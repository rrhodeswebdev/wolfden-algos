use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use bytes::Bytes;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};
use zeromq::prelude::*;
use zeromq::{PubSocket, PullSocket, ZmqMessage};

use tauri::{AppHandle, Emitter};

use crate::types::{NtInbound, NtOutbound};
use crate::websocket_server::{ConnectionRegistry, OrderEvent, PositionEvent};

/// Tracks in-flight orders so we can reconstruct fill messages
/// when NinjaTrader sends back OrderUpdate (which lacks side/symbol).
#[derive(Clone)]
pub struct PendingOrder {
    pub side: String,
    pub symbol: String,
    pub algo_id: String,
    pub instance_id: String,
    pub order_type: String,
}

/// Shared order tracker between the publisher (reads) and order receiver (writes).
pub type OrderTracker = Arc<Mutex<HashMap<String, PendingOrder>>>;

/// Addresses for ZMQ sockets.
fn addresses() -> (&'static str, &'static str) {
    if cfg!(target_os = "windows") {
        ("tcp://127.0.0.1:5555", "tcp://127.0.0.1:5556")
    } else {
        ("ipc:///tmp/wolfden-market-data", "ipc:///tmp/wolfden-trade-signals")
    }
}

/// Remove stale IPC socket files left over from a previous run.
/// Must be called once at startup before binding any ZMQ sockets.
pub fn cleanup_ipc_files() {
    if cfg!(not(target_os = "windows")) {
        let (pub_addr, pull_addr) = addresses();
        for addr in [pub_addr, pull_addr] {
            if let Some(path) = addr.strip_prefix("ipc://") {
                if std::path::Path::new(path).exists() {
                    let _ = std::fs::remove_file(path);
                    log::info!("Removed stale IPC socket: {}", path);
                }
            }
        }
    }
}

pub fn market_data_addr() -> &'static str {
    addresses().0
}

pub fn trade_signal_addr() -> &'static str {
    addresses().1
}

/// Starts the ZMQ PUB socket that fans out market data to Python algo processes.
/// Subscribes to the WebSocket inbound broadcast and re-publishes ticks/bars/fills as
/// msgpack-encoded messages with topic-based routing.
/// Also drains the ack channel to send order_accepted acknowledgments to algos.
pub async fn start_publisher(
    mut inbound_rx: broadcast::Receiver<NtInbound>,
    order_tracker: OrderTracker,
    mut ack_rx: mpsc::Receiver<(String, Vec<u8>)>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut pub_socket = PubSocket::new();
    let addr = market_data_addr();
    pub_socket.bind(addr).await?;
    log::info!("ZMQ PUB socket bound to {}", addr);

    loop {
        tokio::select! {
            recv_result = inbound_rx.recv() => {
                match recv_result {
                    Ok(msg) => {
                        let result = match &msg {
                            NtInbound::Tick { source_id, symbol, price, size, timestamp, .. } => {
                                let topic = format!("md:{}:tick", source_id);
                                let payload = rmp_serde::to_vec(&serde_json::json!({
                                    "type": "tick",
                                    "symbol": symbol,
                                    "price": price,
                                    "size": size,
                                    "timestamp": timestamp,
                                }))?;
                                send_pub(&mut pub_socket, &topic, &payload).await
                            }
                            NtInbound::Bar { source_id, symbol, o, h, l, c, v, timestamp } => {
                                let topic = format!("md:{}:bar", source_id);
                                let payload = rmp_serde::to_vec(&serde_json::json!({
                                    "type": "bar",
                                    "symbol": symbol,
                                    "o": o, "h": h, "l": l, "c": c, "v": v,
                                    "timestamp": timestamp,
                                }))?;
                                send_pub(&mut pub_socket, &topic, &payload).await
                            }
                            NtInbound::History { source_id, symbol, ref bars } => {
                                let topic = format!("history:{}", source_id);
                                let bars_json: Vec<serde_json::Value> = bars.iter().map(|b| {
                                    serde_json::json!({
                                        "o": b.o, "h": b.h, "l": b.l, "c": b.c,
                                        "v": b.v, "t": b.timestamp,
                                    })
                                }).collect();
                                let payload = rmp_serde::to_vec(&serde_json::json!({
                                    "type": "history",
                                    "symbol": symbol,
                                    "source_id": source_id,
                                    "bars": bars_json,
                                }))?;
                                log::info!("Publishing {} historical bars on topic {}", bars.len(), topic);
                                // Use a timeout to prevent large history sends from
                                // blocking the publisher loop (starving tick/bar delivery).
                                match tokio::time::timeout(
                                    Duration::from_secs(5),
                                    send_pub(&mut pub_socket, &topic, &payload),
                                ).await {
                                    Ok(result) => result,
                                    Err(_) => {
                                        log::warn!("History publish timed out after 5s ({} bars) — skipping to unblock tick delivery", bars.len());
                                        Ok(())
                                    }
                                }
                            }
                            NtInbound::OrderUpdate {
                                instance_id, order_id, state, filled_qty,
                                fill_price, timestamp, ..
                            } if state == "filled" || state == "partFilled" => {
                                let is_filled = state == "filled";
                                let mut tracker = order_tracker.lock().await;
                                if let Some(pending) = tracker.get(order_id) {
                                    let qty = filled_qty.unwrap_or(0);
                                    let price = fill_price.unwrap_or(0.0);
                                    let ts = timestamp.unwrap_or(0);
                                    let topic = format!("fill:{}", instance_id);
                                    let symbol = pending.symbol.clone();
                                    let side = pending.side.clone();
                                    // Remove filled orders from tracker to prevent memory leak.
                                    // partFilled orders are kept for subsequent fill updates.
                                    if is_filled {
                                        tracker.remove(order_id);
                                    }
                                    drop(tracker);
                                    let payload = rmp_serde::to_vec(&serde_json::json!({
                                        "type": "fill",
                                        "symbol": symbol,
                                        "side": side,
                                        "qty": qty,
                                        "price": price,
                                        "order_id": order_id,
                                        "timestamp": ts,
                                    }))?;
                                    send_pub(&mut pub_socket, &topic, &payload).await
                                } else {
                                    log::warn!("OrderUpdate for unknown order_id={}", order_id);
                                    Ok(())
                                }
                            }
                            // Clean up tracker on terminal order states (cancelled/rejected only;
                            // filled is handled above)
                            NtInbound::OrderUpdate { order_id, state, .. }
                                if state == "cancelled" || state == "rejected" =>
                            {
                                let mut tracker = order_tracker.lock().await;
                                tracker.remove(order_id);
                                Ok(())
                            }
                            _ => Ok(()),
                        };
                        if let Err(e) = result {
                            log::warn!("ZMQ PUB send error: {}", e);
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("ZMQ publisher lagged by {} messages", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        log::info!("ZMQ publisher: inbound channel closed");
                        break;
                    }
                }
            }
            ack = ack_rx.recv() => {
                match ack {
                    Some((topic, payload)) => {
                        if let Err(e) = send_pub(&mut pub_socket, &topic, &payload).await {
                            log::warn!("ZMQ PUB ack send error: {}", e);
                        }
                    }
                    None => {
                        log::info!("ZMQ publisher: ack channel closed");
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}

async fn send_pub(
    socket: &mut PubSocket,
    topic: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut msg = ZmqMessage::from(Bytes::from(topic.to_string()));
    msg.push_back(Bytes::copy_from_slice(payload));
    socket.send(msg).await?;
    Ok(())
}

/// Starts the ZMQ PULL socket that collects trade signals from Python algo processes
/// and routes them to the correct NinjaTrader WebSocket connection.
pub async fn start_order_receiver(
    registry: Arc<RwLock<ConnectionRegistry>>,
    order_tracker: OrderTracker,
    ack_tx: mpsc::Sender<(String, Vec<u8>)>,
    app_handle: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut pull_socket = PullSocket::new();
    let addr = trade_signal_addr();
    pull_socket.bind(addr).await?;
    log::info!("ZMQ PULL socket bound to {}", addr);

    loop {
        match pull_socket.recv().await {
            Ok(msg) => {
                // Single-frame msgpack message from Python PUSH socket
                let data = if let Some(frame) = msg.get(0) {
                    frame.clone()
                } else {
                    continue;
                };

                match rmp_serde::from_slice::<serde_json::Value>(&data) {
                    Ok(val) => {
                        log::info!("ZMQ PULL received: {}", val);
                        if let Err(e) = route_trade_signal(&val, &registry, &order_tracker, &ack_tx, &app_handle).await {
                            log::warn!("Failed to route trade signal: {}", e);
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to deserialize trade signal: {}", e);
                    }
                }
            }
            Err(e) => {
                log::error!("ZMQ PULL recv error: {}", e);
                break;
            }
        }
    }
    Ok(())
}

/// Routes a trade signal from a Python algo to the correct WebSocket connection.
async fn route_trade_signal(
    val: &serde_json::Value,
    registry: &Arc<RwLock<ConnectionRegistry>>,
    order_tracker: &OrderTracker,
    ack_tx: &mpsc::Sender<(String, Vec<u8>)>,
    app_handle: &AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "order" => {
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let algo_id = val.get("algo_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let side = val.get("side").and_then(|v| v.as_str()).unwrap_or("BUY");
            let symbol = val.get("symbol").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let qty = val.get("qty").and_then(|v| v.as_i64()).unwrap_or(0);
            let order_type = val.get("order_type").and_then(|v| v.as_str()).unwrap_or("MARKET").to_string();
            let limit_price = val.get("limit_price").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let stop_price = val.get("stop_price").and_then(|v| v.as_f64()).unwrap_or(0.0);

            let action = match side {
                "BUY" => "BUY",
                "SELL" => "SELL",
                _ => "BUY",
            };

            let order_id = uuid::Uuid::new_v4().to_string();

            // Track order so we can reconstruct fills when OrderUpdate arrives
            {
                let mut tracker = order_tracker.lock().await;
                tracker.insert(order_id.clone(), PendingOrder {
                    side: action.to_string(),
                    symbol: symbol.clone(),
                    algo_id: algo_id.clone(),
                    instance_id: instance_id.clone(),
                    order_type: order_type.clone(),
                });
            }

            let outbound = NtOutbound::Order {
                id: order_id.clone(),
                instance_id: instance_id.clone(),
                algo_id: algo_id.clone(),
                action: action.to_string(),
                symbol: symbol.clone(),
                qty,
                order_type: order_type.clone(),
                limit_price,
                stop_price,
            };

            // Find the connection that owns the symbol
            let reg = registry.read().await;
            if let Some(sender) = reg.find_sender_by_symbol(&symbol) {
                sender.send(outbound).await.map_err(|e| format!("Send to WS failed: {}", e))?;
                log::info!("Routed order {} from instance {} to NinjaTrader", order_id, instance_id);

                // Emit algo-log for the order
                let _ = app_handle.emit("algo-log", serde_json::json!({
                    "instance_id": instance_id,
                    "algo_id": algo_id,
                    "event_type": "ORDER",
                    "message": format!("{} {} {} @ {} → NinjaTrader", side, qty, symbol, order_type),
                    "timestamp": std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64,
                }));

                // Send order_accepted acknowledgment back to the algo
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;
                let topic = format!("ack:{}", instance_id);
                let payload = rmp_serde::to_vec(&serde_json::json!({
                    "type": "order_accepted",
                    "order_id": order_id,
                    "timestamp": now_ms,
                }))?;
                let _ = ack_tx.send((topic, payload)).await;
            } else {
                log::warn!("No WebSocket connection found for symbol {}", symbol);
            }
        }
        "modify" => {
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("");
            let order_id = val.get("order_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let qty = val.get("qty").and_then(|v| v.as_i64()).unwrap_or(0);
            let limit_price = val.get("limit_price").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let stop_price = val.get("stop_price").and_then(|v| v.as_f64()).unwrap_or(0.0);

            let outbound = NtOutbound::Modify {
                order_id: order_id.clone(),
                qty,
                limit_price,
                stop_price,
            };

            // Look up symbol from tracker to route to the correct connection
            let tracker = order_tracker.lock().await;
            let symbol = tracker.get(&order_id).map(|p| p.symbol.clone());
            drop(tracker);

            if let Some(symbol) = symbol {
                let reg = registry.read().await;
                if let Some(sender) = reg.find_sender_by_symbol(&symbol) {
                    sender.send(outbound).await.map_err(|e| format!("Send modify to WS failed: {}", e))?;
                    log::info!("Routed modify for order {} from instance {} to NinjaTrader", order_id, instance_id);
                } else {
                    log::warn!("No WebSocket connection found for symbol {}", symbol);
                }
            } else {
                log::warn!("Modify for unknown order_id={}", order_id);
            }
        }
        "cancel" => {
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("");
            let order_id = val.get("order_id").and_then(|v| v.as_str()).unwrap_or("").to_string();

            let outbound = NtOutbound::Cancel {
                order_id: order_id.clone(),
            };

            // Look up symbol from tracker to route, then remove
            let tracker = order_tracker.lock().await;
            let symbol = tracker.get(&order_id).map(|p| p.symbol.clone());
            drop(tracker);

            if let Some(symbol) = symbol {
                let reg = registry.read().await;
                if let Some(sender) = reg.find_sender_by_symbol(&symbol) {
                    sender.send(outbound).await.map_err(|e| format!("Send cancel to WS failed: {}", e))?;
                    log::info!("Routed cancel for order {} from instance {} to NinjaTrader", order_id, instance_id);
                } else {
                    log::warn!("No WebSocket connection found for symbol {}", symbol);
                }
                // Remove from tracker after sending cancel
                let mut tracker = order_tracker.lock().await;
                tracker.remove(&order_id);
            } else {
                log::warn!("Cancel for unknown order_id={}", order_id);
            }
        }
        "shadow_fill" => {
            // Shadow mode simulated fill — emit to frontend as order + position events
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let algo_id = val.get("algo_id").and_then(|v| v.as_str()).unwrap_or("");
            let symbol = val.get("symbol").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let side = val.get("side").and_then(|v| v.as_str()).unwrap_or("BUY").to_string();
            let qty = val.get("qty").and_then(|v| v.as_i64()).unwrap_or(0);
            let price = val.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let order_id = val.get("order_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let position = val.get("position").and_then(|v| v.as_i64()).unwrap_or(0);
            let unrealized_pnl = val.get("unrealized_pnl").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let timestamp = val.get("timestamp").and_then(|v| v.as_i64());

            // Emit as order fill event
            let _ = app_handle.emit("nt-order-update", OrderEvent {
                source_id: String::new(),
                account: String::from("shadow"),
                instance_id: instance_id.clone(),
                order_id: order_id.clone(),
                state: String::from("filled"),
                symbol: symbol.clone(),
                side: Some(side.clone()),
                filled_qty: Some(qty),
                avg_fill_price: Some(price),
                fill_price: Some(price),
                remaining: Some(0),
                error: None,
                timestamp,
            });

            // Emit position update
            let direction = if position > 0 {
                "Long"
            } else if position < 0 {
                "Short"
            } else {
                "Flat"
            };
            let entry_price = val.get("entry_price").and_then(|v| v.as_f64()).unwrap_or(price);
            let _ = app_handle.emit("nt-position", PositionEvent {
                source_id: String::new(),
                account: String::from("shadow"),
                symbol: symbol.clone(),
                direction: direction.to_string(),
                qty: position.abs(),
                avg_price: entry_price,
                unrealized_pnl,
            });

            log::info!("Shadow fill: instance={} algo={} order={}", instance_id, algo_id, order_id);

            // Emit algo-log for the fill
            let _ = app_handle.emit("algo-log", serde_json::json!({
                "instance_id": instance_id,
                "algo_id": algo_id,
                "event_type": "FILL",
                "message": format!("{} {} {} @ {:.2} filled", side, qty, symbol, price),
                "timestamp": timestamp.unwrap_or_else(|| {
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64
                }),
            }));
        }
        "shadow_position" => {
            // Throttled position update for live P&L tracking in shadow mode
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("");
            let symbol = val.get("symbol").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let position = val.get("position").and_then(|v| v.as_i64()).unwrap_or(0);
            let entry_price = val.get("entry_price").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let unrealized_pnl = val.get("unrealized_pnl").and_then(|v| v.as_f64()).unwrap_or(0.0);

            let direction = if position > 0 {
                "Long"
            } else if position < 0 {
                "Short"
            } else {
                "Flat"
            };
            let _ = app_handle.emit("nt-position", PositionEvent {
                source_id: String::new(),
                account: String::from("shadow"),
                symbol,
                direction: direction.to_string(),
                qty: position.abs(),
                avg_price: entry_price,
                unrealized_pnl,
            });

            log::trace!("Shadow position update: instance={}", instance_id);
        }
        "backtest_result" => {
            // Backtest results from a shadow algo — emit to frontend
            log::info!("Backtest result received: {}", val);
            let _ = app_handle.emit("algo-backtest-result", val.clone());
        }
        "heartbeat" => {
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("?").to_string();
            let algo_id = val.get("algo_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let status = val.get("status").and_then(|v| v.as_str()).unwrap_or("?");
            let timestamp = val.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
            log::debug!("Algo heartbeat: instance={} status={}", instance_id, status);

            let _ = app_handle.emit("algo-log", serde_json::json!({
                "instance_id": instance_id,
                "algo_id": algo_id,
                "event_type": "HEARTBEAT",
                "message": format!("Algo heartbeat: {}", status),
                "timestamp": timestamp,
            }));
        }
        "algo_error" => {
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let algo_id = val.get("algo_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let severity = val.get("severity").and_then(|v| v.as_str()).unwrap_or("error").to_string();
            let category = val.get("category").and_then(|v| v.as_str()).unwrap_or("runtime").to_string();
            let message = val.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let handler = val.get("handler").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let traceback = val.get("traceback").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let timestamp = val.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);

            log::warn!("Algo error: instance={} severity={} category={} message={}", instance_id, severity, category, message);

            let _ = app_handle.emit("algo-error", serde_json::json!({
                "instance_id": instance_id,
                "algo_id": algo_id,
                "severity": severity,
                "category": category,
                "message": message,
                "handler": handler,
                "traceback": traceback,
                "timestamp": timestamp,
            }));

            // Also emit as algo-log for the log panel
            let _ = app_handle.emit("algo-log", serde_json::json!({
                "instance_id": instance_id,
                "algo_id": algo_id,
                "event_type": "ERROR",
                "message": message,
                "timestamp": timestamp,
            }));
        }
        _ => {
            log::warn!("Unknown trade signal type: {}", msg_type);
        }
    }

    Ok(())
}
