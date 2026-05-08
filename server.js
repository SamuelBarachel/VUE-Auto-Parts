const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Master-Inventory-%26-Location";

const SYSTEM_PROMPT = `You are the VUE Auto Parts assistant. Real shop. Real people. Chipinge, Zimbabwe.

PERSONALITY:
- Sound human. Warm, direct, no fluff.
- Short sentences only. Max 2-3 per reply.
- Never ask for names or personal info.
- No robotic if/then answers. Talk like a person.

BUSINESS:
- VUE Auto Parts. Chipinge, Manicaland, Zimbabwe.
- We specialise in: Honda Fit, Toyota Corolla, Toyota Probox, Nissan Caravan.
- Universal stock always available: engine oils (Castrol 10W40, 20W50), wiper blades, coolants, brake pads & fluid, oil/air/fuel filters, fan belts, tyres, bulbs, batteries.
- We are data-driven. We study Zimbabwe road accident patterns to stock the parts that actually keep people safe.
- Clear pricing. 24h quote turnaround. Walk in or WhatsApp.
- WhatsApp: +16038662272. Email: info@vueautoparts.com.

REWARDS PROGRAMME:
- Refer 5 customers who buy → earn $5 cash or discount.
- Refer 15+ customers who buy → earn $10 cash or discount.
- No sign-up needed. Just send people our way. Terms apply.
- Tell them to mention your name when they come in.

CHOICES RULE:
- If the conversation is unclear, vague, or missing direction — offer exactly 3 specific choices + "Other".
- Choices must be short (5 words max each).
- Always include "Other" as the last choice.

INVENTORY RULE:
- Use the provided live inventory to answer part queries.
- Give price and availability directly. No dancing around it.
- If not in inventory, say we can source it and direct to WhatsApp.

RESPONSE FORMAT — return ONLY raw JSON. No markdown. No code blocks. No extra text:
If you want to offer choices: {"answer": "your message", "choices": ["Option 1", "Option 2", "Option 3", "Other"]}
If no choices needed: {"answer": "your message"}`;

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

function fallbackResponse(question, inventory) {
  const lowered = question.toLowerCase();
  const words = lowered.split(/\s+/).filter((word) => word.length > 2);
  const match = inventory.find((item) => {
    const text = `${item.model} ${item.part} ${item.specification} ${item.price}`.toLowerCase();
    return words.some((word) => text.includes(word));
  });

  if (match) {
    return {
      answer: `${match.model} — ${match.part}: ${match.price}. ${match.availability}.`,
    };
  }

  if (lowered.includes("reward") || lowered.includes("refer") || lowered.includes("earn")) {
    return {
      answer: "Refer 5 buyers → earn $5. Refer 15+ buyers → earn $10. No sign-up. Just send people our way.",
    };
  }

  if (lowered.includes("location") || lowered.includes("address") || lowered.includes("where")) {
    return { answer: "We're in Chipinge, Manicaland, Zimbabwe. Walk in or WhatsApp us." };
  }

  if (lowered.includes("contact") || lowered.includes("email") || lowered.includes("whatsapp")) {
    return { answer: "WhatsApp: +16038662272. Email: info@vueautoparts.com." };
  }

  return {
    answer: "Not sure what you need? Let me point you in the right direction.",
    choices: ["Find a specific part", "Check what's in stock", "Learn about rewards", "Other"],
  };
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
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  if (!question) return sendJson(response, 400, { answer: "What part are you looking for?" });

  const inventory = await getInventory();

  if (!apiKey) {
    return sendJson(response, 200, fallbackResponse(question, inventory));
  }

  const inventorySummary = inventory.slice(0, 60).map(
    (item) => `${item.model} | ${item.part} | ${item.specification} | ${item.price} | ${item.availability}`
  ).join("\n");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    {
      role: "user",
      content: JSON.stringify({
        question,
        inventory: inventorySummary,
        shopFacts: {
          business: "VUE Auto Parts",
          location: "Chipinge, Manicaland, Zimbabwe",
          whatsapp: "+16038662272",
          email: "info@vueautoparts.com",
          focusModels: ["Honda Fit", "Toyota Corolla", "Toyota Probox", "Nissan Caravan"],
          universalParts: "engine oils, wiper blades, coolants, brake systems, filters, belts, tyres, bulbs, batteries",
        },
      }),
    },
  ];

  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 160,
      messages,
    }),
  });

  if (!groqResponse.ok) {
    return sendJson(response, 200, fallbackResponse(question, inventory));
  }

  const data = await groqResponse.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || "";

  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      if (parsed.answer) return sendJson(response, 200, parsed);
    }
  } catch (_) {}

  return sendJson(response, 200, { answer: raw || fallbackResponse(question, inventory).answer });
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
    return sendJson(response, 500, { answer: "Something went wrong. Try Parts Finder or WhatsApp us." });
  }
});

server.listen(PORT, () => {
  console.log(`VUE Auto Parts listening on ${PORT}`);
});
