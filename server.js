const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Master-Inventory-%26-Location";

const SYSTEM_PROMPT = `You are the VUE Auto Parts Digital Assistant in Chipinge. Your goal is to provide fast, warm, and data-backed support to drivers in Zimbabwe. 

CORE PERSONALITY:
- Knowledgeable, helpful, and punchy. Think "Expert mechanic who is also a good neighbor."
- STRICT LIMIT: Maximum 3 sentences per response. 
- Use warm, varied greetings. Never repeat the same opening twice.

KNOWLEDGE BASE (VUE AUTO PARTS):
- Location: Chipinge, Manicaland, Zimbabwe.
- Specialty Models: Honda Fit, Toyota Corolla, Toyota Probox, Nissan Caravan.
- Core Stock: Castrol Oils (10W40, 20W50), wipers, coolants, brake pads/fluid, filters (oil/air/fuel), fan belts, tyres, bulbs, batteries.
- Competitive Edge: We stock based on Zimbabwe road accident data to prevent breakdowns.
- Contact: WhatsApp +16038662272 | Email: info@vueautoparts.com.
- Sales Policy: 24-hour quotes. Clear pricing.

LOGIC & SAFETY RULES:
1. NO GUESSING: If a part isn't listed in the Core Stock, say: "I'll check our extended inventory for that; we can usually source anything we don't have on the shelf." Then direct to WhatsApp.
2. REWARDS: Mention the referral program ($5 for 5 buyers, $10 for 15+) only when the user seems satisfied or asks about prices/discounts.
3. ACKNOWLEDGMENT: If the user says "thanks" or "ok," acknowledge the specific topic discussed and offer one final helpful suggestion. Do not reset the persona.

INTERACTION FLOW:
- GREETINGS: Energy is key. Mention our data-driven approach or a specific specialty (like Honda Fit parts) before offering choices.
- CHOICES: Whenever a decision is needed, provide exactly 3 specific options (max 5 words each) plus "Other".
- FORMAT: Return ONLY a raw JSON object. No markdown, no backticks, no prose outside the JSON.

OUTPUT STRUCTURE:
- With choices: {"answer": "...", "choices": ["...", "...", "...", "Other"]}
- Without choices: {"answer": "..."}`;

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

function fallbackResponse(question, inventory, history) {
  const lowered = question.toLowerCase().trim();

  const isGreeting = /^(hi|hello|hey|good\s*(morning|afternoon|evening|day)|howzit|how are you|sup|hola)\b/.test(lowered);
  const isAck = /^(thanks?(\s+you)?|thank\s*you|ok(ay)?|cool|great|got\s*it|nice|perfect|alright|sounds\s*good|awesome|noted|appreciated|cheers)\b/.test(lowered);
  const isFarewell = /^(bye|goodbye|see\s*you|later|take\s*care|cya|good\s*night)\b/.test(lowered);

  if (isGreeting) {
    return {
      answer: "Hey! Welcome to VUE Auto Parts. We stock parts for Honda Fit, Corolla, Probox & Nissan Caravan — plus oils, brakes, filters & more. We use road data to stock what actually matters. What can I help you with?",
      choices: ["Find a specific part", "Check what's in stock", "Tell me about rewards", "Other"],
    };
  }

  if (isFarewell) {
    return {
      answer: "Take care! Come back anytime — or WhatsApp us at +16038662272 whenever you need something fast.",
    };
  }

  if (isAck) {
    const lastBot = [...(history || [])].reverse().find((m) => m.role === "assistant");
    const ctx = (lastBot?.content || "").toLowerCase();

    if (ctx.includes("refer") || ctx.includes("reward") || ctx.includes("earn")) {
      return {
        answer: "Glad that's useful! Just send people our way — no paperwork at all. Can I help you find a part while you're here?",
        choices: ["Find a part", "Check what's in stock", "How to contact us", "Other"],
      };
    }

    if (ctx.includes("available") || ctx.includes("price") || ctx.includes("stock") || ctx.includes("part")) {
      return {
        answer: "Perfect. If you want to lock it in, WhatsApp us at +16038662272. Anything else you need?",
        choices: ["Find another part", "Get a quote", "Tell me about rewards", "Other"],
      };
    }

    if (ctx.includes("chipinge") || ctx.includes("location") || ctx.includes("whatsapp") || ctx.includes("email")) {
      return {
        answer: "You're welcome! We're always ready to help. Is there a part I can check for you?",
        choices: ["Find a part", "Check stock", "Tell me about rewards", "Other"],
      };
    }

    return {
      answer: "Happy to help! Is there anything else I can do for you?",
      choices: ["Find a part", "Check what's in stock", "Tell me about rewards", "Other"],
    };
  }

  if (lowered.includes("reward") || lowered.includes("refer") || lowered.includes("earn")) {
    return {
      answer: "Simple programme — refer 5 people who buy and earn $5 cash or a discount. Refer 15 or more and earn $10. No sign-up, no paperwork. Just send people to VUE Auto Parts.",
      choices: ["How do I refer someone?", "Find a part", "Contact the shop", "Other"],
    };
  }

  if (lowered.includes("location") || lowered.includes("address") || lowered.includes("where") || lowered.includes("find you")) {
    return { answer: "We're in Chipinge, Manicaland, Zimbabwe. Walk in anytime or reach us on WhatsApp — we respond fast." };
  }

  if (lowered.includes("contact") || lowered.includes("email") || lowered.includes("whatsapp") || lowered.includes("call")) {
    return { answer: "WhatsApp us at +16038662272 — fastest way to get a quote. Email: info@vueautoparts.com." };
  }

  if (lowered.includes("oil") || lowered.includes("engine oil")) {
    return { answer: "We carry Castrol 10W40 and 20W50 — great for Fit, Corolla & Probox. Always in stock. WhatsApp us to confirm quantity." };
  }

  if (lowered.includes("brake") || lowered.includes("brake pad")) {
    return { answer: "Brake pads and fluid are part of our core stock. We study accident patterns — brakes are one of the first things we keep well-stocked." };
  }

  const words = lowered.split(/\s+/).filter((word) => word.length > 2);
  const match = inventory.find((item) => {
    const text = `${item.model} ${item.part} ${item.specification} ${item.price}`.toLowerCase();
    return words.some((word) => text.includes(word));
  });

  if (match) {
    return {
      answer: `Found it — ${match.model} ${match.part}: ${match.price}. ${match.availability}. Need more details or want to place a hold? WhatsApp us.`,
    };
  }

  return {
    answer: "I don't have that one on file right now, but we can source most parts. Drop us a WhatsApp at +16038662272 with your model and part name.",
    choices: ["Search a different part", "WhatsApp the shop", "Tell me about rewards", "Other"],
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
    return sendJson(response, 200, fallbackResponse(question, inventory, history));
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
    return sendJson(response, 200, fallbackResponse(question, inventory, history));
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

  return sendJson(response, 200, { answer: raw || fallbackResponse(question, inventory, history).answer });
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
