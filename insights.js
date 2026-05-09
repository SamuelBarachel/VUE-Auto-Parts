"use strict";

const fsSync = require("node:fs");
const path   = require("node:path");

const SHEET_ID       = "1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho";
const STATE_PATH     = path.join(__dirname, "insights-state.json");
const ANALYTICS_MODEL = "llama-3.3-70b-versatile";
const EMAIL_TO       = "info@vueautoparts.com";
const ZWE_UTC_OFFSET = 2;   // Zimbabwe is UTC+2 (no DST)
const DAILY_HOUR_UTC = 5;   // 7 AM Zimbabwe = 5 AM UTC

// ── CSV / Sheet helpers ──────────────────────────────────────────────────────

function parseCsv(csvText) {
  const rows = [];
  let current = "", row = [], inQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i], n = csvText[i + 1];
    if (c === '"' && n === '"')              { current += '"'; i++; }
    else if (c === '"')                      { inQuotes = !inQuotes; }
    else if (c === "," && !inQuotes)         { row.push(current); current = ""; }
    else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && n === "\n") i++;
      row.push(current);
      if (row.some(v => v.trim())) rows.push(row);
      row = []; current = "";
    } else { current += c; }
  }
  row.push(current);
  if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

function sheetToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = (row[i] || "").trim(); });
    return obj;
  }).filter(obj => Object.values(obj).some(v => v));
}

async function fetchSheet(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const res  = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet fetch failed (${tab}): ${res.status}`);
  return sheetToObjects(parseCsv(await res.text()));
}

async function fetchAllData() {
  const [sales, inventory] = await Promise.all([
    fetchSheet("Sales"),
    fetchSheet("Inventory"),
  ]);
  return { sales, inventory };
}

// ── Metric computation ───────────────────────────────────────────────────────

function parsePrice(str) {
  return parseFloat((str || "").replace(/[$,]/g, "")) || 0;
}

function zweNow() {
  return new Date(Date.now() + ZWE_UTC_OFFSET * 3600000);
}

function dateStr(d) {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function computeMetrics(sales, inventory, targetMonthKey) {
  const invMap = {};
  inventory.forEach(item => { if (item["Part ID"]) invMap[item["Part ID"]] = item; });

  // Filter sales to target month if provided (for monthly report)
  const filteredSales = targetMonthKey
    ? sales.filter(s => {
        const d = new Date(s["Date"]);
        if (isNaN(d)) return false;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return key === targetMonthKey;
      })
    : sales;

  const byPart = {}, byDate = {};

  filteredSales.forEach(row => {
    const partId = row["Part ID"];
    const count  = parseFloat(row["Count"])       || 0;
    const value  = parseFloat(row["Total Value"])  || 0;
    const date   = row["Date"] || "";
    if (!partId) return;

    if (!byPart[partId]) byPart[partId] = { units: 0, revenue: 0, txns: 0, dates: [] };
    byPart[partId].units   += count;
    byPart[partId].revenue += value;
    byPart[partId].txns++;
    byPart[partId].dates.push(date);

    if (!byDate[date]) byDate[date] = { revenue: 0, units: 0, txns: 0 };
    byDate[date].revenue += value;
    byDate[date].units   += count;
    byDate[date].txns++;
  });

  const uniqueDates     = Object.keys(byDate).filter(Boolean).sort();
  const totalDays       = uniqueDates.length || 1;
  const totalRevenue    = Object.values(byDate).reduce((s, d) => s + d.revenue, 0);
  const avgDailyRevenue = totalRevenue / totalDays;

  const now      = zweNow();
  const todayKey = dateStr(now);
  const todayData = byDate[todayKey] || { revenue: 0, units: 0, txns: 0 };

  let bestDay = null, bestDayRevenue = 0;
  Object.entries(byDate).forEach(([d, data]) => {
    if (data.revenue > bestDayRevenue) { bestDayRevenue = data.revenue; bestDay = d; }
  });

  // Sales velocity: avg units/day over days this item appeared
  const velocity = {};
  Object.entries(byPart).forEach(([id, d]) => {
    const activeDays = [...new Set(d.dates)].length || 1;
    velocity[id] = +(d.units / activeDays).toFixed(2);
  });

  // Full stock analysis
  const stockAnalysis = inventory.map(item => {
    const id    = item["Part ID"];
    const stock = parseFloat(item["Count"]) || 0;
    const price = parsePrice(item["Unit Price"]);
    const vel   = velocity[id] || 0;
    const daysLeft = vel > 0 ? +(stock / vel).toFixed(1) : null;
    const sd    = byPart[id];
    const stockValue = parsePrice(item["Total Value"]) || stock * price;
    return {
      id, name: item["Part Name"], model: item["Vehicle Model"] || "Universal",
      spec: item["Specification"] || "", cls: item["Class"] || "General",
      location: item["Location"] || "", stock, price, stockValue,
      velocity: vel, daysLeft,
      totalUnitsSold: sd?.units   || 0,
      totalRevenue:   sd?.revenue || 0,
      txns: sd?.txns || 0,
      isCritical:   daysLeft !== null && daysLeft < 3,
      isLow:        daysLeft !== null && daysLeft >= 3 && daysLeft < 7,
      isDead:       !sd && stock > 0,
      isOverstocked: daysLeft !== null && daysLeft > 60,
    };
  });

  const totalInventoryValue = inventory.reduce((s, i) => s + parsePrice(i["Total Value"]), 0);
  const deadStockValue      = stockAnalysis.filter(s => s.isDead).reduce((a, s) => a + s.stockValue, 0);
  const overstockedValue    = stockAnalysis.filter(s => s.isOverstocked).reduce((a, s) => a + s.stockValue, 0);

  const topSellers = Object.entries(byPart).map(([id, d]) => ({
    id, name: invMap[id]?.["Part Name"] || id,
    model: invMap[id]?.["Vehicle Model"] || "Universal",
    cls: invMap[id]?.["Class"] || "",
    currentStock: parseFloat(invMap[id]?.["Count"]) || 0,
    price: parsePrice(invMap[id]?.["Unit Price"]),
    ...d,
  })).sort((a, b) => b.revenue - a.revenue).slice(0, 7);

  const byClass = {};
  Object.entries(byPart).forEach(([id, d]) => {
    const cls = invMap[id]?.["Class"] || "Unknown";
    if (!byClass[cls]) byClass[cls] = { revenue: 0, units: 0 };
    byClass[cls].revenue += d.revenue;
    byClass[cls].units   += d.units;
  });

  // Week-over-week: last 7 days vs previous 7 days
  const sorted = uniqueDates.slice().sort();
  const last7  = sorted.slice(-7);
  const prev7  = sorted.slice(-14, -7);
  const rev7   = last7.reduce((s, d) => s + (byDate[d]?.revenue || 0), 0);
  const revP7  = prev7.reduce((s, d) => s + (byDate[d]?.revenue || 0), 0);
  const wow    = revP7 > 0 ? +((( rev7 - revP7) / revP7) * 100).toFixed(1) : null;

  return {
    totalRevenue: +totalRevenue.toFixed(2),
    avgDailyRevenue: +avgDailyRevenue.toFixed(2),
    totalDays,
    uniqueDates,
    totalInventoryValue: +totalInventoryValue.toFixed(2),
    deadStockValue: +deadStockValue.toFixed(2),
    overstockedValue: +overstockedValue.toFixed(2),
    todayKey, todayData,
    bestDay, bestDayRevenue: +bestDayRevenue.toFixed(2),
    topSellers,
    byClass,
    byDate,
    critical:    stockAnalysis.filter(s => s.isCritical),
    low:         stockAnalysis.filter(s => s.isLow),
    dead:        stockAnalysis.filter(s => s.isDead),
    overstocked: stockAnalysis.filter(s => s.isOverstocked),
    stockAnalysis, invMap, byPart, velocity,
    wow, rev7: +rev7.toFixed(2), revP7: +revP7.toFixed(2),
  };
}

// ── AI calls ─────────────────────────────────────────────────────────────────

async function callGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ANALYTICS_MODEL,
      temperature: 0.25,
      max_tokens: 1600,
      messages,
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Groq ${res.status}: ${t}`); }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

function buildDailyPrompt(m) {
  const stockTable = m.stockAnalysis.map(s =>
    `${s.name} (${s.id}): stock=${s.stock}, sold=${s.totalUnitsSold} units, velocity=${s.velocity}/day, days_left=${s.daysLeft ?? "∞"}, stock_value=$${s.stockValue.toFixed(2)}, status=${s.isCritical ? "CRITICAL" : s.isLow ? "LOW" : s.isDead ? "DEAD_STOCK" : s.isOverstocked ? "OVERSTOCKED" : "OK"}`
  ).join("\n");

  const topTable = m.topSellers.map((s, i) =>
    `${i+1}. ${s.name} (${s.model}): $${s.revenue.toFixed(2)} revenue, ${s.units} units, ${s.txns} transactions, current_stock=${s.currentStock}`
  ).join("\n");

  const catTable = Object.entries(m.byClass).map(([c, d]) =>
    `${c}: $${d.revenue.toFixed(2)} revenue, ${d.units} units`
  ).join("\n");

  return `You are the CFO of VUE Auto Parts, Chipinge, Zimbabwe. Be brutal, specific, and brief. No waffle.

DATA (${m.todayKey}):
Revenue today: $${m.todayData.revenue.toFixed(2)} (${m.todayData.txns} txns) | Daily avg: $${m.avgDailyRevenue.toFixed(2)} | WoW: ${m.wow !== null ? (m.wow >= 0 ? "+" : "") + m.wow + "%" : "N/A"}
Inventory value: $${m.totalInventoryValue.toFixed(2)} | Dead stock: $${m.deadStockValue.toFixed(2)} | Overstock: $${m.overstockedValue.toFixed(2)}
Critical (<3 days): ${m.critical.length ? m.critical.map(s => `${s.name} (${s.daysLeft}d)`).join(", ") : "None"}
Low (3–7 days): ${m.low.length ? m.low.map(s => `${s.name} (${s.daysLeft}d)`).join(", ") : "None"}
Dead stock: ${m.dead.length ? m.dead.map(s => `${s.name} $${s.stockValue.toFixed(2)}`).join(", ") : "None"}
Top sellers: ${topTable || "No data"}
By category: ${catTable || "No data"}
Full stock: ${stockTable}

Return a JSON object ONLY — no markdown, no backticks:
{
  "headline": "One brutal sentence on business health right now — use real numbers",
  "status": "ON TRACK" or "WATCH OUT" or "NEEDS ATTENTION",
  "actions": [
    "Verb-first, specific, doable today — include a name or number where possible",
    "Action 2",
    "Action 3",
    "Action 4",
    "Action 5"
  ],
  "insights": [
    {"icon": "🔥", "title": "Short title", "body": "One sentence. Specific number. Direct verdict."},
    {"icon": "📦", "title": "Short title", "body": "One sentence. Specific number. Direct verdict."},
    {"icon": "💰", "title": "Short title", "body": "One sentence. Specific number. Direct verdict."},
    {"icon": "⚡", "title": "Short title", "body": "One sentence. Specific number. Direct verdict."}
  ],
  "bold_move": "One bold, unconventional move for this week — specific and financially grounded."
}`;
}

function buildMonthlyPrompt(m, monthLabel) {
  const topTable = m.topSellers.map((s, i) =>
    `${i+1}. ${s.name} (${s.model}): $${s.revenue.toFixed(2)} revenue, ${s.units} units sold, ${s.txns} transactions, avg price per unit: $${s.txns > 0 ? (s.revenue/s.units).toFixed(2) : s.price}`
  ).join("\n");

  const catTable = Object.entries(m.byClass).map(([c, d]) =>
    `${c}: $${d.revenue.toFixed(2)} revenue, ${d.units} units (${m.totalRevenue > 0 ? ((d.revenue/m.totalRevenue)*100).toFixed(1) : 0}% of total)`
  ).join("\n");

  const deadList = m.dead.map(s =>
    `• ${s.name} (${s.model}): ${s.stock} units, $${s.stockValue.toFixed(2)} tied up`
  ).join("\n");

  const dayRevs = Object.entries(m.byDate).sort(([a],[b]) => a.localeCompare(b)).map(([d, v]) =>
    `${d}: $${v.revenue.toFixed(2)} (${v.txns} txns)`
  ).join(", ");

  return `You are the CFO and strategic business advisor for VUE Auto Parts in Chipinge, Zimbabwe. You are delivering the monthly board-level business review. You think with world-class financial rigour, understand Zimbabwe's economic realities (USD cash economy, import dependency, rural market dynamics), and give advice that is specific, bold, and actionable.

MONTH IN REVIEW: ${monthLabel}

FINANCIAL PERFORMANCE:
- Total revenue: $${m.totalRevenue.toFixed(2)}
- Trading days: ${m.totalDays}
- Average daily revenue: $${m.avgDailyRevenue.toFixed(2)}
- Best single day: ${m.bestDay || "N/A"} — $${m.bestDayRevenue.toFixed(2)}
- Day-by-day: ${dayRevs || "No data"}

INVENTORY HEALTH (end of month):
- Total inventory value on hand: $${m.totalInventoryValue.toFixed(2)}
- Dead stock (never sold this month): $${m.deadStockValue.toFixed(2)} (${m.dead.length} items)
- Overstocked (>60 days of supply): $${m.overstockedValue.toFixed(2)}

REVENUE BY PRODUCT CATEGORY:
${catTable || "No data"}

TOP SELLING ITEMS:
${topTable || "No data"}

DEAD STOCK DETAIL:
${deadList || "None — excellent!"}

CURRENT STOCK HEALTH:
- Critical (< 3 days): ${m.critical.length} items — ${m.critical.map(s => s.name).join(", ") || "None"}
- Low (3–7 days): ${m.low.length} items — ${m.low.map(s => s.name).join(", ") || "None"}

ABOUT THE BUSINESS:
- Located in Chipinge, Manicaland, Zimbabwe
- Serves Honda Fit, Toyota Corolla, Toyota Wish, Toyota Probox, Nissan Caravan owners
- USD cash economy, customers are price-sensitive but quality-conscious
- Main contact: WhatsApp +16038662272

Produce the monthly strategic report. Return a JSON object ONLY — no markdown, no backticks:
{
  "headline": "One powerful sentence summing up this month",
  "grade": "A / B / C / D / F — overall performance grade with one-line reason",
  "financial_summary": "3-4 sentences: revenue context, margin awareness, cash position signals, what the numbers really mean",
  "wins": ["Specific win #1 with numbers", "Win #2", "Win #3"],
  "failures": ["What didn't work #1 with reason", "#2", "#3"],
  "cost_cuts": [
    {"action": "Specific cost cut or cash-saving move", "estimated_impact": "$X or X%"},
    ... (4 to 6 items)
  ],
  "demand_forecast": "2-3 sentences: what will likely sell next month and why, based on trends and seasonality",
  "pricing_advice": "2-3 sentences on pricing strategy — which items have pricing power, where you are leaving money on the table",
  "bold_strategy": "One bold, specific strategic recommendation for next month that could meaningfully change the trajectory of the business",
  "targets": ["Measurable target #1 for next month", "Target #2", "Target #3"]
}`;
}

// ── Email HTML builders ───────────────────────────────────────────────────────

function statusColor(status) {
  if (status === "ON TRACK")        return "#16a34a";
  if (status === "WATCH OUT")       return "#d97706";
  return "#dc2626";
}

function statusBg(status) {
  if (status === "ON TRACK")  return "#f0fdf4";
  if (status === "WATCH OUT") return "#fffbeb";
  return "#fef2f2";
}

function buildDailyEmailHtml(m, ai) {
  const now       = zweNow();
  const dayName   = now.toLocaleDateString("en-ZW", { weekday: "long" });
  const dateFull  = now.toLocaleDateString("en-ZW", { day: "numeric", month: "long", year: "numeric" });
  const sc        = statusColor(ai.status);
  const sbg       = statusBg(ai.status);
  const wowLabel  = m.wow !== null ? `${m.wow >= 0 ? "+" : ""}${m.wow}% WoW` : "";
  const wowColor  = m.wow !== null ? (m.wow >= 0 ? "#16a34a" : "#dc2626") : "#888";

  // ── Action items (hero section) ──
  const actionItems = (ai.actions || []).map((a, i) => `
    <tr>
      <td style="width:32px;padding:11px 0 11px 20px;vertical-align:top">
        <div style="width:26px;height:26px;background:#0f4f36;color:#fff;border-radius:50%;font-size:12px;font-weight:800;text-align:center;line-height:26px;flex-shrink:0">${i + 1}</div>
      </td>
      <td style="padding:11px 20px 11px 10px;font-size:14px;color:#111;line-height:1.5;font-weight:${i === 0 ? "700" : "400"};border-bottom:1px solid #f0f0f0">${a}</td>
    </tr>`).join("");

  // ── Critical alerts ──
  const hasAlerts = m.critical.length > 0 || m.low.length > 0;
  const critRows  = m.critical.map(s => `
    <tr>
      <td style="padding:9px 14px;border-bottom:1px solid #fecaca;font-size:13px;font-weight:700;color:#991b1b">${s.name}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #fecaca;font-size:13px;color:#dc2626;text-align:center;white-space:nowrap">${s.stock} left</td>
      <td style="padding:9px 14px;border-bottom:1px solid #fecaca;font-size:13px;font-weight:800;color:#fff;background:#dc2626;text-align:center;white-space:nowrap;border-radius:4px">${s.daysLeft}d — ORDER</td>
    </tr>`).join("");

  // ── Insights ──
  const insightCards = (ai.insights || []).map(ins => `
    <tr>
      <td style="padding:12px 20px;border-bottom:1px solid #f3f4f6;vertical-align:top">
        <span style="font-size:16px;margin-right:8px">${ins.icon || "📌"}</span>
        <span style="font-size:13px;font-weight:800;color:#0f4f36">${ins.title || ""}</span>
        <div style="font-size:13px;color:#444;line-height:1.55;margin-top:3px;padding-left:24px">${ins.body || ""}</div>
      </td>
    </tr>`).join("");

  // ── Top sellers (compact) ──
  const topRows = m.topSellers.slice(0, 5).map((s, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"}">
      <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#111;max-width:160px">${s.name}</td>
      <td style="padding:8px 14px;font-size:12px;color:#555">${s.model}</td>
      <td style="padding:8px 14px;font-size:12px;font-weight:800;color:#0f4f36;text-align:right">$${s.revenue.toFixed(2)}</td>
      <td style="padding:8px 14px;font-size:12px;text-align:right;color:${s.currentStock <= 3 ? "#dc2626" : s.currentStock <= 7 ? "#d97706" : "#555"};font-weight:${s.currentStock <= 7 ? "700" : "400"}">${s.currentStock} left</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eeeee8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:600px;margin:20px auto;border-radius:10px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.12)">

  <!-- Header -->
  <div style="background:linear-gradient(160deg,#0a3526 0%,#0f4f36 55%,#1a6b4a 100%);padding:24px 28px 20px">
    <div style="font-size:10px;font-weight:800;letter-spacing:2.5px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:10px">VUE AUTO PARTS &nbsp;·&nbsp; CHIPINGE, ZIMBABWE</div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div style="font-size:20px;font-weight:800;color:#fff;line-height:1.2">${dayName}'s Report</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:3px">${dateFull}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="display:inline-block;background:${sc};color:#fff;font-size:11px;font-weight:800;letter-spacing:1px;padding:5px 13px;border-radius:999px;text-transform:uppercase">${ai.status || "READY"}</div>
        ${wowLabel ? `<div style="font-size:11px;font-weight:700;color:${wowColor};margin-top:5px">${wowLabel}</div>` : ""}
      </div>
    </div>
    ${ai.headline ? `<div style="margin-top:14px;padding:10px 14px;background:rgba(255,255,255,0.08);border-radius:6px;font-size:13px;color:rgba(255,255,255,0.85);line-height:1.5;font-style:italic">"${ai.headline}"</div>` : ""}
  </div>

  <!-- Numbers strip -->
  <div style="background:#fff;border-bottom:2px solid #f0f0f0">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="padding:16px 0;text-align:center;border-right:1px solid #f0f0f0">
          <div style="font-size:22px;font-weight:800;color:#0f4f36">$${m.todayData.revenue.toFixed(2)}</div>
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Today</div>
        </td>
        <td style="padding:16px 0;text-align:center;border-right:1px solid #f0f0f0">
          <div style="font-size:22px;font-weight:800;color:#374151">$${m.avgDailyRevenue.toFixed(2)}</div>
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Daily Avg</div>
        </td>
        <td style="padding:16px 0;text-align:center;border-right:1px solid #f0f0f0">
          <div style="font-size:22px;font-weight:800;color:#374151">$${m.totalInventoryValue.toFixed(0)}</div>
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Stock Value</div>
        </td>
        <td style="padding:16px 0;text-align:center">
          <div style="font-size:22px;font-weight:800;color:${m.critical.length > 0 ? "#dc2626" : "#16a34a"}">${m.critical.length}</div>
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Alerts</div>
        </td>
      </tr>
    </table>
  </div>

  <!-- ⚡ ACTIONS — FIRST -->
  <div style="background:#0f4f36;padding:20px 0 8px">
    <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:rgba(255,255,255,0.5);text-transform:uppercase;padding:0 20px;margin-bottom:10px">⚡ Do This Today</div>
    <table style="width:100%;border-collapse:collapse;background:#fff">
      ${actionItems || '<tr><td style="padding:14px 20px;font-size:13px;color:#888">No actions generated</td></tr>'}
    </table>
  </div>

  <!-- 🚨 Stock alerts (only shown if any) -->
  ${hasAlerts ? `<div style="background:#fff;padding:18px 20px 20px;border-top:3px solid #dc2626">
    <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#dc2626;text-transform:uppercase;margin-bottom:10px">🚨 Stock Alerts</div>
    ${m.critical.length ? `<table style="width:100%;border-collapse:collapse;border:1px solid #fecaca;border-radius:6px;overflow:hidden;margin-bottom:10px">
      <thead><tr style="background:#fef2f2">
        <th style="padding:7px 14px;text-align:left;font-size:11px;color:#991b1b;font-weight:700">Part</th>
        <th style="padding:7px 14px;text-align:center;font-size:11px;color:#991b1b;font-weight:700">Stock</th>
        <th style="padding:7px 14px;text-align:center;font-size:11px;color:#991b1b;font-weight:700">Status</th>
      </tr></thead>
      <tbody>${critRows}</tbody>
    </table>` : ""}
    ${m.low.length ? `<div style="padding:9px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:5px;font-size:12px;color:#92400e;line-height:1.5">
      <strong>⚠ Running Low:</strong> ${m.low.map(s => `${s.name} (${s.daysLeft}d left)`).join(" &nbsp;·&nbsp; ")}
    </div>` : ""}
  </div>` : ""}

  <!-- 🧠 Insights -->
  ${insightCards ? `<div style="background:#fff;border-top:1px solid #f0f0f0;padding-top:4px;padding-bottom:4px">
    <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#6b7280;text-transform:uppercase;padding:14px 20px 6px">🧠 Advisor Notes</div>
    <table style="width:100%;border-collapse:collapse">${insightCards}</table>
  </div>` : ""}

  <!-- 📊 Top sellers -->
  ${topRows ? `<div style="background:#fff;border-top:1px solid #f0f0f0">
    <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#6b7280;text-transform:uppercase;padding:16px 20px 8px">📊 Top Sellers</div>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #f3f4f6">
      <thead><tr style="background:#f9fafb">
        <th style="padding:7px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:700">Part</th>
        <th style="padding:7px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:700">Vehicle</th>
        <th style="padding:7px 14px;text-align:right;font-size:11px;color:#6b7280;font-weight:700">Revenue</th>
        <th style="padding:7px 14px;text-align:right;font-size:11px;color:#6b7280;font-weight:700">In Stock</th>
      </tr></thead>
      <tbody>${topRows}</tbody>
    </table>
  </div>` : ""}

  <!-- 💡 Bold move -->
  ${ai.bold_move ? `<div style="background:linear-gradient(135deg,#0a3526,#0f4f36);padding:18px 22px">
    <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:7px">💡 Bold Move This Week</div>
    <div style="font-size:13px;color:#e2ffe8;line-height:1.6;font-weight:500">${ai.bold_move}</div>
  </div>` : ""}

  <!-- Footer -->
  <div style="background:#111;padding:14px 22px;text-align:center">
    <div style="font-size:11px;color:#555">VUE Auto Parts &nbsp;·&nbsp; Chipinge, ZWE &nbsp;·&nbsp; <a href="https://vueautoparts.com" style="color:#c9a84c;text-decoration:none">vueautoparts.com</a></div>
    <div style="font-size:10px;color:#3a3a3a;margin-top:3px">Auto-generated daily at 7:00 AM &nbsp;·&nbsp; Powered by AI</div>
  </div>

</div>
</body></html>`;
}

function buildMonthlyEmailHtml(m, ai, monthLabel) {
  const gradeColor = g => {
    if (g && g.startsWith("A")) return "#16a34a";
    if (g && g.startsWith("B")) return "#2563eb";
    if (g && g.startsWith("C")) return "#d97706";
    return "#dc2626";
  };
  const gc = gradeColor(ai.grade);

  const winsHtml = (ai.wins || []).map(w => `
    <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f0fdf4">
      <div style="color:#16a34a;font-size:16px;flex-shrink:0">✅</div>
      <div style="font-size:13px;color:#333;line-height:1.5">${w}</div>
    </div>`).join("");

  const failsHtml = (ai.failures || []).map(f => `
    <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #fef2f2">
      <div style="color:#dc2626;font-size:16px;flex-shrink:0">❌</div>
      <div style="font-size:13px;color:#333;line-height:1.5">${f}</div>
    </div>`).join("");

  const costCutsHtml = (ai.cost_cuts || []).map(c => `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;color:#166534">${c.action || c}</div>
      ${c.estimated_impact ? `<div style="font-size:12px;color:#16a34a;margin-top:3px">Potential impact: ${c.estimated_impact}</div>` : ""}
    </div>`).join("");

  const targetsHtml = (ai.targets || []).map((t, i) => `
    <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f0f0f0">
      <div style="min-width:28px;height:28px;background:#c9a84c;color:#fff;border-radius:50%;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
      <div style="font-size:13px;color:#333;line-height:1.5;padding-top:5px">${t}</div>
    </div>`).join("");

  const catRows = Object.entries(m.byClass).sort((a,b) => b[1].revenue - a[1].revenue).map(([c, d]) => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#333;font-weight:700">${c}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:800;color:#0f4f36;text-align:right">$${d.revenue.toFixed(2)}</td>
      <td style="padding:8px 12px;font-size:13px;color:#555;text-align:right">${d.units} units</td>
      <td style="padding:8px 12px;font-size:13px;text-align:right">
        <div style="background:#e5e7eb;border-radius:999px;height:8px;overflow:hidden;min-width:60px">
          <div style="background:#0f4f36;height:100%;width:${m.totalRevenue > 0 ? Math.round((d.revenue/m.totalRevenue)*100) : 0}%"></div>
        </div>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:640px;margin:24px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.12)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f2d1f 0%,#0f4f36 60%,#1a6b4a 100%);padding:32px">
    <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:rgba(255,255,255,0.5);text-transform:uppercase;margin-bottom:8px">VUE AUTO PARTS · MONTHLY INTELLIGENCE BRIEF</div>
    <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:4px">${monthLabel} — Month in Review</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.65);margin-bottom:16px">"${ai.headline || "Monthly performance summary"}"</div>
    <div style="display:inline-block;background:${gc};color:#fff;font-size:18px;font-weight:800;padding:8px 20px;border-radius:8px">${ai.grade || "—"}</div>
  </div>

  <!-- Financial Summary -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #f0f0f0">
    <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#0f4f36;text-transform:uppercase;margin-bottom:16px">📈 Financial Performance</div>
    <div style="display:flex;gap:0;margin-bottom:16px">
      <div style="flex:1;text-align:center;border-right:1px solid #f0f0f0;padding-right:12px">
        <div style="font-size:28px;font-weight:800;color:#0f4f36">$${m.totalRevenue.toFixed(2)}</div>
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:3px">Total Revenue</div>
      </div>
      <div style="flex:1;text-align:center;border-right:1px solid #f0f0f0;padding:0 12px">
        <div style="font-size:28px;font-weight:800;color:#0f4f36">$${m.avgDailyRevenue.toFixed(2)}</div>
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:3px">Daily Average</div>
      </div>
      <div style="flex:1;text-align:center;padding-left:12px">
        <div style="font-size:28px;font-weight:800;color:#0f4f36">$${m.bestDayRevenue.toFixed(2)}</div>
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:3px">Best Day</div>
      </div>
    </div>
    <div style="background:#f9fafb;border-radius:8px;padding:14px 16px;font-size:14px;color:#333;line-height:1.7">${ai.financial_summary || ""}</div>
  </div>

  <!-- Revenue by Category -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #f0f0f0">
    <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#0f4f36;text-transform:uppercase;margin-bottom:12px">📦 Revenue by Category</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#f0fdf4">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#166534;font-weight:700">Category</th>
        <th style="padding:8px 12px;text-align:right;font-size:12px;color:#166534;font-weight:700">Revenue</th>
        <th style="padding:8px 12px;text-align:right;font-size:12px;color:#166534;font-weight:700">Units</th>
        <th style="padding:8px 12px;text-align:right;font-size:12px;color:#166534;font-weight:700">Share</th>
      </tr></thead>
      <tbody>${catRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#888;font-size:13px">No data</td></tr>'}</tbody>
    </table>
  </div>

  <!-- Wins & Failures (side by side) -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #f0f0f0">
    <div style="display:flex;gap:20px">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#16a34a;text-transform:uppercase;margin-bottom:12px">✅ What Worked</div>
        ${winsHtml || '<div style="font-size:13px;color:#888">No data</div>'}
      </div>
      <div style="width:1px;background:#f0f0f0"></div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#dc2626;text-transform:uppercase;margin-bottom:12px">❌ What Didn't Work</div>
        ${failsHtml || '<div style="font-size:13px;color:#888">No data</div>'}
      </div>
    </div>
  </div>

  <!-- Cost Cuts -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #f0f0f0">
    <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#0f4f36;text-transform:uppercase;margin-bottom:14px">✂️ Cost-Cutting Opportunities</div>
    ${costCutsHtml || '<div style="font-size:13px;color:#888">No recommendations available</div>'}
  </div>

  <!-- Pricing Advice -->
  ${ai.pricing_advice ? `<div style="background:#fffbeb;padding:24px 32px;border-bottom:1px solid #fde68a;border-left:4px solid #c9a84c">
    <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#92400e;text-transform:uppercase;margin-bottom:10px">💰 Pricing Intelligence</div>
    <div style="font-size:14px;color:#333;line-height:1.7">${ai.pricing_advice}</div>
  </div>` : ""}

  <!-- Demand Forecast -->
  ${ai.demand_forecast ? `<div style="background:#eff6ff;padding:24px 32px;border-bottom:1px solid #bfdbfe">
    <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#1e40af;text-transform:uppercase;margin-bottom:10px">🔮 Demand Forecast — Next Month</div>
    <div style="font-size:14px;color:#333;line-height:1.7">${ai.demand_forecast}</div>
  </div>` : ""}

  <!-- Bold Strategy -->
  ${ai.bold_strategy ? `<div style="background:linear-gradient(135deg,#0f4f36,#1a6b4a);padding:24px 32px;border-bottom:1px solid #f0f0f0">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;color:rgba(255,255,255,0.55);text-transform:uppercase;margin-bottom:10px">🚀 Bold Strategic Move</div>
    <div style="font-size:15px;color:#fff;line-height:1.7;font-weight:500">${ai.bold_strategy}</div>
  </div>` : ""}

  <!-- Next Month Targets -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #f0f0f0">
    <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#c9a84c;text-transform:uppercase;margin-bottom:12px">🎯 Targets for Next Month</div>
    ${targetsHtml || '<div style="font-size:13px;color:#888">No targets set</div>'}
  </div>

  <!-- Footer -->
  <div style="background:#1a1a1a;padding:18px 32px;text-align:center">
    <div style="font-size:12px;color:#888">VUE Auto Parts · Chipinge, Zimbabwe · <a href="https://vueautoparts.com" style="color:#c9a84c;text-decoration:none">vueautoparts.com</a></div>
    <div style="font-size:11px;color:#555;margin-top:4px">Monthly intelligence brief — sent on the 1st of every month at 7:00 AM. Powered by AI.</div>
  </div>

</div>
</body></html>`;
}

// ── Email sending ─────────────────────────────────────────────────────────────

async function sendEmail(subject, html, textFallback) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "VUE Auto Parts Intelligence <onboarding@resend.dev>",
      to: [EMAIL_TO],
      subject,
      html,
      text: textFallback || subject,
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Resend ${res.status}: ${t}`); }
  return await res.json();
}

// ── Orchestration ─────────────────────────────────────────────────────────────

async function runDailyInsights() {
  console.log("[insights] Running daily report…");
  const { sales, inventory } = await fetchAllData();
  const m   = computeMetrics(sales, inventory, null);
  const raw = await callGroq([
    { role: "system", content: "You are a world-class CFO and business advisor. You always return valid JSON only, no markdown, no code blocks." },
    { role: "user",   content: buildDailyPrompt(m) },
  ]);

  let ai = {};
  try {
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) ai = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    console.error("[insights] Failed to parse AI daily response:", e.message, raw.slice(0, 200));
    ai = { headline: "Report generated — see data below.", status: "REPORT READY", insights: [], actions: [], bold_move: "" };
  }

  const now   = zweNow();
  const label = now.toLocaleDateString("en-ZW", { weekday: "long", month: "long", day: "numeric" });
  const html  = buildDailyEmailHtml(m, ai);
  await sendEmail(`📊 Daily Report — ${label} | ${ai.status || "VUE Auto Parts"}`, html, `Daily business report for ${label}`);
  console.log("[insights] Daily report sent ✓");
  return { ok: true, type: "daily", status: ai.status };
}

async function runMonthlyInsights() {
  console.log("[insights] Running monthly report…");
  const { sales, inventory } = await fetchAllData();

  // Previous month
  const now   = zweNow();
  const prevM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthKey   = `${prevM.getUTCFullYear()}-${String(prevM.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = prevM.toLocaleDateString("en-ZW", { month: "long", year: "numeric" });

  const m   = computeMetrics(sales, inventory, monthKey);
  const raw = await callGroq([
    { role: "system", content: "You are a world-class CFO and strategic business advisor. You always return valid JSON only, no markdown, no code blocks." },
    { role: "user",   content: buildMonthlyPrompt(m, monthLabel) },
  ]);

  let ai = {};
  try {
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) ai = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    console.error("[insights] Failed to parse AI monthly response:", e.message);
    ai = { headline: "Monthly review ready.", grade: "—", financial_summary: "", wins: [], failures: [], cost_cuts: [], demand_forecast: "", pricing_advice: "", bold_strategy: "", targets: [] };
  }

  const html = buildMonthlyEmailHtml(m, ai, monthLabel);
  await sendEmail(`📅 Monthly Intelligence Brief — ${monthLabel} | VUE Auto Parts`, html, `Monthly report for ${monthLabel}`);
  console.log("[insights] Monthly report sent ✓");
  return { ok: true, type: "monthly", month: monthLabel };
}

// ── State management ──────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fsSync.existsSync(STATE_PATH)) return JSON.parse(fsSync.readFileSync(STATE_PATH, "utf8"));
  } catch {}
  return { lastDailySent: null, lastMonthlySent: null };
}

function saveState(state) {
  fsSync.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startScheduler() {
  console.log("[insights] Scheduler started — daily at 7 AM ZWE, monthly on the 1st.");

  setInterval(async () => {
    const now   = new Date(); // UTC
    const utcH  = now.getUTCHours();
    const utcM  = now.getUTCMinutes();
    if (utcH !== DAILY_HOUR_UTC || utcM !== 0) return;

    const zwe   = zweNow();
    const todayKey  = zwe.toISOString().slice(0, 10);
    const monthKey  = todayKey.slice(0, 7);
    const isFirst   = zwe.getUTCDate() === 1;
    const state     = loadState();

    // Monthly report on the 1st
    if (isFirst && state.lastMonthlySent !== monthKey) {
      try {
        await runMonthlyInsights();
        state.lastMonthlySent = monthKey;
        saveState(state);
      } catch (err) {
        console.error("[insights] Monthly report failed:", err.message);
      }
    }

    // Daily report
    if (state.lastDailySent !== todayKey) {
      try {
        await runDailyInsights();
        state.lastDailySent = todayKey;
        saveState(state);
      } catch (err) {
        console.error("[insights] Daily report failed:", err.message);
      }
    }
  }, 60 * 1000);
}

module.exports = { startScheduler, runDailyInsights, runMonthlyInsights };
