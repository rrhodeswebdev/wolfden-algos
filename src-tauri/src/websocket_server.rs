use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use crate::types::{NtInbound, NtOutbound};

/// Starts the WebSocket server that NinjaTrader connects to.
/// Returns a broadcast sender for outbound messages (orders → NT)
/// and spawns a task that publishes inbound messages (market data → app).
pub async fn start(
    port: u16,
    inbound_tx: broadcast::Sender<NtInbound>,
    mut outbound_rx: broadcast::Receiver<NtOutbound>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = TcpListener::bind(&addr).await?;
    log::info!("WebSocket server listening on ws://{}", addr);

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        log::info!("NinjaTrader connected from {}", peer_addr);

        let inbound_tx = inbound_tx.clone();
        let outbound_tx_for_clone = inbound_tx.clone();

        tokio::spawn(async move {
            let ws_stream = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(e) => {
                    log::error!("WebSocket handshake failed: {}", e);
                    return;
                }
            };

            let (mut ws_sink, mut ws_stream_rx) = ws_stream.split();

            // Read inbound messages from NinjaTrader
            while let Some(msg_result) = ws_stream_rx.next().await {
                match msg_result {
                    Ok(Message::Text(text)) => {
                        match serde_json::from_str::<NtInbound>(&text) {
                            Ok(parsed) => {
                                let _ = inbound_tx.send(parsed);
                            }
                            Err(e) => {
                                log::warn!("Failed to parse NT message: {} — raw: {}", e, text);
                            }
                        }
                    }
                    Ok(Message::Ping(data)) => {
                        let _ = ws_sink.send(Message::Pong(data)).await;
                    }
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
        });
    }
}
