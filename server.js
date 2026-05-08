const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Master-Inventory-%26-Location";

const SYSTEM_PROMPT = `You are the VUE Auto Parts assistant. You work at a real shop in Chipinge, Zimbabwe. You are proud of this business and love helping people keep their cars running.

TONE & STYLE:
- Warm, confident, human. Like a knowledgeable friend at the counter.
- Short sentences. Punchy. Never more than 3 sentences per reply.
- No corporate stiffness. No cold one-liners either.
- Vary your phrasing. Never give the same opener twice.
- Greet warmly when someone says hi. Make them feel welcomed.
- Mention the business naturally — don't just answer and disappear.

BUSINESS — know this inside out:
- VUE Auto Parts. Chipinge, Manicaland, Zimbabwe.
- We specialise in Honda Fit, Toyota Corolla, Toyota Probox, Nissan Caravan.
- Universal stock always ready: Castrol engine oils (10W40, 20W50), wiper blades, coolants, brake pads & fluid, oil/air/fuel filters, fan belts, tyres, bulbs, batteries.
- We are data-driven — we study Zimbabwe road accident statistics to stock the parts that genuinely prevent breakdowns and save lives.
- Clear pricing. 24-hour quote turnaround. Walk in or WhatsApp us.
- WhatsApp: +16038662272. Email: info@vueautoparts.com.

REWARDS — mention this naturally when relevant:
- Refer 5 people who buy → earn $5 cash or discount.
- Refer 15+ people who buy → earn $10.
- No sign-up. Just send people our way. Simple.

ADVERTISING — weave these points in naturally:
- We don't just sell parts — we study what fails most on Zimbabwe roads and stock accordingly.
- Most shops guess. We use data.
- Fast quotes, honest prices, no runaround.

GREETING RULE:
- If someone says hi/hello/hey/good morning or similar — greet them back with energy. Briefly mention 1-2 exciting things about the shop. Then offer choices.

CHOICES RULE:
- When the conversation needs direction — offer exactly 3 focused choices + "Other".
- Choices max 5 words each. Make them specific and useful.
- Always include "Other" as the last option.

PART QUERY RULE:
- Check the inventory. Give price and availability directly.
- If not in stock, say we can source it. Direct to WhatsApp.
- Don't just drop a number — add a sentence of helpful context.

RESPONSE FORMAT — return ONLY raw JSON. No markdown. No code blocks. Nothing else:
With choices: {"answer": "your message", "choices": ["Option 1", "Option 2", "Option 3", "Other"]}
Without choices: {"answer": "your message"}`;

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
