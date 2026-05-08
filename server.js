const http   = require("node:http");
const fs     = require("node:fs/promises");
const fsSync = require("node:fs");
const path   = require("node:path");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Inventory";
const STAFF_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Staff";
const REWARDS_DB_PATH = path.join(ROOT, "rewards-db.json");

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

function normalizeId(id) {
  return id.replace(/-/g, "").toLowerCase();
}

function loadRewardsDb() {
  try {
    if (fsSync.existsSync(REWARDS_DB_PATH)) {
      return JSON.parse(fsSync.readFileSync(REWARDS_DB_PATH, "utf8"));
    }
  } catch {}
  return { cards: [] };
}

function saveRewardsDb(db) {
  fsSync.writeFileSync(REWARDS_DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function calcReward(referrals, purchases) {
  const score = Math.max(referrals || 0, purchases || 0);
  if (score >= 15) return 7;
  if (score >= 5)  return 3;
  return 0;
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

async function handleDraft(request, response) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = (process.env.GROQ_MODEL || "llama-3.1-8b-instant").toLowerCase();

  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const name = String(body.name || "").trim().slice(0, 100);
  const phone = String(body.phone || "").trim().slice(0, 30);
  const vehicle = String(body.vehicle || "").trim().slice(0, 100);
  const part = String(body.part || "").trim().slice(0, 200);

  if (!name || !vehicle || !part) {
    return sendJson(response, 400, { ok: false, error: "Name, vehicle and part are required." });
  }

  if (!apiKey) {
    const fallback = `Hi VUE Auto Parts,\n\nMy name is ${name}${phone ? ` and my contact number is ${phone}` : ""}. I'm looking for ${part} for my ${vehicle}.\n\nPlease let me know if you have it in stock and the price. Thank you.`;
    return sendJson(response, 200, { ok: true, draft: fallback });
  }

  const prompt = `Write a short, natural, friendly enquiry message from a customer to an auto parts shop called VUE Auto Parts in Chipinge, Zimbabwe. Keep it conversational and genuine — like a real person texting a shop, not a formal letter. 2-4 sentences max.

Customer details:
- Name: ${name}
- Phone: ${phone || "not provided"}
- Vehicle: ${vehicle}
- Part needed: ${part}

Return ONLY the message text, no subject line, no "Dear", no sign-off label. Just the body of the message.`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 120,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!groqRes.ok) {
      const fallback = `Hi VUE Auto Parts,\n\nMy name is ${name}${phone ? ` and my contact number is ${phone}` : ""}. I'm looking for ${part} for my ${vehicle}.\n\nPlease let me know if you have it in stock and the price. Thank you.`;
      return sendJson(response, 200, { ok: true, draft: fallback });
    }

    const data = await groqRes.json();
    const draft = data.choices?.[0]?.message?.content?.trim() || "";
    return sendJson(response, 200, { ok: true, draft: draft || `Hi, I'm ${name} and I'm looking for ${part} for my ${vehicle}. Please contact me on ${phone}.` });
  } catch (err) {
    console.error("[draft] error:", err.message);
    const fallback = `Hi VUE Auto Parts,\n\nMy name is ${name}${phone ? ` and my number is ${phone}` : ""}. I need ${part} for my ${vehicle}. Please let me know price and availability.`;
    return sendJson(response, 200, { ok: true, draft: fallback });
  }
}

async function handleEnquiry(request, response) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[enquiry] RESEND_API_KEY not set");
    return sendJson(response, 500, { ok: false, error: "Email service not configured." });
  }

  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const name = String(body.name || "").trim().slice(0, 100);
  const phone = String(body.phone || "").trim().slice(0, 30);
  const vehicle = String(body.vehicle || "").trim().slice(0, 100);
  const part = String(body.part || "").trim().slice(0, 200);
  const message = String(body.message || "").trim().slice(0, 1000);

  if (!name || !vehicle || !part || !message) {
    return sendJson(response, 400, { ok: false, error: "All fields are required." });
  }

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#1a3a2a;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0;font-size:18px">New Part Enquiry</h2>
        <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px">VUE Auto Parts website</p>
      </div>
      <div style="background:#f9f9f9;padding:20px 24px;border-left:1px solid #eee;border-right:1px solid #eee">
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr><td style="padding:7px 0;color:#666;width:110px;font-weight:600">Name</td><td style="padding:7px 0;font-weight:700">${name}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600">Phone</td><td style="padding:7px 0;font-weight:700">${phone || "—"}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600">Vehicle</td><td style="padding:7px 0;font-weight:700">${vehicle}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600">Part needed</td><td style="padding:7px 0;font-weight:700">${part}</td></tr>
        </table>
      </div>
      <div style="background:#fff;padding:20px 24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
        <p style="color:#444;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${message}</p>
      </div>
    </div>
  `;

  const text = `New Part Enquiry\n\nName: ${name}\nPhone: ${phone || "—"}\nVehicle: ${vehicle}\nPart needed: ${part}\n\n${message}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VUE Auto Parts <onboarding@resend.dev>",
        to: ["info@vueautoparts.com"],
        subject: `Enquiry: ${part} — ${vehicle} (${name})`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[enquiry] Resend error:", res.status, err);
      return sendJson(response, 500, { ok: false, error: "Could not send. Please try WhatsApp." });
    }

    console.log("[enquiry] sent:", name, "|", phone, "|", vehicle, "|", part);
    return sendJson(response, 200, { ok: true });
  } catch (err) {
    console.error("[enquiry] fetch error:", err.message);
    return sendJson(response, 500, { ok: false, error: "Could not send. Please try WhatsApp." });
  }
}

async function handleRewardDraft(request, response) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = (process.env.GROQ_MODEL || "llama-3.1-8b-instant").toLowerCase();

  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const name     = String(body.name     || "").trim().slice(0, 100);
  const location = String(body.location || "").trim().slice(0, 100);
  const phone    = String(body.phone    || "").trim().slice(0, 30);
  const idNumber = String(body.idNumber || "").trim().slice(0, 50);

  if (!name || !location || !phone || !idNumber) {
    return sendJson(response, 400, { ok: false, error: "All fields are required." });
  }

  const fallback = `Hi VUE Auto Parts,\n\nMy name is ${name} and I live in ${location}. My phone number is ${phone} and my ID number is ${idNumber}.\n\nI would like to register for the referral rewards programme. Please let me know the next steps. Thank you.`;

  if (!apiKey) return sendJson(response, 200, { ok: true, draft: fallback });

  const prompt = `Write a short, natural, friendly message from a customer who wants to join the VUE Auto Parts referral rewards programme in Chipinge, Zimbabwe. The programme pays $5 for 5 referrals and $10 for 15+ referrals. Keep it conversational and genuine — like a real person texting, not a formal letter. 2–4 sentences max. Include all the details naturally.

Customer details:
- Name: ${name}
- Location: ${location}
- Phone: ${phone}
- ID number: ${idNumber}

Return ONLY the message body. No subject line, no greeting label, no sign-off label.`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!groqRes.ok) return sendJson(response, 200, { ok: true, draft: fallback });

    const data = await groqRes.json();
    const draft = data.choices?.[0]?.message?.content?.trim() || "";
    return sendJson(response, 200, { ok: true, draft: draft || fallback });
  } catch (err) {
    console.error("[reward-draft] error:", err.message);
    return sendJson(response, 200, { ok: true, draft: fallback });
  }
}

async function handleRewardEnquiry(request, response) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[reward-enquiry] RESEND_API_KEY not set");
    return sendJson(response, 500, { ok: false, error: "Email service not configured." });
  }

  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const name     = String(body.name     || "").trim().slice(0, 100);
  const location = String(body.location || "").trim().slice(0, 100);
  const phone    = String(body.phone    || "").trim().slice(0, 30);
  const idNumber = String(body.idNumber || "").trim().slice(0, 50);
  const message  = String(body.message  || "").trim().slice(0, 1000);

  if (!name || !location || !phone || !idNumber || !message) {
    return sendJson(response, 400, { ok: false, error: "All fields are required." });
  }

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#1a3a2a;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0;font-size:18px">New Rewards Registration</h2>
        <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px">VUE Auto Parts referral programme</p>
      </div>
      <div style="background:#f9f9f9;padding:20px 24px;border-left:1px solid #eee;border-right:1px solid #eee">
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr><td style="padding:7px 0;color:#666;width:110px;font-weight:600">Name</td><td style="padding:7px 0;font-weight:700">${name}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600">Location</td><td style="padding:7px 0;font-weight:700">${location}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600">Phone</td><td style="padding:7px 0;font-weight:700">${phone}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600">ID Number</td><td style="padding:7px 0;font-weight:700">${idNumber}</td></tr>
        </table>
      </div>
      <div style="background:#fff;padding:20px 24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
        <p style="color:#444;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${message}</p>
      </div>
    </div>
  `;

  const text = `New Rewards Registration\n\nName: ${name}\nLocation: ${location}\nPhone: ${phone}\nID Number: ${idNumber}\n\n${message}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VUE Auto Parts <onboarding@resend.dev>",
        to: ["info@vueautoparts.com"],
        subject: `Rewards Registration: ${name} — ${location}`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[reward-enquiry] Resend error:", res.status, err);
      return sendJson(response, 500, { ok: false, error: "Could not send. Please try WhatsApp." });
    }

    console.log("[reward-enquiry] sent:", name, "|", phone, "|", location, "|", idNumber);
    return sendJson(response, 200, { ok: true });
  } catch (err) {
    console.error("[reward-enquiry] fetch error:", err.message);
    return sendJson(response, 500, { ok: false, error: "Could not send. Please try WhatsApp." });
  }
}

async function handleStaffVerify(request, response) {
  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const firstName = String(body.firstName || "").trim().toLowerCase();
  const lastName  = String(body.lastName  || "").trim().toLowerCase();
  const id        = normalizeId(String(body.id || "").trim());
  const role      = String(body.role      || "").trim().toLowerCase();

  if (!firstName || !lastName || !id || !role) {
    return sendJson(response, 400, { ok: false, error: "All fields are required." });
  }

  let staffList;
  try {
    const res = await fetch(STAFF_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Staff fetch failed: ${res.status}`);
    const csv = await res.text();
    const rows = parseCsv(csv);
    const headers = rows[0] || [];
    const idx = {
      firstName: headers.findIndex(h => h.trim().toLowerCase() === "first name"),
      lastName:  headers.findIndex(h => h.trim().toLowerCase() === "last name"),
      id:        headers.findIndex(h => h.trim().toLowerCase() === "id"),
      role:      headers.findIndex(h => h.trim().toLowerCase() === "role"),
    };
    staffList = rows.slice(1).map(row => ({
      firstName: (row[idx.firstName] || "").trim(),
      lastName:  (row[idx.lastName]  || "").trim(),
      id:        (row[idx.id]        || "").trim(),
      role:      (row[idx.role]      || "").trim(),
    })).filter(s => s.firstName || s.lastName);
  } catch (err) {
    console.error("[staff-verify] sheet fetch error:", err.message);
    return sendJson(response, 500, { ok: false, error: "Could not load staff list. Try again." });
  }

  const match = staffList.find(s =>
    s.firstName.toLowerCase()  === firstName &&
    s.lastName.toLowerCase()   === lastName  &&
    normalizeId(s.id)          === id        &&
    s.role.toLowerCase()       === role
  );

  if (!match) {
    console.log("[staff-verify] no match for:", firstName, lastName, id, role);
    return sendJson(response, 200, { ok: false, error: "Details not found. Please check your information and try again." });
  }

  console.log("[staff-verify] verified:", match.firstName, match.lastName, match.role);
  return sendJson(response, 200, { ok: true, staff: match });
}

async function handleStaffDraft(request, response) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = (process.env.GROQ_MODEL || "llama-3.1-8b-instant").toLowerCase();

  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const firstName = String(body.firstName || "").trim();
  const lastName  = String(body.lastName  || "").trim();
  const role      = String(body.role      || "").trim();
  const action    = String(body.action    || "").trim();
  const details   = body.details || {};
  const now       = new Date().toLocaleString("en-ZW", { dateStyle: "full", timeStyle: "short" });

  const actionLabels = {
    "clock-in":  "reporting to work (clocking in)",
    "clock-out": "reporting the end of the work day (clocking out)",
    "event":     "reporting a workplace event or incident",
    "pay":       "submitting a pay report or request",
  };

  let contextBlock = `Date and Time: ${now}\n`;
  if (action === "event") {
    contextBlock += `Event type: ${details.eventType || "Unspecified"}\n`;
    if (details.eventDesc) contextBlock += `Description: ${details.eventDesc}\n`;
  }
  if (action === "pay") {
    contextBlock += `Pay period: ${details.payMonth || ""} ${details.payYear || ""}\n`;
  }
  if (details.notes) contextBlock += `Additional notes: ${details.notes}\n`;

  const toneGuide = action === "event"
    ? "Clear, factual and professional — this is an incident report."
    : action === "pay"
    ? "Polite, professional, and direct — this is a formal pay request."
    : "Warm, brief and professional — a quick check-in message.";

  const prompt = `Write a short, professional staff message for VUE Auto Parts in Chipinge, Zimbabwe. The staff member is ${actionLabels[action] || action}.

Staff details:
- Name: ${firstName} ${lastName}
- Role: ${role}

Context:
${contextBlock}

Tone: ${toneGuide}
Length: 2–4 sentences. Natural, genuine, not stiff.
Return ONLY the message body — no subject line, no greeting label, no sign-off label.`;

  const fallback = buildStaffFallback(firstName, lastName, role, action, details, now);
  if (!apiKey) return sendJson(response, 200, { ok: true, draft: fallback });

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 160,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!groqRes.ok) return sendJson(response, 200, { ok: true, draft: fallback });
    const data = await groqRes.json();
    const draft = data.choices?.[0]?.message?.content?.trim() || "";
    return sendJson(response, 200, { ok: true, draft: draft || fallback });
  } catch (err) {
    console.error("[staff-draft] error:", err.message);
    return sendJson(response, 200, { ok: true, draft: fallback });
  }
}

function buildStaffFallback(firstName, lastName, role, action, details, now) {
  const full = `${firstName} ${lastName}`;
  if (action === "clock-in")  return `Hi Management,\n\nThis is ${full} (${role}) reporting to work on ${now}.\n\n${details.notes || ""}`.trim();
  if (action === "clock-out") return `Hi Management,\n\nThis is ${full} (${role}) signing off for the day on ${now}.\n\n${details.notes || ""}`.trim();
  if (action === "event")     return `Hi Management,\n\nThis is ${full} (${role}) reporting an event on ${now}. Type: ${details.eventType || "Unspecified"}.\n\n${details.eventDesc || ""}\n\n${details.notes || ""}`.trim();
  if (action === "pay")       return `Hi Management,\n\nThis is ${full} (${role}) submitting a pay request for ${details.payMonth || ""} ${details.payYear || ""}.\n\n${details.notes || ""}`.trim();
  return "";
}

async function handleStaffReport(request, response) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[staff-report] RESEND_API_KEY not set");
    return sendJson(response, 500, { ok: false, error: "Email service not configured." });
  }

  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const firstName = String(body.firstName || "").trim();
  const lastName  = String(body.lastName  || "").trim();
  const staffId   = String(body.id        || "").trim();
  const role      = String(body.role      || "").trim();
  const action    = String(body.action    || "").trim();
  const details   = body.details || {};
  const message   = String(body.message  || "").trim().slice(0, 2000);
  const now       = new Date().toLocaleString("en-ZW", { dateStyle: "full", timeStyle: "short" });

  if (!firstName || !lastName || !role || !action || !message) {
    return sendJson(response, 400, { ok: false, error: "All fields are required." });
  }

  const actionLabels = {
    "clock-in":  "Clock In",
    "clock-out": "Clock Out",
    "event":     "Event Report",
    "pay":       "Pay Request",
  };
  const actionColors = {
    "clock-in":  "#166534",
    "clock-out": "#7c3aed",
    "event":     "#b45309",
    "pay":       "#0f4f36",
  };
  const actionLabel = actionLabels[action] || action;
  const accentColor = actionColors[action] || "#0f4f36";

  let extraRows = "";
  if (action === "event") {
    extraRows += `<tr><td style="padding:7px 0;color:#666;width:130px;font-weight:600">Event type</td><td style="padding:7px 0;font-weight:700">${details.eventType || "—"}</td></tr>`;
  }
  if (action === "pay") {
    extraRows += `<tr><td style="padding:7px 0;color:#666;font-weight:600">Pay period</td><td style="padding:7px 0;font-weight:700">${details.payMonth || ""} ${details.payYear || ""}</td></tr>`;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <div style="background:${accentColor};padding:20px 24px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">
        <div>
          <h2 style="color:#fff;margin:0;font-size:18px">Staff ${actionLabel}</h2>
          <p style="color:rgba(255,255,255,0.65);margin:4px 0 0;font-size:13px">VUE Auto Parts · ${now}</p>
        </div>
        <span style="background:rgba(255,255,255,0.15);color:#fff;font-size:11px;font-weight:800;letter-spacing:0.08em;padding:4px 10px;border-radius:999px;text-transform:uppercase">${actionLabel}</span>
      </div>
      <div style="background:#f9f9f9;padding:20px 24px;border-left:1px solid #eee;border-right:1px solid #eee">
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr><td style="padding:7px 0;color:#666;width:130px;font-weight:600">Name</td><td style="padding:7px 0;font-weight:700">${firstName} ${lastName}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600">Role</td><td style="padding:7px 0;font-weight:700">${role}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600">Action</td><td style="padding:7px 0;font-weight:700">${actionLabel}</td></tr>
          ${extraRows}
        </table>
      </div>
      <div style="background:#fff;padding:20px 24px;border:1px solid #eee;border-top:none">
        <p style="color:#444;font-size:14px;line-height:1.7;margin:0;white-space:pre-wrap">${message}</p>
      </div>
      <div style="background:#f0fdf4;padding:16px 24px;border:1px solid #bbf7d0;border-top:none;border-radius:0 0 8px 8px">
        <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.07em;color:#166534;text-transform:uppercase">Electronic Signature</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <tr><td style="padding:3px 0;color:#166534;width:110px;font-weight:600">Signed by</td><td style="padding:3px 0;font-weight:700;color:#14532d">${firstName} ${lastName}</td></tr>
          <tr><td style="padding:3px 0;color:#166534;font-weight:600">National ID</td><td style="padding:3px 0;font-weight:700;color:#14532d">${staffId || "—"}</td></tr>
          <tr><td style="padding:3px 0;color:#166534;font-weight:600">Role</td><td style="padding:3px 0;font-weight:700;color:#14532d">${role}</td></tr>
          <tr><td style="padding:3px 0;color:#166534;font-weight:600">Timestamp</td><td style="padding:3px 0;font-weight:700;color:#14532d">${now}</td></tr>
        </table>
        <p style="margin:10px 0 0;font-size:11px;color:#166534;line-height:1.5">This submission was electronically signed by the staff member named above. The electronic signature is legally equivalent to a handwritten signature under the Electronic Transactions Act.</p>
      </div>
    </div>
  `;

  const text = `Staff ${actionLabel}\n\nName: ${firstName} ${lastName}\nRole: ${role}\nDate: ${now}\n\n${message}\n\n---\nELECTRONIC SIGNATURE\nSigned by: ${firstName} ${lastName}\nNational ID: ${staffId || "—"}\nRole: ${role}\nTimestamp: ${now}\nThis electronic signature is legally equivalent to a handwritten signature.`;
  const subject = `[Staff] ${actionLabel} — ${firstName} ${lastName} (${role})`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VUE Auto Parts Staff <onboarding@resend.dev>",
        to: ["info@vueautoparts.com"],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[staff-report] Resend error:", res.status, err);
      return sendJson(response, 500, { ok: false, error: "Could not send. Please try WhatsApp." });
    }
    console.log("[staff-report] sent:", firstName, lastName, "|", role, "|", action);
    return sendJson(response, 200, { ok: true });
  } catch (err) {
    console.error("[staff-report] fetch error:", err.message);
    return sendJson(response, 500, { ok: false, error: "Could not send. Please try WhatsApp." });
  }
}

async function handleRewardsCreate(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, customerName, phone, staffName, staffRole } = body;
  if (!customerName || !phone || !serial) {
    return sendJson(response, 400, { ok: false, error: "Name, phone, and serial are required." });
  }
  const db = loadRewardsDb();
  if (db.cards.find(c => c.serial === serial)) {
    return sendJson(response, 400, { ok: false, error: "Card serial already registered." });
  }
  const card = {
    serial:        String(serial).trim(),
    name:          String(customerName).trim(),
    phone:         String(phone).trim(),
    issuedBy:      String(staffName  || "").trim(),
    issuedByRole:  String(staffRole  || "").trim(),
    issuedDate:    new Date().toISOString(),
    status:        "active",
    referrals:     0,
    purchases:     0,
    revokedBy:     null,
    revokeReason:  null,
    revokedDate:   null,
    renewedDate:   null,
    paidDate:      null,
    paidAmount:    null,
  };
  db.cards.push(card);
  saveRewardsDb(db);
  return sendJson(response, 200, { ok: true, card });
}

async function handleRewardsLookup(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const query = String(body.query || "").trim().toLowerCase();
  if (!query) return sendJson(response, 400, { ok: false, error: "Search query is required." });
  const db = loadRewardsDb();
  const results = db.cards
    .filter(c =>
      c.serial.toLowerCase().includes(query) ||
      c.name.toLowerCase().includes(query) ||
      (c.phone && c.phone.replace(/\D/g, "").includes(query.replace(/\D/g, "")))
    )
    .map(c => ({ ...c, rewardOwed: calcReward(c.referrals, c.purchases) }));
  return sendJson(response, 200, { ok: true, cards: results });
}

async function handleRewardsAdd(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, type, count } = body;
  if (!serial || !type) return sendJson(response, 400, { ok: false, error: "Serial and type required." });
  const db  = loadRewardsDb();
  const idx = db.cards.findIndex(c => c.serial === serial);
  if (idx === -1) return sendJson(response, 404, { ok: false, error: "Card not found." });
  if (db.cards[idx].status !== "active") return sendJson(response, 400, { ok: false, error: "Card is not active." });
  const n = Math.max(1, Math.min(10, parseInt(count) || 1));
  if (type === "referral") db.cards[idx].referrals = (db.cards[idx].referrals || 0) + n;
  if (type === "purchase") db.cards[idx].purchases = (db.cards[idx].purchases || 0) + n;
  saveRewardsDb(db);
  const card = { ...db.cards[idx], rewardOwed: calcReward(db.cards[idx].referrals, db.cards[idx].purchases) };
  return sendJson(response, 200, { ok: true, card });
}

async function handleRewardsRevoke(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, revokedBy, reason } = body;
  if (!serial) return sendJson(response, 400, { ok: false, error: "Serial required." });
  const db  = loadRewardsDb();
  const idx = db.cards.findIndex(c => c.serial === serial);
  if (idx === -1) return sendJson(response, 404, { ok: false, error: "Card not found." });
  db.cards[idx].status      = "revoked";
  db.cards[idx].revokedBy   = String(revokedBy || "").trim();
  db.cards[idx].revokeReason= String(reason    || "Policy violation").trim();
  db.cards[idx].revokedDate = new Date().toISOString();
  saveRewardsDb(db);
  return sendJson(response, 200, { ok: true });
}

async function handleRewardsRenew(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, renewedBy } = body;
  if (!serial) return sendJson(response, 400, { ok: false, error: "Serial required." });
  const db  = loadRewardsDb();
  const idx = db.cards.findIndex(c => c.serial === serial);
  if (idx === -1) return sendJson(response, 404, { ok: false, error: "Card not found." });
  if (db.cards[idx].status === "active") return sendJson(response, 400, { ok: false, error: "Card is already active." });
  const wasPaid = db.cards[idx].status === "paid";
  db.cards[idx].status      = "active";
  db.cards[idx].renewedDate = new Date().toISOString();
  db.cards[idx].revokedBy   = null;
  db.cards[idx].revokeReason= null;
  db.cards[idx].revokedDate = null;
  if (wasPaid) {
    db.cards[idx].referrals  = 0;
    db.cards[idx].purchases  = 0;
    db.cards[idx].paidDate   = null;
    db.cards[idx].paidAmount = null;
  }
  saveRewardsDb(db);
  const card = { ...db.cards[idx], rewardOwed: calcReward(db.cards[idx].referrals, db.cards[idx].purchases) };
  return sendJson(response, 200, { ok: true, card });
}

async function handleRewardsPay(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, paidBy } = body;
  if (!serial) return sendJson(response, 400, { ok: false, error: "Serial required." });
  const db  = loadRewardsDb();
  const idx = db.cards.findIndex(c => c.serial === serial);
  if (idx === -1) return sendJson(response, 404, { ok: false, error: "Card not found." });
  const amount = calcReward(db.cards[idx].referrals, db.cards[idx].purchases);
  if (amount === 0) return sendJson(response, 400, { ok: false, error: "No reward owed on this card." });
  db.cards[idx].status      = "paid";
  db.cards[idx].paidDate    = new Date().toISOString();
  db.cards[idx].paidAmount  = amount;
  db.cards[idx].revokedBy   = String(paidBy || "").trim();
  db.cards[idx].revokedDate = new Date().toISOString();
  db.cards[idx].revokeReason= "Reward paid out — card auto-revoked.";
  saveRewardsDb(db);
  return sendJson(response, 200, { ok: true, amount });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/ask") {
      return await handleAsk(request, response);
    }
    if (request.method === "POST" && request.url === "/api/draft") {
      return await handleDraft(request, response);
    }
    if (request.method === "POST" && request.url === "/api/enquiry") {
      return await handleEnquiry(request, response);
    }
    if (request.method === "POST" && request.url === "/api/reward-draft") {
      return await handleRewardDraft(request, response);
    }
    if (request.method === "POST" && request.url === "/api/reward-enquiry") {
      return await handleRewardEnquiry(request, response);
    }
    if (request.method === "POST" && request.url === "/api/staff-verify") {
      return await handleStaffVerify(request, response);
    }
    if (request.method === "POST" && request.url === "/api/staff-draft") {
      return await handleStaffDraft(request, response);
    }
    if (request.method === "POST" && request.url === "/api/staff-report") {
      return await handleStaffReport(request, response);
    }
    if (request.method === "POST" && request.url === "/api/rewards-create") {
      return await handleRewardsCreate(request, response);
    }
    if (request.method === "POST" && request.url === "/api/rewards-lookup") {
      return await handleRewardsLookup(request, response);
    }
    if (request.method === "POST" && request.url === "/api/rewards-add") {
      return await handleRewardsAdd(request, response);
    }
    if (request.method === "POST" && request.url === "/api/rewards-revoke") {
      return await handleRewardsRevoke(request, response);
    }
    if (request.method === "POST" && request.url === "/api/rewards-renew") {
      return await handleRewardsRenew(request, response);
    }
    if (request.method === "POST" && request.url === "/api/rewards-pay") {
      return await handleRewardsPay(request, response);
    }
    return await serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 500, WHATSAPP_FALLBACK);
  }
});

server.listen(PORT, () => {
  console.log(`VUE Auto Parts listening on ${PORT}`);
});
