use crate::db::{self, DbState};
use crate::types::{Algo, AlgoInstance, AlgoRun, DataSource, RiskConfig, Session, Trade};
use crate::{AiTermState, ProcState, VenvState};
use crate::venv_manager;
use tauri::Emitter;

#[tauri::command]
pub fn get_algos(state: tauri::State<DbState>) -> Result<Vec<Algo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_algos(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_algo(
    state: tauri::State<DbState>,
    name: String,
    code: String,
    dependencies: String,
) -> Result<Algo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::create_algo(&conn, &name, &code, &dependencies).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_algo(
    state: tauri::State<DbState>,
    id: i64,
    name: String,
    code: String,
    dependencies: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_algo(&conn, id, &name, &code, &dependencies).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_algo(state: tauri::State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_algo(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sessions(state: tauri::State<DbState>) -> Result<Vec<Session>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_sessions(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_trades(
    state: tauri::State<DbState>,
    session_id: Option<i64>,
    algo_id: Option<i64>,
) -> Result<Vec<Trade>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_trades(&conn, session_id, algo_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_algo_runs(
    state: tauri::State<DbState>,
    session_id: Option<i64>,
) -> Result<Vec<AlgoRun>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_algo_runs(&conn, session_id).map_err(|e| e.to_string())
}

// --- Data Sources ---

#[tauri::command]
pub fn get_data_sources(state: tauri::State<DbState>) -> Result<Vec<DataSource>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_data_sources(&conn).map_err(|e| e.to_string())
}

// --- Algo Instances ---

#[tauri::command]
pub fn get_algo_instances(
    state: tauri::State<DbState>,
    data_source_id: Option<String>,
) -> Result<Vec<AlgoInstance>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_algo_instances(&conn, data_source_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_algo_instance(
    state: tauri::State<DbState>,
    algo_id: i64,
    data_source_id: String,
    account: String,
    mode: String,
    risk_config: Option<RiskConfig>,
) -> Result<AlgoInstance, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let rc = risk_config.unwrap_or(RiskConfig {
        max_position_size: None,
        max_daily_loss: None,
        max_daily_trades: None,
        stop_loss_ticks: None,
    });
    db::create_algo_instance(
        &conn,
        &id,
        algo_id,
        &data_source_id,
        &account,
        &mode,
        rc.max_position_size.unwrap_or(5),
        rc.max_daily_loss.unwrap_or(500.0),
        rc.max_daily_trades.unwrap_or(50),
        rc.stop_loss_ticks,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_algo_instance(
    db_state: tauri::State<DbState>,
    proc_state: tauri::State<ProcState>,
    venv_state: tauri::State<VenvState>,
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<(), String> {
    log::info!("start_algo_instance: received request for instance_id={}", instance_id);

    // Install per-algo deps if needed before spawning
    {
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        let instance = db::get_algo_instance_by_id(&conn, &instance_id)
            .map_err(|e| format!("Instance not found: {}", e))?;
        let algo = db::get_algo_by_id(&conn, instance.algo_id)
            .map_err(|e| format!("Algo not found: {}", e))?;

        let deps = algo.dependencies.trim().to_string();
        if !deps.is_empty() {
            let current_hash = venv_manager::VenvManager::hash_deps(&deps);
            if current_hash != algo.deps_hash {
                log::info!("Installing dependencies for algo {} (hash changed)", algo.name);
                let result = venv_state.0.install_algo_deps(&deps);
                if !result.success {
                    return Err(format!("Failed to install dependencies:\n{}", result.output));
                }
                // Update deps_hash
                conn.execute(
                    "UPDATE algos SET deps_hash = ?1 WHERE id = ?2",
                    rusqlite::params![current_hash, instance.algo_id],
                )
                .map_err(|e| format!("Failed to update deps_hash: {}", e))?;
                log::info!("Dependencies installed for algo {}", algo.name);
            }
        }
    }

    let (pid, handles) = proc_state.0.start_instance(&db_state, &instance_id)?;
    log::info!("start_algo_instance: spawned instance_id={} pid={}", instance_id, pid);

    // Monitor stderr in a background thread
    let app = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(handles.stderr);
        let mut last_line = String::new();
        for line in reader.lines() {
            match line {
                Ok(text) if !text.is_empty() => {
                    log::info!("Algo stderr [{}]: {}", handles.instance_id, text);
                    last_line = text;
                }
                Err(_) => break,
                _ => {}
            }
        }
        if !last_line.is_empty() {
            let _ = app.emit("algo-error", serde_json::json!({
                "instance_id": handles.instance_id,
                "algo_id": handles.algo_id,
                "severity": "critical",
                "category": "infrastructure",
                "message": format!("Process exited: {}", last_line),
                "handler": "",
                "traceback": "",
                "timestamp": std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64,
            }));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_algo_instance(
    db_state: tauri::State<DbState>,
    proc_state: tauri::State<ProcState>,
    instance_id: String,
) -> Result<(), String> {
    proc_state.0.stop_instance(&db_state, &instance_id)?;
    log::info!("stop_algo_instance: stopped instance_id={}", instance_id);
    Ok(())
}

#[tauri::command]
pub fn update_instance_risk(
    state: tauri::State<DbState>,
    instance_id: String,
    risk_config: RiskConfig,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_algo_instance_risk(
        &conn,
        &instance_id,
        risk_config.max_position_size.unwrap_or(5),
        risk_config.max_daily_loss.unwrap_or(500.0),
        risk_config.max_daily_trades.unwrap_or(50),
        risk_config.stop_loss_ticks,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_algo_instance(
    state: tauri::State<DbState>,
    instance_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_algo_instance(&conn, &instance_id).map_err(|e| e.to_string())
}

// --- AI Terminal ---

#[tauri::command]
pub fn spawn_ai_terminal(
    db_state: tauri::State<DbState>,
    ai_state: tauri::State<AiTermState>,
    app_handle: tauri::AppHandle,
    algo_id: i64,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    ai_state.0.spawn(&db_state, algo_id, rows, cols, app_handle)
}

#[tauri::command]
pub fn write_ai_terminal(
    ai_state: tauri::State<AiTermState>,
    algo_id: i64,
    input: String,
) -> Result<(), String> {
    ai_state.0.write(algo_id, input.as_bytes())
}

#[tauri::command]
pub fn resize_ai_terminal(
    ai_state: tauri::State<AiTermState>,
    algo_id: i64,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    ai_state.0.resize(algo_id, rows, cols)
}

#[tauri::command]
pub fn close_ai_terminal(
    ai_state: tauri::State<AiTermState>,
    algo_id: i64,
) -> Result<(), String> {
    ai_state.0.close(algo_id)
}

#[tauri::command]
pub fn get_active_ai_terminals(
    ai_state: tauri::State<AiTermState>,
) -> Result<Vec<i64>, String> {
    Ok(ai_state.0.active_algo_ids())
}

// --- Python Venv ---

#[tauri::command]
pub fn check_venv_status(
    venv_state: tauri::State<VenvState>,
) -> Result<serde_json::Value, String> {
    let healthy = venv_state.0.is_venv_healthy();
    Ok(serde_json::json!({
        "healthy": healthy,
        "python_path": venv_state.0.python_path().to_string_lossy(),
    }))
}

#[tauri::command]
pub fn setup_venv(
    venv_state: tauri::State<VenvState>,
) -> Result<String, String> {
    venv_state.0.ensure_setup()
}

#[tauri::command]
pub fn install_algo_deps(
    db_state: tauri::State<DbState>,
    venv_state: tauri::State<VenvState>,
    algo_id: i64,
) -> Result<String, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let algo = db::get_algo_by_id(&conn, algo_id)
        .map_err(|e| format!("Algo not found: {}", e))?;

    let deps = algo.dependencies.trim();
    if deps.is_empty() {
        return Ok("No dependencies to install.".to_string());
    }

    // Check if deps have changed since last install
    let current_hash = venv_manager::VenvManager::hash_deps(deps);
    if current_hash == algo.deps_hash {
        return Ok("Dependencies already up to date.".to_string());
    }

    // Install deps
    let result = venv_state.0.install_algo_deps(deps);
    if result.success {
        // Update deps_hash in DB
        conn.execute(
            "UPDATE algos SET deps_hash = ?1 WHERE id = ?2",
            rusqlite::params![current_hash, algo_id],
        )
        .map_err(|e| format!("Failed to update deps_hash: {}", e))?;
        Ok(result.output)
    } else {
        Err(result.output)
    }
}
