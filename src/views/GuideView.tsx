import { useState } from "react";

const SECTIONS = [
  "Getting Started",
  "Dashboard",
  "Charts & Algos",
  "Algorithm Editor",
  "Trading View",
  "Algo API Reference",
  "Keyboard Shortcuts",
] as const;

type Section = (typeof SECTIONS)[number];

export const GuideView = () => {
  const [activeSection, setActiveSection] = useState<Section>("Getting Started");

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Left: Table of Contents */}
      <div className="w-64 flex-shrink-0 border-r border-[var(--border)] p-6 overflow-auto">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-6">
          Guide
        </h2>
        <nav className="space-y-2">
          {SECTIONS.map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section)}
              className={`block w-full text-left px-4 py-3 rounded-lg text-sm transition-colors ${
                activeSection === section
                  ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]"
              }`}
            >
              {section}
            </button>
          ))}
        </nav>
      </div>

      {/* Right: Content */}
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-2xl">
          {activeSection === "Getting Started" && <GettingStarted />}
          {activeSection === "Dashboard" && <DashboardGuide />}
          {activeSection === "Charts & Algos" && <ChartsAndAlgosGuide />}
          {activeSection === "Algorithm Editor" && <AlgorithmEditorGuide />}
          {activeSection === "Trading View" && <TradingViewGuide />}
          {activeSection === "Algo API Reference" && <AlgoApiReference />}
          {activeSection === "Keyboard Shortcuts" && <KeyboardShortcuts />}
        </div>
      </div>
    </div>
  );
};

const SectionTitle = ({ children }: { children: string }) => (
  <h1 className="text-2xl font-semibold mb-6">{children}</h1>
);

const SubHeading = ({ children }: { children: string }) => (
  <h2 className="text-base font-semibold mt-8 mb-4">{children}</h2>
);

const Paragraph = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-5">{children}</p>
);

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 text-xs leading-relaxed overflow-x-auto font-mono text-[var(--text-primary)]">
    {children}
  </pre>
);

const InlineCode = ({ children }: { children: string }) => (
  <code className="bg-[var(--bg-panel)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs font-mono text-[var(--accent-blue)]">
    {children}
  </code>
);

const StatusDot = ({ color, label }: { color: string; label: string }) => (
  <div className="flex items-center gap-3 mb-3">
    <div className={`w-3 h-3 rounded-full ${color}`} />
    <span className="text-sm text-[var(--text-secondary)]">{label}</span>
  </div>
);

const KeyCombo = ({ keys, description }: { keys: string; description: string }) => (
  <div className="flex items-center justify-between py-3 border-b border-[var(--border)]">
    <kbd className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-md px-3 py-1.5 text-xs font-mono text-[var(--text-primary)]">
      {keys}
    </kbd>
    <span className="text-sm text-[var(--text-secondary)]">{description}</span>
  </div>
);

const GettingStarted = () => (
  <div>
    <SectionTitle>Getting Started</SectionTitle>
    <Paragraph>
      Wolf Den is an algorithmic trading command center that connects to NinjaTrader
      to execute and monitor your trading algorithms. Write algos in Python, assign them
      to NinjaTrader charts, configure per-instance risk management, and track performance
      in real time.
    </Paragraph>

    <SubHeading>How It Works</SubHeading>
    <Paragraph>
      Each NinjaTrader chart runs a WolfDenBridge indicator that connects to Wolf Den via
      WebSocket. When a chart connects, it appears in the Charts panel. You then assign
      algos to those charts — each algo receives market data (ticks and bars) from its
      assigned chart and can place orders back through NinjaTrader.
    </Paragraph>

    <SubHeading>Connecting to NinjaTrader</SubHeading>
    <Paragraph>
      Add the WolfDenBridge indicator to any NinjaTrader chart. When the indicator loads,
      it connects to Wolf Den and the chart appears in the Charts panel automatically. The
      connection status in the sidebar shows the overall state:
    </Paragraph>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5">
      <StatusDot color="bg-[var(--accent-green)]" label="Connected — At least one NinjaTrader chart is linked" />
      <StatusDot color="bg-[var(--accent-yellow)] animate-pulse" label="Waiting — No charts connected yet" />
      <StatusDot color="bg-[var(--accent-red)]" label="Error — Connection failed, check NinjaTrader is running" />
    </div>

    <SubHeading>Workflow Overview</SubHeading>
    <Paragraph>
      A typical workflow follows these steps:
    </Paragraph>
    <div className="space-y-3 mb-5">
      <Step number={1} text="Open charts in NinjaTrader with the WolfDenBridge indicator" />
      <Step number={2} text="Write an algorithm in the Editor using the Python API" />
      <Step number={3} text="Assign the algo to a chart in Shadow mode to simulate trades" />
      <Step number={4} text="Monitor performance on the Dashboard and Trading view" />
      <Step number={5} text="When confident, start the algo in Live mode to execute real trades" />
    </div>

    <SubHeading>Trading Modes</SubHeading>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-4">
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-green)]">Live</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          Real orders are sent to NinjaTrader and executed in the market. Use with caution.
        </p>
      </div>
      <div className="border-t border-[var(--border)]" />
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-yellow)]">Shadow</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          Simulated execution — your algo receives real market data but orders are paper-traded.
          Use this to validate logic before going live.
        </p>
      </div>
    </div>

    <SubHeading>Key Concepts</SubHeading>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-4">
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Chart (Data Source)</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          A NinjaTrader chart connected to Wolf Den. Identified by instrument and timeframe
          (e.g., ES 5min, NQ 1min). Each chart provides its own stream of market data.
        </p>
      </div>
      <div className="border-t border-[var(--border)]" />
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Algo Instance</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          A specific algo running on a specific chart. The same algo can run on multiple charts
          simultaneously — each instance has its own isolated state, positions, and risk settings.
        </p>
      </div>
      <div className="border-t border-[var(--border)]" />
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Risk Config</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          Each algo instance has independent risk management: max position size, daily loss limit,
          and max trades per day. These are enforced at multiple layers for safety.
        </p>
      </div>
    </div>
  </div>
);

const DashboardGuide = () => (
  <div>
    <SectionTitle>Dashboard</SectionTitle>
    <Paragraph>
      The Home view is your at-a-glance overview of the current trading session.
      It&apos;s split into three columns.
    </Paragraph>

    <SubHeading>Accounts (Left Column)</SubHeading>
    <Paragraph>
      Shows your NinjaTrader trading accounts with real-time balance, day P&L, and open
      position count. A green dot indicates at least one algo is running on that account.
    </Paragraph>

    <SubHeading>Session Stats (Middle Column)</SubHeading>
    <Paragraph>
      Displays key performance metrics for the current trading day, aggregated across
      all running algo instances:
    </Paragraph>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-3">
      <MetricExplainer label="Total P&L" description="Combined realized and unrealized profit/loss" />
      <MetricExplainer label="Realized" description="Locked-in profit/loss from closed positions" />
      <MetricExplainer label="Unrealized" description="Paper profit/loss from open positions" />
      <div className="border-t border-[var(--border)]" />
      <MetricExplainer label="Win Rate" description="Percentage of trades that were profitable" />
      <MetricExplainer label="Profit Factor" description="Gross profit divided by gross loss" />
      <MetricExplainer label="Sharpe Ratio" description="Risk-adjusted return — higher is better" />
      <MetricExplainer label="Max Drawdown" description="Largest peak-to-trough decline during the session" />
      <div className="border-t border-[var(--border)]" />
      <MetricExplainer label="Total Trades" description="Completed round-trip trades" />
      <MetricExplainer label="Avg Win / Loss" description="Average dollar amount of winning and losing trades" />
      <MetricExplainer label="Consecutive Wins / Losses" description="Current streak of consecutive results" />
    </div>

    <SubHeading>Active Algos (Right Column)</SubHeading>
    <Paragraph>
      Shows all currently running algo instances with their name, chart (instrument and timeframe),
      account, and trading mode. Green dot means live, yellow means shadow.
    </Paragraph>
  </div>
);

const ChartsAndAlgosGuide = () => (
  <div>
    <SectionTitle>Charts & Algos</SectionTitle>
    <Paragraph>
      The Algos view is where you assign algorithms to NinjaTrader charts and manage
      running instances. The workflow is chart-centric: select a chart, then add algos to it.
    </Paragraph>

    <SubHeading>Charts Panel (Left Side)</SubHeading>
    <Paragraph>
      Shows all NinjaTrader charts currently connected to Wolf Den. Each card displays the
      instrument symbol, timeframe, account, and how many algos are running on it. Click a
      chart to select it and manage its algos.
    </Paragraph>
    <Paragraph>
      Charts appear automatically when you add the WolfDenBridge indicator to a NinjaTrader
      chart. If the panel is empty, no charts are connected yet.
    </Paragraph>

    <SubHeading>Running Algos (Right Side, Top)</SubHeading>
    <Paragraph>
      When a chart is selected, this section shows all algo instances running on it. Each row
      displays the algo name, trading mode (Live or Shadow), account, and live performance
      stats including P&L, win rate, Sharpe ratio, and more.
    </Paragraph>
    <Paragraph>
      You can stop individual instances or use the Stop All button to halt everything on
      that chart at once.
    </Paragraph>

    <SubHeading>Add Algo (Right Side, Bottom)</SubHeading>
    <Paragraph>
      Below the running algos, you&apos;ll see a list of available algorithms that aren&apos;t
      yet running on the selected chart. Each algo has Shadow and Live buttons to start it
      immediately on that chart.
    </Paragraph>

    <SubHeading>Multi-Chart, Multi-Algo</SubHeading>
    <Paragraph>
      Wolf Den supports flexible combinations of algos and charts:
    </Paragraph>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-4">
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Multiple algos on one chart</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          Run several different strategies on the same chart. Each receives the same market data
          but maintains its own state, positions, and risk limits independently.
        </p>
      </div>
      <div className="border-t border-[var(--border)]" />
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Same algo on multiple charts</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          Run the same algorithm on different instruments or timeframes. Each instance is fully
          isolated — an EMA Crossover on ES 5min has no shared state with the same algo on NQ 1min.
        </p>
      </div>
      <div className="border-t border-[var(--border)]" />
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Per-instance risk management</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          Each algo instance has its own risk config: max position size, daily loss limit, and
          max trades per day. This means you can run a conservative config on one chart and an
          aggressive config of the same algo on another.
        </p>
      </div>
    </div>
  </div>
);

const AlgorithmEditorGuide = () => (
  <div>
    <SectionTitle>Algorithm Editor</SectionTitle>
    <Paragraph>
      The Editor view is where you create and edit your trading algorithms in Python.
      It has two panels: the algorithm list on the left and the code editor on the right.
    </Paragraph>

    <SubHeading>Managing Algorithms</SubHeading>
    <Paragraph>
      Use the algorithm list to organize your strategies:
    </Paragraph>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-4">
      <ActionExplainer action="Create" description="Click the + button to create a new algo with the default template" />
      <ActionExplainer action="Rename" description="Double-click an algo name to rename it" />
      <ActionExplainer action="Delete" description="Click the trash icon to remove an algo permanently" />
    </div>
    <Paragraph>
      To run an algo, switch to the Algos view and assign it to a connected chart.
    </Paragraph>

    <SubHeading>Code Editor</SubHeading>
    <Paragraph>
      The editor uses Monaco (the same engine as VS Code) with Python syntax highlighting.
      Your algo code is saved to the database — press <InlineCode>{"⌘S"}</InlineCode> or click the
      Save button to persist changes.
    </Paragraph>

    <SubHeading>Algo Structure</SubHeading>
    <Paragraph>
      Every algorithm must export a <InlineCode>create_algo()</InlineCode> function that returns
      a dictionary of handler functions. The system calls these handlers as market events arrive
      from the assigned NinjaTrader chart. Only <InlineCode>init</InlineCode> and at least one
      of <InlineCode>on_tick</InlineCode> or <InlineCode>on_bar</InlineCode> are required — any
      missing handlers default to no-ops:
    </Paragraph>
    <CodeBlock>{`def create_algo():
    def init():
        return {'prices': ()}

    def on_tick(state, tick, ctx):
        return AlgoResult(state, ())

    return {'init': init, 'on_tick': on_tick}`}</CodeBlock>
    <Paragraph>
      Algos are purely functional — each handler receives the current state, an event,
      and a <InlineCode>ctx</InlineCode> (context) provided by the runtime. Handlers return
      a new state along with any orders to submit. State is an immutable dict; use tuples
      instead of lists to keep things immutable.
    </Paragraph>

    <SubHeading>Demo Algos</SubHeading>
    <Paragraph>
      Wolf Den ships with three demo algos to learn from: EMA Crossover, CVD Divergence, and
      Scalper. Each demonstrates different patterns including ATR-based stops, daily loss limits,
      tilt protection, and bracket orders.
    </Paragraph>
  </div>
);

const TradingViewGuide = () => (
  <div>
    <SectionTitle>Trading View</SectionTitle>
    <Paragraph>
      The Trading view gives you a detailed look at live trading activity across all
      running algo instances.
    </Paragraph>

    <SubHeading>Filters</SubHeading>
    <Paragraph>
      Use the filter bar at the top to narrow the view by Chart (instrument/timeframe),
      Account, or Algo. When a filter is active, all panels below update to show only
      matching data. Click "All" to reset a filter.
    </Paragraph>

    <SubHeading>P&L Cards</SubHeading>
    <Paragraph>
      The top-left section shows three P&L values: Realized (closed trades), Unrealized (open
      positions), and Total. Values animate smoothly as they update in real time.
    </Paragraph>

    <SubHeading>Performance Stats</SubHeading>
    <Paragraph>
      The top-right section shows Win Rate, total Trades, Max Drawdown, and Sharpe Ratio.
      These reflect the currently filtered view — filter by a single chart or algo to see
      its isolated performance.
    </Paragraph>

    <SubHeading>P&L Chart</SubHeading>
    <Paragraph>
      The center chart plots cumulative P&L over time with a smooth curve. Positive regions
      are green, negative regions are red. Hover to see exact values at any point. When
      filtered, the chart shows the sum of matching instance P&L histories.
    </Paragraph>

    <SubHeading>Open Positions</SubHeading>
    <Paragraph>
      The bottom-left table shows all currently held positions with symbol, side (long/short),
      quantity, average entry price, unrealized P&L, the algo that opened the position, and
      the account.
    </Paragraph>

    <SubHeading>Recent Orders</SubHeading>
    <Paragraph>
      The bottom-right table shows order history including timestamp, symbol, side, quantity,
      fill price, status (Filled, Working, Cancelled), algo name, and account.
    </Paragraph>
  </div>
);

const AlgoApiReference = () => (
  <div>
    <SectionTitle>Algo API Reference</SectionTitle>
    <Paragraph>
      Complete reference for the Wolf Den algo API. Everything your algo interacts
      with lives in the <InlineCode>wolf_types</InlineCode> module — import what you need
      at the top of your file:
    </Paragraph>
    <CodeBlock>{`from wolf_types import (
    # Market data
    Tick, Bar, Fill,
    # Return type
    AlgoResult,
    # Order helpers
    market_buy, market_sell,
    limit_buy, limit_sell,
    stop_buy, stop_sell,
    bracket,
)`}</CodeBlock>

    {/* ── Contract ── */}

    <SubHeading>Algo Contract</SubHeading>
    <Paragraph>
      Every algo file must define a <InlineCode>create_algo()</InlineCode> function that
      returns a dict of handlers. Only <InlineCode>init</InlineCode> and at least one
      of <InlineCode>on_tick</InlineCode> or <InlineCode>on_bar</InlineCode> are
      required — missing handlers default to no-ops.
    </Paragraph>
    <CodeBlock>{`def create_algo():
    def init():
        return {'prices': ()}

    def on_tick(state, tick, ctx):
        return AlgoResult(state, ())

    return {'init': init, 'on_tick': on_tick}`}</CodeBlock>
    <Paragraph>
      The <InlineCode>create_algo()</InlineCode> function can accept parameters
      to make your algo configurable:
    </Paragraph>
    <CodeBlock>{`def create_algo(fast_period=10, slow_period=20):
    def init():
        return {'prices': ()}

    def on_tick(state, tick, ctx):
        prices = (*state['prices'], tick.price)[-slow_period:]
        # use fast_period and slow_period in your logic
        ...

    return {'init': init, 'on_tick': on_tick}`}</CodeBlock>

    {/* ── Handler Functions ── */}

    <SubHeading>Handler Functions</SubHeading>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-5">
      <HandlerDoc
        name="init()"
        description="Called once when the algo instance starts. Return the initial state dict. This is where you set up any state your algo needs — indicator buffers, flags, counters, etc."
        returns="dict"
      />
      <div className="border-t border-[var(--border)]" />
      <HandlerDoc
        name="on_tick(state, tick, ctx)"
        description="Called on every market tick from the assigned chart. Receives the current state, a Tick event, and the runtime Context. Use for tick-level strategies or managing open positions."
        returns="AlgoResult"
      />
      <div className="border-t border-[var(--border)]" />
      <HandlerDoc
        name="on_bar(state, bar, ctx)"
        description="Called when a new bar (candle) completes on the assigned chart. Receives the current state, a Bar event, and the runtime Context. Use for bar-based strategies and accumulating indicator data."
        returns="AlgoResult"
      />
      <div className="border-t border-[var(--border)]" />
      <HandlerDoc
        name="on_fill(state, fill, ctx)"
        description="Called when one of this instance's orders is filled. Optional — the runtime already tracks position and entry price for you via ctx. Only define this if you need custom fill handling (e.g. tracking per-trade P&L in state)."
        returns="AlgoResult"
      />
    </div>
    <Paragraph>
      Every handler except <InlineCode>init</InlineCode> must return
      an <InlineCode>AlgoResult(state, orders)</InlineCode> — the updated state dict
      and a tuple of orders (empty tuple <InlineCode>()</InlineCode> for no orders).
    </Paragraph>

    {/* ── Context ── */}

    <SubHeading>Context (ctx)</SubHeading>
    <Paragraph>
      Every handler receives a <InlineCode>ctx</InlineCode> object that the runtime builds
      automatically. You do not need to track position or entry price
      in your state — the runtime does it for you from fill events:
    </Paragraph>
    <CodeBlock>{`Context = NamedTuple('Context', [
    ('symbol', str),           # instrument (e.g. "ES 09-26")
    ('position', int),         # current position size (+ long, - short, 0 flat)
    ('entry_price', float),    # average entry price of current position
    ('unrealized_pnl', float), # unrealized P&L based on last price
])`}</CodeBlock>
    <Paragraph>
      Use <InlineCode>ctx.position</InlineCode> to check your current position
      before entering or exiting trades:
    </Paragraph>
    <CodeBlock>{`# Check if flat
if ctx.position == 0:
    ...

# Check if long
if ctx.position > 0:
    ...

# Check if short
if ctx.position < 0:
    ...

# Current P&L on the open position
if ctx.unrealized_pnl < -200:
    # exit if losing more than $200
    ...`}</CodeBlock>

    {/* ── Market Data Types ── */}

    <SubHeading>Market Data Types</SubHeading>
    <CodeBlock>{`Tick = NamedTuple('Tick', [
    ('symbol', str),       # instrument symbol
    ('price', float),      # last trade price
    ('size', int),         # trade size
    ('timestamp', int),    # unix timestamp in ms
])

Bar = NamedTuple('Bar', [
    ('symbol', str),       # instrument symbol
    ('o', float),          # open price
    ('h', float),          # high price
    ('l', float),          # low price
    ('c', float),          # close price
    ('v', int),            # volume
    ('timestamp', int),    # unix timestamp in ms
])

Fill = NamedTuple('Fill', [
    ('symbol', str),       # instrument symbol
    ('side', str),         # "BUY" or "SELL"
    ('qty', int),          # filled quantity
    ('price', float),      # fill price
    ('order_id', str),     # unique order identifier
    ('timestamp', int),    # unix timestamp in ms
])`}</CodeBlock>
    <Paragraph>
      Tick and Bar data comes from the NinjaTrader chart your algo is assigned to.
      The timeframe of Bar events matches the chart timeframe (e.g., a 5-minute chart
      produces 5-minute bars). Fill events are sent when one of your orders executes.
    </Paragraph>

    {/* ── Order Types ── */}

    <SubHeading>Order Types</SubHeading>
    <Paragraph>
      The symbol is filled in automatically by the runtime — you never need to specify it.
      Use the convenience constructors to create orders:
    </Paragraph>
    <CodeBlock>{`# Market orders — execute immediately at current price
market_buy(qty=1)
market_sell(qty=1)

# Limit orders — execute at a specific price or better
limit_buy(qty=1, price=5400.00)    # buy at 5400 or lower
limit_sell(qty=1, price=5450.00)   # sell at 5450 or higher

# Stop orders — trigger when price reaches stop level
stop_buy(qty=1, stop_price=5460.00)   # buy if price rises to 5460
stop_sell(qty=1, stop_price=5390.00)  # sell if price falls to 5390

# Bracket order — entry with automatic stop loss and take profit
bracket(side="BUY", qty=1,
        stop_loss_price=5390.00,
        take_profit_price=5450.00)`}</CodeBlock>

    <Paragraph>
      The underlying <InlineCode>Order</InlineCode> and <InlineCode>BracketOrder</InlineCode> types
      are NamedTuples if you need to construct orders manually:
    </Paragraph>
    <CodeBlock>{`Order = NamedTuple('Order', [
    ('side', str),         # "BUY" or "SELL"
    ('symbol', str),       # auto-filled by runtime if empty
    ('qty', int),
    ('order_type', str),   # "MARKET", "LIMIT", "STOP", "STOPLIMIT", "MIT"
    ('limit_price', float),
    ('stop_price', float),
])

BracketOrder = NamedTuple('BracketOrder', [
    ('symbol', str),       # auto-filled by runtime if empty
    ('entry', Order),      # the entry order
    ('stop_loss', Order),  # protective stop loss
    ('take_profit', Order),# take profit target
])`}</CodeBlock>

    {/* ── AlgoResult ── */}

    <SubHeading>AlgoResult</SubHeading>
    <Paragraph>
      Every handler returns an <InlineCode>AlgoResult</InlineCode> with two fields:
      the updated state dict and a tuple of orders. Return an empty
      tuple <InlineCode>()</InlineCode> when you have no orders to submit:
    </Paragraph>
    <CodeBlock>{`AlgoResult = NamedTuple('AlgoResult', [
    ('state', dict),   # your updated state to carry forward
    ('orders', tuple),  # tuple of Order or BracketOrder (or empty)
])

# No orders
return AlgoResult(new_state, ())

# One order
return AlgoResult(new_state, (market_buy(1),))

# Multiple orders
return AlgoResult(new_state, (
    market_buy(1),
    limit_sell(1, price=5450.00),
))`}</CodeBlock>

    {/* ── Entering Trades ── */}

    <SubHeading>Entering Trades</SubHeading>
    <Paragraph>
      To enter a trade, return an order in
      your <InlineCode>AlgoResult</InlineCode>. Always
      check <InlineCode>ctx.position</InlineCode> to avoid entering when you already have a
      position:
    </Paragraph>
    <CodeBlock>{`def on_tick(state, tick, ctx):
    if ctx.position == 0 and some_buy_signal:
        return AlgoResult(state, (market_buy(1),))

    if ctx.position == 0 and some_sell_signal:
        return AlgoResult(state, (market_sell(1),))

    return AlgoResult(state, ())`}</CodeBlock>
    <Paragraph>
      Use a bracket order to enter with automatic stop loss and take profit.
      NinjaTrader manages the exit orders — your algo does not need to
      monitor them:
    </Paragraph>
    <CodeBlock>{`def on_bar(state, bar, ctx):
    if ctx.position == 0 and buy_signal:
        entry = bracket(
            side="BUY", qty=1,
            stop_loss_price=bar.c - 5.0,
            take_profit_price=bar.c + 10.0,
        )
        return AlgoResult(state, (entry,))

    return AlgoResult(state, ())`}</CodeBlock>

    {/* ── Exiting Trades ── */}

    <SubHeading>Exiting Trades</SubHeading>
    <Paragraph>
      To exit, submit an order in the opposite direction of your position. Use
      {" "}<InlineCode>ctx.position</InlineCode> to know the current size:
    </Paragraph>
    <CodeBlock>{`def on_tick(state, tick, ctx):
    # Exit a long position
    if ctx.position > 0 and exit_signal:
        return AlgoResult(state, (market_sell(ctx.position),))

    # Exit a short position
    if ctx.position < 0 and exit_signal:
        return AlgoResult(state, (market_buy(abs(ctx.position)),))

    return AlgoResult(state, ())`}</CodeBlock>
    <Paragraph>
      You can also manage exits with stop and limit orders placed after entry:
    </Paragraph>
    <CodeBlock>{`def on_tick(state, tick, ctx):
    # Enter and set a stop loss in state
    if ctx.position == 0 and buy_signal:
        new_state = {**state, 'stop_price': tick.price - 5.0}
        return AlgoResult(new_state, (market_buy(1),))

    # Check stop loss manually on each tick
    if ctx.position > 0 and tick.price <= state.get('stop_price', 0):
        return AlgoResult(state, (market_sell(ctx.position),))

    return AlgoResult(state, ())`}</CodeBlock>

    {/* ── State Management ── */}

    <SubHeading>State Management</SubHeading>
    <Paragraph>
      State is a plain dict that persists across handler calls within a single instance.
      Keep it immutable — use tuples instead of lists, and return a new dict rather than
      mutating the existing one:
    </Paragraph>
    <CodeBlock>{`def on_tick(state, tick, ctx):
    # Append to a tuple (immutable) and keep a sliding window
    prices = (*state['prices'], tick.price)[-20:]
    new_state = {**state, 'prices': prices}
    return AlgoResult(new_state, ())`}</CodeBlock>
    <Paragraph>
      Each algo instance has its own isolated state. If the same algo runs on two different
      charts, they do not share state — each starts fresh from <InlineCode>init()</InlineCode>.
    </Paragraph>

    {/* ── Tick vs Bar ── */}

    <SubHeading>Tick vs Bar Strategies</SubHeading>
    <Paragraph>
      You can define both <InlineCode>on_tick</InlineCode> and <InlineCode>on_bar</InlineCode> in
      the same algo. A common pattern is to accumulate indicator data
      in <InlineCode>on_bar</InlineCode> and make trading decisions
      in <InlineCode>on_tick</InlineCode>:
    </Paragraph>
    <CodeBlock>{`def create_algo(atr_period=14):
    def init():
        return {
            'highs': (),
            'lows': (),
            'closes': (),
            'stop_price': 0.0,
        }

    def on_bar(state, bar, ctx):
        # Accumulate bar data for indicators
        highs = (*state['highs'], bar.h)[-(atr_period + 2):]
        lows = (*state['lows'], bar.l)[-(atr_period + 2):]
        closes = (*state['closes'], bar.c)[-(atr_period + 2):]
        return AlgoResult({**state,
            'highs': highs, 'lows': lows, 'closes': closes,
        }, ())

    def on_tick(state, tick, ctx):
        # Use accumulated data for real-time decisions
        if ctx.position > 0 and tick.price <= state['stop_price']:
            return AlgoResult(state, (market_sell(ctx.position),))
        return AlgoResult(state, ())

    return {'init': init, 'on_bar': on_bar, 'on_tick': on_tick}`}</CodeBlock>
    <Paragraph>
      If your algo only needs bar data, you can define
      just <InlineCode>on_bar</InlineCode> and omit <InlineCode>on_tick</InlineCode> entirely.
      The same applies in reverse.
    </Paragraph>

    {/* ── Risk Management ── */}

    <SubHeading>Risk Management</SubHeading>
    <Paragraph>
      Wolf Den enforces risk limits at two layers. The runtime layer is configured
      per-instance when you start an algo and cannot be bypassed:
    </Paragraph>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-4">
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Max Position Size</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          Orders that would exceed this position size are silently rejected.
        </p>
      </div>
      <div className="border-t border-[var(--border)]" />
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Max Daily Loss</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          When cumulative daily loss reaches this limit, all further orders are rejected
          and the instance halts for the day.
        </p>
      </div>
      <div className="border-t border-[var(--border)]" />
      <div>
        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">Max Daily Trades</span>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">
          When the trade count reaches this limit, no further orders are accepted.
        </p>
      </div>
    </div>
    <Paragraph>
      You can also build additional risk management directly into your algo logic.
      Orders rejected by the runtime risk manager are silently dropped — your algo
      will not receive a fill event for them:
    </Paragraph>
    <CodeBlock>{`def on_tick(state, tick, ctx):
    # Custom daily P&L tracking
    if state.get('daily_pnl', 0) <= -300:
        return AlgoResult(state, ())  # halt trading

    # Custom cooldown after a trade
    ticks_since = state.get('ticks_since_trade', 0) + 1
    if ticks_since < 100:
        return AlgoResult({**state, 'ticks_since_trade': ticks_since}, ())
    ...`}</CodeBlock>

    {/* ── Complete Example ── */}

    <SubHeading>Complete Example</SubHeading>
    <Paragraph>
      A minimal but functional SMA crossover algo:
    </Paragraph>
    <CodeBlock>{`from wolf_types import AlgoResult, market_buy, market_sell


def create_algo(fast_period=10, slow_period=20):

    def init():
        return {'prices': ()}

    def on_tick(state, tick, ctx):
        prices = (*state['prices'], tick.price)[-slow_period:]
        new_state = {**state, 'prices': prices}

        if len(prices) < slow_period:
            return AlgoResult(new_state, ())

        fast_sma = sum(prices[-fast_period:]) / fast_period
        slow_sma = sum(prices) / slow_period

        if fast_sma > slow_sma and ctx.position <= 0:
            return AlgoResult(new_state, (market_buy(1),))
        if fast_sma < slow_sma and ctx.position >= 0:
            return AlgoResult(new_state, (market_sell(1),))

        return AlgoResult(new_state, ())

    return {'init': init, 'on_tick': on_tick}`}</CodeBlock>
  </div>
);

const KeyboardShortcuts = () => (
  <div>
    <SectionTitle>Keyboard Shortcuts</SectionTitle>
    <Paragraph>
      Available keyboard shortcuts within Wolf Den.
    </Paragraph>

    <SubHeading>Algo Editor</SubHeading>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5">
      <KeyCombo keys="⌘ S" description="Save the current algorithm" />
      <KeyCombo keys="⌘ Z" description="Undo last edit" />
      <KeyCombo keys="⌘ ⇧ Z" description="Redo last edit" />
      <KeyCombo keys="⌘ F" description="Find in editor" />
      <KeyCombo keys="⌘ H" description="Find and replace" />
      <KeyCombo keys="⌘ /" description="Toggle line comment" />
    </div>

    <Paragraph>
      The editor supports all standard Monaco (VS Code) keyboard shortcuts for
      text editing, selection, and navigation.
    </Paragraph>
  </div>
);

const Step = ({ number, text }: { number: number; text: string }) => (
  <div className="flex items-start gap-4">
    <div className="w-7 h-7 rounded-full bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] flex items-center justify-center text-xs font-semibold flex-shrink-0">
      {number}
    </div>
    <span className="text-sm text-[var(--text-secondary)] pt-1">{text}</span>
  </div>
);

const MetricExplainer = ({ label, description }: { label: string; description: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
    <span className="text-sm text-[var(--text-secondary)]">{description}</span>
  </div>
);

const ActionExplainer = ({ action, description }: { action: string; description: string }) => (
  <div>
    <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent-blue)]">{action}</span>
    <p className="text-sm text-[var(--text-secondary)] mt-1">{description}</p>
  </div>
);

const HandlerDoc = ({ name, description, returns }: { name: string; description: string; returns: string }) => (
  <div>
    <code className="text-sm font-mono text-[var(--accent-blue)]">{name}</code>
    <p className="text-sm text-[var(--text-secondary)] mt-1.5">{description}</p>
    <p className="text-xs text-[var(--text-secondary)] mt-1">
      Returns: <InlineCode>{returns}</InlineCode>
    </p>
  </div>
);
