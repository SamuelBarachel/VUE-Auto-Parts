const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Master-Inventory-%26-Location";

window.VUEInventoryTools = {
  getRows: () => inventoryState.rows,
  displayPrice,
  availabilityLabel,
};

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
  basket: new Map(),
};

const columns = [
  "Vehicle Model",
  "Part Name",
  "Specification",
  "Price",
  "Availability",
  "Hold",
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
const basketEmpty = document.querySelector("#basketEmpty");
const basketItems = document.querySelector("#basketItems");
const basketTotal = document.querySelector("#basketTotal");
const holdWhatsApp = document.querySelector("#holdWhatsApp");

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

function rowKey(row) {
  return row["Part ID"] || `${row["Vehicle Model"]}-${row["Part Name"]}-${row["Specification"]}`;
}

function isAvailable(row) {
  const stock = Number.parseInt(row["Stock on Hand"], 10);
  return !Number.isNaN(stock) && stock > 0;
}

function priceAmount(row) {
  const price = displayPrice(row);
  const match = price.match(/[\d,.]+/);
  if (!match) return 0;
  return Number.parseFloat(match[0].replace(/,/g, "")) || 0;
}

function money(value) {
  return `$${value.toFixed(2)}`;
}

function basketRows() {
  return [...inventoryState.basket.values()];
}

function buildHoldMessage(items, total) {
  const lines = [
    "Hello VUE Auto Parts, I would like to place these parts on a 2-hour hold:",
    "",
    ...items.map(({ row, quantity }) => {
      const unit = priceAmount(row);
      const lineTotal = unit * quantity;
      return `${row["Vehicle Model"]} - ${row["Part Name"]} (${row["Specification"] || "standard"}): ${quantity} x ${money(unit)} = ${money(lineTotal)}`;
    }),
    "",
    `Total purchase price: ${money(total)}`,
    "Please hold these for me for 2 hours.",
  ];

  return lines.join("\n");
}

function renderBasket() {
  const items = basketRows();
  basketItems.innerHTML = "";
  basketEmpty.hidden = items.length !== 0;
  basketTotal.hidden = items.length === 0;
  holdWhatsApp.classList.toggle("disabled", items.length === 0);
  holdWhatsApp.setAttribute("aria-disabled", String(items.length === 0));

  let total = 0;

  items.forEach(({ row, quantity }) => {
    const unit = priceAmount(row);
    const lineTotal = unit * quantity;
    total += lineTotal;

    const article = document.createElement("article");
    article.className = "basket-item";
    article.innerHTML = `
      <div>
        <strong>${row["Vehicle Model"]} ${row["Part Name"]}</strong>
        <span>${row["Specification"] || "Standard"} | ${money(unit)} each</span>
      </div>
      <label>
        <span>Amount</span>
        <input type="number" min="1" value="${quantity}" data-basket-qty="${rowKey(row)}">
      </label>
      <strong>${money(lineTotal)}</strong>
      <button type="button" data-remove-basket="${rowKey(row)}">Remove</button>
    `;
    basketItems.append(article);
  });

  basketTotal.querySelector("strong").textContent = money(total);

  if (items.length) {
    const message = encodeURIComponent(buildHoldMessage(items, total));
    holdWhatsApp.href = `https://wa.me/16038662272?text=${message}`;
  } else {
    holdWhatsApp.href = "#";
  }
}

function addToBasket(row) {
  if (!isAvailable(row)) return;
  const key = rowKey(row);
  const existing = inventoryState.basket.get(key);
  inventoryState.basket.set(key, {
    row,
    quantity: existing ? existing.quantity + 1 : 1,
  });
  renderBasket();
}

function attachHoldButton(button, row) {
  let activated = false;
  const activate = () => {
    if (activated) return;
    activated = true;
    addToBasket(row);
    window.setTimeout(() => {
      activated = false;
    }, 350);
  };

  button.addEventListener("pointerup", activate);
  button.addEventListener("click", activate);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
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
      } else if (column === "Hold") {
        const button = document.createElement("button");
        button.className = "hold-button";
        button.type = "button";
        button.textContent = isAvailable(row) ? "Add to hold" : "Ask first";
        button.disabled = !isAvailable(row);
        button.dataset.holdPart = rowKey(row);
        attachHoldButton(button, row);
        td.append(button);
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
  window.dispatchEvent(new CustomEvent("vue-inventory-ready"));
}

searchInput.addEventListener("input", applyFilters);
modelFilter.addEventListener("change", applyFilters);
basketItems.addEventListener("input", (event) => {
  const input = event.target.closest("[data-basket-qty]");
  if (!input) return;
  const item = inventoryState.basket.get(input.dataset.basketQty);
  if (!item) return;
  item.quantity = Math.max(1, Number.parseInt(input.value, 10) || 1);
  inventoryState.basket.set(input.dataset.basketQty, item);
  renderBasket();
});

basketItems.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-basket]");
  if (!button) return;
  inventoryState.basket.delete(button.dataset.removeBasket);
  renderBasket();
});

holdWhatsApp.addEventListener("click", (event) => {
  if (!basketRows().length) {
    event.preventDefault();
  }
});

loadInventory();
