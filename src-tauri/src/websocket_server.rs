use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, RwLock};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use tauri::{AppHandle, Emitter};

use serde::Serialize;

use crate::types::{HistoryBar, NtInbound, NtOutbound};
use crate::zmq_hub::OrderTracker;

/// Stores historical bars per data source, keyed by source_id.
pub type HistoryStore = Arc<RwLock<HashMap<String, Vec<HistoryBar>>>>;

/// Account snapshot emitted to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AccountSnapshot {
    pub name: String,
    pub buying_power: f64,
    pub cash: f64,
    pub realized_pnl: f64,
    /// Account-wide unrealized P&L (NT's own aggregate across all positions on the
    /// account, including manual ones). Combined with `realized_pnl` on the home
    /// dashboard so "Day P&L" matches what NT's Control Center displays.
    pub unrealized_pnl: f64,
}

/// Chart info emitted to the frontend when a NinjaTrader chart connects.
#[derive(Debug, Clone, Serialize)]
pub struct ChartInfo {
    pub id: String,
    pub instrument: String,
    pub timeframe: String,
    pub account: String,
}

/// Position update emitted to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct PositionEvent {
    pub source_id: String,
    pub account: String,
    pub symbol: String,
    pub direction: String,
    pub qty: i64,
    pub avg_price: f64,
    pub unrealized_pnl: f64,
}

/// Realized trade event emitted to the frontend. Sourced from NinjaTrader's per-execution
/// P&L computation in the bridge — authoritative relative to the locally-derived unrealized
/// snapshot the frontend previously used.
#[derive(Debug, Clone, Serialize)]
pub struct TradeEvent {
    pub source_id: String,
    pub account: String,
    pub symbol: String,
    pub side: String,
    pub qty: i64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub exit_time: i64,
    pub pnl: f64,
    pub gross_pnl: f64,
    pub commission: f64,
    pub flattens: bool,
    pub order_id: String,
    pub instance_id: String,
}

/// Order update emitted to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct OrderEvent {
    pub source_id: String,
    pub account: String,
    pub instance_id: String,
    pub order_id: String,
    pub state: String,
    pub symbol: String,
    pub side: Option<String>,
    pub filled_qty: Option<i64>,
    pub avg_fill_price: Option<f64>,
    pub fill_price: Option<f64>,
    pub remaining: Option<i64>,
    pub error: Option<String>,
    pub timestamp: Option<i64>,
}

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

    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }

    pub fn get_sender(&self, source_id: &str) -> Option<&mpsc::Sender<NtOutbound>> {
        self.connections.get(source_id)
    }

    /// Returns senders for all active connections.
    pub fn all_senders(&self) -> Vec<&mpsc::Sender<NtOutbound>> {
        self.connections.values().collect()
    }

    /// Find a sender by matching symbol prefix (e.g. "ES 09-26" matches "ES 09-26:5min").
    /// Returns the first match if multiple connections share the same instrument.
    pub fn find_sender_by_symbol(&self, symbol: &str) -> Option<&mpsc::Sender<NtOutbound>> {
        self.connections.iter()
            .find(|(source_id, _)| source_id.starts_with(symbol))
            .map(|(_, sender)| sender)
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
    order_tracker: OrderTracker,
    history_store: HistoryStore,
    app_handle: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = TcpListener::bind(&addr).await?;
    log::info!("WebSocket server listening on ws://{}", addr);

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        log::info!("NinjaTrader connected from {}", peer_addr);

        let inbound_tx = inbound_tx.clone();
        let registry = registry.clone();
        let order_tracker = order_tracker.clone();
        let history_store = history_store.clone();
        let app_handle = app_handle.clone();

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

            // Track the source_id and account this connection registered as
            let source_id: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));
            let source_id_for_cleanup = source_id.clone();
            let account_name: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));
            let account_name_for_cleanup = account_name.clone();

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
                                if let NtInbound::Register { ref instrument, ref timeframe, ref account, .. } = parsed {
                                    let sid = format!("{}:{}", instrument, timeframe);
                                    log::info!("Registering data source: {} account: {} from {}", sid, account, peer_addr);

                                    let mut reg = registry.write().await;
                                    reg.register(sid.clone(), outbound_tx.clone());
                                    let count = reg.connection_count();
                                    drop(reg);

                                    let _ = app_handle.emit("nt-connection-count", count);

                                    // Store account name for this connection
                                    let mut acct_lock = account_name.write().await;
                                    *acct_lock = Some(account.clone());
                                    drop(acct_lock);

                                    // Emit initial account snapshot (zeroed until Account message arrives)
                                    let _ = app_handle.emit("nt-account", AccountSnapshot {
                                        name: account.clone(),
                                        buying_power: 0.0,
                                        cash: 0.0,
                                        realized_pnl: 0.0,
                                        unrealized_pnl: 0.0,
                                    });

                                    // Emit chart connected event
                                    let _ = app_handle.emit("nt-chart", ChartInfo {
                                        id: sid.clone(),
                                        instrument: instrument.clone(),
                                        timeframe: timeframe.clone(),
                                        account: account.clone(),
                                    });

                                    let mut sid_lock = source_id.write().await;
                                    *sid_lock = Some(sid);
                                }

                                // On History, store bars for this data source
                                if let NtInbound::History { ref source_id, ref bars, .. } = parsed {
                                    log::info!("Received {} historical bars for {}", bars.len(), source_id);
                                    let mut store = history_store.write().await;
                                    store.insert(source_id.clone(), bars.clone());
                                }

                                // On Account update, emit with the connection's account name
                                if let NtInbound::Account { buying_power, cash, realized_pnl, unrealized_pnl } = &parsed {
                                    let acct = account_name.read().await;
                                    if let Some(ref name) = *acct {
                                        let _ = app_handle.emit("nt-account", AccountSnapshot {
                                            name: name.clone(),
                                            buying_power: *buying_power,
                                            cash: *cash,
                                            realized_pnl: *realized_pnl,
                                            unrealized_pnl: *unrealized_pnl,
                                        });
                                    }
                                }

                                // On Position update, emit with connection context
                                if let NtInbound::Position { ref source_id, ref symbol, ref direction, qty, avg_price, unrealized_pnl } = parsed {
                                    let acct = account_name.read().await;
                                    if let Some(ref name) = *acct {
                                        let _ = app_handle.emit("nt-position", PositionEvent {
                                            source_id: source_id.clone(),
                                            account: name.clone(),
                                            symbol: symbol.clone(),
                                            direction: direction.clone(),
                                            qty,
                                            avg_price,
                                            unrealized_pnl,
                                        });

                                        // Emit algo-log for position updates
                                        let _ = app_handle.emit("algo-log", serde_json::json!({
                                            "instance_id": "",
                                            "algo_id": "",
                                            "event_type": "POSITION",
                                            "message": format!("{} {} {} @ {:.2} (uPnL: {:.2})", direction, qty, symbol, avg_price, unrealized_pnl),
                                            "timestamp": std::time::SystemTime::now()
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .unwrap_or_default()
                                                .as_millis() as i64,
                                        }));
                                    }
                                }

                                // On Trade (NT-computed realized P&L), emit with connection's account name
                                if let NtInbound::Trade {
                                    ref source_id, ref symbol, ref side, qty,
                                    entry_price, exit_price, exit_time,
                                    pnl, gross_pnl, commission, flattens,
                                    ref order_id, ref instance_id,
                                } = parsed {
                                    let acct = account_name.read().await;
                                    if let Some(ref name) = *acct {
                                        let _ = app_handle.emit("nt-trade", TradeEvent {
                                            source_id: source_id.clone(),
                                            account: name.clone(),
                                            symbol: symbol.clone(),
                                            side: side.clone(),
                                            qty,
                                            entry_price,
                                            exit_price,
                                            exit_time,
                                            pnl,
                                            gross_pnl,
                                            commission,
                                            flattens,
                                            order_id: order_id.clone(),
                                            instance_id: instance_id.clone(),
                                        });
                                    }
                                }

                                // On OrderUpdate, emit with connection context
                                if let NtInbound::OrderUpdate { source_id: ref msg_source_id, ref instance_id, ref order_id, ref state, filled_qty, avg_fill_price, fill_price, remaining, ref error, timestamp } = parsed {
                                    let acct = account_name.read().await;
                                    // Get symbol from the connection's source_id (e.g. "ES 09-26:5min" -> "ES 09-26")
                                    let conn_sid = source_id.read().await;
                                    let symbol = conn_sid.as_ref().map(|s| s.split(':').next().unwrap_or("").to_string()).unwrap_or_default();
                                    drop(conn_sid);

                                    // Look up order side from the tracker
                                    let tracker = order_tracker.lock().await;
                                    let side = tracker.get(order_id).map(|p| p.side.clone());
                                    drop(tracker);

                                    if let Some(ref name) = *acct {
                                        let side_clone = side.clone();
                                        let _ = app_handle.emit("nt-order-update", OrderEvent {
                                            source_id: msg_source_id.clone(),
                                            account: name.clone(),
                                            instance_id: instance_id.clone(),
                                            order_id: order_id.clone(),
                                            state: state.clone(),
                                            symbol,
                                            side,
                                            filled_qty,
                                            avg_fill_price,
                                            fill_price,
                                            remaining,
                                            error: error.clone(),
                                            timestamp,
                                        });
                                        // Emit algo-log for live fills
                                        if state == "filled" || state == "Filled" {
                                            let _ = app_handle.emit("algo-log", serde_json::json!({
                                                "instance_id": instance_id,
                                                "algo_id": "",
                                                "event_type": "FILL",
                                                "message": format!("{} {} @ {:.2} filled",
                                                    side_clone.as_deref().unwrap_or("?"),
                                                    filled_qty.unwrap_or(0),
                                                    fill_price.unwrap_or(0.0)),
                                                "timestamp": timestamp.unwrap_or_else(|| {
                                                    std::time::SystemTime::now()
                                                        .duration_since(std::time::UNIX_EPOCH)
                                                        .unwrap_or_default()
                                                        .as_millis() as i64
                                                }),
                                            }));
                                        }
                                    }
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
            if let Some(ref sid) = sid {
                log::info!("Unregistering data source: {}", sid);
                let mut reg = registry.write().await;
                reg.unregister(sid);
                let count = reg.connection_count();
                drop(reg);

                let _ = app_handle.emit("nt-connection-count", count);
                let _ = app_handle.emit("nt-chart-removed", sid.clone());
            }

            // Notify frontend that this account disconnected
            let acct = account_name_for_cleanup.read().await.clone();
            if let Some(name) = acct {
                let _ = app_handle.emit("nt-account-removed", name);
            }

            outbound_task.abort();
        });
    }
}
