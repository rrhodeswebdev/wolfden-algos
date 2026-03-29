import { useState } from "react";

const SECTIONS = [
  "Getting Started",
  "Dashboard",
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
      to execute and monitor your trading algorithms. Write algos in Python, run them
      in live or shadow mode, and track performance in real time.
    </Paragraph>

    <SubHeading>Connecting to NinjaTrader</SubHeading>
    <Paragraph>
      Wolf Den requires a running NinjaTrader instance to place orders and receive market data.
      The connection status indicator in the bottom of the sidebar shows the current state:
    </Paragraph>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5">
      <StatusDot color="bg-[var(--accent-green)]" label="Connected — NinjaTrader is linked and ready" />
      <StatusDot color="bg-[var(--accent-yellow)] animate-pulse" label="Waiting — Searching for NinjaTrader connection" />
      <StatusDot color="bg-[var(--accent-red)]" label="Error — Connection failed, check NinjaTrader is running" />
    </div>

    <SubHeading>Workflow Overview</SubHeading>
    <Paragraph>
      A typical workflow follows these steps:
    </Paragraph>
    <div className="space-y-3 mb-5">
      <Step number={1} text="Write an algorithm in the Algo Editor using the Python API" />
      <Step number={2} text="Test it in Shadow mode to simulate trades without real orders" />
      <Step number={3} text="Monitor performance on the Dashboard and Trading view" />
      <Step number={4} text="When confident, switch to Live mode to execute real trades" />
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
  </div>
);

const DashboardGuide = () => (
  <div>
    <SectionTitle>Dashboard</SectionTitle>
    <Paragraph>
      The Home view is your at-a-glance overview of the current trading session.
      It&apos;s split into two columns.
    </Paragraph>

    <SubHeading>Session Stats (Left Column)</SubHeading>
    <Paragraph>
      Displays key performance metrics for the current trading day:
    </Paragraph>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-3">
      <MetricExplainer label="Total P&L" description="Combined realized and unrealized profit/loss" />
      <MetricExplainer label="Realized" description="Locked-in profit/loss from closed positions" />
      <MetricExplainer label="Unrealized" description="Paper profit/loss from open positions" />
      <div className="border-t border-[var(--border)]" />
      <MetricExplainer label="Win Rate" description="Percentage of trades that were profitable" />
      <MetricExplainer label="Trades" description="Total number of completed round-trip trades" />
      <MetricExplainer label="Max Drawdown" description="Largest peak-to-trough decline during the session" />
      <MetricExplainer label="Sharpe Ratio" description="Risk-adjusted return — higher is better" />
    </div>

    <SubHeading>Active Algos (Right Column)</SubHeading>
    <Paragraph>
      Shows all currently running algorithms with their trading mode indicated by a colored dot.
      Green means live, yellow means shadow. Click into the Algos view to start or stop algorithms.
    </Paragraph>
  </div>
);

const AlgorithmEditorGuide = () => (
  <div>
    <SectionTitle>Algorithm Editor</SectionTitle>
    <Paragraph>
      The Algos view is where you create, edit, and manage your trading algorithms.
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
      <ActionExplainer action="Start / Stop" description="Use the play and stop buttons to run an algo in live or shadow mode" />
    </div>

    <SubHeading>Code Editor</SubHeading>
    <Paragraph>
      The editor uses Monaco (the same engine as VS Code) with Python syntax highlighting.
      Your algo code is saved to the database — press <InlineCode>⌘S</InlineCode> or click the
      Save button to persist changes.
    </Paragraph>

    <SubHeading>Algo Structure</SubHeading>
    <Paragraph>
      Every algorithm must export a <InlineCode>create_algo()</InlineCode> function that returns
      a dictionary of handler functions. The system calls these handlers as market events arrive:
    </Paragraph>
    <CodeBlock>{`def create_algo():
    def init():
        return {'prices': (), 'position': 0}

    def on_tick(state, tick: Tick) -> AlgoResult:
        return AlgoResult(state, ())

    def on_bar(state, bar: Bar) -> AlgoResult:
        return AlgoResult(state, ())

    def on_fill(state, fill: Fill) -> AlgoResult:
        return AlgoResult(state, ())

    return {
        'init': init,
        'on_tick': on_tick,
        'on_bar': on_bar,
        'on_fill': on_fill,
    }`}</CodeBlock>
    <Paragraph>
      Algos are purely functional — each handler receives the current state and an event, and
      returns a new state along with any orders to submit. State is an immutable dict; use tuples
      instead of lists to keep things immutable.
    </Paragraph>
  </div>
);

const TradingViewGuide = () => (
  <div>
    <SectionTitle>Trading View</SectionTitle>
    <Paragraph>
      The Trading view gives you a detailed look at live trading activity.
    </Paragraph>

    <SubHeading>P&L Cards</SubHeading>
    <Paragraph>
      The top-left section shows three P&L values: Realized (closed trades), Unrealized (open
      positions), and Total. Values update in real time when connected to NinjaTrader.
    </Paragraph>

    <SubHeading>Performance Stats</SubHeading>
    <Paragraph>
      The top-right section shows Win Rate, total Trades, Max Drawdown, and Sharpe Ratio
      for the current session. These reset at the start of each trading day.
    </Paragraph>

    <SubHeading>P&L Chart</SubHeading>
    <Paragraph>
      The center chart plots your cumulative P&L over time. Use the time range buttons
      (1H, 4H, 1D, 1W) to adjust the visible window.
    </Paragraph>

    <SubHeading>Open Positions</SubHeading>
    <Paragraph>
      The bottom-left table shows all currently held positions with symbol, side (long/short),
      quantity, average entry price, unrealized P&L, and the algo that opened the position.
    </Paragraph>

    <SubHeading>Recent Orders</SubHeading>
    <Paragraph>
      The bottom-right table shows order history including timestamp, symbol, side, quantity,
      fill price, and status (filled, pending, cancelled).
    </Paragraph>
  </div>
);

const AlgoApiReference = () => (
  <div>
    <SectionTitle>Algo API Reference</SectionTitle>
    <Paragraph>
      Your algo handlers receive typed data structures and must return
      an <InlineCode>AlgoResult</InlineCode>. Here is the complete type reference.
    </Paragraph>

    <SubHeading>Input Types</SubHeading>
    <CodeBlock>{`Tick = NamedTuple('Tick', [
    ('symbol', str),
    ('price', float),
    ('size', int),
    ('timestamp', int),
])

Bar = NamedTuple('Bar', [
    ('symbol', str),
    ('o', float),      # open
    ('h', float),      # high
    ('l', float),      # low
    ('c', float),      # close
    ('v', int),        # volume
    ('timestamp', int),
])

Fill = NamedTuple('Fill', [
    ('symbol', str),
    ('side', str),     # "BUY" or "SELL"
    ('qty', int),
    ('price', float),
])`}</CodeBlock>

    <SubHeading>Output Types</SubHeading>
    <CodeBlock>{`Order = NamedTuple('Order', [
    ('side', str),         # "BUY" or "SELL"
    ('symbol', str),
    ('qty', int),
    ('order_type', str),   # "MARKET" or "LIMIT"
    ('limit_price', float),
    ('stop_price', float),
])

AlgoResult = NamedTuple('AlgoResult', [
    ('state', dict),       # updated state to carry forward
    ('orders', tuple),     # tuple of Order namedtuples
])`}</CodeBlock>

    <SubHeading>Handler Functions</SubHeading>
    <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-5 mb-5 space-y-5">
      <HandlerDoc
        name="init()"
        description="Called once when the algo starts. Return the initial state dict."
        returns="dict"
      />
      <div className="border-t border-[var(--border)]" />
      <HandlerDoc
        name="on_tick(state, tick: Tick)"
        description="Called on every market tick. Use for high-frequency strategies."
        returns="AlgoResult"
      />
      <div className="border-t border-[var(--border)]" />
      <HandlerDoc
        name="on_bar(state, bar: Bar)"
        description="Called when a new bar (candle) completes. Use for bar-based strategies."
        returns="AlgoResult"
      />
      <div className="border-t border-[var(--border)]" />
      <HandlerDoc
        name="on_fill(state, fill: Fill)"
        description="Called when an order is filled. Use to update position tracking in state."
        returns="AlgoResult"
      />
    </div>

    <SubHeading>Placing Orders</SubHeading>
    <Paragraph>
      Return orders as a tuple in the <InlineCode>AlgoResult</InlineCode>. Multiple orders
      can be submitted at once:
    </Paragraph>
    <CodeBlock>{`def on_bar(state, bar: Bar) -> AlgoResult:
    buy = Order(
        side="BUY",
        symbol=bar.symbol,
        qty=1,
        order_type="MARKET",
        limit_price=0.0,
        stop_price=0.0,
    )
    return AlgoResult(state, (buy,))`}</CodeBlock>

    <SubHeading>State Management</SubHeading>
    <Paragraph>
      State is a plain dict that persists across handler calls. Keep it immutable — use
      tuples instead of lists, and return a new dict rather than mutating the existing one:
    </Paragraph>
    <CodeBlock>{`def on_tick(state, tick: Tick) -> AlgoResult:
    new_prices = state['prices'] + (tick.price,)
    new_state = {**state, 'prices': new_prices}
    return AlgoResult(new_state, ())`}</CodeBlock>
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
