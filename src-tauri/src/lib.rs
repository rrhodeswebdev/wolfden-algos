mod ai_terminal;
mod db;
mod process_manager;
mod websocket_server;
mod zmq_hub;
mod commands;
mod types;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::{broadcast, RwLock};

/// Shared WebSocket state so commands can access the connection registry
/// and inbound broadcast channel.
pub struct WsState {
    pub registry: Arc<RwLock<websocket_server::ConnectionRegistry>>,
    pub inbound_tx: broadcast::Sender<types::NtInbound>,
    pub order_tracker: zmq_hub::OrderTracker,
    pub history_store: websocket_server::HistoryStore,
}

/// Shared process manager state for commands to spawn/stop algo processes.
pub struct ProcState(pub process_manager::ProcessManager);

/// Shared AI terminal state for Claude Code PTY sessions.
pub struct AiTermState(pub ai_terminal::AiTerminalManager);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize SQLite database
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create data dir");
            let db_path = data_dir.join("wolf_den.db");
            let db = db::initialize(&db_path).expect("failed to initialize database");
            app.manage(db::DbState(std::sync::Mutex::new(db)));

            log::info!("Wolf Den initialized. Database at {:?}", db_path);

            // Initialize process manager
            app.manage(ProcState(process_manager::ProcessManager::new(data_dir.clone())));

            // Initialize AI terminal manager
            app.manage(AiTermState(ai_terminal::AiTerminalManager::new(db_path.clone())));

            // Start WebSocket server for NinjaTrader connections
            let (inbound_tx, _) = broadcast::channel(256);
            let registry = Arc::new(RwLock::new(websocket_server::ConnectionRegistry::new()));

            // Clean up stale IPC socket files from previous runs
            zmq_hub::cleanup_ipc_files();

            // Shared order tracker for fill routing
            let order_tracker = std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::<String, zmq_hub::PendingOrder>::new(),
            ));

            let history_store: websocket_server::HistoryStore = Arc::new(RwLock::new(
                std::collections::HashMap::new(),
            ));

            app.manage(WsState {
                registry: registry.clone(),
                inbound_tx: inbound_tx.clone(),
                order_tracker: order_tracker.clone(),
                history_store: history_store.clone(),
            });

            let port: u16 = 9000;
            let handle = app.handle().clone();
            let ws_inbound_tx = inbound_tx.clone();
            let ws_registry = registry.clone();
            let ws_tracker = order_tracker.clone();
            let ws_history = history_store.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = websocket_server::start(port, ws_inbound_tx, ws_registry, ws_tracker, ws_history, handle).await {
                    log::error!("WebSocket server error: {}", e);
                }
            });

            // Ack channel for order_accepted messages from order receiver to publisher
            let (ack_tx, ack_rx) = tokio::sync::mpsc::channel::<(String, Vec<u8>)>(64);

            // Start ZMQ PUB socket (market data + fill fan-out to Python algos)
            let zmq_inbound_rx = inbound_tx.subscribe();
            let pub_tracker = order_tracker.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = zmq_hub::start_publisher(zmq_inbound_rx, pub_tracker, ack_rx).await {
                    log::error!("ZMQ publisher error: {}", e);
                }
            });

            // Start ZMQ PULL socket (trade signals from Python algos → WebSocket)
            let pull_registry = registry.clone();
            let pull_tracker = order_tracker.clone();
            let pull_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = zmq_hub::start_order_receiver(pull_registry, pull_tracker, ack_tx, pull_handle).await {
                    log::error!("ZMQ order receiver error: {}", e);
                }
            });

            // Persist data sources to DB when NinjaTrader charts register
            let db_rx = inbound_tx.subscribe();
            let db_path_for_ds = db_path.clone();
            tauri::async_runtime::spawn(async move {
                let conn = match rusqlite::Connection::open(&db_path_for_ds) {
                    Ok(c) => c,
                    Err(e) => { log::error!("DB open for data source upsert failed: {}", e); return; }
                };
                let mut rx = db_rx;
                loop {
                    match rx.recv().await {
                        Ok(types::NtInbound::Register { ref instrument, ref timeframe, ref account, .. }) => {
                            let id = format!("{}:{}", instrument, timeframe);
                            if let Err(e) = db::upsert_data_source(&conn, &id, instrument, timeframe, account) {
                                log::error!("Failed to upsert data source: {}", e);
                            }
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                        _ => {}
                    }
                }
            });

            // Persist filled trades to DB when NinjaTrader sends OrderUpdate
            let trade_rx = inbound_tx.subscribe();
            let trade_db_path = db_path.clone();
            let trade_tracker = order_tracker.clone();
            tauri::async_runtime::spawn(async move {
                let conn = match rusqlite::Connection::open(&trade_db_path) {
                    Ok(c) => c,
                    Err(e) => { log::error!("DB open for trade persistence failed: {}", e); return; }
                };
                let session_id = match db::get_or_create_active_session(&conn) {
                    Ok(id) => id,
                    Err(e) => { log::error!("Failed to get/create session: {}", e); return; }
                };
                let mut rx = trade_rx;
                loop {
                    match rx.recv().await {
                        Ok(types::NtInbound::OrderUpdate {
                            ref order_id, ref state, filled_qty, fill_price, timestamp, ..
                        }) if state == "filled" => {
                            let tracker = trade_tracker.lock().await;
                            if let Some(pending) = tracker.get(order_id) {
                                let qty = filled_qty.unwrap_or(0);
                                let price = fill_price.unwrap_or(0.0);
                                let ts = timestamp.unwrap_or(0);
                                let filled_at = if ts > 0 {
                                    // Store as epoch seconds string — consistent with SQLite datetime
                                    (ts / 1000).to_string()
                                } else {
                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs();
                                    now.to_string()
                                };

                                let algo_id: i64 = pending.algo_id.parse().unwrap_or(0);
                                if let Err(e) = db::insert_trade(
                                    &conn,
                                    session_id,
                                    algo_id,
                                    &pending.instance_id,
                                    &pending.symbol,
                                    &pending.side,
                                    qty,
                                    price,
                                    &filled_at,
                                    Some(&pending.order_type),
                                ) {
                                    log::error!("Failed to persist trade: {}", e);
                                }
                            }
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                        _ => {}
                    }
                }
            });

            log::info!("WebSocket server starting on port {}", port);
            log::info!("ZMQ hub starting (market data + trade signals)");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_algos,
            commands::create_algo,
            commands::update_algo,
            commands::delete_algo,
            commands::get_sessions,
            commands::get_trades,
            commands::get_algo_runs,
            commands::get_data_sources,
            commands::get_algo_instances,
            commands::create_algo_instance,
            commands::start_algo_instance,
            commands::stop_algo_instance,
            commands::update_instance_risk,
            commands::delete_algo_instance,
            commands::spawn_ai_terminal,
            commands::write_ai_terminal,
            commands::resize_ai_terminal,
            commands::close_ai_terminal,
            commands::get_active_ai_terminals,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("Window close requested — shutting down algos and flattening positions");

                let app = window.app_handle();

                // 1. Kill all running algo processes
                if let Some(proc_state) = app.try_state::<ProcState>() {
                    if let Some(db_state) = app.try_state::<db::DbState>() {
                        proc_state.0.stop_all(&db_state);
                    }
                }

                // 2. Kill all AI terminal PTY sessions
                if let Some(ai_state) = app.try_state::<AiTermState>() {
                    ai_state.0.close_all();
                }

                // 3. Send Flatten to every connected NinjaTrader chart
                if let Some(ws_state) = app.try_state::<WsState>() {
                    let registry = ws_state.registry.clone();
                    // Use block_on since we're in a sync callback
                    tauri::async_runtime::block_on(async {
                        let reg = registry.read().await;
                        for sender in reg.all_senders() {
                            if let Err(e) = sender.send(types::NtOutbound::Flatten).await {
                                log::warn!("Failed to send Flatten: {}", e);
                            }
                        }
                    });
                }

                log::info!("Shutdown cleanup complete");
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
