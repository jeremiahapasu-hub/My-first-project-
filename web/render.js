"use strict";
/* =========================================================================
 * UI layer for the browser edition.
 *
 * Chart geometry mirrors the Recharts configuration in the full app: 50% is
 * always drawn as a reference line on a win-rate axis, and buckets below a
 * usable sample size are faded rather than dropped.
 * ========================================================================= */

const $ = (id) => document.getElementById(id);

const state = {
  signals: [],
  messages: [],
  isSample: false,
  filters: { asset: "", provider: "", result: "", direction: "", timeframe: "", from: "", to: "" },
};

// ---- formatting ----------------------------------------------------------
const pct = (v) => (v * 100).toFixed(1) + "%";
const money = (v) => (v >= 0 ? "+" : "") + v.toFixed(2);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const shortDate = (iso) => { const p = iso.split("-"); return +p[2] + " " + MONTHS[+p[1] - 1]; };
const utc = (d) => d.toISOString().replace("T", " ").slice(0, 16);

// ---- SVG chart primitives -------------------------------------------------
const W = 720, H = 240, PAD = { t: 12, r: 12, b: 26, l: 50 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;

function axisLabels(points, scaleX, y) {
  const step = Math.max(1, Math.floor(points.length / 6));
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push({ x: scaleX(i), label: shortDate(points[i].date) });
  const last = points.length - 1;
  if (!out.length || out[out.length - 1].label !== shortDate(points[last].date)) out.push({ x: scaleX(last), label: shortDate(points[last].date) });
  return out.map((l) => '<text x="' + l.x + '" y="' + y + '" text-anchor="middle" class="tick">' + esc(l.label) + "</text>").join("");
}

function gridLines(ticks) {
  return ticks.map((t) =>
    '<line x1="' + PAD.l + '" y1="' + t.y + '" x2="' + (PAD.l + PW) + '" y2="' + t.y + '" stroke="var(--line)" stroke-dasharray="2 4"/>' +
    '<text x="' + (PAD.l - 8) + '" y="' + (t.y + 3.5) + '" text-anchor="end" class="tick">' + esc(t.label) + "</text>").join("");
}

function equityChart(series) {
  if (series.length < 2) return emptyChart("Not enough days to plot a curve");
  const vals = series.map((p) => p.cumulativePnl);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1;
  const sx = (i) => PAD.l + (i / (series.length - 1)) * PW;
  const sy = (v) => PAD.t + PH - ((v - min) / span) * PH;
  const line = series.map((p, i) => sx(i) + "," + sy(p.cumulativePnl)).join(" ");
  const stroke = (vals[vals.length - 1] ?? 0) >= 0 ? "var(--accent)" : "var(--loss)";
  const ticks = [0, .25, .5, .75, 1].map((f) => ({ y: sy(min + f * span), label: Math.round(min + f * span) }));

  return '<svg viewBox="0 0 ' + W + " " + H + '" class="chart" role="img" aria-label="Cumulative profit and loss">' +
    '<defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + stroke + '" stop-opacity=".28"/><stop offset="100%" stop-color="' + stroke + '" stop-opacity="0"/></linearGradient></defs>' +
    gridLines(ticks) + axisLabels(series, sx, PAD.t + PH + 17) +
    '<line x1="' + PAD.l + '" y1="' + sy(0) + '" x2="' + (PAD.l + PW) + '" y2="' + sy(0) + '" stroke="var(--line)" stroke-width="1.5"/>' +
    '<polygon points="' + PAD.l + "," + sy(min) + " " + line + " " + (PAD.l + PW) + "," + sy(min) + '" fill="url(#eq)"/>' +
    '<polyline points="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linejoin="round"/></svg>';
}

function winRateChart(series) {
  if (series.length < 2) return emptyChart("Not enough days to plot a trend");
  const sx = (i) => PAD.l + (i / (series.length - 1)) * PW;
  const sy = (v) => PAD.t + PH - v * PH;
  const ticks = [0, .25, .5, .75, 1].map((v) => ({ y: sy(v), label: Math.round(v * 100) + "%" }));

  return '<svg viewBox="0 0 ' + W + " " + H + '" class="chart" role="img" aria-label="Daily win rate and accuracy against the 50% break-even line">' +
    gridLines(ticks) + axisLabels(series, sx, PAD.t + PH + 17) +
    '<line x1="' + PAD.l + '" y1="' + sy(.5) + '" x2="' + (PAD.l + PW) + '" y2="' + sy(.5) + '" stroke="var(--pending)" stroke-dasharray="4 4" stroke-opacity=".6"/>' +
    '<text x="' + (PAD.l + PW - 4) + '" y="' + (sy(.5) - 6) + '" text-anchor="end" class="tick">coin flip</text>' +
    '<polyline points="' + series.map((p, i) => sx(i) + "," + sy(p.accuracy)).join(" ") + '" fill="none" stroke="var(--ink-dim)" stroke-width="1.25" stroke-dasharray="3 3" opacity=".75"/>' +
    '<polyline points="' + series.map((p, i) => sx(i) + "," + sy(p.winRate)).join(" ") + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/></svg>';
}

/** Horizontal win-rate bars; thin samples faded, never hidden. */
function bucketBars(buckets, labelChars) {
  if (!buckets.length) return emptyChart("Nothing to rank");
  const sorted = [...buckets].sort((a, b) => b.winRate - a.winRate);
  const rowH = 26, labelW = (labelChars || 13) * 7.2, barW = W - labelW - 62, h = sorted.length * rowH + 26;

  const rows = sorted.map((b, i) => {
    const y = i * rowH + 6, w = Math.max(1, b.winRate * barW);
    const fill = b.winRate >= .5 ? "var(--win)" : "var(--loss)";
    return '<text x="' + (labelW - 8) + '" y="' + (y + 13) + '" text-anchor="end" class="cat">' + esc(b.label) + "</text>" +
      '<rect x="' + labelW + '" y="' + (y + 4) + '" width="' + w + '" height="13" rx="2.5" fill="' + fill + '" opacity="' + (b.settled < 8 ? .32 : 1) + '"><title>' + esc(b.label) + " — " + pct(b.winRate) + ", " + b.settled + " settled, net " + money(b.netPnl) + "</title></rect>" +
      '<text x="' + (labelW + w + 7) + '" y="' + (y + 14.5) + '" class="val">' + pct(b.winRate) + "</text>";
  }).join("");

  const mid = labelW + barW * .5;
  return '<svg viewBox="0 0 ' + W + " " + h + '" class="chart" role="img" aria-label="Win rate by category">' +
    '<line x1="' + mid + '" y1="2" x2="' + mid + '" y2="' + (h - 22) + '" stroke="var(--pending)" stroke-dasharray="4 4" stroke-opacity=".45"/>' + rows +
    '<text x="' + labelW + '" y="' + (h - 6) + '" class="tick">0%</text>' +
    '<text x="' + mid + '" y="' + (h - 6) + '" text-anchor="middle" class="tick">50%</text>' +
    '<text x="' + (labelW + barW) + '" y="' + (h - 6) + '" text-anchor="end" class="tick">100%</text></svg>';
}

/** Vertical bars with volume encoded as opacity. */
function verticalBars(items, valueOf, labelOf, opts) {
  if (!items.length) return emptyChart("No data in range");
  const o = opts || {}, h = 200, p = { t: 10, b: 24, l: 46, r: 10 };
  const pw = W - p.l - p.r, ph = h - p.t - p.b, slot = pw / items.length;
  const maxV = o.percent ? 1 : Math.max(1, ...items.map(valueOf));
  const maxVol = Math.max(1, ...items.map((it) => it.total || 1));

  const bars = items.map((it, i) => {
    const v = valueOf(it), bh = (v / maxV) * ph;
    const x = p.l + i * slot + slot * .17, w = Math.max(1, slot * .66);
    const fill = o.percent ? (v >= .5 ? "var(--win)" : "var(--loss)") : "var(--accent-dim)";
    const op = o.percent ? (.35 + .65 * ((it.total || 1) / maxVol)).toFixed(2) : 1;
    return '<rect x="' + x + '" y="' + (p.t + ph - bh) + '" width="' + w + '" height="' + bh + '" rx="2" fill="' + fill + '" opacity="' + op + '"><title>' + esc(o.tip ? o.tip(it) : labelOf(it)) + "</title></rect>" +
      (items.length <= 26 && i % 2 === 0 ? '<text x="' + (x + w / 2) + '" y="' + (h - 7) + '" text-anchor="middle" class="tick">' + esc(labelOf(it)) + "</text>" : "");
  }).join("");

  const ticks = [0, .5, 1].map((f) => {
    const y = p.t + ph - f * ph;
    return '<line x1="' + p.l + '" y1="' + y + '" x2="' + (p.l + pw) + '" y2="' + y + '" stroke="var(--line)" stroke-dasharray="2 4"/>' +
      '<text x="' + (p.l - 8) + '" y="' + (y + 3.5) + '" text-anchor="end" class="tick">' + (o.percent ? Math.round(f * 100) + "%" : Math.round(f * maxV)) + "</text>";
  }).join("");

  let xs = "";
  if (items.length > 26 && o.dated) {
    const sx = (i) => p.l + i * slot + slot / 2;
    xs = axisLabels(items, sx, h - 7);
  }
  return '<svg viewBox="0 0 ' + W + " " + h + '" class="chart" role="img" aria-label="' + esc(o.aria || "Bar chart") + '">' + ticks + bars + xs + "</svg>";
}

function sentimentChart(series) {
  if (!series.length) return emptyChart("No messages in range");
  const h = 220, p = { t: 10, b: 24, l: 46, r: 10 };
  const pw = W - p.l - p.r, ph = h - p.t - p.b, slot = pw / series.length;
  const max = Math.max(1, ...series.map((d) => d.bullish + d.bearish + d.neutral));

  const bars = series.map((d, i) => {
    const x = p.l + i * slot + slot * .15, w = Math.max(1, slot * .7), u = ph / max;
    let y = p.t + ph, out = "";
    y -= d.bullish * u; out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + d.bullish * u + '" fill="var(--win)"/>';
    y -= d.neutral * u; out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + d.neutral * u + '" fill="var(--draw)" opacity=".55"/>';
    y -= d.bearish * u; out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + d.bearish * u + '" fill="var(--loss)"/>';
    return "<g><title>" + esc(d.date) + " — " + d.bullish + " bullish, " + d.bearish + " bearish, " + d.neutral + " neutral</title>" + out + "</g>";
  }).join("");

  const ticks = [0, .5, 1].map((f) => {
    const y = p.t + ph - f * ph;
    return '<line x1="' + p.l + '" y1="' + y + '" x2="' + (p.l + pw) + '" y2="' + y + '" stroke="var(--line)" stroke-dasharray="2 4"/>' +
      '<text x="' + (p.l - 8) + '" y="' + (y + 3.5) + '" text-anchor="end" class="tick">' + Math.round(f * max) + "</text>";
  }).join("");

  return '<svg viewBox="0 0 ' + W + " " + h + '" class="chart" role="img" aria-label="Daily message counts by sentiment">' +
    ticks + bars + axisLabels(series, (i) => p.l + i * slot + slot / 2, h - 7) + "</svg>";
}

function emptyChart(msg) {
  return '<svg viewBox="0 0 ' + W + ' 120" class="chart"><text x="' + W / 2 + '" y="64" text-anchor="middle" class="tick">' + esc(msg) + "</text></svg>";
}

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function heatGrid(cells) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  const map = new Map(cells.map((c) => [c.weekday + "-" + c.hour, c]));
  let html = '<div class="heat"><div class="heat-row"><span class="heat-day"></span>';
  for (let h = 0; h < 24; h++) html += '<span class="heat-hour">' + (h % 3 === 0 ? String(h).padStart(2, "0") : "") + "</span>";
  html += "</div>";

  // Monday-first: the trading week reads Mon→Sun.
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    html += '<div class="heat-row"><span class="heat-day">' + DAYS[wd] + "</span>";
    for (let h = 0; h < 24; h++) {
      const c = map.get(wd + "-" + h), n = c ? c.count : 0;
      if (!n) { html += '<span class="heat-cell" title="' + DAYS[wd] + " " + String(h).padStart(2, "0") + ':00 — no signals"></span>'; continue; }
      const intensity = Math.round((.2 + .8 * (n / max)) * 100);
      const col = c.winRate >= .5 ? "var(--win)" : "var(--loss)";
      html += '<span class="heat-cell" style="background:color-mix(in oklab, ' + col + " " + intensity + '%, transparent)" title="' + DAYS[wd] + " " + String(h).padStart(2, "0") + ":00 — " + n + " signals, " + pct(c.winRate) + '"></span>';
    }
    html += "</div>";
  }
  return html + "</div>";
}

// ---- filtering -----------------------------------------------------------
function applyFilters(sigs) {
  const f = state.filters;
  return sigs.filter((s) => {
    if (f.asset && s.asset !== f.asset) return false;
    if (f.provider && (s.provider || "Unattributed") !== f.provider) return false;
    if (f.result && s.result !== f.result) return false;
    if (f.direction && s.direction !== f.direction) return false;
    if (f.timeframe && String(s.timeframeSec) !== f.timeframe) return false;
    if (f.from && s.entryAt < new Date(f.from)) return false;
    if (f.to) { const to = new Date(f.to); to.setUTCHours(23, 59, 59, 999); if (s.entryAt > to) return false; }
    return true;
  });
}

function chatSummary(msgs) {
  const visible = msgs.filter((m) => !m.isSpam);
  const seen = new Set(); let dupes = 0;
  for (const m of msgs) { if (seen.has(m.hash)) dupes++; else seen.add(m.hash); }
  const b = visible.filter((m) => m.sentiment === "BULLISH").length;
  const r = visible.filter((m) => m.sentiment === "BEARISH").length;
  const n = visible.length - b - r;
  const mean = visible.length ? visible.reduce((s, m) => s + m.sentimentScore, 0) / visible.length : 0;

  const byDate = new Map();
  for (const m of visible) {
    const k = m.postedAt.toISOString().slice(0, 10);
    const e = byDate.get(k) || { date: k, bullish: 0, bearish: 0, neutral: 0 };
    if (m.sentiment === "BULLISH") e.bullish++; else if (m.sentiment === "BEARISH") e.bearish++; else e.neutral++;
    byDate.set(k, e);
  }

  const tally = (get) => {
    const c = new Map();
    for (const m of visible) for (const v of get(m)) c.set(v, (c.get(v) || 0) + 1);
    return [...c.entries()].map(([name, count]) => ({ name, count })).sort((a, b2) => b2.count - a.count);
  };

  return { analysed: visible.length, all: msgs.length, spam: msgs.length - visible.length,
    duplicates: dupes, spamRatio: msgs.length ? (msgs.length - visible.length) / msgs.length : 0,
    bullish: b, bearish: r, neutral: n, mean,
    series: [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date)),
    topAssets: tally((m) => m.assets), topStrategies: tally((m) => m.strategies) };
}

// ---- render --------------------------------------------------------------
const tile = (label, value, hint, tone) =>
  '<div class="tile"><span class="eyebrow">' + esc(label) + '</span><span class="tile-v ' + (tone || "") + '">' + esc(value) + '</span><span class="tile-h">' + esc(hint || "") + "</span></div>";

const panel = (title, sub, body) =>
  '<section class="panel"><header><h2>' + esc(title) + "</h2>" + (sub ? "<p>" + esc(sub) + "</p>" : "") + "</header>" + body + "</section>";

const ranks = (buckets, tone) => '<ul class="ranks">' + (buckets.length ? buckets.map((b) =>
  '<li><div class="rank-top"><span>' + esc(b.label) + '</span><b class="' + (b.winRate >= .5 ? "good" : "bad") + '">' + pct(b.winRate) + "</b></div>" +
  '<div class="meter"><i class="' + tone + '" style="width:' + (b.winRate * 100).toFixed(1) + '%"></i></div>' +
  '<div class="rank-bot"><span>' + b.settled + ' settled</span><span class="' + (b.netPnl >= 0 ? "good" : "bad") + '">' + money(b.netPnl) + "</span></div></li>").join("")
  : '<li class="muted" style="font-size:11.5px">Nothing has enough settled signals to rank yet.</li>') + "</ul>";

const SEV = { good: "good", warning: "warn", critical: "bad", info: "info" };

function render() {
  const sigs = applyFilters(state.signals);
  const results = $("results");
  results.classList.remove("hidden");

  if (!state.signals.length && !state.messages.length) { results.classList.add("hidden"); return; }

  const st = computeStats(sigs);
  const series = dailySeries(sigs);
  const assets = byAsset(sigs), hours = byHour(sigs), providers = byProvider(sigs);
  const ar = rankBuckets(assets, 8);
  const chat = state.messages.length ? chatSummary(state.messages) : null;
  const ins = generateInsights(sigs, chat);

  let html = "";

  // A synthetic-data banner has to be impossible to miss — the charts render it
  // convincingly enough to be mistaken for real market history.
  if (state.isSample) {
    html += '<div class="errbox" style="border-color:color-mix(in oklab, var(--pending) 40%, transparent);background:color-mix(in oklab, var(--pending) 9%, transparent);margin:0 0 18px">' +
      '<b style="color:var(--pending)">This is invented data.</b> The sample was produced by a random number generator to exercise the charts. ' +
      'The assets, providers and win rates below are fictional and describe no real instrument. Load your own export to get real answers.</div>';
  }

  // ---- filters
  const opts = (vals, cur) => '<option value="">All</option>' + vals.map((v) =>
    '<option value="' + esc(v.value) + '"' + (cur === v.value ? " selected" : "") + ">" + esc(v.label) + "</option>").join("");

  if (state.signals.length) {
    const uniq = (arr) => [...new Set(arr)].sort();
    html += '<section class="panel" style="margin-bottom:18px"><div class="body"><div class="row" style="gap:10px">' +
      '<label class="field"><span class="eyebrow">From</span><input type="date" id="fFrom" value="' + esc(state.filters.from) + '"></label>' +
      '<label class="field"><span class="eyebrow">To</span><input type="date" id="fTo" value="' + esc(state.filters.to) + '"></label>' +
      '<label class="field"><span class="eyebrow">Asset</span><select id="fAsset">' + opts(uniq(state.signals.map((s) => s.asset)).map((v) => ({ value: v, label: v })), state.filters.asset) + "</select></label>" +
      '<label class="field"><span class="eyebrow">Provider</span><select id="fProvider">' + opts(uniq(state.signals.map((s) => s.provider || "Unattributed")).map((v) => ({ value: v, label: v })), state.filters.provider) + "</select></label>" +
      '<label class="field"><span class="eyebrow">Result</span><select id="fResult">' + opts(["WIN","LOSS","DRAW","PENDING"].map((v) => ({ value: v, label: v })), state.filters.result) + "</select></label>" +
      '<label class="field"><span class="eyebrow">Direction</span><select id="fDirection">' + opts(["BUY","SELL"].map((v) => ({ value: v, label: v })), state.filters.direction) + "</select></label>" +
      '<label class="field"><span class="eyebrow">Timeframe</span><select id="fTimeframe">' + opts(uniq(state.signals.map((s) => s.timeframeSec)).map((v) => ({ value: String(v), label: fmtTf(v) })), state.filters.timeframe) + "</select></label>" +
      '<button id="clearFilters" style="align-self:flex-end">Clear</button>' +
      '<button id="exportCsv" style="align-self:flex-end">Download CSV</button>' +
      "</div></div></section>";

    // ---- headline figures
    html += '<div class="tiles">' +
      tile("Win rate", pct(st.winRate), st.wins + "W / " + st.losses + "L, draws excluded", st.winRate >= .5 ? "good" : "bad") +
      tile("Accuracy", pct(st.accuracy), "over " + st.settled + " settled") +
      tile("Net P/L", money(st.netPnl), "avg " + money(st.avgPnl) + " per signal", st.netPnl >= 0 ? "good" : "bad") +
      tile("Profit factor", st.profitFactor === null ? "—" : st.profitFactor.toFixed(2), st.profitFactor === null ? "no losses recorded" : st.profitFactor >= 1 ? "gains exceed losses" : "losses exceed gains", st.profitFactor === null ? "" : st.profitFactor >= 1 ? "good" : "bad") +
      tile("Best run", String(st.bestStreak), "consecutive wins", "good") +
      tile("Worst run", String(st.worstStreak), "consecutive losses", st.worstStreak >= 5 ? "warn" : "") +
      "</div>";

    html += '<div class="grid two">' +
      panel("Cumulative profit & loss", "Running total across the filtered period", '<div class="body scroll">' + equityChart(series) + "</div>") +
      panel("Win rate & accuracy", "Daily, against the 50% break-even line", '<div class="body scroll">' + winRateChart(series) + "</div>") +
      "</div>";

    html += '<div style="margin-bottom:18px">' + panel("Performance by asset", "Faded bars have fewer than 8 settled signals", '<div class="body scroll">' + bucketBars(assets) + "</div>") + "</div>";

    html += '<div class="grid two">' +
      panel("Strongest assets", "Minimum 8 settled signals" + (ar.excluded ? " · " + ar.excluded + " excluded as too thin" : ""), ranks(ar.best, "good")) +
      panel("Weakest assets", "Same threshold, worst first", ranks(ar.worst, "bad")) + "</div>";

    html += '<div class="grid two">' +
      panel("Performance by hour", "Bar opacity shows signal volume (UTC)", '<div class="body scroll">' +
        verticalBars(hours, (b) => b.winRate, (b) => b.label, { percent: true, aria: "Win rate by hour", tip: (b) => b.label + " UTC — " + b.total + " signals, " + pct(b.winRate) }) + "</div>") +
      panel("Signal frequency", "Signals per day", '<div class="body scroll">' +
        verticalBars(series.map((p) => ({ date: p.date, count: p.count })), (p) => p.count, (p) => shortDate(p.date), { dated: true, aria: "Signals per day", tip: (p) => p.date + " — " + p.count + " signals" }) + "</div>") +
      "</div>";

    html += '<div style="margin-bottom:18px">' + panel("Weekly heat map", "Win rate by weekday and hour — green above 50%, red below",
      '<div class="scroll">' + heatGrid(heatmap(sigs)) + "</div>" +
      '<div class="legend"><span><i class="swatch" style="background:var(--win)"></i>above 50%</span><span><i class="swatch" style="background:var(--loss)"></i>below 50%</span><span>Opacity shows volume. Hours are UTC.</span></div>') + "</div>";

    if (providers.length > 1) {
      html += '<div style="margin-bottom:18px">' + panel("Performance by provider", "Where the signals came from", '<div class="body scroll">' + bucketBars(providers, 22) + "</div>") + "</div>";
    }
  }

  // ---- chat
  if (chat) {
    html += '<div class="tiles">' +
      tile("Messages analysed", chat.analysed.toLocaleString(), "of " + chat.all.toLocaleString() + " imported") +
      tile("Bullish", chat.bullish.toLocaleString(), Math.round(chat.bullish / Math.max(chat.analysed, 1) * 100) + "% of analysed", "good") +
      tile("Bearish", chat.bearish.toLocaleString(), Math.round(chat.bearish / Math.max(chat.analysed, 1) * 100) + "% of analysed", "bad") +
      tile("Promotional", chat.spam.toLocaleString(), (chat.spamRatio * 100).toFixed(1) + "% of the room", chat.spamRatio > .2 ? "warn" : "") +
      tile("Duplicates", chat.duplicates.toLocaleString(), "repeated message bodies") + "</div>";

    html += '<div class="grid two">' +
      panel("Sentiment over time", "Promotional messages excluded", '<div class="body scroll">' + sentimentChart(chat.series) + "</div>") +
      panel("Most-discussed assets", "Detected from message text", '<ul class="ranks">' + (chat.topAssets.slice(0, 8).map((r) =>
        '<li><div class="rank-top"><span>' + esc(r.name) + '</span><b class="muted">' + r.count + "</b></div>" +
        '<div class="meter"><i style="width:' + (r.count / chat.topAssets[0].count * 100).toFixed(1) + '%"></i></div></li>').join("") || '<li class="muted" style="font-size:11.5px">No assets detected.</li>') + "</ul>") +
      "</div>";
  }

  // ---- insights
  html += '<div style="margin-bottom:18px">' + panel("Summary", "Computed locally in this page", '<p style="padding:14px 17px;margin:0;font-size:12.5px;color:var(--ink-dim)">' + esc(ins.summary) + "</p>") + "</div>";

  const findings = ins.insights.filter((i) => i.kind !== "recommendation");
  const recs = ins.insights.filter((i) => i.kind === "recommendation");

  html += '<div class="grid two">' +
    panel("Findings", "Each describes something that already happened", '<ul class="findings">' + findings.map((i) =>
      '<li class="finding sev-' + SEV[i.severity] + '"><div class="finding-head"><span class="pill ' + SEV[i.severity] + '">' + esc(i.kind) + "</span><h3>" + esc(i.title) + "</h3></div>" +
      "<p>" + esc(i.detail) + "</p>" +
      '<div class="conf"><span class="eyebrow">Confidence</span><div class="meter sm"><i style="width:' + Math.round(i.confidence * 100) + '%"></i></div><span class="conf-n">' + Math.round(i.confidence * 100) + "%</span></div></li>").join("") + "</ul>") +
    '<div class="grid">' +
      panel("Risk assessment", "What makes this data harder to trust",
        '<div style="display:flex;align-items:baseline;gap:9px;padding:14px 17px 9px"><b style="font-size:22px;font-weight:600" class="' + (ins.risk.level === "low" ? "good" : ins.risk.level === "high" ? "bad" : "warn") + '">' + ins.risk.level[0].toUpperCase() + ins.risk.level.slice(1) + '</b><span style="font-size:11.5px;color:var(--ink-faint)">' + ins.risk.score + "/100</span></div>" +
        '<div style="padding:0 17px"><div class="meter"><i class="' + (ins.risk.score >= 45 ? "bad" : "") + '" style="width:' + ins.risk.score + '%"></i></div></div>' +
        '<ul class="plain">' + ins.risk.factors.map((f) => "<li>" + esc(f) + "</li>").join("") + "</ul>") +
      panel("Suggested next steps", "About the data, not about trades", '<ul class="plain">' + recs.map((r) => "<li>" + esc(r.detail) + "</li>").join("") + "</ul>") +
    "</div></div>";

  // ---- table
  if (sigs.length) {
    const rows = [...sigs].sort((a, b) => b.entryAt - a.entryAt).slice(0, 200);
    html += '<div style="margin-bottom:18px">' + panel("Signal log", "Newest first, showing " + rows.length + " of " + sigs.length + ". Times are UTC.",
      '<div class="scroll"><table><thead><tr><th>Entry</th><th>Asset</th><th>Dir</th><th>TF</th><th>Result</th><th style="text-align:right">Stake</th><th style="text-align:right">P/L</th><th>Provider</th></tr></thead><tbody>' +
      rows.map((s) => "<tr>" +
        '<td style="font-family:ui-monospace,monospace;color:var(--ink-dim)">' + utc(s.entryAt) + "</td>" +
        "<td>" + esc(s.asset) + "</td>" +
        '<td><span class="tag ' + (s.direction === "BUY" ? "good" : "bad") + '">' + s.direction + "</span></td>" +
        '<td class="muted">' + fmtTf(s.timeframeSec) + "</td>" +
        '<td><span class="tag ' + (s.result === "WIN" ? "good" : s.result === "LOSS" ? "bad" : s.result === "DRAW" ? "info" : "warn") + '">' + s.result + "</span></td>" +
        '<td style="text-align:right" class="muted">' + (s.stake === null ? "—" : s.stake.toFixed(2)) + "</td>" +
        '<td style="text-align:right" class="' + (s.pnl === null ? "muted" : s.pnl >= 0 ? "good" : "bad") + '">' + (s.pnl === null ? "—" : money(s.pnl)) + "</td>" +
        '<td class="muted">' + esc(s.provider || "—") + "</td></tr>").join("") +
      "</tbody></table></div>") + "</div>";
  }

  results.innerHTML = html;
  wireFilters();
}

function wireFilters() {
  const bind = (id, key) => { const el = $(id); if (el) el.onchange = () => { state.filters[key] = el.value; render(); }; };
  bind("fFrom", "from"); bind("fTo", "to"); bind("fAsset", "asset"); bind("fProvider", "provider");
  bind("fResult", "result"); bind("fDirection", "direction"); bind("fTimeframe", "timeframe");

  const clear = $("clearFilters");
  if (clear) clear.onclick = () => { state.filters = { asset:"", provider:"", result:"", direction:"", timeframe:"", from:"", to:"" }; render(); };

  const exp = $("exportCsv");
  if (exp) exp.onclick = downloadCsv;
}

/** Guards against spreadsheet formula injection, same as the server exporter. */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv() {
  const sigs = applyFilters(state.signals);
  const head = ["Entry (UTC)","Expiry (UTC)","Asset","Direction","Timeframe","Result","Stake","Payout","P/L","Confidence","Provider"];
  const lines = [head.join(",")].concat(sigs.map((s) => [
    utc(s.entryAt), utc(s.expiresAt), s.asset, s.direction, fmtTf(s.timeframeSec), s.result,
    s.stake ?? "", s.payout ?? "", s.pnl ?? "", s.confidence ?? "", s.provider ?? ""
  ].map(csvCell).join(",")));

  // BOM so Excel on Windows reads UTF-8 correctly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "signals-" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ---- import handling -----------------------------------------------------
function reportImport(kind, res, filename) {
  const box = $("importReport");

  // Three colours, not two: a file where most rows landed is a caveat, not a
  // failure, and colouring it red makes a good import look broken.
  const tone = res.rows.length === 0 ? "loss" : res.errors.length === 0 ? "win" : "pending";

  box.innerHTML =
    '<div class="errbox" style="border-color:color-mix(in oklab, var(--' + tone + ') 32%, transparent);' +
    "background:color-mix(in oklab, var(--" + tone + ') 8%, transparent)">' +
    '<b style="color:var(--' + tone + ')">' + esc(filename) + "</b> — " +
    res.rows.length.toLocaleString() + " " + (kind === "SIGNALS" ? "signals" : "messages") + " imported" +
    (res.errors.length ? ", " + res.errors.length + " row" + (res.errors.length === 1 ? "" : "s") + " skipped" : ", no errors") + "." +
    (res.rows.length === 0 ? " Nothing could be read from this file — check the format." : "") +
    (res.errors.length ? '<ul class="errlist">' + res.errors.slice(0, 30).map((e) => "<li>row " + e.row + ": " + esc(e.reason) + "</li>").join("") + "</ul>" : "") +
    "</div>";
}

function ingest(text, filename, forcedKind) {
  const kind = forcedKind || detectKind(text, filename);
  if (kind === "SIGNALS") {
    const res = parseSignals(text, filename);
    if (!res.rows.length && !state.signals.length) {
      // Falling back rather than showing an empty dashboard for a chat file.
      const chatRes = parseChat(text, filename);
      if (chatRes.rows.length) { state.messages = state.messages.concat(chatRes.rows); reportImport("CHAT", chatRes, filename); render(); return; }
    }
    state.signals = state.signals.concat(res.rows);
    reportImport("SIGNALS", res, filename);
  } else {
    const res = parseChat(text, filename);
    state.messages = state.messages.concat(res.rows);
    reportImport("CHAT", res, filename);
  }
  $("reset").classList.remove("hidden");
  render();
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    state.isSample = false;
    $("dropLabel").textContent = file.name;
    ingest(String(reader.result), file.name);
  };
  reader.readAsText(file);
}

// ---- wiring --------------------------------------------------------------
$("file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) readFile(f); });

const drop = $("drop");
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f); });

$("pasteToggle").onclick = () => $("pasteBox").classList.toggle("hidden");
$("parsePaste").onclick = () => {
  const t = $("paste").value.trim();
  if (!t) return;
  state.isSample = false;
  ingest(t, "pasted.txt");
};

$("loadSample").onclick = () => {
  state.signals = []; state.messages = [];
  state.isSample = true;
  const sig = parseSignals(SAMPLE_SIGNALS, "signals.csv");
  const chat = parseChat(SAMPLE_CHAT, "chat.txt");
  state.signals = sig.rows;
  state.messages = chat.rows;
  $("dropLabel").textContent = "Choose a file, or drop one here";
  reportImport("SIGNALS", sig, "sample signals.csv (synthetic)");
  $("reset").classList.remove("hidden");
  render();
};

$("reset").onclick = () => {
  state.signals = []; state.messages = []; state.isSample = false;
  state.filters = { asset:"", provider:"", result:"", direction:"", timeframe:"", from:"", to:"" };
  $("importReport").innerHTML = "";
  $("results").classList.add("hidden");
  $("reset").classList.add("hidden");
  $("dropLabel").textContent = "Choose a file, or drop one here";
  $("file").value = "";
};
