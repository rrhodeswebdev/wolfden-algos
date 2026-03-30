use std::sync::Arc;
use bytes::Bytes;
use tokio::sync::{broadcast, RwLock};
use zeromq::prelude::*;
use zeromq::{PubSocket, PullSocket, ZmqMessage};

use crate::types::{NtInbound, NtOutbound, BracketLeg};
use crate::websocket_server::ConnectionRegistry;

/// Addresses for ZMQ sockets.
fn addresses() -> (&'static str, &'static str) {
    if cfg!(target_os = "windows") {
        ("tcp://127.0.0.1:5555", "tcp://127.0.0.1:5556")
    } else {
        ("ipc:///tmp/wolfden-market-data", "ipc:///tmp/wolfden-trade-signals")
    }
}

pub fn market_data_addr() -> &'static str {
    addresses().0
}

pub fn trade_signal_addr() -> &'static str {
    addresses().1
}

/// Starts the ZMQ PUB socket that fans out market data to Python algo processes.
/// Subscribes to the WebSocket inbound broadcast and re-publishes ticks/bars as
/// msgpack-encoded messages with topic-based routing.
pub async fn start_publisher(
    mut inbound_rx: broadcast::Receiver<NtInbound>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut pub_socket = PubSocket::new();
    let addr = market_data_addr();
    pub_socket.bind(addr).await?;
    log::info!("ZMQ PUB socket bound to {}", addr);

    loop {
        match inbound_rx.recv().await {
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
    Ok(())
}

/// Sends a fill notification to a specific algo instance via the PUB socket.
pub async fn send_fill(
    pub_socket: &mut PubSocket,
    instance_id: &str,
    symbol: &str,
    side: &str,
    qty: i64,
    price: f64,
    order_id: &str,
    timestamp: i64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let topic = format!("fill:{}", instance_id);
    let payload = rmp_serde::to_vec(&serde_json::json!({
        "type": "fill",
        "symbol": symbol,
        "side": side,
        "qty": qty,
        "price": price,
        "order_id": order_id,
        "timestamp": timestamp,
    }))?;
    send_pub(pub_socket, &topic, &payload).await
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
                        if let Err(e) = route_trade_signal(&val, &registry).await {
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

            let outbound = NtOutbound::Order {
                id: order_id,
                instance_id: instance_id.clone(),
                algo_id,
                action: action.to_string(),
                symbol: symbol.clone(),
                qty,
                order_type,
                limit_price,
                stop_price,
            };

            // Find the connection that owns the symbol
            // The source_id format is "SYMBOL:timeframe", so we match by symbol prefix
            let reg = registry.read().await;
            if let Some(sender) = reg.find_sender_by_symbol(&symbol) {
                sender.send(outbound).await.map_err(|e| format!("Send to WS failed: {}", e))?;
                log::info!("Routed order from instance {} to NinjaTrader", instance_id);
            } else {
                log::warn!("No WebSocket connection found for symbol {}", symbol);
            }
        }
        "heartbeat" => {
            // Algo heartbeat — log for now
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("?");
            let status = val.get("status").and_then(|v| v.as_str()).unwrap_or("?");
            log::debug!("Algo heartbeat: instance={} status={}", instance_id, status);
        }
        _ => {
            log::warn!("Unknown trade signal type: {}", msg_type);
        }
    }

    Ok(())
}
