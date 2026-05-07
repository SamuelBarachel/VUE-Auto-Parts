const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Master-Inventory-%26-Location";

const FALLBACK_INVENTORY = [
  {
    "Part ID": "HON-OIL-001",
    "Vehicle Model": "Honda Fit",
    "Part Name": "Oil Filter",
    Specification: "GD1/GE6",
    "Unit Price (USD Base)": "$15.00",
    "Calculated Price (ZiG)": "ZiG202.50",
    "Calculated Price (ZAR)": "ZAR288.00",
    "Stock on Hand": "4",
  },
];

const inventoryState = {
  rows: [],
  filteredRows: [],
};

const columns = [
  "Vehicle Model",
  "Part Name",
  "Specification",
  "Price",
  "Availability",
];

const sourceColumns = [
  "Part ID",
  "Vehicle Model",
  "Part Name",
  "Specification",
  "Location",
  "Unit Price (USD Base)",
  "Calculated Price (ZiG)",
  "Calculated Price (ZAR)",
  "Stock on Hand",
];

const searchInput = document.querySelector("#inventorySearch");
const modelFilter = document.querySelector("#modelFilter");
const tableBody = document.querySelector("#inventoryBody");
const statusEl = document.querySelector("#inventoryStatus");
const emptyEl = document.querySelector("#inventoryEmpty");

function parseCsv(csvText) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function csvToInventory(csvText) {
  const parsedRows = parseCsv(csvText);
  const headers = parsedRows[0] || [];
  const validHeaderIndexes = headers
    .map((header, index) => ({ header: header.trim(), index }))
    .filter(({ header }) => header !== "");

  return parsedRows
    .slice(1)
    .map((row) => {
      const item = {};
      validHeaderIndexes.forEach(({ header, index }) => {
        item[header] = (row[index] || "").trim();
      });
      return item;
    })
    .filter((item) => columns.some((column) => item[column]));
}

function renderModelOptions(rows) {
  const models = [...new Set(rows.map((row) => row["Vehicle Model"]).filter(Boolean))].sort();
  modelFilter.innerHTML = '<option value="">All models</option>';
  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelFilter.append(option);
  });
}

function stockClass(stockValue) {
  const stock = Number.parseInt(stockValue, 10);
  if (Number.isNaN(stock)) return "";
  if (stock <= 0) return "stock-out";
  return "stock-good";
}

function availabilityLabel(stockValue) {
  const stock = Number.parseInt(stockValue, 10);
  if (Number.isNaN(stock)) return "Ask in store";
  return stock > 0 ? "Available" : "Ask in store";
}

function displayPrice(row) {
  return (
    row["Unit Price (USD Base)"] ||
    row["Calculated Price (ZiG)"] ||
    row["Calculated Price (ZAR)"] ||
    "Ask for price"
  );
}

function renderRows(rows) {
  tableBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      td.dataset.label = column;
      if (column === "Price") {
        td.textContent = displayPrice(row);
        td.className = "price-cell";
      } else if (column === "Availability") {
        td.textContent = availabilityLabel(row["Stock on Hand"]);
        td.className = stockClass(row["Stock on Hand"]);
      } else {
        td.textContent = row[column] || "-";
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

  inventoryState.filteredRows = inventoryState.rows.filter((row) => {
    const matchesModel = !selectedModel || row["Vehicle Model"] === selectedModel;
    const searchable = sourceColumns.map((column) => row[column] || "").join(" ").toLowerCase();
    return matchesModel && (!query || searchable.includes(query));
  });

  renderRows(inventoryState.filteredRows);
  const label = inventoryState.filteredRows.length === 1 ? "part" : "parts";
  statusEl.textContent = `${inventoryState.filteredRows.length} matching ${label} shown.`;
}

async function loadInventory() {
  try {
    const response = await fetch(INVENTORY_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Inventory request failed with ${response.status}`);
    }

    const csvText = await response.text();
    const rows = csvToInventory(csvText);
    if (!rows.length) {
      throw new Error("Inventory feed is empty");
    }

    inventoryState.rows = rows;
    statusEl.textContent = "Live inventory loaded.";
  } catch (error) {
    inventoryState.rows = FALLBACK_INVENTORY;
    statusEl.textContent =
      "Showing saved inventory preview. Live shop inventory will appear here when available.";
  }

  renderModelOptions(inventoryState.rows);
  applyFilters();
}

searchInput.addEventListener("input", applyFilters);
modelFilter.addEventListener("change", applyFilters);
loadInventory();
