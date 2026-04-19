// Shared prototype helpers: proto-banner injection + fake-editor rendering.

(function injectBanner() {
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const banner = document.createElement("div");
  banner.className = "proto-banner";
  banner.innerHTML = `
    <span class="label">Editor Prototypes</span>
    <a href="index.html" data-f="index.html">Overview</a>
    <a href="variant-a-minimal.html" data-f="variant-a-minimal.html">A · Minimal</a>
    <a href="variant-b-workspace.html" data-f="variant-b-workspace.html">B · Workspace</a>
    <a href="variant-c-focus.html" data-f="variant-c-focus.html">C · Focus</a>
  `;
  document.body.appendChild(banner);
  banner.querySelectorAll("a").forEach((a) => {
    if (a.dataset.f === here) a.classList.add("active");
  });
})();

// Render a Python code sample with manual syntax coloring.
window.renderEditor = function renderEditor(rootEl, opts = {}) {
  const activeLine = opts.activeLine ?? 12;
  const lines = [
    ['<span class="tok-kw">from</span> <span class="tok-id">wolf_types</span> <span class="tok-kw">import</span> <span class="tok-id">AlgoResult</span>, <span class="tok-id">market_buy</span>, <span class="tok-id">market_sell</span>'],
    [''],
    [''],
    ['<span class="tok-kw">def</span> <span class="tok-fn">create_algo</span>():'],
    ['    <span class="tok-str">"""Momentum breakout with trailing stop."""</span>'],
    [''],
    ['    <span class="tok-kw">def</span> <span class="tok-fn">init</span>():'],
    ['        <span class="tok-kw">return</span> {<span class="tok-str">\'prices\'</span>: (), <span class="tok-str">\'position\'</span>: <span class="tok-num">0</span>}'],
    [''],
    ['    <span class="tok-kw">def</span> <span class="tok-fn">on_tick</span>(<span class="tok-id">state</span>, <span class="tok-id">tick</span>, <span class="tok-id">ctx</span>):'],
    ['        <span class="tok-com"># keep last 20 prices for SMA</span>'],
    ['        <span class="tok-id">prices</span> <span class="tok-op">=</span> (<span class="tok-op">*</span><span class="tok-id">state</span>[<span class="tok-str">\'prices\'</span>], <span class="tok-id">tick</span>.<span class="tok-id">price</span>)[<span class="tok-op">-</span><span class="tok-num">20</span>:]'],
    ['        <span class="tok-kw">if</span> <span class="tok-fn">len</span>(<span class="tok-id">prices</span>) <span class="tok-op">&lt;</span> <span class="tok-num">20</span>:'],
    ['            <span class="tok-kw">return</span> <span class="tok-cls">AlgoResult</span>({<span class="tok-op">**</span><span class="tok-id">state</span>, <span class="tok-str">\'prices\'</span>: <span class="tok-id">prices</span>}, ())'],
    [''],
    ['        <span class="tok-id">sma</span> <span class="tok-op">=</span> <span class="tok-fn">sum</span>(<span class="tok-id">prices</span>) <span class="tok-op">/</span> <span class="tok-fn">len</span>(<span class="tok-id">prices</span>)'],
    ['        <span class="tok-id">orders</span> <span class="tok-op">=</span> ()'],
    [''],
    ['        <span class="tok-kw">if</span> <span class="tok-id">tick</span>.<span class="tok-id">price</span> <span class="tok-op">&gt;</span> <span class="tok-id">sma</span> <span class="tok-op">*</span> <span class="tok-num">1.02</span> <span class="tok-kw">and</span> <span class="tok-id">state</span>[<span class="tok-str">\'position\'</span>] <span class="tok-op">==</span> <span class="tok-num">0</span>:'],
    ['            <span class="tok-id">orders</span> <span class="tok-op">=</span> (<span class="tok-fn">market_buy</span>(<span class="tok-num">1</span>),)'],
    [''],
    ['        <span class="tok-kw">return</span> <span class="tok-cls">AlgoResult</span>({<span class="tok-op">**</span><span class="tok-id">state</span>, <span class="tok-str">\'prices\'</span>: <span class="tok-id">prices</span>}, <span class="tok-id">orders</span>)'],
    [''],
    ['    <span class="tok-kw">return</span> {<span class="tok-str">\'init\'</span>: <span class="tok-id">init</span>, <span class="tok-str">\'on_tick\'</span>: <span class="tok-id">on_tick</span>}'],
  ];
  rootEl.innerHTML = lines
    .map((l, i) => {
      const isActive = i + 1 === activeLine;
      const num = String(i + 1).padStart(2, " ");
      return `<div class="editor-line${isActive ? " active" : ""}"><span class="editor-gutter">${num}</span>${l[0]}</div>`;
    })
    .join("");
};
