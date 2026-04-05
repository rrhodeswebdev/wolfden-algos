use crate::db::{self, DbState};
use crate::types::{Algo, AlgoInstance, AlgoRun, DataSource, RiskConfig, Session, Trade};
use crate::{AiTermState, ProcState};

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
    instance_id: String,
) -> Result<(), String> {
    log::info!("start_algo_instance: received request for instance_id={}", instance_id);
    proc_state.0.start_instance(&db_state, &instance_id)?;
    log::info!("start_algo_instance: spawned instance_id={}", instance_id);
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
