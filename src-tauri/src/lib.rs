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
}

/// Shared process manager state for commands to spawn/stop algo processes.
pub struct ProcState(pub process_manager::ProcessManager);

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

            // Start WebSocket server for NinjaTrader connections
            let (inbound_tx, _) = broadcast::channel(256);
            let registry = Arc::new(RwLock::new(websocket_server::ConnectionRegistry::new()));

            app.manage(WsState {
                registry: registry.clone(),
                inbound_tx: inbound_tx.clone(),
            });

            let port: u16 = 9000;
            let handle = app.handle().clone();
            let ws_inbound_tx = inbound_tx.clone();
            let ws_registry = registry.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = websocket_server::start(port, ws_inbound_tx, ws_registry, handle).await {
                    log::error!("WebSocket server error: {}", e);
                }
            });

            // Start ZMQ PUB socket (market data fan-out to Python algos)
            let zmq_inbound_rx = inbound_tx.subscribe();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = zmq_hub::start_publisher(zmq_inbound_rx).await {
                    log::error!("ZMQ publisher error: {}", e);
                }
            });

            // Start ZMQ PULL socket (trade signals from Python algos → WebSocket)
            let pull_registry = registry.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = zmq_hub::start_order_receiver(pull_registry).await {
                    log::error!("ZMQ order receiver error: {}", e);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
