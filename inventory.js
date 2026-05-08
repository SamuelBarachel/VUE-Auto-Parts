const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Inventory";
const SALES_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Sales";

const POPULAR_CACHE_KEY = "vue_popular_v3";
const SIX_HOURS = 6 * 60 * 60 * 1000;

window.VUEInventoryTools = {
  getRows: () => inventoryState.rows,
};

const FALLBACK_INVENTORY = [
  { "Vehicle Model": "Honda Fit",      "Part Name": "Oil Filter", "Count": "20" },
  { "Vehicle Model": "Toyota Corolla", "Part Name": "Oil Filter", "Count": "6"  },
  { "Vehicle Model": "Universal",      "Part Name": "Engine Oil", "Count": "13" },
];

const inventoryState = { rows: [], filteredRows: [] };

const displayColumns = ["Vehicle Model", "Part Name", "Availability"];

const searchInput = document.querySelector("#inventorySearch");
const modelFilter  = document.querySelector("#modelFilter");
const tableBody    = document.querySelector("#inventoryBody");
const statusEl     = document.querySelector("#inventoryStatus");
const emptyEl      = document.querySelector("#inventoryEmpty");
const popularEl    = document.querySelector("#popularParts");
const tableWrap    = document.querySelector(".inventory-table-wrap");

/* ── CSV parsing ─────────────────────────────────────────── */

function parseCsv(csvText) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const next = csvText[i + 1];
    if (char === '"' && next === '"') { current += '"'; i++; }
    else if (char === '"') { inQuotes = !inQuotes; }
    else if (char === "," && !inQuotes) { row.push(current); current = ""; }
    else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(current);
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = []; current = "";
    } else { current += char; }
  }
  row.push(current);
  if (row.some(v => v.trim() !== "")) rows.push(row);
  return rows;
}

// Returns objects with ALL columns (Part ID included — for internal use only)
function csvToObjects(csvText) {
  const parsed = parseCsv(csvText);
  if (!parsed.length) return [];
  const headers = parsed[0].map(h => h.trim());
  return parsed.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = (row[i] || "").trim(); });
    return obj;
  });
}

// Strip private fields before public storage
function stripPrivate(row) {
  const { "Part ID": _, Location: __, ...safe } = row;
  return safe;
}

/* ── Availability ────────────────────────────────────────── */

function isAvailable(row) {
  const n = Number.parseInt(row["Count"], 10);
  return !Number.isNaN(n) && n > 0;
}

function availabilityLabel(row) {
  return isAvailable(row) ? "Available" : "Unavailable";
}

function stockClass(row) {
  return isAvailable(row) ? "stock-good" : "stock-out";
}

/* ── Model filter dropdown ───────────────────────────────── */

function renderModelOptions(rows) {
  const models = [...new Set(rows.map(r => r["Vehicle Model"]).filter(Boolean))].sort();
  modelFilter.innerHTML = '<option value="">All models</option>';
  models.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    modelFilter.append(opt);
  });
}

/* ── Search results table ────────────────────────────────── */

function renderRows(rows) {
  tableBody.innerHTML = "";
  rows.forEach(row => {
    const tr = document.createElement("tr");
    displayColumns.forEach(col => {
      const td = document.createElement("td");
      td.dataset.label = col;
      if (col === "Availability") {
        td.textContent = availabilityLabel(row);
        td.className = stockClass(row);
      } else {
        td.textContent = row[col] || "-";
      }
      tr.append(td);
    });
    tableBody.append(tr);
  });
  emptyEl.hidden = rows.length !== 0;
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedModel = modelFilter.value;
  const hasFilter = query.length > 0 || selectedModel.length > 0;

  popularEl.hidden = hasFilter;
  tableWrap.hidden = !hasFilter;

  if (!hasFilter) {
    statusEl.textContent = "";
    emptyEl.hidden = true;
    return;
  }

  inventoryState.filteredRows = inventoryState.rows.filter(row => {
    const matchesModel = !selectedModel || row["Vehicle Model"] === selectedModel;
    const searchable = [row["Vehicle Model"], row["Part Name"]].join(" ").toLowerCase();
    return matchesModel && (!query || searchable.includes(query));
  });

  renderRows(inventoryState.filteredRows);
  const label = inventoryState.filteredRows.length === 1 ? "part" : "parts";
  statusEl.textContent = `${inventoryState.filteredRows.length} ${label} found.`;
}

/* ── Popular parts (Sales tab, 6h cache) ─────────────────── */

// rawRows still contain Part ID for the internal join
async function getPopularFromSales(rawRows) {
  try {
    const cached = JSON.parse(localStorage.getItem(POPULAR_CACHE_KEY) || "null");
    if (
      cached &&
      Date.now() - cached.ts < SIX_HOURS &&
      Array.isArray(cached.data) &&
      cached.data.length > 0 &&
      cached.data[0]["Part Name"]
    ) return cached.data;
  } catch (_) {}

  const resp = await fetch(SALES_URL, { cache: "no-store" });
  if (!resp.ok) return [];
  const salesRows = csvToObjects(await resp.text());

  // Sum Count per Part ID across all Sales rows
  const salesCountById = {};
  salesRows.forEach(r => {
    const id = r["Part ID"];
    const n  = Number.parseInt(r["Count"], 10) || 0;
    if (id) salesCountById[id] = (salesCountById[id] || 0) + n;
  });

  // For each model, find the single most popular part (by sales count)
  const modelBest = {}; // model -> { partName, count }
  rawRows.forEach(r => {
    const id    = r["Part ID"];
    const model = r["Vehicle Model"];
    const part  = r["Part Name"];
    if (!id || !model || !part) return;
    const count = salesCountById[id] || 0;
    if (!modelBest[model] || count > modelBest[model].count) {
      modelBest[model] = { part, count };
    }
  });

  // Rank models by their best part's sales count, keep top 3
  const joined = Object.entries(modelBest)
    .filter(([, v]) => v.count > 0)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 3)
    .map(([model, v]) => ({
      "Vehicle Model": model,
      "Part Name":     v.part,
      salesCount:      v.count,
    }));

  try {
    localStorage.setItem(POPULAR_CACHE_KEY, JSON.stringify({ data: joined, ts: Date.now() }));
  } catch (_) {}
  return joined;
}

function renderPopular(parts) {
  if (!popularEl) return;
  if (!parts.length) {
    popularEl.innerHTML = '<p class="popular-empty">Ask us on WhatsApp for this week\'s popular parts.</p>';
    return;
  }
  const items = parts.map(p => {
    const inv = inventoryState.rows.find(
      r => r["Vehicle Model"] === p["Vehicle Model"] && r["Part Name"] === p["Part Name"]
    );
    const avail = inv ? availabilityLabel(inv) : null;
    const cls   = inv ? stockClass(inv) : "";
    return `<li class="popular-item">
      <div class="popular-model">${p["Vehicle Model"]}</div>
      <div class="popular-part">${p["Part Name"]}</div>
      ${avail ? `<span class="popular-avail ${cls}">${avail}</span>` : ""}
    </li>`;
  }).join("");
  popularEl.innerHTML = `<p class="eyebrow popular-eyebrow">Most bought this week — by model</p><ul class="popular-list">${items}</ul>`;
}

/* ── Boot ────────────────────────────────────────────────── */

async function loadInventory() {
  let rawRows = [];
  try {
    const resp = await fetch(INVENTORY_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    rawRows = csvToObjects(await resp.text()).filter(
      r => r["Vehicle Model"] || r["Part Name"]
    );
    if (!rawRows.length) throw new Error("Empty");
    // Strip Part ID + Location before public storage
    inventoryState.rows = rawRows.map(stripPrivate);
    statusEl.textContent = "";
  } catch (_) {
    inventoryState.rows = FALLBACK_INVENTORY;
    rawRows = FALLBACK_INVENTORY;
  }

  renderModelOptions(inventoryState.rows);
  applyFilters();

  try {
    renderPopular(await getPopularFromSales(rawRows));
  } catch (_) {
    renderPopular([]);
  }

  window.dispatchEvent(new CustomEvent("vue-inventory-ready"));
}

searchInput.addEventListener("input", applyFilters);
modelFilter.addEventListener("change", applyFilters);

loadInventory();
