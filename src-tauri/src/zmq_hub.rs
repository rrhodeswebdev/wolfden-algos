/// ZeroMQ hub for market data fan-out to Python algo processes
/// and trade signal collection from algo processes.
///
/// PUB socket: publishes market data with topic-based routing
///   - "md:{source_id}:tick" for tick data
///   - "md:{source_id}:bar" for bar data
///   - "fill:{instance_id}" for fill notifications
///
/// PULL socket: collects trade signals from algo PUSH sockets
///   - Validates orders against instance risk limits
///   - Routes validated orders to the correct WebSocket connection

pub struct ZmqHub {
    pub market_data_addr: String,
    pub trade_signal_addr: String,
}

impl ZmqHub {
    pub fn new() -> Self {
        let transport = if cfg!(target_os = "windows") {
            ("tcp://127.0.0.1:5555", "tcp://127.0.0.1:5556")
        } else {
            ("ipc:///tmp/wolfden-market-data", "ipc:///tmp/wolfden-trade-signals")
        };

        ZmqHub {
            market_data_addr: transport.0.to_string(),
            trade_signal_addr: transport.1.to_string(),
        }
    }

    pub fn market_data_addr(&self) -> &str {
        &self.market_data_addr
    }

    pub fn trade_signal_addr(&self) -> &str {
        &self.trade_signal_addr
    }
}
