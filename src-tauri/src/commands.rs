use crate::db::{self, DbState};
use crate::types::{Algo, AlgoRun, Session, Trade};

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
pub fn start_algo(
    _state: tauri::State<DbState>,
    _algo_id: i64,
    _mode: String,
) -> Result<(), String> {
    // TODO: Phase 2 — spawn Python algo process via process manager
    log::info!("start_algo called for algo_id={}, mode={}", _algo_id, _mode);
    Ok(())
}

#[tauri::command]
pub fn stop_algo(
    _state: tauri::State<DbState>,
    _algo_id: i64,
) -> Result<(), String> {
    // TODO: Phase 2 — kill Python algo process via process manager
    log::info!("stop_algo called for algo_id={}", _algo_id);
    Ok(())
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
