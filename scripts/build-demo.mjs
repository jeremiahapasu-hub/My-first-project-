/**
 * Builds a self-contained static snapshot of the dashboard.
 *
 * The real app needs a Node server and PostgreSQL, so it cannot be published as
 * a static page. This bakes the *actual computed output* of a seeded run into
 * one HTML file with hand-rolled SVG charts, so the analysis can be looked at in
 * a browser without running anything.
 *
 * It is a snapshot, not the app: no auth, no import, no filtering, no export.
 *
 * Usage:
 *   npm run demo                              against a dev server on :3000
 *   node scripts/build-demo.mjs <url> [out]   against any running instance
 *   node scripts/build-demo.mjs <dir> [out]   from previously-saved JSON
 *
 * When given a URL it signs in with the seeded analyst credentials and pulls
 * the four analytics endpoints itself, so producing the page is one command.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const source = process.argv[2] ?? "http://localhost:3000";
const outPath = process.argv[3] ?? "demo.html";

const ENDPOINTS = {
  overview: "/api/analytics/overview",
  heatmap: "/api/analytics/heatmap",
  chat: "/api/chat/analysis",
  insights: "/api/insights",
};

/** Signs in, then pulls every endpoint with the returned session cookie. */
async function fetchFromServer(baseUrl) {
  const email = process.env.SEED_ANALYST_EMAIL ?? "analyst@example.com";
  const password = process.env.SEED_ANALYST_PASSWORD ?? "analyst12345";

  const login = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);

  if (!login) {
    throw new Error(
      `Could not reach ${baseUrl}. Start the app with \`npm run dev\` first.`,
    );
  }

  if (!login.ok) {
    throw new Error(
      `Sign-in failed as ${email} (HTTP ${login.status}). ` +
        `Run \`npm run db:seed\`, or set SEED_ANALYST_EMAIL / SEED_ANALYST_PASSWORD.`,
    );
  }

  // `fetch` does not keep a cookie jar, so the session is threaded manually.
  const cookie = (login.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .join("; ");

  const result = {};

  for (const [name, path] of Object.entries(ENDPOINTS)) {
    const response = await fetch(new URL(path, baseUrl), { headers: { cookie } });

    if (!response.ok) {
      throw new Error(`GET ${path} returned HTTP ${response.status}`);
    }

    result[name] = await response.json();
  }

  return result;
}

function readFromDir(dir) {
  const read = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  return {
    overview: read("overview"),
    heatmap: read("heatmap"),
    chat: read("chat"),
    insights: read("insights"),
  };
}

const data = /^https?:\/\//.test(source)
  ? await fetchFromServer(source)
  : readFromDir(source);

const { overview, heatmap, chat, insights } = data;

const { stats } = overview;

// --- formatting -------------------------------------------------------------

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const money = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const shortDate = (iso) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};

// --- SVG chart builders -----------------------------------------------------
// Hand-rolled because the artifact CSP blocks external chart libraries.

const W = 720;
const H = 240;
const PAD = { top: 12, right: 12, bottom: 26, left: 46 };
const PW = W - PAD.left - PAD.right;
const PH = H - PAD.top - PAD.bottom;

/** Shared axis/grid chrome so every chart reads as one family. */
function frame({ yTicks, xLabels }) {
  const grid = yTicks
    .map(
      (t) =>
        `<line x1="${PAD.left}" y1="${t.y}" x2="${PAD.left + PW}" y2="${t.y}" stroke="var(--line)" stroke-dasharray="2 4" stroke-width="1"/>` +
        `<text x="${PAD.left - 8}" y="${t.y + 3.5}" text-anchor="end" class="tick">${esc(t.label)}</text>`,
    )
    .join("");

  const xs = xLabels
    .map(
      (l) =>
        `<text x="${l.x}" y="${PAD.top + PH + 17}" text-anchor="middle" class="tick">${esc(l.label)}</text>`,
    )
    .join("");

  return grid + xs;
}

/** Picks ~6 evenly spaced labels from a series, always including the last. */
function sparseLabels(points, scaleX) {
  const step = Math.max(1, Math.floor(points.length / 6));
  const out = [];

  for (let i = 0; i < points.length; i += step) {
    out.push({ x: scaleX(i), label: shortDate(points[i].date) });
  }

  const last = points.length - 1;
  if (out.at(-1)?.label !== shortDate(points[last].date)) {
    out.push({ x: scaleX(last), label: shortDate(points[last].date) });
  }

  return out;
}

function equityChart(series) {
  const values = series.map((p) => p.cumulativePnl);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const scaleX = (i) => PAD.left + (i / (series.length - 1)) * PW;
  const scaleY = (v) => PAD.top + PH - ((v - min) / span) * PH;

  const line = series.map((p, i) => `${scaleX(i)},${scaleY(p.cumulativePnl)}`).join(" ");
  const area = `${PAD.left},${scaleY(min)} ${line} ${PAD.left + PW},${scaleY(min)}`;

  const ending = values.at(-1) ?? 0;
  const stroke = ending >= 0 ? "var(--accent)" : "var(--loss)";

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = min + f * span;
    return { y: scaleY(v), label: Math.round(v).toString() };
  });

  return `
<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Cumulative profit and loss, ending at ${money(ending)}">
  <defs>
    <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${stroke}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${frame({ yTicks, xLabels: sparseLabels(series, scaleX) })}
  <line x1="${PAD.left}" y1="${scaleY(0)}" x2="${PAD.left + PW}" y2="${scaleY(0)}" stroke="var(--line)" stroke-width="1.5"/>
  <polygon points="${area}" fill="url(#eqFill)"/>
  <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
}

function winRateChart(series) {
  const scaleX = (i) => PAD.left + (i / (series.length - 1)) * PW;
  const scaleY = (v) => PAD.top + PH - v * PH;

  const win = series.map((p, i) => `${scaleX(i)},${scaleY(p.winRate)}`).join(" ");
  const acc = series.map((p, i) => `${scaleX(i)},${scaleY(p.accuracy)}`).join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) => ({
    y: scaleY(v),
    label: `${Math.round(v * 100)}%`,
  }));

  return `
<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Daily win rate and accuracy against the 50% break-even line">
  ${frame({ yTicks, xLabels: sparseLabels(series, scaleX) })}
  <line x1="${PAD.left}" y1="${scaleY(0.5)}" x2="${PAD.left + PW}" y2="${scaleY(0.5)}"
        stroke="var(--pending)" stroke-dasharray="4 4" stroke-opacity="0.6"/>
  <text x="${PAD.left + PW - 4}" y="${scaleY(0.5) - 6}" text-anchor="end" class="tick">coin flip</text>
  <polyline points="${acc}" fill="none" stroke="var(--ink-dim)" stroke-width="1.25" stroke-dasharray="3 3" opacity="0.75"/>
  <polyline points="${win}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
}

/** Horizontal win-rate bars. Thin samples are faded, never dropped. */
function bucketBars(buckets, labelChars = 13) {
  const sorted = [...buckets].sort((a, b) => b.winRate - a.winRate);
  const rowH = 26;
  const labelW = labelChars * 7.2;
  const barW = W - labelW - 60;
  const height = sorted.length * rowH + 26;

  const rows = sorted
    .map((b, i) => {
      const y = i * rowH + 6;
      const w = Math.max(1, b.winRate * barW);
      const thin = b.settled < 8;
      const fill = b.winRate >= 0.5 ? "var(--win)" : "var(--loss)";

      return `
  <text x="${labelW - 8}" y="${y + 13}" text-anchor="end" class="cat">${esc(b.label)}</text>
  <rect x="${labelW}" y="${y + 4}" width="${w}" height="13" rx="2.5" fill="${fill}" opacity="${thin ? 0.32 : 1}"/>
  <text x="${labelW + w + 7}" y="${y + 14.5}" class="val">${pct(b.winRate)}</text>`;
    })
    .join("");

  const midline = labelW + barW * 0.5;

  return `
<svg viewBox="0 0 ${W} ${height}" class="chart" role="img" aria-label="Win rate by category">
  <line x1="${midline}" y1="2" x2="${midline}" y2="${height - 22}" stroke="var(--pending)" stroke-dasharray="4 4" stroke-opacity="0.45"/>
  ${rows}
  <text x="${labelW}" y="${height - 6}" class="tick">0%</text>
  <text x="${midline}" y="${height - 6}" text-anchor="middle" class="tick">50%</text>
  <text x="${labelW + barW}" y="${height - 6}" text-anchor="end" class="tick">100%</text>
</svg>`;
}

/** Vertical bars with volume encoded as opacity. */
function hourlyBars(buckets) {
  const h = 200;
  const pad = { top: 10, bottom: 24, left: 42, right: 10 };
  const pw = W - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;
  const maxVolume = Math.max(1, ...buckets.map((b) => b.total));
  const slot = pw / buckets.length;

  const bars = buckets
    .map((b, i) => {
      const barH = b.winRate * ph;
      const x = pad.left + i * slot + slot * 0.18;
      const w = slot * 0.64;
      const fill = b.winRate >= 0.5 ? "var(--win)" : "var(--loss)";
      const opacity = 0.35 + 0.65 * (b.total / maxVolume);

      return `<rect x="${x}" y="${pad.top + ph - barH}" width="${w}" height="${barH}" rx="2" fill="${fill}" opacity="${opacity.toFixed(2)}"><title>${esc(b.label)} UTC — ${b.total} signals, ${pct(b.winRate)}</title></rect>` +
        (i % 2 === 0
          ? `<text x="${x + w / 2}" y="${h - 7}" text-anchor="middle" class="tick">${esc(b.label)}</text>`
          : "");
    })
    .join("");

  const ticks = [0, 0.5, 1]
    .map((v) => {
      const y = pad.top + ph - v * ph;
      return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + pw}" y2="${y}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${pad.left - 8}" y="${y + 3.5}" text-anchor="end" class="tick">${Math.round(v * 100)}%</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${h}" class="chart" role="img" aria-label="Win rate by hour of day">${ticks}${bars}</svg>`;
}

function frequencyBars(points) {
  const h = 200;
  const pad = { top: 10, bottom: 24, left: 42, right: 10 };
  const pw = W - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => p.count));
  const slot = pw / points.length;

  const bars = points
    .map((p, i) => {
      const barH = (p.count / max) * ph;
      return `<rect x="${pad.left + i * slot + slot * 0.15}" y="${pad.top + ph - barH}" width="${Math.max(1, slot * 0.7)}" height="${barH}" rx="1" fill="var(--accent-dim)"><title>${esc(p.date)} — ${p.count} signals</title></rect>`;
    })
    .join("");

  const scaleX = (i) => pad.left + i * slot + slot / 2;
  const labels = sparseLabels(points, scaleX)
    .map((l) => `<text x="${l.x}" y="${h - 7}" text-anchor="middle" class="tick">${esc(l.label)}</text>`)
    .join("");

  const ticks = [0, 0.5, 1]
    .map((v) => {
      const y = pad.top + ph - v * ph;
      return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + pw}" y2="${y}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${pad.left - 8}" y="${y + 3.5}" text-anchor="end" class="tick">${Math.round(v * max)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${h}" class="chart" role="img" aria-label="Signals per day">${ticks}${bars}${labels}</svg>`;
}

/** Stacked daily sentiment counts. */
function sentimentChart(series) {
  const h = 220;
  const pad = { top: 10, bottom: 24, left: 42, right: 10 };
  const pw = W - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;
  const max = Math.max(1, ...series.map((p) => p.bullish + p.bearish + p.neutral));
  const slot = pw / series.length;

  const bars = series
    .map((p, i) => {
      const x = pad.left + i * slot + slot * 0.15;
      const w = Math.max(1, slot * 0.7);
      const unit = ph / max;

      const hb = p.bullish * unit;
      const hn = p.neutral * unit;
      const hr = p.bearish * unit;

      let y = pad.top + ph;
      const seg = [];

      y -= hb;
      seg.push(`<rect x="${x}" y="${y}" width="${w}" height="${hb}" fill="var(--win)"/>`);
      y -= hn;
      seg.push(`<rect x="${x}" y="${y}" width="${w}" height="${hn}" fill="var(--draw)" opacity="0.55"/>`);
      y -= hr;
      seg.push(`<rect x="${x}" y="${y}" width="${w}" height="${hr}" fill="var(--loss)"/>`);

      return `<g><title>${esc(p.date)} — ${p.bullish} bullish, ${p.bearish} bearish, ${p.neutral} neutral</title>${seg.join("")}</g>`;
    })
    .join("");

  const scaleX = (i) => pad.left + i * slot + slot / 2;
  const labels = sparseLabels(series, scaleX)
    .map((l) => `<text x="${l.x}" y="${h - 7}" text-anchor="middle" class="tick">${esc(l.label)}</text>`)
    .join("");

  const ticks = [0, 0.5, 1]
    .map((v) => {
      const y = pad.top + ph - v * ph;
      return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + pw}" y2="${y}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${pad.left - 8}" y="${y + 3.5}" text-anchor="end" class="tick">${Math.round(v * max)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${h}" class="chart" role="img" aria-label="Daily message counts by sentiment">${ticks}${bars}${labels}</svg>`;
}

/** Weekday × hour grid. Monday-first: the trading week reads Mon→Sun. */
function heatGrid(cells) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const max = Math.max(1, ...cells.map((c) => c.count));
  const lookup = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));

  const header =
    `<div class="heat-row"><span class="heat-day"></span>` +
    Array.from({ length: 24 }, (_, h) =>
      `<span class="heat-hour">${h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>`,
    ).join("") +
    `</div>`;

  const rows = order
    .map((wd) => {
      const cellsHtml = Array.from({ length: 24 }, (_, hour) => {
        const cell = lookup.get(`${wd}-${hour}`);
        const count = cell?.count ?? 0;
        const rate = cell?.winRate ?? 0;

        if (count === 0) {
          return `<span class="heat-cell" title="${days[wd]} ${String(hour).padStart(2, "0")}:00 — no signals"></span>`;
        }

        const intensity = Math.round((0.2 + 0.8 * (count / max)) * 100);
        const color = rate >= 0.5 ? "var(--win)" : "var(--loss)";

        return `<span class="heat-cell" style="background:color-mix(in oklab, ${color} ${intensity}%, transparent)" title="${days[wd]} ${String(hour).padStart(2, "0")}:00 — ${count} signals, ${pct(rate)}"></span>`;
      }).join("");

      return `<div class="heat-row"><span class="heat-day">${days[wd]}</span>${cellsHtml}</div>`;
    })
    .join("");

  return `<div class="heat">${header}${rows}</div>`;
}

// --- page fragments ---------------------------------------------------------

const tile = (label, value, hint, tone = "") =>
  `<div class="tile"><span class="eyebrow">${esc(label)}</span><span class="tile-v ${tone}">${esc(value)}</span><span class="tile-h">${esc(hint)}</span></div>`;

const rankList = (buckets, tone) =>
  buckets
    .map(
      (b) => `
    <li>
      <div class="rank-top"><span>${esc(b.label)}</span><b class="${b.winRate >= 0.5 ? "good" : "bad"}">${pct(b.winRate)}</b></div>
      <div class="meter"><i class="${tone}" style="width:${(b.winRate * 100).toFixed(1)}%"></i></div>
      <div class="rank-bot"><span>${b.settled} settled</span><span class="${b.netPnl >= 0 ? "good" : "bad"}">${money(b.netPnl)}</span></div>
    </li>`,
    )
    .join("");

const SEVERITY = { good: "good", warning: "warn", critical: "bad", info: "info" };

const findings = insights.insights
  .filter((i) => i.kind !== "recommendation")
  .map(
    (i) => `
    <li class="finding sev-${SEVERITY[i.severity]}">
      <div class="finding-head">
        <span class="pill ${SEVERITY[i.severity]}">${esc(i.kind)}</span>
        <h3>${esc(i.title)}</h3>
      </div>
      <p>${esc(i.detail)}</p>
      <div class="conf"><span class="eyebrow">Confidence</span><div class="meter sm"><i style="width:${(i.confidence * 100).toFixed(0)}%"></i></div><span class="conf-n">${Math.round(i.confidence * 100)}%</span></div>
    </li>`,
  )
  .join("");

const recommendations = insights.insights
  .filter((i) => i.kind === "recommendation")
  .map((i) => `<li>${esc(i.detail)}</li>`)
  .join("");

const tally = (rows, max) =>
  rows
    .slice(0, 8)
    .map(
      (r) => `
    <li>
      <div class="rank-top"><span>${esc(r.name)}</span><b class="muted">${r.count}</b></div>
      <div class="meter"><i style="width:${((r.count / max) * 100).toFixed(1)}%"></i></div>
    </li>`,
    )
    .join("");

const riskLevel = insights.riskAssessment.level;

// --- document ---------------------------------------------------------------

const html = `<title>Pocket Signal Lab — static snapshot</title>
<style>
  /*
   * Palette lifted verbatim from the application's own tokens so this snapshot
   * matches the running product rather than reinterpreting it.
   *
   * Deliberately single-theme: the real app commits to dark, because it is a
   * monitoring surface built around luminous marks on a dark ground.
   */
  :root {
    --abyss: #070b14;
    --void: #0a0f1c;
    --panel: #111827;
    --panel-2: #161f31;
    --line: #1f2a3d;
    --line-soft: #18212f;
    --ink: #e8edf6;
    --ink-dim: #9aa8c0;
    --ink-faint: #64748b;
    --accent: #2dd4a7;
    --accent-dim: #1e9e8a;
    --win: #2dd4a7;
    --loss: #f0556b;
    --draw: #7c8db5;
    --pending: #e0a33e;
    color-scheme: dark;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--abyss);
    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
  }

  .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 20px 64px; }

  /* Banner — this must be impossible to miss, since the page looks like the app. */
  .notice {
    display: flex; gap: 12px; align-items: flex-start;
    border: 1px solid color-mix(in oklab, var(--pending) 32%, transparent);
    background: color-mix(in oklab, var(--pending) 8%, transparent);
    border-radius: 12px; padding: 14px 16px; margin-bottom: 26px;
  }
  .notice svg { flex: none; margin-top: 2px; }
  .notice h2 { margin: 0 0 4px; font-size: 13px; color: var(--pending); }
  .notice p { margin: 0; font-size: 12.5px; color: var(--ink-dim); }
  .notice code { background: var(--void); padding: 1px 5px; border-radius: 4px; font-size: 11.5px; }

  header.masthead { display: flex; align-items: center; gap: 11px; margin-bottom: 22px; }
  .mark {
    width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
    background: color-mix(in oklab, var(--accent) 15%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 30%, transparent);
  }
  .masthead h1 { margin: 0; font-size: 17px; letter-spacing: -0.01em; }
  .masthead p { margin: 1px 0 0; font-size: 12.5px; color: var(--ink-faint); }

  .eyebrow {
    font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--ink-faint);
  }

  .tiles {
    display: grid; gap: 12px; margin-bottom: 20px;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
  .tile {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 13px 15px; display: flex; flex-direction: column; gap: 2px;
  }
  .tile-v { font-size: 25px; font-weight: 600; letter-spacing: -0.02em; }
  .tile-h { font-size: 11.5px; color: var(--ink-faint); }

  .good { color: var(--win); }
  .bad { color: var(--loss); }
  .warn { color: var(--pending); }
  .info { color: var(--ink-dim); }
  .muted { color: var(--ink-faint); }

  .grid { display: grid; gap: 20px; margin-bottom: 20px; }
  @media (min-width: 900px) { .grid.two { grid-template-columns: 1fr 1fr; } }

  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .panel > header { padding: 14px 18px; border-bottom: 1px solid var(--line-soft); }
  .panel h2 { margin: 0; font-size: 13.5px; font-weight: 600; }
  .panel header p { margin: 2px 0 0; font-size: 11.5px; color: var(--ink-faint); }
  .panel .body { padding: 16px 12px 12px; }

  /* Charts scroll inside their own container so the page never scrolls sideways. */
  .scroll { overflow-x: auto; }
  .chart { display: block; width: 100%; min-width: 460px; height: auto; }
  .tick { fill: var(--ink-faint); font-size: 10.5px; }
  .cat { fill: var(--ink-dim); font-size: 11px; }
  .val { fill: var(--ink); font-size: 10.5px; font-weight: 600; }

  ul.ranks { list-style: none; margin: 0; padding: 4px 18px 16px; display: grid; gap: 13px; }
  .rank-top { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; margin-bottom: 5px; }
  .rank-top b { font-weight: 600; }
  .rank-bot { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-faint); margin-top: 5px; }
  .meter { height: 6px; border-radius: 99px; background: var(--line-soft); overflow: hidden; }
  .meter.sm { height: 4px; width: 78px; }
  .meter i { display: block; height: 100%; border-radius: 99px; background: var(--accent-dim); }
  .meter i.bad { background: var(--loss); }
  .meter i.good { background: var(--win); }

  ul.findings { list-style: none; margin: 0; padding: 0; }
  .finding { padding: 15px 18px; border-bottom: 1px solid var(--line-soft); border-left: 2px solid var(--line); }
  .finding:last-child { border-bottom: 0; }
  /* The rail encodes severity, so scanning surfaces the critical items. */
  .finding.sev-good { border-left-color: var(--win); }
  .finding.sev-warn { border-left-color: var(--pending); }
  .finding.sev-bad { border-left-color: var(--loss); }
  .finding-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 5px; }
  .finding h3 { margin: 0; font-size: 13px; font-weight: 500; }
  .finding p { margin: 0 0 9px; font-size: 12px; color: var(--ink-dim); }
  .conf { display: flex; align-items: center; gap: 8px; }
  .conf-n { font-size: 10.5px; color: var(--ink-faint); }

  .pill {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    padding: 2px 7px; border-radius: 5px;
    background: color-mix(in oklab, currentColor 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, currentColor 26%, transparent);
  }

  .prose { padding: 15px 18px; font-size: 13px; color: var(--ink-dim); margin: 0; }
  ul.plain { list-style: none; margin: 0; padding: 6px 18px 16px; display: grid; gap: 10px; font-size: 12px; color: var(--ink-dim); }
  ul.plain li { display: flex; gap: 9px; }
  ul.plain li::before { content: ""; flex: none; width: 4px; height: 4px; border-radius: 99px; background: var(--accent); margin-top: 8px; }

  .heat { padding: 4px 18px 18px; min-width: 620px; }
  .heat-row { display: flex; align-items: center; gap: 3px; margin-bottom: 3px; }
  .heat-day { width: 30px; flex: none; font-size: 10px; color: var(--ink-faint); }
  .heat-hour { flex: 1; text-align: center; font-size: 9px; color: var(--ink-faint); }
  .heat-cell { flex: 1; height: 19px; border-radius: 3px; border: 1px solid var(--line-soft); }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 6px 18px 18px; font-size: 10.5px; color: var(--ink-faint); align-items: center; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }

  .risk-head { display: flex; align-items: baseline; gap: 9px; padding: 15px 18px 10px; }
  .risk-head b { font-size: 23px; font-weight: 600; }
  .risk-head span { font-size: 11.5px; color: var(--ink-faint); }
  .risk-meter { padding: 0 18px; }

  footer { margin-top: 34px; border-top: 1px solid var(--line); padding-top: 18px; font-size: 11.5px; color: var(--ink-faint); }
  footer p { margin: 0 0 9px; }
  footer a { color: var(--accent); }

  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">

  <div class="notice">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#e0a33e" stroke-width="2">
      <circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5" stroke-linecap="round"/><circle cx="12" cy="16.5" r="0.9" fill="#e0a33e" stroke="none"/>
    </svg>
    <div>
      <h2>Static snapshot — this is not the running application</h2>
      <p>
        The real app is a Next.js server backed by PostgreSQL, so it cannot be published as a static page.
        Every number and chart below is the genuine computed output of a seeded run, frozen into one HTML file.
        Sign-in, filtering, importing and CSV/Excel/PDF export are all live features of the app and are
        <strong>not</strong> interactive here. To run the real thing:
        <code>npm install &amp;&amp; npm run db:migrate &amp;&amp; npm run samples &amp;&amp; npm run db:seed &amp;&amp; npm run dev</code>
      </p>
    </div>
  </div>

  <header class="masthead">
    <span class="mark">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2dd4a7" stroke-width="2.2">
        <path d="M3 16.5 8.5 11l3.5 3.5L21 6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <div>
      <h1>Pocket Signal Lab</h1>
      <p>${stats.total.toLocaleString()} signals across 92 days · ${chat.totals.all.toLocaleString()} chat messages · seeded sample dataset</p>
    </div>
  </header>

  <div class="tiles">
    ${tile("Win rate", pct(stats.winRate), `${stats.wins}W / ${stats.losses}L, draws excluded`, stats.winRate >= 0.5 ? "good" : "bad")}
    ${tile("Accuracy", pct(stats.accuracy), `over ${stats.settled} settled`)}
    ${tile("Net P/L", money(stats.netPnl), `avg ${money(stats.avgPnl)} per signal`, stats.netPnl >= 0 ? "good" : "bad")}
    ${tile("Profit factor", stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2), stats.profitFactor >= 1 ? "gains exceed losses" : "losses exceed gains", stats.profitFactor >= 1 ? "good" : "bad")}
    ${tile("Best run", String(stats.bestStreak), "consecutive wins", "good")}
    ${tile("Worst run", String(stats.worstStreak), "consecutive losses", "warn")}
  </div>

  <div class="grid two">
    <section class="panel">
      <header><h2>Cumulative profit &amp; loss</h2><p>Running total across the period</p></header>
      <div class="body scroll">${equityChart(overview.series)}</div>
    </section>

    <section class="panel">
      <header><h2>Win rate &amp; accuracy</h2><p>Daily, against the 50% break-even line</p></header>
      <div class="body scroll">${winRateChart(overview.series)}</div>
    </section>
  </div>

  <section class="panel" style="margin-bottom:20px">
    <header><h2>Performance by asset</h2><p>Faded bars have fewer than 8 settled signals</p></header>
    <div class="body scroll">${bucketBars(overview.assets)}</div>
  </section>

  <div class="grid two">
    <section class="panel">
      <header><h2>Strongest assets</h2><p>Minimum 8 settled signals${overview.assetRanking.excluded > 0 ? ` · ${overview.assetRanking.excluded} excluded for thin samples` : ""}</p></header>
      <ul class="ranks">${rankList(overview.assetRanking.best, "good")}</ul>
    </section>

    <section class="panel">
      <header><h2>Weakest assets</h2><p>Same threshold, worst first</p></header>
      <ul class="ranks">${rankList(overview.assetRanking.worst, "bad")}</ul>
    </section>
  </div>

  <div class="grid two">
    <section class="panel">
      <header><h2>Performance by hour</h2><p>Bar opacity shows signal volume (UTC)</p></header>
      <div class="body scroll">${hourlyBars(overview.hourly)}</div>
    </section>

    <section class="panel">
      <header><h2>Signal frequency</h2><p>Signals per day</p></header>
      <div class="body scroll">${frequencyBars(overview.frequency)}</div>
    </section>
  </div>

  <section class="panel" style="margin-bottom:20px">
    <header><h2>Weekly heat map</h2><p>Win rate by weekday and hour — green above 50%, red below</p></header>
    <div class="scroll">${heatGrid(heatmap.cells)}</div>
    <div class="legend">
      <span><i class="swatch" style="background:var(--win)"></i>above 50%</span>
      <span><i class="swatch" style="background:var(--loss)"></i>below 50%</span>
      <span>Opacity shows signal volume. Hours are UTC.</span>
    </div>
  </section>

  <section class="panel" style="margin-bottom:20px">
    <header><h2>Performance by provider</h2><p>Where the signals came from</p></header>
    <div class="body scroll">${bucketBars(overview.providers, 22)}</div>
  </section>

  <div class="grid two">
    <section class="panel">
      <header><h2>Chat sentiment over time</h2><p>Daily message counts by tone, promotional messages excluded</p></header>
      <div class="body scroll">${sentimentChart(chat.series)}</div>
      <div class="legend">
        <span><i class="swatch" style="background:var(--win)"></i>bullish ${chat.totals.bullish}</span>
        <span><i class="swatch" style="background:var(--draw)"></i>neutral ${chat.totals.neutral}</span>
        <span><i class="swatch" style="background:var(--loss)"></i>bearish ${chat.totals.bearish}</span>
        <span>${chat.totals.spam} flagged promotional · ${chat.totals.duplicates} duplicates</span>
      </div>
    </section>

    <section class="panel">
      <header><h2>Most-discussed assets</h2><p>Detected from message text, not from the signal log</p></header>
      <ul class="ranks">${tally(chat.topAssets, chat.topAssets[0]?.count ?? 1)}</ul>
    </section>
  </div>

  <section class="panel" style="margin-bottom:20px">
    <header><h2>Summary</h2><p>Written by the built-in analyser — engine: ${esc(insights.engine)}</p></header>
    <p class="prose">${esc(insights.summary)}</p>
  </section>

  <div class="grid two">
    <section class="panel">
      <header><h2>Findings</h2><p>Each describes something that already happened in the data</p></header>
      <ul class="findings">${findings}</ul>
    </section>

    <div class="grid">
      <section class="panel">
        <header><h2>Risk assessment</h2><p>What makes this data harder to trust</p></header>
        <div class="risk-head">
          <b class="${riskLevel === "low" ? "good" : riskLevel === "high" ? "bad" : "warn"}">${riskLevel[0].toUpperCase()}${riskLevel.slice(1)}</b>
          <span>${insights.riskAssessment.score}/100</span>
        </div>
        <div class="risk-meter"><div class="meter"><i class="${insights.riskAssessment.score >= 45 ? "bad" : ""}" style="width:${insights.riskAssessment.score}%"></i></div></div>
        <ul class="plain">${insights.riskAssessment.factors.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </section>

      <section class="panel">
        <header><h2>Suggested next steps</h2><p>About the data, not about trades</p></header>
        <ul class="plain">${recommendations}</ul>
      </section>
    </div>
  </div>

  <footer>
    <p>
      <strong>Not financial advice.</strong> Everything above describes a synthetic sample dataset generated
      for testing. It is not a recommendation to trade, not a forecast, and the patterns shown have no
      obligation to continue. Binary options carry a substantial risk of losing your capital.
    </p>
    <p>
      The application analyses only data the user imports. It does not connect to Pocket Option, hold broker
      credentials, or scrape any platform.
    </p>
    <p>Source on branch <code>claude/new-session-ttyhqn</code>. Generated ${new Date().toISOString().slice(0, 10)}.</p>
  </footer>
</div>`;

writeFileSync(outPath, html, "utf8");

console.log(`${outPath} — ${(html.length / 1024).toFixed(0)} KB`);
