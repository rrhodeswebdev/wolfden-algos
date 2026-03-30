use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, RwLock};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use crate::types::{NtInbound, NtOutbound};

/// Tracks which WebSocket connection owns which data source,
/// enabling targeted outbound routing of orders.
pub struct ConnectionRegistry {
    /// Maps source_id -> per-connection sender for outbound messages
    connections: HashMap<String, mpsc::Sender<NtOutbound>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        ConnectionRegistry {
            connections: HashMap::new(),
        }
    }

    pub fn register(&mut self, source_id: String, sender: mpsc::Sender<NtOutbound>) {
        self.connections.insert(source_id, sender);
    }

    pub fn unregister(&mut self, source_id: &str) {
        self.connections.remove(source_id);
    }

    pub fn get_sender(&self, source_id: &str) -> Option<&mpsc::Sender<NtOutbound>> {
        self.connections.get(source_id)
    }
}

/// Starts the WebSocket server that NinjaTrader connects to.
/// Each NinjaTrader chart runs a WolfDenBridge indicator that opens
/// its own WebSocket connection and sends a Register message identifying
/// the instrument, timeframe, and account.
///
/// Inbound messages (market data) are broadcast to all listeners.
/// Outbound messages (orders) are routed to the specific connection
/// that owns the target data source.
pub async fn start(
    port: u16,
    inbound_tx: broadcast::Sender<NtInbound>,
    registry: Arc<RwLock<ConnectionRegistry>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = TcpListener::bind(&addr).await?;
    log::info!("WebSocket server listening on ws://{}", addr);

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        log::info!("NinjaTrader connected from {}", peer_addr);

        let inbound_tx = inbound_tx.clone();
        let registry = registry.clone();

        tokio::spawn(async move {
            let ws_stream = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(e) => {
                    log::error!("WebSocket handshake failed: {}", e);
                    return;
                }
            };

            let (mut ws_sink, mut ws_stream_rx) = ws_stream.split();

            // Per-connection outbound channel for targeted order routing
            let (outbound_tx, mut outbound_rx) = mpsc::channel::<NtOutbound>(64);

            // Track the source_id this connection registered as
            let source_id: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));
            let source_id_for_cleanup = source_id.clone();

            // Spawn a task to forward outbound messages to this WebSocket
            let outbound_task = tokio::spawn(async move {
                while let Some(msg) = outbound_rx.recv().await {
                    match serde_json::to_string(&msg) {
                        Ok(json) => {
                            if ws_sink.send(Message::Text(json.into())).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to serialize outbound message: {}", e);
                        }
                    }
                }
            });

            // Read inbound messages from NinjaTrader
            while let Some(msg_result) = ws_stream_rx.next().await {
                match msg_result {
                    Ok(Message::Text(text)) => {
                        match serde_json::from_str::<NtInbound>(&text) {
                            Ok(parsed) => {
                                // On Register, store this connection in the registry
                                if let NtInbound::Register { ref instrument, ref timeframe, .. } = parsed {
                                    let sid = format!("{}:{}", instrument, timeframe);
                                    log::info!("Registering data source: {} from {}", sid, peer_addr);

                                    let mut reg = registry.write().await;
                                    reg.register(sid.clone(), outbound_tx.clone());

                                    let mut sid_lock = source_id.write().await;
                                    *sid_lock = Some(sid);
                                }

                                let _ = inbound_tx.send(parsed);
                            }
                            Err(e) => {
                                log::warn!("Failed to parse NT message: {} — raw: {}", e, text);
                            }
                        }
                    }
                    Ok(Message::Ping(_)) => {}
                    Ok(Message::Close(_)) => {
                        log::info!("NinjaTrader disconnected from {}", peer_addr);
                        break;
                    }
                    Err(e) => {
                        log::error!("WebSocket error from {}: {}", peer_addr, e);
                        break;
                    }
                    _ => {}
                }
            }

            // Cleanup: remove this connection from the registry
            let sid = source_id_for_cleanup.read().await.clone();
            if let Some(sid) = sid {
                log::info!("Unregistering data source: {}", sid);
                let mut reg = registry.write().await;
                reg.unregister(&sid);
            }

            outbound_task.abort();
        });
    }
}
