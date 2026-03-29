use rusqlite::{Connection, Result, params};
use std::path::Path;
use std::sync::Mutex;

use crate::types::{Algo, AlgoRun, Session, Trade};

pub struct DbState(pub Mutex<Connection>);

pub fn initialize(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;

    // Performance pragmas for low-latency trading workloads
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -64000;
         PRAGMA mmap_size = 268435456;
         PRAGMA page_size = 4096;
         PRAGMA temp_store = MEMORY;
         PRAGMA wal_autocheckpoint = 1000;
         PRAGMA busy_timeout = 5000;",
    )?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS algos (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            code TEXT NOT NULL,
            config JSON,
            dependencies TEXT DEFAULT '',
            deps_hash TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            ended_at TEXT,
            status TEXT DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY,
            session_id INTEGER REFERENCES sessions(id),
            algo_id INTEGER REFERENCES algos(id),
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            qty INTEGER NOT NULL,
            price REAL NOT NULL,
            filled_at TEXT NOT NULL,
            order_type TEXT
        );

        CREATE TABLE IF NOT EXISTS algo_runs (
            id INTEGER PRIMARY KEY,
            algo_id INTEGER REFERENCES algos(id),
            session_id INTEGER REFERENCES sessions(id),
            pid INTEGER,
            status TEXT DEFAULT 'running',
            mode TEXT DEFAULT 'shadow',
            started_at TEXT DEFAULT (datetime('now')),
            stopped_at TEXT
        );

        CREATE TABLE IF NOT EXISTS shadow_trades (
            id INTEGER PRIMARY KEY,
            session_id INTEGER REFERENCES sessions(id),
            algo_id INTEGER REFERENCES algos(id),
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            qty INTEGER NOT NULL,
            sim_fill_price REAL NOT NULL,
            slippage REAL DEFAULT 0,
            filled_at TEXT NOT NULL,
            order_type TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(session_id);
        CREATE INDEX IF NOT EXISTS idx_trades_algo ON trades(algo_id);
        CREATE INDEX IF NOT EXISTS idx_trades_filled_at ON trades(filled_at);
        CREATE INDEX IF NOT EXISTS idx_shadow_trades_session ON shadow_trades(session_id);
        CREATE INDEX IF NOT EXISTS idx_shadow_trades_algo ON shadow_trades(algo_id);
        CREATE INDEX IF NOT EXISTS idx_algo_runs_algo ON algo_runs(algo_id);
        CREATE INDEX IF NOT EXISTS idx_algo_runs_session ON algo_runs(session_id);",
    )?;

    seed_sample_algos(&conn)?;

    Ok(conn)
}

fn seed_sample_algos(conn: &Connection) -> Result<()> {
    let samples: &[(&str, &str)] = &[
        ("Demo: EMA Crossover", include_str!("../../algo_runtime/examples/ema_cross.py")),
        ("Demo: CVD Divergence", include_str!("../../algo_runtime/examples/cvd_divergence.py")),
        ("Demo: Scalper", include_str!("../../algo_runtime/examples/scalper.py")),
    ];

    for (name, code) in samples {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM algos WHERE name = ?1)",
            params![name],
            |row| row.get(0),
        )?;
        if !exists {
            conn.execute(
                "INSERT INTO algos (name, code, dependencies) VALUES (?1, ?2, '')",
                params![name, code],
            )?;
        }
    }

    Ok(())
}

// --- Algo CRUD ---

pub fn get_algos(conn: &Connection) -> Result<Vec<Algo>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, code, config, dependencies, deps_hash, created_at, updated_at FROM algos ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Algo {
            id: row.get(0)?,
            name: row.get(1)?,
            code: row.get(2)?,
            config: row.get(3)?,
            dependencies: row.get(4)?,
            deps_hash: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn create_algo(conn: &Connection, name: &str, code: &str, dependencies: &str) -> Result<Algo> {
    conn.execute(
        "INSERT INTO algos (name, code, dependencies) VALUES (?1, ?2, ?3)",
        params![name, code, dependencies],
    )?;
    let id = conn.last_insert_rowid();
    let mut stmt = conn.prepare(
        "SELECT id, name, code, config, dependencies, deps_hash, created_at, updated_at FROM algos WHERE id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        Ok(Algo {
            id: row.get(0)?,
            name: row.get(1)?,
            code: row.get(2)?,
            config: row.get(3)?,
            dependencies: row.get(4)?,
            deps_hash: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })
}

pub fn update_algo(conn: &Connection, id: i64, name: &str, code: &str, dependencies: &str) -> Result<()> {
    conn.execute(
        "UPDATE algos SET name = ?1, code = ?2, dependencies = ?3, updated_at = datetime('now') WHERE id = ?4",
        params![name, code, dependencies, id],
    )?;
    Ok(())
}

pub fn delete_algo(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM algos WHERE id = ?1", params![id])?;
    Ok(())
}

// --- Sessions ---

pub fn get_sessions(conn: &Connection) -> Result<Vec<Session>> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at, ended_at, status FROM sessions ORDER BY started_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Session {
            id: row.get(0)?,
            started_at: row.get(1)?,
            ended_at: row.get(2)?,
            status: row.get(3)?,
        })
    })?;
    rows.collect()
}

// --- Trades ---

pub fn get_trades(conn: &Connection, session_id: Option<i64>, algo_id: Option<i64>) -> Result<Vec<Trade>> {
    let mut sql = String::from(
        "SELECT id, session_id, algo_id, symbol, side, qty, price, filled_at, order_type FROM trades WHERE 1=1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(sid) = session_id {
        sql.push_str(" AND session_id = ?");
        param_values.push(Box::new(sid));
    }
    if let Some(aid) = algo_id {
        sql.push_str(" AND algo_id = ?");
        param_values.push(Box::new(aid));
    }
    sql.push_str(" ORDER BY filled_at DESC");

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(Trade {
            id: row.get(0)?,
            session_id: row.get(1)?,
            algo_id: row.get(2)?,
            symbol: row.get(3)?,
            side: row.get(4)?,
            qty: row.get(5)?,
            price: row.get(6)?,
            filled_at: row.get(7)?,
            order_type: row.get(8)?,
        })
    })?;
    rows.collect()
}

// --- Algo Runs ---

pub fn get_algo_runs(conn: &Connection, session_id: Option<i64>) -> Result<Vec<AlgoRun>> {
    let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(sid) = session_id {
        (
            "SELECT id, algo_id, session_id, pid, status, mode, started_at, stopped_at FROM algo_runs WHERE session_id = ?1 ORDER BY started_at DESC".to_string(),
            vec![Box::new(sid)],
        )
    } else {
        (
            "SELECT id, algo_id, session_id, pid, status, mode, started_at, stopped_at FROM algo_runs ORDER BY started_at DESC".to_string(),
            vec![],
        )
    };

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(AlgoRun {
            id: row.get(0)?,
            algo_id: row.get(1)?,
            session_id: row.get(2)?,
            pid: row.get(3)?,
            status: row.get(4)?,
            mode: row.get(5)?,
            started_at: row.get(6)?,
            stopped_at: row.get(7)?,
        })
    })?;
    rows.collect()
}
