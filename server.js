const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Master-Inventory-%26-Location";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

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
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function csvToInventory(csvText) {
  const parsedRows = parseCsv(csvText);
  const headers = parsedRows[0] || [];

  return parsedRows
    .slice(1)
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        if (header.trim()) item[header.trim()] = (row[index] || "").trim();
      });
      return item;
    })
    .filter((item) => item["Vehicle Model"] || item["Part Name"]);
}

function publicInventoryRow(row) {
  const stock = Number.parseInt(row["Stock on Hand"], 10);
  return {
    model: row["Vehicle Model"] || "",
    part: row["Part Name"] || "",
    specification: row.Specification || "",
    price: row["Unit Price (USD Base)"] || "Ask for price",
    availability: !Number.isNaN(stock) && stock > 0 ? "Available" : "Ask in store",
  };
}

function fallbackAnswer(question, inventory) {
  const lowered = question.toLowerCase();
  const words = lowered.split(/\s+/).filter((word) => word.length > 2);
  const match = inventory.find((item) => {
    const text = `${item.model} ${item.part} ${item.specification} ${item.price}`.toLowerCase();
    return words.some((word) => text.includes(word));
  });

  if (match) {
    return `${match.model} ${match.part}: ${match.price}. ${match.availability}.`;
  }

  if (lowered.includes("location") || lowered.includes("address")) return "Chipinge, Manicaland.";
  if (lowered.includes("contact") || lowered.includes("email")) return "Email info@vueautoparts.com.";
  return "Please use Parts Finder or WhatsApp us.";
}

async function getInventory() {
  const response = await fetch(INVENTORY_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Inventory fetch failed: ${response.status}`);
  return csvToInventory(await response.text()).map(publicInventoryRow);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function handleAsk(request, response) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || process.env.GROG_MODEL || "llama-3.1-8b-instant";

  const body = JSON.parse(await readRequestBody(request) || "{}");
  const question = String(body.question || "").trim().slice(0, 500);

  if (!question) return sendJson(response, 400, { answer: "Ask a short parts question." });

  const inventory = await getInventory();

  if (!apiKey) {
    return sendJson(response, 200, {
      answer: fallbackAnswer(question, inventory),
    });
  }

  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 70,
      messages: [
        {
          role: "system",
          content:
            "You are VUE Auto Parts AI. Answer in one very short, precise sentence. Use only the provided inventory and shop facts. Do not reveal stock quantities. Say Available or Ask in store only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            shopFacts: {
              business: "VUE Auto Parts",
              location: "Chipinge, Manicaland",
              email: "info@vueautoparts.com",
              whatsapp: "+16038662272",
              focusModels: ["Honda Fit", "Toyota Corolla", "Toyota Wish", "Toyota Probox"],
            },
            inventory,
            question,
          }),
        },
      ],
    }),
  });

  if (!groqResponse.ok) {
    return sendJson(response, 200, { answer: fallbackAnswer(question, inventory) });
  }

  const data = await groqResponse.json();
  const answer = data.choices?.[0]?.message?.content?.trim() || "Please use Parts Finder.";
  return sendJson(response, 200, { answer });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const safePath = path
    .normalize(decodeURIComponent(url.pathname))
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(file);
  } catch (error) {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/ask") {
      return await handleAsk(request, response);
    }
    return await serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 500, { answer: "AI is unavailable. Try Parts Finder." });
  }
});

server.listen(PORT, () => {
  console.log(`VUE Auto Parts listening on ${PORT}`);
});
