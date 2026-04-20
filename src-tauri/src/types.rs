use serde::{Deserialize, Serialize};

// --- Database Records ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Algo {
    pub id: i64,
    pub name: String,
    pub code: String,
    pub config: Option<String>,
    pub dependencies: String,
    pub deps_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: i64,
    pub session_id: i64,
    pub algo_id: i64,
    pub instance_id: Option<String>,
    pub symbol: String,
    pub side: String,
    pub qty: i64,
    pub price: f64,
    pub filled_at: String,
    pub order_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlgoRun {
    pub id: i64,
    pub algo_id: i64,
    pub session_id: i64,
    pub instance_id: Option<String>,
    pub data_source_id: Option<String>,
    pub account: Option<String>,
    pub pid: Option<i64>,
    pub status: String,
    pub mode: String,
    pub started_at: String,
    pub stopped_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShadowTrade {
    pub id: i64,
    pub session_id: i64,
    pub algo_id: i64,
    pub instance_id: Option<String>,
    pub symbol: String,
    pub side: String,
    pub qty: i64,
    pub sim_fill_price: f64,
    pub slippage: f64,
    pub filled_at: String,
    pub order_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSource {
    pub id: String,
    pub instrument: String,
    pub timeframe: String,
    pub account: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlgoInstance {
    pub id: String,
    pub algo_id: i64,
    pub data_source_id: String,
    pub account: String,
    pub mode: String,
    pub status: String,
    pub pid: Option<i64>,
    pub max_position_size: i64,
    pub max_daily_loss: f64,
    pub max_daily_trades: i64,
    pub stop_loss_ticks: Option<i64>,
    pub started_at: Option<String>,
    pub stopped_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    pub max_position_size: Option<i64>,
    pub max_daily_loss: Option<f64>,
    pub max_daily_trades: Option<i64>,
    pub stop_loss_ticks: Option<i64>,
}

// --- WebSocket Messages (NinjaTrader Protocol) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NtInbound {
    #[serde(rename = "register")]
    Register {
        instrument: String,
        timeframe: String,
        chart_id: String,
        account: String,
    },
    #[serde(rename = "tick")]
    Tick {
        source_id: String,
        symbol: String,
        price: f64,
        size: i64,
        bid: f64,
        ask: f64,
        timestamp: i64,
    },
    #[serde(rename = "bar")]
    Bar {
        source_id: String,
        symbol: String,
        o: f64,
        h: f64,
        l: f64,
        c: f64,
        v: i64,
        timestamp: i64,
    },
    #[serde(rename = "position")]
    Position {
        source_id: String,
        symbol: String,
        direction: String,
        qty: i64,
        avg_price: f64,
        unrealized_pnl: f64,
    },
    #[serde(rename = "account")]
    Account {
        buying_power: f64,
        cash: f64,
        realized_pnl: f64,
    },
    #[serde(rename = "order_update")]
    OrderUpdate {
        source_id: String,
        instance_id: String,
        order_id: String,
        state: String,
        filled_qty: Option<i64>,
        avg_fill_price: Option<f64>,
        fill_price: Option<f64>,
        remaining: Option<i64>,
        error: Option<String>,
        timestamp: Option<i64>,
    },
    #[serde(rename = "trade")]
    Trade {
        source_id: String,
        symbol: String,
        side: String,
        qty: i64,
        entry_price: f64,
        exit_price: f64,
        exit_time: i64,
        pnl: f64,
        gross_pnl: f64,
        commission: f64,
        flattens: bool,
        order_id: String,
        instance_id: String,
    },
    #[serde(rename = "history")]
    History {
        source_id: String,
        symbol: String,
        bars: Vec<HistoryBar>,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryBar {
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: i64,
    #[serde(rename = "t")]
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NtOutbound {
    #[serde(rename = "order")]
    Order {
        id: String,
        instance_id: String,
        algo_id: String,
        action: String,
        symbol: String,
        qty: i64,
        order_type: String,
        limit_price: f64,
        stop_price: f64,
    },
    #[serde(rename = "cancel")]
    Cancel { order_id: String },
    #[serde(rename = "modify")]
    Modify {
        order_id: String,
        qty: i64,
        limit_price: f64,
        stop_price: f64,
    },
    #[serde(rename = "bracket")]
    Bracket {
        id: String,
        instance_id: String,
        algo_id: String,
        symbol: String,
        entry: BracketLeg,
        stop_loss: BracketLeg,
        take_profit: BracketLeg,
    },
    #[serde(rename = "flatten")]
    Flatten,
    #[serde(rename = "heartbeat")]
    Heartbeat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BracketLeg {
    pub action: Option<String>,
    pub order_type: String,
    pub qty: Option<i64>,
    pub limit_price: Option<f64>,
    pub stop_price: Option<f64>,
}
