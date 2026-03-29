use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;

/// Manages Python algo processes — spawn, monitor, kill.
///
/// Each algo runs in its own process with its own venv.
/// Communication via ZeroMQ (SUB for market data, PUSH for orders).
///
/// TODO: Phase 2 implementation
/// - Spawn Python processes using venv interpreter
/// - Pass ZMQ addresses and algo config via command-line args or env vars
/// - Monitor heartbeats, restart on crash
/// - Enforce resource limits

pub struct ProcessManager {
    processes: HashMap<i64, AlgoProcess>,
    python_path: PathBuf,
    algo_envs_dir: PathBuf,
    market_data_addr: String,
    trade_signal_addr: String,
}

struct AlgoProcess {
    algo_id: i64,
    child: Child,
    mode: String,
}

impl ProcessManager {
    pub fn new(
        python_path: PathBuf,
        algo_envs_dir: PathBuf,
        market_data_addr: String,
        trade_signal_addr: String,
    ) -> Self {
        ProcessManager {
            processes: HashMap::new(),
            python_path,
            algo_envs_dir,
            market_data_addr,
            trade_signal_addr,
        }
    }
}
