mod db;
mod process_manager;
mod websocket_server;
mod zmq_hub;
mod commands;
mod types;

use tauri::Manager;

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_algos,
            commands::create_algo,
            commands::update_algo,
            commands::delete_algo,
            commands::start_algo,
            commands::stop_algo,
            commands::get_sessions,
            commands::get_trades,
            commands::get_algo_runs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
