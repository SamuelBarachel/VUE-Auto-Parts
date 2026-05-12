const http        = require("node:http");
const fs          = require("node:fs/promises");
const fsSync      = require("node:fs");
const path        = require("node:path");
const { Pool }    = require("pg");
const PDFDocument = require("pdfkit");
const insights    = require("./insights");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const INVENTORY_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Inventory";
const STAFF_URL =
  "https://docs.google.com/spreadsheets/d/1KHfFq8V4sVpVASosrYyACfxMcSMDS1ji6pvXwRBvdho/gviz/tq?tqx=out:csv&sheet=Staff";

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
- Specialty vehicles: Honda Fit, Toyota Corolla, Toyota Wish, Toyota Probox, Nissan Caravan (engine parts, suspension, body &amp; van-specific service items)
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

STRICT RULES — NEVER BREAK THESE:
- NEVER mention, suggest, or reference any other shop, competitor, or alternative supplier — not even vaguely. You represent VUE Auto Parts exclusively.
- NEVER say things like "you could check other shops", "try elsewhere", "compare prices", or anything that directs a customer away from us.
- If something is not in stock or you are unsure, ALWAYS direct the customer to WhatsApp (+16038662272) — not to look elsewhere.
- You are a loyal representative of VUE Auto Parts. Your job is to keep customers with us and help them through us.

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

function rowToCard(r) {
  return {
    serial:       r.serial,
    name:         r.name,
    phone:        r.phone,
    issuedBy:     r.issued_by,
    issuedByRole: r.issued_by_role,
    issuedDate:   r.issued_date,
    status:       r.status,
    referrals:    r.referrals,
    purchases:    r.purchases,
    revokedBy:    r.revoked_by,
    revokeReason: r.revoke_reason,
    revokedDate:  r.revoked_date,
    renewedDate:  r.renewed_date,
    paidDate:     r.paid_date,
    paidAmount:   r.paid_amount !== null ? Number(r.paid_amount) : null,
  };
}

function calcReward(referrals, purchases) {
  const score = Math.max(referrals || 0, purchases || 0);
  if (score >= 15) return 7;
  if (score >= 5)  return 3;
  return 0;
}

async function readRequestBody(request, maxBytes = 12 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error("Request body too large");
      err.code = "BODY_TOO_LARGE";
      throw err;
    }
    chunks.push(chunk);
  }
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

async function handlePartRequest(request, response) {
  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const name    = String(body.name    || "").trim().slice(0, 100);
  const phone   = String(body.phone   || "").trim().slice(0, 30);
  const vehicle = String(body.vehicle || "").trim().slice(0, 100);
  const part    = String(body.part    || "").trim().slice(0, 200);
  const note    = String(body.note    || "").trim().slice(0, 500);

  if (!name || !vehicle || !part) {
    return sendJson(response, 400, { ok: false, error: "Name, vehicle and part are required." });
  }

  try {
    await pool.query(
      `INSERT INTO part_requests (name, phone, vehicle, part, note) VALUES ($1, $2, $3, $4, $5)`,
      [name, phone, vehicle, part, note]
    );
  } catch (err) {
    console.error("[part-request] DB error:", err.message);
    return sendJson(response, 500, { ok: false, error: "Could not save request. Please WhatsApp us directly." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const html = `<h2 style="color:#062f22">New Part Request</h2><p><strong>Name:</strong> ${name}<br><strong>Phone:</strong> ${phone || "—"}<br><strong>Vehicle:</strong> ${vehicle}<br><strong>Part needed:</strong> ${part}${note ? `<br><strong>Note:</strong> ${note}` : ""}</p>`;
    const text = `New Part Request\n\nName: ${name}\nPhone: ${phone || "—"}\nVehicle: ${vehicle}\nPart needed: ${part}${note ? "\nNote: " + note : ""}`;
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VUE Auto Parts <onboarding@resend.dev>",
        to: ["info@vueautoparts.com"],
        subject: `Part Request: ${part} — ${vehicle} (${name})`,
        html,
        text,
      }),
    }).catch(e => console.error("[part-request] email error:", e.message));
  }

  return sendJson(response, 200, { ok: true });
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

async function handleJobsDraft(request, response) {
  const apiKey = process.env.GROQ_API_KEY;
  const model  = (process.env.GROQ_MODEL || "llama-3.1-8b-instant").toLowerCase();

  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const { role, firstName, lastName, dobMonth, dobDay, dobYear, age,
          sex, location, phone, idNumber, computer, medical } = body;

  const dobStr = `${dobMonth}/${dobDay}/${dobYear}`;
  const fallback =
    `Dear VUE Auto Parts Management,\n\n` +
    `I, ${firstName} ${lastName}, would like to apply for the position of ${role} at VUE Auto Parts, Chipinge.\n\n` +
    `Personal Details:\n` +
    `• Date of Birth: ${dobStr} (Age: ${age})\n` +
    `• Sex: ${sex}\n` +
    `• Location: ${location}\n` +
    `• Phone: ${phone}\n` +
    `• National ID: ${idNumber}\n` +
    `• Computer Skills: ${computer}\n` +
    (medical ? `• Health notes: ${medical}\n` : "") +
    `\nI confirm I am willing to work from 7 AM to 6 PM and I am happy with the transport and food subsidy. ` +
    `I am excited about the opportunity to grow with VUE Auto Parts.\n\n` +
    `Regards,\n${firstName} ${lastName}`;

  if (!apiKey) return sendJson(response, 200, { ok: true, draft: fallback });

  const prompt = `You are helping a job applicant write a short, professional application message for VUE Auto Parts, an auto parts shop in Chipinge, Zimbabwe. The message should be warm, genuine, and brief — 3 to 5 sentences. Do not include subject lines or greetings like "Dear Sir/Madam". Just the message body. Use the applicant's real details naturally.

Applicant details:
- Role applied for: ${role}
- Full name: ${firstName} ${lastName}
- Date of birth: ${dobStr} (Age: ${age})
- Sex: ${sex}
- Location: ${location}
- Phone: ${phone}
- National ID: ${idNumber}
- Computer skills: ${computer}
- Medical notes: ${medical || "None"}

The message should confirm they are available 7 AM–6 PM, are happy with transport and food subsidy, and are eager to grow with the company. Return ONLY the message body, no subject, no sign-off label.`;

  try {
    const gr = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.6, max_tokens: 250,
        messages: [{ role: "user", content: prompt }] }),
    });
    if (!gr.ok) return sendJson(response, 200, { ok: true, draft: fallback });
    const data = await gr.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    const full = (text || fallback) + `\n\nSigned: ${firstName} ${lastName} | ID: ${idNumber} | Phone: ${phone}`;
    return sendJson(response, 200, { ok: true, draft: full });
  } catch (err) {
    console.error("[jobs-draft] error:", err.message);
    return sendJson(response, 200, { ok: true, draft: fallback });
  }
}

async function handleJobsApply(request, response) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[jobs-apply] RESEND_API_KEY not set");
    return sendJson(response, 500, { ok: false, error: "Email service not configured." });
  }

  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch (e) {
    if (e.code === "BODY_TOO_LARGE") {
      return sendJson(response, 413, { ok: false, error: "Your ID photo is too large. Please use a smaller image and try again." });
    }
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const {
    role, firstName, lastName, dobMonth, dobDay, dobYear, age,
    sex, location, phone, idNumber, computer, medical,
    signature, draft, idPhotoBase64, idPhotoName,
  } = body;

  if (!firstName || !lastName || !role || !signature) {
    return sendJson(response, 400, { ok: false, error: "Required fields missing." });
  }

  if (sex && !["Male", "Female"].includes(sex)) {
    return sendJson(response, 400, { ok: false, error: "Gender must be Male or Female." });
  }

  const dobStr = `${dobMonth}/${dobDay}/${dobYear}`;
  const computerLabel = computer === "Yes" ? "Yes" : computer === "Learning" ? "Willing to learn" : "Not yet";

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#062f22 0%,#0f4f36 60%,#1a6b4a 100%);padding:24px 28px 20px;border-radius:8px 8px 0 0">
        <div style="font-size:10px;font-weight:800;letter-spacing:2.5px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:8px">VUE AUTO PARTS &nbsp;·&nbsp; CAREERS</div>
        <h2 style="color:#fff;margin:0;font-size:20px;font-weight:900">New Job Application</h2>
        <p style="color:rgba(255,255,255,0.55);margin:4px 0 0;font-size:13px">Received via the VUE Auto Parts website</p>
      </div>
      <div style="background:#f9f9f9;padding:20px 28px;border-left:1px solid #eee;border-right:1px solid #eee">
        <div style="display:inline-block;background:#d1fae5;color:#065f46;font-size:11px;font-weight:800;letter-spacing:1px;padding:4px 12px;border-radius:999px;text-transform:uppercase;margin-bottom:16px">${role}</div>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr><td style="padding:7px 0;color:#666;width:140px;font-weight:600;vertical-align:top">Full Name</td><td style="padding:7px 0;font-weight:700">${firstName} ${lastName}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Date of Birth</td><td style="padding:7px 0;font-weight:700">${dobStr} &nbsp;<span style="color:#888;font-weight:500">(Age ${age})</span></td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Sex</td><td style="padding:7px 0;font-weight:700">${sex}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Location</td><td style="padding:7px 0;font-weight:700">${location}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Phone</td><td style="padding:7px 0;font-weight:700">${phone}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">National ID</td><td style="padding:7px 0;font-weight:700;font-family:'Courier New',monospace">${idNumber}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Computer Skills</td><td style="padding:7px 0;font-weight:700">${computerLabel}</td></tr>
          ${medical ? `<tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Health Notes</td><td style="padding:7px 0;font-weight:700">${medical}</td></tr>` : ""}
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Signed By</td><td style="padding:7px 0;font-weight:700;color:#0f4f36">${signature}</td></tr>
        </table>
      </div>
      <div style="background:#fff;padding:20px 28px;border:1px solid #eee;border-top:none">
        <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#6b7280;text-transform:uppercase;margin-bottom:10px">Application Message</div>
        <p style="color:#333;font-size:14px;line-height:1.7;margin:0;white-space:pre-wrap">${draft}</p>
      </div>
      ${idPhotoBase64 ? `<div style="background:#f9f9f9;padding:16px 28px 20px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
        <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#6b7280;text-transform:uppercase;margin-bottom:10px">National ID Photo</div>
        <p style="color:#888;font-size:12px;margin:0">The ID photo is attached to this email.</p>
      </div>` : ""}
    </div>
  `;

  const text = `New Job Application\n\nRole: ${role}\nName: ${firstName} ${lastName}\nDOB: ${dobStr} (Age ${age})\nSex: ${sex}\nLocation: ${location}\nPhone: ${phone}\nID: ${idNumber}\nComputer: ${computerLabel}\n${medical ? "Health: " + medical + "\n" : ""}Signed: ${signature}\n\n${draft}`;

  const emailBody = {
    from: "VUE Auto Parts <onboarding@resend.dev>",
    to: ["info@vueautoparts.com"],
    subject: `Job Application: ${role} — ${firstName} ${lastName}`,
    html,
    text,
  };

  if (idPhotoBase64 && idPhotoName) {
    const ext = (idPhotoName.split(".").pop() || "jpg").toLowerCase();
    const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    emailBody.attachments = [{
      filename: `national-id-${firstName.toLowerCase()}-${lastName.toLowerCase()}.${ext}`,
      content: idPhotoBase64,
    }];
  }

  // ── 1. Save to DB first — this is the primary record ───────────────
  let savedId = null;
  try {
    const dbRes = await pool.query(
      `INSERT INTO job_applications
       (first_name, last_name, id_number, dob, dob_month, dob_day, dob_year, age,
        phone, email, sex, location, role, computer_skills, medical, signature, draft, id_photo_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        String(firstName).trim(),
        String(lastName).trim(),
        String(idNumber  || "").trim(),
        dobStr,
        String(dobMonth  || ""),
        String(dobDay    || ""),
        String(dobYear   || ""),
        age ? parseInt(age) : null,
        String(phone     || "").trim(),
        String(body.email || "").trim().toLowerCase(),
        String(sex       || "").trim(),
        String(location  || "").trim(),
        String(role).trim(),
        String(computer  || "").trim(),
        String(medical   || "").trim(),
        String(signature || "").trim(),
        String(draft     || "").trim().slice(0, 3000),
        String(idPhotoName || "").trim(),
      ]
    );
    savedId = dbRes.rows[0].id;
    console.log(`[jobs-apply] saved to DB id=${savedId}: ${firstName} ${lastName} | ${role}`);
  } catch (dbErr) {
    console.error("[jobs-apply] DB save error:", dbErr.message);
    return sendJson(response, 500, { ok: false, error: "Could not save your application. Please try again or contact us on WhatsApp." });
  }

  // ── 2. Fire-and-forget admin notification email ──────────────────────
  fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(emailBody),
  }).then(r => {
    if (r.ok) console.log(`[jobs-apply] admin email sent for id=${savedId}`);
    else r.text().then(t => console.error("[jobs-apply] admin email error:", r.status, t));
  }).catch(e => console.error("[jobs-apply] admin email fetch error:", e.message));

  // ── 3. Fire-and-forget applicant confirmation email ──────────────────
  const applicantEmail = String(body.email || "").trim().toLowerCase();
  if (applicantEmail) {
    const statusUrl = "https://vueautoparts.com";
    const confirmHtml = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#062f22 0%,#0f4f36 60%,#1a6b4a 100%);padding:24px 28px 20px;border-radius:8px 8px 0 0">
          <div style="font-size:9px;font-weight:800;letter-spacing:2.5px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:6px">VUE AUTO PARTS &nbsp;·&nbsp; CAREERS</div>
          <h2 style="color:#fff;margin:0;font-size:19px;font-weight:900">We received your application</h2>
        </div>
        <div style="background:#fff;padding:24px 28px;border:1px solid #eee;border-top:none">
          <p style="color:#222;font-size:15px;font-weight:700;margin:0 0 6px">Hi ${firstName},</p>
          <p style="color:#444;font-size:14px;line-height:1.75;margin:0 0 18px">
            Thank you for applying for the <strong>${role}</strong> position at VUE Auto Parts. We have received your application and it is now under review. Our director will make a decision and we will be in touch.
          </p>
          <p style="color:#444;font-size:14px;line-height:1.75;margin:0 0 22px">
            You can check the status of your application at any time by visiting our website and clicking <strong>"Check application status"</strong>.
          </p>
          <a href="${statusUrl}" style="display:inline-block;background:#0f4f36;color:#fff;font-size:13px;font-weight:700;padding:11px 22px;border-radius:8px;text-decoration:none">Check My Application Status →</a>
        </div>
        <div style="background:#f9f9f9;padding:14px 28px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
          <p style="color:#9ca3af;font-size:11px;margin:0;line-height:1.6">
            VUE Auto Parts &nbsp;·&nbsp; Chipinge, Manicaland, Zimbabwe<br>
            Questions? WhatsApp us at <a href="https://wa.me/16038662272" style="color:#0f4f36">+16038662272</a> &nbsp;·&nbsp; info@vueautoparts.com
          </p>
        </div>
      </div>`;
    const confirmText = `Hi ${firstName},\n\nThank you for applying for the ${role} position at VUE Auto Parts. We have received your application and it is now under review.\n\nTo check your application status, visit:\n${statusUrl}\n\nScroll down to the careers section and click "Check application status".\n\n— VUE Auto Parts, Chipinge, Zimbabwe`;
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VUE Auto Parts <onboarding@resend.dev>",
        to: [applicantEmail],
        subject: `Application received — ${role} at VUE Auto Parts`,
        html: confirmHtml,
        text: confirmText,
      }),
    }).then(r => {
      if (r.ok) console.log(`[jobs-apply] confirmation sent to ${applicantEmail}`);
      else r.text().then(t => console.error("[jobs-apply] confirm email error:", r.status, t));
    }).catch(e => console.error("[jobs-apply] confirm email fetch error:", e.message));
  }

  return sendJson(response, 200, { ok: true });
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
  try {
    const res = await pool.query(
      `INSERT INTO rewards_cards (serial, name, phone, issued_by, issued_by_role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        String(serial).trim(),
        String(customerName).trim(),
        String(phone).trim(),
        String(staffName  || "").trim(),
        String(staffRole  || "").trim(),
      ]
    );
    const card = { ...rowToCard(res.rows[0]), rewardOwed: 0 };
    return sendJson(response, 200, { ok: true, card });
  } catch (err) {
    if (err.code === "23505") return sendJson(response, 400, { ok: false, error: "Card serial already registered." });
    throw err;
  }
}

async function handleRewardsLookup(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const q = String(body.query || "").trim();
  if (!q) return sendJson(response, 400, { ok: false, error: "Search query is required." });
  const digits = q.replace(/\D/g, "");
  const pattern = `%${q.toLowerCase()}%`;
  const res = await pool.query(
    `SELECT * FROM rewards_cards
     WHERE LOWER(serial) LIKE $1
        OR LOWER(name)   LIKE $1
        OR (LENGTH($2) > 0 AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE $3)
     ORDER BY issued_date DESC`,
    [pattern, digits, `%${digits}%`]
  );
  const cards = res.rows.map(r => ({ ...rowToCard(r), rewardOwed: calcReward(r.referrals, r.purchases) }));
  return sendJson(response, 200, { ok: true, cards });
}

async function handleRewardsAdd(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, type, count } = body;
  if (!serial || !type) return sendJson(response, 400, { ok: false, error: "Serial and type required." });
  const n = Math.max(1, Math.min(10, parseInt(count) || 1));
  const col = type === "referral" ? "referrals" : type === "purchase" ? "purchases" : null;
  if (!col) return sendJson(response, 400, { ok: false, error: "Type must be referral or purchase." });
  const res = await pool.query(
    `UPDATE rewards_cards SET ${col} = ${col} + $1
     WHERE serial = $2 AND status = 'active'
     RETURNING *`,
    [n, String(serial).trim()]
  );
  if (res.rowCount === 0) {
    const exists = await pool.query("SELECT status FROM rewards_cards WHERE serial = $1", [serial]);
    if (exists.rowCount === 0) return sendJson(response, 404, { ok: false, error: "Card not found." });
    return sendJson(response, 400, { ok: false, error: "Card is not active." });
  }
  const card = { ...rowToCard(res.rows[0]), rewardOwed: calcReward(res.rows[0].referrals, res.rows[0].purchases) };
  return sendJson(response, 200, { ok: true, card });
}

async function handleRewardsRevoke(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, revokedBy, reason } = body;
  if (!serial) return sendJson(response, 400, { ok: false, error: "Serial required." });
  const res = await pool.query(
    `UPDATE rewards_cards
     SET status = 'revoked', revoked_by = $1, revoke_reason = $2, revoked_date = NOW()
     WHERE serial = $3
     RETURNING *`,
    [
      String(revokedBy || "").trim(),
      String(reason    || "Policy violation").trim(),
      String(serial).trim(),
    ]
  );
  if (res.rowCount === 0) return sendJson(response, 404, { ok: false, error: "Card not found." });
  return sendJson(response, 200, { ok: true });
}

async function handleRewardsRenew(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, renewedBy } = body;
  if (!serial) return sendJson(response, 400, { ok: false, error: "Serial required." });
  const check = await pool.query("SELECT * FROM rewards_cards WHERE serial = $1", [String(serial).trim()]);
  if (check.rowCount === 0) return sendJson(response, 404, { ok: false, error: "Card not found." });
  const current = check.rows[0];
  if (current.status === "active") return sendJson(response, 400, { ok: false, error: "Card is already active." });
  const wasPaid = current.status === "paid";
  const res = await pool.query(
    `UPDATE rewards_cards
     SET status = 'active',
         renewed_date  = NOW(),
         revoked_by    = NULL,
         revoke_reason = NULL,
         revoked_date  = NULL,
         referrals     = CASE WHEN $1 THEN 0 ELSE referrals END,
         purchases     = CASE WHEN $1 THEN 0 ELSE purchases END,
         paid_date     = CASE WHEN $1 THEN NULL ELSE paid_date END,
         paid_amount   = CASE WHEN $1 THEN NULL ELSE paid_amount END
     WHERE serial = $2
     RETURNING *`,
    [wasPaid, String(serial).trim()]
  );
  const card = { ...rowToCard(res.rows[0]), rewardOwed: calcReward(res.rows[0].referrals, res.rows[0].purchases) };
  return sendJson(response, 200, { ok: true, card });
}

async function handleRewardsPay(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const { serial, paidBy } = body;
  if (!serial) return sendJson(response, 400, { ok: false, error: "Serial required." });
  const check = await pool.query("SELECT * FROM rewards_cards WHERE serial = $1", [String(serial).trim()]);
  if (check.rowCount === 0) return sendJson(response, 404, { ok: false, error: "Card not found." });
  const amount = calcReward(check.rows[0].referrals, check.rows[0].purchases);
  if (amount === 0) return sendJson(response, 400, { ok: false, error: "No reward owed on this card." });
  await pool.query(
    `UPDATE rewards_cards
     SET status = 'paid',
         paid_date     = NOW(),
         paid_amount   = $1,
         revoked_by    = $2,
         revoked_date  = NOW(),
         revoke_reason = 'Reward paid out — card auto-revoked.'
     WHERE serial = $3`,
    [amount, String(paidBy || "").trim(), String(serial).trim()]
  );
  return sendJson(response, 200, { ok: true, amount });
}

async function verifyDirector(body) {
  const firstName = String(body.directorFirst || "").trim().toLowerCase();
  const lastName  = String(body.directorLast  || "").trim().toLowerCase();
  const id        = normalizeId(String(body.directorId   || "").trim());
  const role      = String(body.directorRole  || "").trim().toLowerCase();
  if (!firstName || !lastName || !id) return null;
  try {
    const res = await fetch(STAFF_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const csv  = await res.text();
    const rows = parseCsv(csv);
    const hdrs = rows[0] || [];
    const idx  = {
      firstName: hdrs.findIndex(h => h.trim().toLowerCase() === "first name"),
      lastName:  hdrs.findIndex(h => h.trim().toLowerCase() === "last name"),
      id:        hdrs.findIndex(h => h.trim().toLowerCase() === "id"),
      role:      hdrs.findIndex(h => h.trim().toLowerCase() === "role"),
    };
    const list = rows.slice(1).map(r => ({
      firstName: (r[idx.firstName] || "").trim(),
      lastName:  (r[idx.lastName]  || "").trim(),
      id:        (r[idx.id]        || "").trim(),
      role:      (r[idx.role]      || "").trim(),
    })).filter(s => s.firstName || s.lastName);
    const match = list.find(s =>
      s.firstName.toLowerCase() === firstName &&
      s.lastName.toLowerCase()  === lastName  &&
      normalizeId(s.id)         === id        &&
      s.role.toLowerCase()      === role
    );
    if (!match) return null;
    if (!["director", "admin", "manager"].includes(match.role.toLowerCase())) return null;
    return match;
  } catch { return null; }
}

function generateLetterPdf(app, type) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: "A4", margins: { top: 72, bottom: 72, left: 72, right: 72 } });
    const chunks = [];
    doc.on("data",  c => chunks.push(c));
    doc.on("end",   ()  => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GREEN = "#0f4f36";
    const GOLD  = "#b8902a";
    const GREY  = "#555555";
    const W     = 595 - 144;

    doc.rect(72, 72, W, 4).fill(GREEN);
    doc.moveDown(0.6);
    doc.fontSize(18).font("Helvetica-Bold").fillColor(GREEN).text("VUE AUTO PARTS", { align: "center" });
    doc.fontSize(9).font("Helvetica").fillColor(GREY)
       .text("Chipinge, Manicaland, Zimbabwe  ·  info@vueautoparts.com  ·  vueautoparts.com", { align: "center" });
    doc.moveDown(0.4);
    doc.rect(72, doc.y, W, 1).fill(GOLD);
    doc.moveDown(1.2);

    const dateStr = new Date().toLocaleDateString("en-ZW", { day: "numeric", month: "long", year: "numeric" });
    doc.fontSize(10).font("Helvetica").fillColor("#000").text(dateStr, { align: "right" });
    doc.moveDown(0.8);

    doc.fontSize(10).font("Helvetica-Bold").fillColor("#000")
       .text(`${app.first_name} ${app.last_name}`);
    doc.font("Helvetica").fillColor(GREY)
       .text(app.location || "Zimbabwe");
    doc.moveDown(1);

    const isApproved = type === "approved";
    const refLine    = `RE: Job Application — ${app.role}`;

    doc.fontSize(10).font("Helvetica-Bold").fillColor(GREEN).text(refLine);
    doc.moveDown(0.6);
    doc.fontSize(10).font("Helvetica").fillColor("#000").text(`Dear ${app.first_name},`);
    doc.moveDown(0.6);

    if (isApproved) {
      doc.text(
        `We are pleased to inform you that your application for the position of ${app.role} at VUE Auto Parts ` +
        `has been reviewed and, after careful consideration, we are delighted to offer you this role.`,
        { lineGap: 3 }
      );
      doc.moveDown(0.6);
      doc.text(
        `We were impressed by your commitment to joining our team and by the information provided in your application. ` +
        `A member of our team will be in contact with you shortly to confirm your start date and any further arrangements. ` +
        `Please bring your original National ID and any relevant documents on your first day of work.`,
        { lineGap: 3 }
      );
      doc.moveDown(0.6);
      doc.text(
        `Salaries at VUE Auto Parts grow with the company's performance, and we look forward to building something great together. ` +
        `Congratulations, and welcome to the VUE Auto Parts family.`,
        { lineGap: 3 }
      );
    } else {
      doc.text(
        `Thank you sincerely for taking the time to apply for the position of ${app.role} at VUE Auto Parts. ` +
        `We genuinely appreciate your interest in joining our team and the effort you put into your application.`,
        { lineGap: 3 }
      );
      doc.moveDown(0.6);
      doc.text(
        `After careful consideration of all applications received, we regret to inform you that we are unable to offer ` +
        `you this particular position at this time. Please know that this decision was not made lightly, and it does not ` +
        `reflect negatively on your character or potential.`,
        { lineGap: 3 }
      );
      doc.moveDown(0.6);
      doc.text(
        `We encourage you to continue pursuing your aspirations with confidence. Should further opportunities arise at ` +
        `VUE Auto Parts, we sincerely hope you will consider applying again. We wish you every success in your future endeavours.`,
        { lineGap: 3 }
      );
    }

    doc.moveDown(1);
    doc.text("Yours " + (isApproved ? "sincerely" : "respectfully") + ",");
    doc.moveDown(0.4);
    doc.rect(72, doc.y, 120, 1).fill(GREY); doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fillColor("#000").text("Samuel Takwirira");
    doc.font("Helvetica").fillColor(GREY).fontSize(9).text("Director");
    doc.text("VUE Auto Parts, Chipinge, Zimbabwe");

    const footerY = 595 + 72 + 4;
    doc.rect(72, footerY, W, 1).fill(GREEN);

    doc.end();
  });
}

async function handleJobsStatus(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const { firstName, lastName, idNumber, dobMonth, dobDay, dobYear } = body;
  if (!firstName || !lastName || !idNumber || !dobMonth || !dobDay || !dobYear) {
    return sendJson(response, 400, { ok: false, error: "All fields are required." });
  }

  const res = await pool.query(
    `SELECT id, first_name, last_name, role, status, letter_published, created_at
     FROM job_applications
     WHERE LOWER(first_name) = LOWER($1)
       AND LOWER(last_name)  = LOWER($2)
       AND LOWER(REPLACE(id_number, '-', '')) = LOWER(REPLACE($3, '-', ''))
       AND dob_month = $4 AND dob_day = $5 AND dob_year = $6
     ORDER BY created_at DESC
     LIMIT 1`,
    [firstName.trim(), lastName.trim(), idNumber.trim(),
     String(dobMonth), String(dobDay), String(dobYear)]
  );

  if (res.rowCount === 0) {
    return sendJson(response, 200, { ok: false, error: "No application found matching those details. Please check your information and try again." });
  }

  const row = res.rows[0];
  return sendJson(response, 200, {
    ok: true,
    applicationId:    row.id,
    status:           row.status,
    role:             row.role,
    submittedAt:      row.created_at,
    letterAvailable:  row.letter_published && (row.status === "approved" || row.status === "denied"),
  });
}

async function handleJobsLetter(request, response) {
  const url    = new URL(request.url, "http://localhost");
  const appId  = parseInt(url.searchParams.get("id") || "0");
  const fn     = (url.searchParams.get("fn")  || "").trim().toLowerCase();
  const ln     = (url.searchParams.get("ln")  || "").trim().toLowerCase();
  const idn    = (url.searchParams.get("idn") || "").trim().replace(/-/g, "").toLowerCase();

  if (!appId || !fn || !ln || !idn) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    return response.end("Bad request.");
  }

  const res = await pool.query(
    `SELECT * FROM job_applications WHERE id = $1`, [appId]
  );
  if (res.rowCount === 0) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    return response.end("Application not found.");
  }

  const app = res.rows[0];
  const ok  =
    app.first_name.toLowerCase() === fn &&
    app.last_name.toLowerCase()  === ln &&
    app.id_number.replace(/-/g, "").toLowerCase() === idn;

  if (!ok) {
    response.writeHead(403, { "Content-Type": "text/plain" });
    return response.end("Verification failed.");
  }
  if (!app.letter_published) {
    response.writeHead(403, { "Content-Type": "text/plain" });
    return response.end("Letter not yet available.");
  }
  if (app.status !== "approved" && app.status !== "denied") {
    response.writeHead(403, { "Content-Type": "text/plain" });
    return response.end("No letter available.");
  }

  try {
    const pdf      = await generateLetterPdf(app, app.status);
    const safeName = `${app.first_name}_${app.last_name}`.replace(/[^a-zA-Z_]/g, "_");
    const type     = app.status === "approved" ? "Offer_Letter" : "Outcome_Letter";
    response.writeHead(200, {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="VUE_${type}_${safeName}.pdf"`,
      "Content-Length":      pdf.length,
      "Cache-Control":       "no-store",
    });
    return response.end(pdf);
  } catch (err) {
    console.error("[jobs-letter] PDF error:", err.message);
    response.writeHead(500, { "Content-Type": "text/plain" });
    return response.end("Could not generate letter.");
  }
}

/* ══════════════════════════════════════════════════════════════
   VuePay handlers
══════════════════════════════════════════════════════════════ */
async function handleVuePayConfig(request, response) {
  try {
    const r = await pool.query("SELECT receiving_number FROM vuepay_config ORDER BY id DESC LIMIT 1");
    const receivingNumber = r.rowCount > 0 ? r.rows[0].receiving_number : "";
    return sendJson(response, 200, { ok: true, receivingNumber });
  } catch (err) {
    console.error("[vuepay-config] error:", err.message);
    return sendJson(response, 500, { ok: false, error: "Could not load config." });
  }
}

async function handleVuePayUpdateConfig(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const director = await verifyDirector(body);
  if (!director) return sendJson(response, 403, { ok: false, error: "Director credentials required." });

  const receivingNumber = String(body.receivingNumber || "").trim();
  if (!receivingNumber) return sendJson(response, 400, { ok: false, error: "Receiving number is required." });

  const by = `${director.firstName} ${director.lastName}`;
  await pool.query(
    "INSERT INTO vuepay_config (receiving_number, updated_by, updated_at) VALUES ($1, $2, NOW())",
    [receivingNumber, by]
  );
  console.log(`[vuepay-config] updated to ${receivingNumber} by ${by}`);
  return sendJson(response, 200, { ok: true, receivingNumber });
}

async function handleVuePayCheckout(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const customerName  = String(body.customerName  || "").trim().slice(0, 120);
  const customerPhone = String(body.customerPhone || "").trim().slice(0, 40);
  const paymentMethod = String(body.paymentMethod || "").trim();
  const description   = String(body.description   || "").trim().slice(0, 600);
  const note          = String(body.note          || "").trim().slice(0, 300);
  const amountUsd     = parseFloat(body.amountUsd || 0) || null;

  if (!customerName || !customerPhone || !description) {
    return sendJson(response, 400, { ok: false, error: "Name, phone and description are required." });
  }
  if (!["ecocash","cash","other"].includes(paymentMethod)) {
    return sendJson(response, 400, { ok: false, error: "Invalid payment method." });
  }

  const ref = "VUE-" + Date.now().toString(36).toUpperCase().slice(-6);

  try {
    await pool.query(
      `INSERT INTO vuepay_orders
        (reference, customer_name, customer_phone, payment_method, amount_usd, items_description, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ref, customerName, customerPhone, paymentMethod, amountUsd, description, note]
    );
  } catch (err) {
    console.error("[vuepay-checkout] DB error:", err.message);
    return sendJson(response, 500, { ok: false, error: "Could not save order. Please try WhatsApp." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const methodLabel = { ecocash: "EcoCash", cash: "Cash on Delivery", other: "Other" }[paymentMethod] || paymentMethod;
    const amtStr = amountUsd ? `$${amountUsd.toFixed(2)} USD` : "TBD";
    const html = `<h2 style="margin:0 0 8px">VuePay Order — ${ref}</h2>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Customer</td><td><strong>${customerName}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Phone</td><td>${customerPhone}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Method</td><td>${methodLabel}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Amount</td><td><strong>${amtStr}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Items</td><td>${description}</td></tr>
${note ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Note</td><td>${note}</td></tr>` : ""}
</table>`;
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VUE Auto Parts <onboarding@resend.dev>",
        to: ["info@vueautoparts.com"],
        subject: `VuePay: ${ref} — ${customerName} (${methodLabel})`,
        html,
        text: `VuePay Order\n\nRef: ${ref}\nCustomer: ${customerName}\nPhone: ${customerPhone}\nMethod: ${methodLabel}\nAmount: ${amtStr}\nItems: ${description}${note ? "\nNote: " + note : ""}`,
      }),
    }).then(r => {
      if (r.ok) console.log(`[vuepay-checkout] email sent for ${ref}`);
      else r.text().then(t => console.error("[vuepay-checkout] email error:", r.status, t));
    }).catch(e => console.error("[vuepay-checkout] email error:", e.message));
  }

  return sendJson(response, 200, { ok: true, reference: ref });
}

async function handleVuePayOrders(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const director = await verifyDirector(body);
  if (!director) return sendJson(response, 403, { ok: false, error: "Director credentials required." });

  const r = await pool.query("SELECT * FROM vuepay_orders ORDER BY created_at DESC LIMIT 200");
  return sendJson(response, 200, { ok: true, orders: r.rows });
}

async function handleStaffApplicationsList(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const director = await verifyDirector(body);
  if (!director) return sendJson(response, 403, { ok: false, error: "Director credentials required." });

  const res = await pool.query(
    `SELECT id, first_name, last_name, id_number, dob, age, phone, email, sex, location,
            role, computer_skills, medical, signature, draft, id_photo_name,
            status, decision_notes, decided_by, decided_at, letter_published, published_at, created_at
     FROM job_applications
     ORDER BY created_at DESC`
  );

  return sendJson(response, 200, { ok: true, applications: res.rows });
}

async function handleStaffApplicationsDelete(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const director = await verifyDirector(body);
  if (!director) return sendJson(response, 403, { ok: false, error: "Director credentials required." });

  const { applicationId } = body;
  if (!applicationId) return sendJson(response, 400, { ok: false, error: "Application ID required." });

  const check = await pool.query(
    "SELECT id, first_name, last_name, status FROM job_applications WHERE id = $1",
    [parseInt(applicationId)]
  );
  if (check.rowCount === 0) return sendJson(response, 404, { ok: false, error: "Application not found." });

  const app = check.rows[0];
  if (app.status === "pending") {
    return sendJson(response, 400, { ok: false, error: "Only decided applications (approved or denied) can be deleted." });
  }

  await pool.query("DELETE FROM job_applications WHERE id = $1", [parseInt(applicationId)]);
  console.log(`[apps-delete] id=${applicationId} (${app.first_name} ${app.last_name}) deleted by ${director.firstName} ${director.lastName}`);
  return sendJson(response, 200, { ok: true });
}

async function handleStaffApplicationsDecide(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const director = await verifyDirector(body);
  if (!director) return sendJson(response, 403, { ok: false, error: "Director credentials required." });

  const { applicationId, decision, notes } = body;
  if (!applicationId || !decision) return sendJson(response, 400, { ok: false, error: "Application ID and decision required." });
  if (!["approved", "denied"].includes(decision)) return sendJson(response, 400, { ok: false, error: "Decision must be 'approved' or 'denied'." });

  const directorName = `${director.firstName} ${director.lastName}`;
  const res = await pool.query(
    `UPDATE job_applications
     SET status = $1, decision_notes = $2, decided_by = $3, decided_at = NOW(), letter_published = false
     WHERE id = $4
     RETURNING id, status, first_name, last_name, email, role`,
    [decision, String(notes || "").trim(), directorName, parseInt(applicationId)]
  );

  if (res.rowCount === 0) return sendJson(response, 404, { ok: false, error: "Application not found." });

  const app = res.rows[0];
  console.log(`[apps-decide] ${decision}: ${app.first_name} ${app.last_name} by ${directorName}`);

  // Fire-and-forget decision notification to the applicant
  const resendKey = process.env.RESEND_API_KEY;
  if (app.email && resendKey) {
    const statusUrl = "https://vueautoparts.com";
    const decisionHtml = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#062f22 0%,#0f4f36 60%,#1a6b4a 100%);padding:24px 28px 20px;border-radius:8px 8px 0 0">
          <div style="font-size:9px;font-weight:800;letter-spacing:2.5px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:6px">VUE AUTO PARTS &nbsp;·&nbsp; CAREERS</div>
          <h2 style="color:#fff;margin:0;font-size:19px;font-weight:900">Your application has been reviewed</h2>
        </div>
        <div style="background:#fff;padding:24px 28px;border:1px solid #eee;border-top:none">
          <p style="color:#222;font-size:15px;font-weight:700;margin:0 0 6px">Hi ${app.first_name},</p>
          <p style="color:#444;font-size:14px;line-height:1.75;margin:0 0 18px">
            A decision has been made on your application for the <strong>${app.role}</strong> position at VUE Auto Parts.
            Visit our website to see your full status and, once it is ready, download your official letter.
          </p>
          <p style="color:#444;font-size:14px;line-height:1.75;margin:0 0 22px">
            On the website, click <strong>"Check application status"</strong> and enter the details you applied with.
          </p>
          <a href="${statusUrl}" style="display:inline-block;background:#0f4f36;color:#fff;font-size:13px;font-weight:700;padding:11px 22px;border-radius:8px;text-decoration:none">Check My Status →</a>
        </div>
        <div style="background:#f9f9f9;padding:14px 28px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
          <p style="color:#9ca3af;font-size:11px;margin:0;line-height:1.6">
            VUE Auto Parts &nbsp;·&nbsp; Chipinge, Manicaland, Zimbabwe<br>
            Questions? WhatsApp us at <a href="https://wa.me/16038662272" style="color:#0f4f36">+16038662272</a> &nbsp;·&nbsp; info@vueautoparts.com
          </p>
        </div>
      </div>`;
    const decisionText = `Hi ${app.first_name},\n\nA decision has been made on your application for the ${app.role} position at VUE Auto Parts.\n\nTo see your full status and download your letter when it is ready, visit:\n${statusUrl}\n\nClick "Check application status" and enter your name, ID number and date of birth.\n\n— VUE Auto Parts, Chipinge, Zimbabwe`;
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VUE Auto Parts <onboarding@resend.dev>",
        to: [app.email],
        subject: `Your ${app.role} application has been reviewed — VUE Auto Parts`,
        html: decisionHtml,
        text: decisionText,
      }),
    }).then(r => {
      if (r.ok) console.log(`[apps-decide] notification sent to ${app.email}`);
      else r.text().then(t => console.error("[apps-decide] notify error:", r.status, t));
    }).catch(e => console.error("[apps-decide] notify fetch error:", e.message));
  }

  return sendJson(response, 200, { ok: true, application: app });
}

async function handleStaffApplicationsPublish(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const director = await verifyDirector(body);
  if (!director) return sendJson(response, 403, { ok: false, error: "Director credentials required." });

  const { applicationId } = body;
  if (!applicationId) return sendJson(response, 400, { ok: false, error: "Application ID required." });

  const check = await pool.query("SELECT * FROM job_applications WHERE id = $1", [parseInt(applicationId)]);
  if (check.rowCount === 0) return sendJson(response, 404, { ok: false, error: "Application not found." });

  const app = check.rows[0];
  if (app.status !== "approved" && app.status !== "denied") {
    return sendJson(response, 400, { ok: false, error: "Application must be decided before publishing the letter." });
  }

  try {
    const pdf = await generateLetterPdf(app, app.status);
    const preview = {
      size:     pdf.length,
      filename: `VUE_${app.status === "approved" ? "Offer" : "Outcome"}_Letter_${app.first_name}_${app.last_name}.pdf`,
    };
    await pool.query(
      `UPDATE job_applications SET letter_published = true, published_at = NOW() WHERE id = $1`,
      [parseInt(applicationId)]
    );
    console.log(`[apps-publish] letter published for app ${applicationId} by ${director.firstName} ${director.lastName}`);

    if (app.email) {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const isApproved  = app.status === "approved";
        const letterType  = isApproved ? "Offer Letter" : "Application Outcome";
        const notifSubject = isApproved
          ? `Your VUE Auto Parts Job Application — Great News!`
          : `Your VUE Auto Parts Application — Update Available`;
        const notifHtml = `
          <div style="font-family:sans-serif;max-width:540px;margin:0 auto">
            <div style="background:linear-gradient(135deg,#062f22 0%,#0f4f36 100%);padding:22px 28px 18px;border-radius:8px 8px 0 0">
              <div style="font-size:9px;font-weight:800;letter-spacing:2.5px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:6px">VUE AUTO PARTS · CAREERS</div>
              <h2 style="color:#fff;margin:0;font-size:18px;font-weight:900">Your Application Letter is Ready</h2>
            </div>
            <div style="background:#fff;padding:22px 28px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
              <p style="color:#333;font-size:14px;line-height:1.7;margin:0 0 16px">Dear <strong>${app.first_name}</strong>,</p>
              <p style="color:#333;font-size:14px;line-height:1.7;margin:0 0 16px">
                ${isApproved
                  ? `We are delighted to let you know that your <strong>${app.role}</strong> application at VUE Auto Parts has been reviewed and your <strong>Offer Letter</strong> is now available for download.`
                  : `Your application for the <strong>${app.role}</strong> position at VUE Auto Parts has been reviewed. Your <strong>${letterType}</strong> is now available for download.`}
              </p>
              <p style="color:#333;font-size:14px;line-height:1.7;margin:0 0 20px">
                To view your letter, visit the VUE Auto Parts website, click <em>"Check application status"</em>, and enter your details.
              </p>
              <a href="https://vueautoparts.com" style="display:inline-block;background:#0f4f36;color:#fff;font-size:13px;font-weight:700;padding:11px 20px;border-radius:8px;text-decoration:none">Check My Status →</a>
              <p style="color:#9ca3af;font-size:11px;margin-top:20px;line-height:1.6">
                VUE Auto Parts · Chipinge, Manicaland, Zimbabwe<br>
                info@vueautoparts.com · vueautoparts.com
              </p>
            </div>
          </div>`;
        fetch("https://api.resend.com/emails", {
          method:  "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from:    "VUE Auto Parts <onboarding@resend.dev>",
            to:      [app.email],
            subject: notifSubject,
            html:    notifHtml,
            text:    `Dear ${app.first_name},\n\nYour ${letterType} for the ${app.role} position at VUE Auto Parts is now available.\n\nVisit the website and click "Check application status" to download your letter.\n\nvueautoparts.com\n\n— VUE Auto Parts, Chipinge, Zimbabwe`,
          }),
        }).then(r => {
          if (r.ok) console.log(`[apps-publish] notification sent to ${app.email}`);
          else r.text().then(t => console.error("[apps-publish] notify error:", r.status, t));
        }).catch(e => console.error("[apps-publish] notify fetch error:", e.message));
      }
    }

    return sendJson(response, 200, { ok: true, preview, notified: !!app.email });
  } catch (err) {
    console.error("[apps-publish] PDF error:", err.message);
    return sendJson(response, 500, { ok: false, error: "Could not generate letter preview." });
  }
}

async function handleStaffApplicationsPreviewPdf(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const director = await verifyDirector(body);
  if (!director) return sendJson(response, 403, { ok: false, error: "Director credentials required." });

  const { applicationId } = body;
  if (!applicationId) return sendJson(response, 400, { ok: false, error: "Application ID required." });

  const res = await pool.query("SELECT * FROM job_applications WHERE id = $1", [parseInt(applicationId)]);
  if (res.rowCount === 0) {
    response.writeHead(404, { "Content-Type": "text/plain" }); return response.end("Not found.");
  }
  const app = res.rows[0];
  if (app.status !== "approved" && app.status !== "denied") {
    response.writeHead(400, { "Content-Type": "text/plain" }); return response.end("Not decided yet.");
  }
  try {
    const pdf = await generateLetterPdf(app, app.status);
    response.writeHead(200, {
      "Content-Type":        "application/pdf",
      "Content-Disposition": "inline",
      "Content-Length":      pdf.length,
      "Cache-Control":       "no-store",
    });
    return response.end(pdf);
  } catch (err) {
    response.writeHead(500, { "Content-Type": "text/plain" }); return response.end("PDF error.");
  }
}

async function handleInsightsRun(request, response) {
  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }
  const type = String(body.type || "daily");
  try {
    const result = type === "monthly"
      ? await insights.runMonthlyInsights()
      : type === "weekly"
      ? await insights.runWeeklyInsights()
      : await insights.runDailyInsights();
    return sendJson(response, 200, result);
  } catch (err) {
    console.error("[insights-run] error:", err.message);
    return sendJson(response, 500, { ok: false, error: err.message });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/ask") {
      return await handleAsk(request, response);
    }
    if (request.method === "POST" && request.url === "/api/part-request") {
      return await handlePartRequest(request, response);
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
    if (request.method === "POST" && request.url === "/api/insights-run") {
      return await handleInsightsRun(request, response);
    }
    if (request.method === "POST" && request.url === "/api/jobs-draft") {
      return await handleJobsDraft(request, response);
    }
    if (request.method === "POST" && request.url === "/api/jobs-apply") {
      return await handleJobsApply(request, response);
    }
    if (request.method === "POST" && request.url === "/api/jobs-status") {
      return await handleJobsStatus(request, response);
    }
    if (request.method === "GET" && request.url.startsWith("/api/jobs/letter")) {
      return await handleJobsLetter(request, response);
    }
    if (request.method === "GET"  && request.url === "/api/vuepay/config") {
      return await handleVuePayConfig(request, response);
    }
    if (request.method === "POST" && request.url === "/api/vuepay/update-config") {
      return await handleVuePayUpdateConfig(request, response);
    }
    if (request.method === "POST" && request.url === "/api/vuepay/checkout") {
      return await handleVuePayCheckout(request, response);
    }
    if (request.method === "POST" && request.url === "/api/vuepay/orders") {
      return await handleVuePayOrders(request, response);
    }
    if (request.method === "POST" && request.url === "/api/staff/applications") {
      return await handleStaffApplicationsList(request, response);
    }
    if (request.method === "POST" && request.url === "/api/staff/applications/decide") {
      return await handleStaffApplicationsDecide(request, response);
    }
    if (request.method === "POST" && request.url === "/api/staff/applications/publish") {
      return await handleStaffApplicationsPublish(request, response);
    }
    if (request.method === "POST" && request.url === "/api/staff/applications/preview-pdf") {
      return await handleStaffApplicationsPreviewPdf(request, response);
    }
    if (request.method === "POST" && request.url === "/api/staff/applications/delete") {
      return await handleStaffApplicationsDelete(request, response);
    }
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
      return;
    }
    return await serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 500, WHATSAPP_FALLBACK);
  }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS part_requests (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      phone      TEXT,
      vehicle    TEXT NOT NULL,
      part       TEXT NOT NULL,
      note       TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_applications (
      id              SERIAL PRIMARY KEY,
      first_name      TEXT NOT NULL,
      last_name       TEXT NOT NULL,
      id_number       TEXT NOT NULL,
      dob             TEXT NOT NULL,
      dob_month       TEXT,
      dob_day         TEXT,
      dob_year        TEXT,
      age             INTEGER,
      phone           TEXT,
      sex             TEXT,
      location        TEXT,
      role            TEXT NOT NULL,
      computer_skills TEXT,
      medical         TEXT,
      signature       TEXT,
      draft           TEXT,
      id_photo_name   TEXT,
      email           TEXT,
      status          TEXT DEFAULT 'pending',
      decision_notes  TEXT,
      decided_by      TEXT,
      decided_at      TIMESTAMPTZ,
      letter_published BOOLEAN DEFAULT false,
      published_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS email TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS id_photo_base64 TEXT`).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rewards_cards (
      id             SERIAL PRIMARY KEY,
      serial         TEXT NOT NULL UNIQUE,
      name           TEXT NOT NULL,
      phone          TEXT NOT NULL,
      issued_by      TEXT DEFAULT '',
      issued_by_role TEXT DEFAULT '',
      issued_date    TIMESTAMPTZ DEFAULT NOW(),
      status         TEXT DEFAULT 'active',
      referrals      INTEGER DEFAULT 0,
      purchases      INTEGER DEFAULT 0,
      revoked_by     TEXT,
      revoke_reason  TEXT,
      revoked_date   TIMESTAMPTZ,
      renewed_date   TIMESTAMPTZ,
      paid_date      TIMESTAMPTZ,
      paid_amount    NUMERIC
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vuepay_config (
      id               SERIAL PRIMARY KEY,
      receiving_number TEXT NOT NULL,
      updated_by       TEXT DEFAULT '',
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vuepay_orders (
      id               SERIAL PRIMARY KEY,
      reference        TEXT NOT NULL UNIQUE,
      customer_name    TEXT NOT NULL,
      customer_phone   TEXT NOT NULL,
      payment_method   TEXT NOT NULL,
      amount_usd       NUMERIC,
      items_description TEXT NOT NULL,
      note             TEXT,
      status           TEXT DEFAULT 'pending',
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

initDb()
  .catch(err => console.error("[initDb] error:", err.message))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`VUE Auto Parts listening on ${PORT}`);
      insights.startScheduler();
    });
  });
