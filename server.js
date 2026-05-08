const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Inventory";

const WHATSAPP_FALLBACK = {
  answer:
    "Sorry, I'm having a bit of trouble right now. Please reach out to us directly on WhatsApp at +16038662272 — we respond fast and can help you with anything.",
};

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
  const count = Number.parseInt(row["Count"] || row["Stock on Hand"], 10);
  const rawPrice = row["Unit Price"] || row["Unit Price (USD Base)"] || "";
  const price = rawPrice ? `$${parseFloat(rawPrice).toFixed(2)}` : "Ask for price";
  return {
    model: row["Vehicle Model"] || "",
    part: row["Part Name"] || "",
    specification: row["Specification"] || "",
    price: isNaN(parseFloat(rawPrice)) ? (rawPrice || "Ask for price") : price,
    availability: !Number.isNaN(count) && count > 0 ? "In stock" : "Ask in store",
  };
}

async function getInventory() {
  const response = await fetch(INVENTORY_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Inventory fetch failed: ${response.status}`);
  return csvToInventory(await response.text()).map(publicInventoryRow);
}

function buildSystemPrompt(inventorySummary) {
  return `You are the VUE Auto Parts assistant — a friendly, sharp customer support agent based in Chipinge, Zimbabwe. You help drivers find the right parts, get prices, and connect with the shop.

PERSONALITY:
- Warm, confident and direct. Like a knowledgeable friend at a parts counter.
- Keep responses concise — 1 to 3 sentences unless more detail is genuinely needed.
- Sound human. Vary your phrasing. Never be stiff or robotic.
- Respond naturally to the flow of the conversation — don't reset the topic after every message.

SHOP FACTS:
- Name: VUE Auto Parts
- Location: Chipinge, Manicaland, Zimbabwe
- Specialty vehicles: Honda Fit, Toyota Corolla, Toyota Wish, Toyota Probox, Nissan Caravan
- Core stock always available: Castrol engine oils (10W40, 20W50), wiper blades, coolants, brake pads, brake fluid, oil/air/fuel filters, fan belts, tyres, bulbs, batteries
- Contact: WhatsApp +16038662272 | Email: info@vueautoparts.com
- Quote turnaround: 24 hours. Pricing is transparent.
- Referral rewards: Refer 5 buyers → earn $5. Refer 15+ buyers → earn $10. No sign-up needed.

LIVE INVENTORY (from our Google Sheet — use this to answer part/price questions):
${inventorySummary}

HOW TO HELP:
1. If someone asks about a specific part or vehicle, check the inventory above first. If it's there, give the part name, price and availability naturally in your reply.
2. If it's not in the inventory but could be something we'd carry, say you'll check and point them to WhatsApp.
3. If someone asks about price or ordering, always give the WhatsApp number (+16038662272) as the action step.
4. If someone is satisfied or says thanks, acknowledge what was discussed and offer one natural next step — don't just reset to a generic menu.
5. Only suggest the referral rewards when it fits — e.g. after a positive exchange or when they ask about discounts/deals.

CHOICES (optional):
Only include choices when it genuinely helps the conversation move forward — not on every reply. When you do use choices, provide 3 to 4 short, specific options.

OUTPUT FORMAT:
Return ONLY a raw JSON object — no markdown, no backticks, no extra text.
- With choices: {"answer": "...", "choices": ["...", "...", "...", "Other"]}
- Without choices: {"answer": "..."}`;
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
  const model = (process.env.GROQ_MODEL || "llama-3.1-8b-instant").toLowerCase();

  console.log("[ask] key present:", !!apiKey, "| model:", model);

  const body = JSON.parse(await readRequestBody(request) || "{}");
  const question = String(body.question || "").trim().slice(0, 500);
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

  if (!question) return sendJson(response, 400, { answer: "What part are you looking for?" });

  let inventory;
  try {
    inventory = await getInventory();
    console.log("[ask] inventory rows:", inventory.length);
  } catch (err) {
    console.error("[ask] inventory fetch failed:", err.message);
    return sendJson(response, 200, WHATSAPP_FALLBACK);
  }

  if (!apiKey) {
    console.error("[ask] no API key — returning fallback");
    return sendJson(response, 200, WHATSAPP_FALLBACK);
  }

  const inventorySummary = inventory
    .slice(0, 80)
    .map((item) => `${item.model} | ${item.part} | ${item.specification} | ${item.price} | ${item.availability}`)
    .join("\n");

  const messages = [
    { role: "system", content: buildSystemPrompt(inventorySummary) },
    ...history,
    { role: "user", content: question },
  ];

  let groqResponse;
  try {
    groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 220,
        messages,
      }),
    });
  } catch (err) {
    console.error("[ask] Groq fetch error:", err.message);
    return sendJson(response, 200, WHATSAPP_FALLBACK);
  }

  if (!groqResponse.ok) {
    const errText = await groqResponse.text().catch(() => "");
    console.error("[ask] Groq returned", groqResponse.status, errText);
    return sendJson(response, 200, WHATSAPP_FALLBACK);
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

  if (raw) return sendJson(response, 200, { answer: raw });

  return sendJson(response, 200, WHATSAPP_FALLBACK);
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
    return sendJson(response, 500, WHATSAPP_FALLBACK);
  }
});

server.listen(PORT, () => {
  console.log(`VUE Auto Parts listening on ${PORT}`);
});
