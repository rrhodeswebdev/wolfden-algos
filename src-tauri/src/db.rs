use rusqlite::{Connection, Result, params};
use std::path::Path;
use std::sync::Mutex;

use crate::types::{Algo, AlgoInstance, AlgoRun, DataSource, Session, Trade};

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
            instance_id TEXT,
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
            instance_id TEXT,
            data_source_id TEXT,
            account TEXT,
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
            instance_id TEXT,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            qty INTEGER NOT NULL,
            sim_fill_price REAL NOT NULL,
            slippage REAL DEFAULT 0,
            filled_at TEXT NOT NULL,
            order_type TEXT
        );

        CREATE TABLE IF NOT EXISTS data_sources (
            id TEXT PRIMARY KEY,
            instrument TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            account TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS algo_instances (
            id TEXT PRIMARY KEY,
            algo_id INTEGER REFERENCES algos(id),
            data_source_id TEXT REFERENCES data_sources(id),
            account TEXT NOT NULL,
            mode TEXT DEFAULT 'shadow',
            status TEXT DEFAULT 'stopped',
            pid INTEGER,
            max_position_size INTEGER DEFAULT 5,
            max_daily_loss REAL DEFAULT 500.0,
            max_daily_trades INTEGER DEFAULT 50,
            stop_loss_ticks INTEGER,
            started_at TEXT,
            stopped_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_ds_inst_tf ON data_sources(instrument, timeframe);
        CREATE INDEX IF NOT EXISTS idx_ai_algo ON algo_instances(algo_id);
        CREATE INDEX IF NOT EXISTS idx_ai_ds ON algo_instances(data_source_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_unique ON algo_instances(algo_id, data_source_id, account);
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

pub fn get_algo_by_id(conn: &Connection, id: i64) -> Result<Algo> {
    conn.query_row(
        "SELECT id, name, code, config, dependencies, deps_hash, created_at, updated_at FROM algos WHERE id = ?1",
        params![id],
        |row| {
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
        },
    )
}

pub fn get_algo_instance_by_id(conn: &Connection, id: &str) -> Result<AlgoInstance> {
    conn.query_row(
        "SELECT id, algo_id, data_source_id, account, mode, status, pid, max_position_size, max_daily_loss, max_daily_trades, stop_loss_ticks, started_at, stopped_at, created_at FROM algo_instances WHERE id = ?1",
        params![id],
        |row| {
            Ok(AlgoInstance {
                id: row.get(0)?,
                algo_id: row.get(1)?,
                data_source_id: row.get(2)?,
                account: row.get(3)?,
                mode: row.get(4)?,
                status: row.get(5)?,
                pid: row.get(6)?,
                max_position_size: row.get(7)?,
                max_daily_loss: row.get(8)?,
                max_daily_trades: row.get(9)?,
                stop_loss_ticks: row.get(10)?,
                started_at: row.get(11)?,
                stopped_at: row.get(12)?,
                created_at: row.get(13)?,
            })
        },
    )
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
        "SELECT id, session_id, algo_id, instance_id, symbol, side, qty, price, filled_at, order_type FROM trades WHERE 1=1",
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
            instance_id: row.get(3)?,
            symbol: row.get(4)?,
            side: row.get(5)?,
            qty: row.get(6)?,
            price: row.get(7)?,
            filled_at: row.get(8)?,
            order_type: row.get(9)?,
        })
    })?;
    rows.collect()
}

// --- Algo Runs ---

pub fn get_algo_runs(conn: &Connection, session_id: Option<i64>) -> Result<Vec<AlgoRun>> {
    let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(sid) = session_id {
        (
            "SELECT id, algo_id, session_id, instance_id, data_source_id, account, pid, status, mode, started_at, stopped_at FROM algo_runs WHERE session_id = ?1 ORDER BY started_at DESC".to_string(),
            vec![Box::new(sid)],
        )
    } else {
        (
            "SELECT id, algo_id, session_id, instance_id, data_source_id, account, pid, status, mode, started_at, stopped_at FROM algo_runs ORDER BY started_at DESC".to_string(),
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
            instance_id: row.get(3)?,
            data_source_id: row.get(4)?,
            account: row.get(5)?,
            pid: row.get(6)?,
            status: row.get(7)?,
            mode: row.get(8)?,
            started_at: row.get(9)?,
            stopped_at: row.get(10)?,
        })
    })?;
    rows.collect()
}

// --- Data Sources ---

pub fn get_data_sources(conn: &Connection) -> Result<Vec<DataSource>> {
    let mut stmt = conn.prepare(
        "SELECT id, instrument, timeframe, account FROM data_sources ORDER BY instrument, timeframe",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DataSource {
            id: row.get(0)?,
            instrument: row.get(1)?,
            timeframe: row.get(2)?,
            account: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_data_source(conn: &Connection, id: &str, instrument: &str, timeframe: &str, account: &str) -> Result<DataSource> {
    conn.execute(
        "INSERT INTO data_sources (id, instrument, timeframe, account)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET account = ?4",
        params![id, instrument, timeframe, account],
    )?;
    let mut stmt = conn.prepare(
        "SELECT id, instrument, timeframe, account FROM data_sources WHERE id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        Ok(DataSource {
            id: row.get(0)?,
            instrument: row.get(1)?,
            timeframe: row.get(2)?,
            account: row.get(3)?,
        })
    })
}

pub fn remove_data_source(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM data_sources WHERE id = ?1", params![id])?;
    Ok(())
}

// --- Algo Instances ---

pub fn get_algo_instances(conn: &Connection, data_source_id: Option<&str>) -> Result<Vec<AlgoInstance>> {
    let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(ds_id) = data_source_id {
        (
            "SELECT id, algo_id, data_source_id, account, mode, status, pid, max_position_size, max_daily_loss, max_daily_trades, stop_loss_ticks, started_at, stopped_at, created_at FROM algo_instances WHERE data_source_id = ?1 ORDER BY created_at DESC".to_string(),
            vec![Box::new(ds_id.to_string())],
        )
    } else {
        (
            "SELECT id, algo_id, data_source_id, account, mode, status, pid, max_position_size, max_daily_loss, max_daily_trades, stop_loss_ticks, started_at, stopped_at, created_at FROM algo_instances ORDER BY created_at DESC".to_string(),
            vec![],
        )
    };

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(AlgoInstance {
            id: row.get(0)?,
            algo_id: row.get(1)?,
            data_source_id: row.get(2)?,
            account: row.get(3)?,
            mode: row.get(4)?,
            status: row.get(5)?,
            pid: row.get(6)?,
            max_position_size: row.get(7)?,
            max_daily_loss: row.get(8)?,
            max_daily_trades: row.get(9)?,
            stop_loss_ticks: row.get(10)?,
            started_at: row.get(11)?,
            stopped_at: row.get(12)?,
            created_at: row.get(13)?,
        })
    })?;
    rows.collect()
}

pub fn create_algo_instance(
    conn: &Connection,
    id: &str,
    algo_id: i64,
    data_source_id: &str,
    account: &str,
    mode: &str,
    max_position_size: i64,
    max_daily_loss: f64,
    max_daily_trades: i64,
    stop_loss_ticks: Option<i64>,
) -> Result<AlgoInstance> {
    conn.execute(
        "INSERT INTO algo_instances (id, algo_id, data_source_id, account, mode, max_position_size, max_daily_loss, max_daily_trades, stop_loss_ticks)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, algo_id, data_source_id, account, mode, max_position_size, max_daily_loss, max_daily_trades, stop_loss_ticks],
    )?;
    let mut stmt = conn.prepare(
        "SELECT id, algo_id, data_source_id, account, mode, status, pid, max_position_size, max_daily_loss, max_daily_trades, stop_loss_ticks, started_at, stopped_at, created_at FROM algo_instances WHERE id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        Ok(AlgoInstance {
            id: row.get(0)?,
            algo_id: row.get(1)?,
            data_source_id: row.get(2)?,
            account: row.get(3)?,
            mode: row.get(4)?,
            status: row.get(5)?,
            pid: row.get(6)?,
            max_position_size: row.get(7)?,
            max_daily_loss: row.get(8)?,
            max_daily_trades: row.get(9)?,
            stop_loss_ticks: row.get(10)?,
            started_at: row.get(11)?,
            stopped_at: row.get(12)?,
            created_at: row.get(13)?,
        })
    })
}

pub fn update_algo_instance_status(conn: &Connection, id: &str, status: &str, pid: Option<i64>) -> Result<()> {
    if status == "running" {
        conn.execute(
            "UPDATE algo_instances SET status = ?1, pid = ?2, started_at = datetime('now') WHERE id = ?3",
            params![status, pid, id],
        )?;
    } else if status == "stopped" || status == "error" {
        conn.execute(
            "UPDATE algo_instances SET status = ?1, pid = NULL, stopped_at = datetime('now') WHERE id = ?2",
            params![status, id],
        )?;
    } else {
        conn.execute(
            "UPDATE algo_instances SET status = ?1, pid = ?2 WHERE id = ?3",
            params![status, pid, id],
        )?;
    }
    Ok(())
}

pub fn update_algo_instance_risk(
    conn: &Connection,
    id: &str,
    max_position_size: i64,
    max_daily_loss: f64,
    max_daily_trades: i64,
    stop_loss_ticks: Option<i64>,
) -> Result<()> {
    conn.execute(
        "UPDATE algo_instances SET max_position_size = ?1, max_daily_loss = ?2, max_daily_trades = ?3, stop_loss_ticks = ?4 WHERE id = ?5",
        params![max_position_size, max_daily_loss, max_daily_trades, stop_loss_ticks, id],
    )?;
    Ok(())
}

pub fn delete_algo_instance(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM algo_instances WHERE id = ?1", params![id])?;
    Ok(())
}
