use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;

/// Manages Python algo processes -- spawn, monitor, kill.
///
/// Each algo instance runs in its own process with its own venv.
/// Communication via ZeroMQ (SUB for market data, PUSH for orders).
///
/// Keyed by instance_id (UUID) so the same algo can run on multiple
/// data sources / accounts simultaneously with isolated state.

pub struct ProcessManager {
    processes: HashMap<String, AlgoProcess>,
    python_path: PathBuf,
    algo_envs_dir: PathBuf,
    market_data_addr: String,
    trade_signal_addr: String,
}

struct AlgoProcess {
    instance_id: String,
    algo_id: i64,
    data_source_id: String,
    account: String,
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
