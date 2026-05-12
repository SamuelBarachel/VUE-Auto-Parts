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
  return `You are the Vue Auto Parts assistant — a friendly, sharp customer support agent based in Chipinge, Zimbabwe. You help drivers find the right parts, get prices, and connect with the shop.

PERSONALITY:
- Warm, confident and direct. Like a knowledgeable friend at a parts counter.
- Keep responses concise — 1 to 3 sentences unless more detail is genuinely needed.
- Sound human. Vary your phrasing. Never be stiff or robotic.
- Respond naturally to the flow of the conversation — don't reset the topic after every message.

SHOP FACTS:
- Name: Vue Auto Parts
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
- NEVER mention, suggest, or reference any other shop, competitor, or alternative supplier — not even vaguely. You represent Vue Auto Parts exclusively.
- NEVER say things like "you could check other shops", "try elsewhere", "compare prices", or anything that directs a customer away from us.
- If something is not in stock or you are unsure, ALWAYS direct the customer to WhatsApp (+16038662272) — not to look elsewhere.
- You are a loyal representative of Vue Auto Parts. Your job is to keep customers with us and help them through us.

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
    const fallback = `Hi Vue Auto Parts,\n\nMy name is ${name}${phone ? ` and my contact number is ${phone}` : ""}. I'm looking for ${part} for my ${vehicle}.\n\nPlease let me know if you have it in stock and the price. Thank you.`;
    return sendJson(response, 200, { ok: true, draft: fallback });
  }

  const prompt = `Write a short, natural, friendly enquiry message from a customer to an auto parts shop called Vue Auto Parts in Chipinge, Zimbabwe. Keep it conversational and genuine — like a real person texting a shop, not a formal letter. 2-4 sentences max.

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
      const fallback = `Hi Vue Auto Parts,\n\nMy name is ${name}${phone ? ` and my contact number is ${phone}` : ""}. I'm looking for ${part} for my ${vehicle}.\n\nPlease let me know if you have it in stock and the price. Thank you.`;
      return sendJson(response, 200, { ok: true, draft: fallback });
    }

    const data = await groqRes.json();
    const draft = data.choices?.[0]?.message?.content?.trim() || "";
    return sendJson(response, 200, { ok: true, draft: draft || `Hi, I'm ${name} and I'm looking for ${part} for my ${vehicle}. Please contact me on ${phone}.` });
  } catch (err) {
    console.error("[draft] error:", err.message);
    const fallback = `Hi Vue Auto Parts,\n\nMy name is ${name}${phone ? ` and my number is ${phone}` : ""}. I need ${part} for my ${vehicle}. Please let me know price and availability.`;
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
        from: "Vue Auto Parts <onboarding@resend.dev>",
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
        <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px">Vue Auto Parts website</p>
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
        from: "Vue Auto Parts <onboarding@resend.dev>",
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

  const fallback = `Hi Vue Auto Parts,\n\nMy name is ${name} and I live in ${location}. My phone number is ${phone} and my ID number is ${idNumber}.\n\nI would like to register for the referral rewards programme. Please let me know the next steps. Thank you.`;

  if (!apiKey) return sendJson(response, 200, { ok: true, draft: fallback });

  const prompt = `Write a short, natural, friendly message from a customer who wants to join the Vue Auto Parts referral rewards programme in Chipinge, Zimbabwe. The programme pays $5 for 5 referrals and $10 for 15+ referrals. Keep it conversational and genuine — like a real person texting, not a formal letter. 2–4 sentences max. Include all the details naturally.

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
        <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px">Vue Auto Parts referral programme</p>
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
        from: "Vue Auto Parts <onboarding@resend.dev>",
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
    `Dear Vue Auto Parts Management,\n\n` +
    `I, ${firstName} ${lastName}, would like to apply for the position of ${role} at Vue Auto Parts, Chipinge.\n\n` +
    `Personal Details:\n` +
    `• Date of Birth: ${dobStr} (Age: ${age})\n` +
    `• Sex: ${sex}\n` +
    `• Location: ${location}\n` +
    `• Phone: ${phone}\n` +
    `• National ID: ${idNumber}\n` +
    `• Computer Skills: ${computer}\n` +
    (medical ? `• Health notes: ${medical}\n` : "") +
    `\nI confirm I am willing to work from 7 AM to 6 PM and I am happy with the transport and food subsidy. ` +
    `I am excited about the opportunity to grow with Vue Auto Parts.\n\n` +
    `Regards,\n${firstName} ${lastName}`;

  if (!apiKey) return sendJson(response, 200, { ok: true, draft: fallback });

  const prompt = `You are helping a job applicant write a short, professional application message for Vue Auto Parts, an auto parts shop in Chipinge, Zimbabwe. The message should be warm, genuine, and brief — 3 to 5 sentences. Do not include subject lines or greetings like "Dear Sir/Madam". Just the message body. Use the applicant's real details naturally.

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
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[jobs-apply] RESEND_API_KEY not set");
    return sendJson(response, 500, { ok: false, error: "Email service not configured. Please WhatsApp us at +16038662272." });
  }

  let body;
  try {
    body = JSON.parse(await readRequestBody(request) || "{}");
  } catch (e) {
    if (e.code === "BODY_TOO_LARGE") {
      return sendJson(response, 413, { ok: false, error: "Your ID photo is too large. Please use a smaller image and try again." });
    }
    return sendJson(response, 400, { ok: false, error: "Invalid request." });
  }

  const {
    role, firstName, lastName, dobMonth, dobDay, dobYear, age,
    sex, location, phone, email, idNumber, computer, medical,
    signature, draft, idPhotoBase64, idPhotoName,
  } = body;

  if (!firstName || !lastName || !role || !signature) {
    return sendJson(response, 400, { ok: false, error: "Required fields missing." });
  }

  const dobStr = `${dobMonth || ""}/${dobDay || ""}/${dobYear || ""}`;
  const computerLabel = computer === "Yes" ? "Yes" : computer === "Learning" ? "Willing to learn" : "Not yet";
  const cleanEmail = String(email || "").trim().toLowerCase();

  // ── Build admin email ────────────────────────────────────────────────
  const adminHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#062f22 0%,#0f4f36 60%,#1a6b4a 100%);padding:24px 28px 20px;border-radius:8px 8px 0 0">
        <div style="font-size:10px;font-weight:800;letter-spacing:2.5px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:8px">Vue Auto Parts &nbsp;·&nbsp; Careers</div>
        <h2 style="color:#fff;margin:0;font-size:20px;font-weight:900">New Job Application</h2>
        <p style="color:rgba(255,255,255,0.55);margin:4px 0 0;font-size:13px">Received via the Vue Auto Parts website</p>
      </div>
      <div style="background:#f9f9f9;padding:20px 28px;border-left:1px solid #eee;border-right:1px solid #eee">
        <div style="display:inline-block;background:#d1fae5;color:#065f46;font-size:11px;font-weight:800;letter-spacing:1px;padding:4px 12px;border-radius:999px;text-transform:uppercase;margin-bottom:16px">${role}</div>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr><td style="padding:7px 0;color:#666;width:140px;font-weight:600;vertical-align:top">Full Name</td><td style="padding:7px 0;font-weight:700">${firstName} ${lastName}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Date of Birth</td><td style="padding:7px 0;font-weight:700">${dobStr} &nbsp;<span style="color:#888;font-weight:500">(Age ${age})</span></td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Sex</td><td style="padding:7px 0;font-weight:700">${sex || "—"}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Location</td><td style="padding:7px 0;font-weight:700">${location || "—"}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Phone</td><td style="padding:7px 0;font-weight:700">${phone || "—"}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Email</td><td style="padding:7px 0;font-weight:700">${cleanEmail || "—"}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">National ID</td><td style="padding:7px 0;font-family:'Courier New',monospace;font-weight:700">${idNumber || "—"}</td></tr>
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Computer Skills</td><td style="padding:7px 0;font-weight:700">${computerLabel}</td></tr>
          ${medical ? `<tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Health Notes</td><td style="padding:7px 0;font-weight:700">${medical}</td></tr>` : ""}
          <tr><td style="padding:7px 0;color:#666;font-weight:600;vertical-align:top">Signed By</td><td style="padding:7px 0;font-weight:700;color:#0f4f36">${signature}</td></tr>
        </table>
      </div>
      <div style="background:#fff;padding:20px 28px;border:1px solid #eee;border-top:none">
        <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#6b7280;text-transform:uppercase;margin-bottom:10px">Application Message</div>
        <p style="color:#333;font-size:14px;line-height:1.7;margin:0;white-space:pre-wrap">${draft || ""}</p>
      </div>
      ${idPhotoBase64 ? `<div style="background:#f9f9f9;padding:16px 28px 20px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
        <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#6b7280;text-transform:uppercase;margin-bottom:6px">National ID Photo</div>
        <p style="color:#888;font-size:12px;margin:0">Attached to this email.</p>
      </div>` : ""}
    </div>`;

  const adminPayload = {
    from: "Vue Auto Parts <onboarding@resend.dev>",
    to: ["info@vueautoparts.com"],
    subject: `Job Application: ${role} — ${firstName} ${lastName}`,
    html: adminHtml,
    text: `New Job Application\n\nRole: ${role}\nName: ${firstName} ${lastName}\nDOB: ${dobStr} (Age ${age})\nSex: ${sex || "—"}\nLocation: ${location || "—"}\nPhone: ${phone || "—"}\nEmail: ${cleanEmail || "—"}\nID: ${idNumber || "—"}\nComputer: ${computerLabel}\n${medical ? "Health: " + medical + "\n" : ""}Signed: ${signature}\n\n${draft || ""}`,
  };

  if (idPhotoBase64 && idPhotoName) {
    const ext = (idPhotoName.split(".").pop() || "jpg").toLowerCase();
    adminPayload.attachments = [{
      filename: `national-id-${String(firstName).toLowerCase()}-${String(lastName).toLowerCase()}.${ext}`,
      content: idPhotoBase64,
    }];
  }

  // ── Send admin notification — awaited so we can report success/failure ──
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(adminPayload),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[jobs-apply] admin email error:", r.status, errText);
      return sendJson(response, 500, { ok: false, error: "Could not send your application. Please WhatsApp us at +16038662272." });
    }
    console.log(`[jobs-apply] application emailed: ${firstName} ${lastName} | ${role}`);
  } catch (e) {
    console.error("[jobs-apply] admin email fetch error:", e.message);
    return sendJson(response, 500, { ok: false, error: "Could not send your application. Please WhatsApp us at +16038662272." });
  }

  // ── Applicant confirmation — fire-and-forget ─────────────────────────
  if (cleanEmail) {
    const confirmHtml = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#062f22 0%,#0f4f36 60%,#1a6b4a 100%);padding:24px 28px 20px;border-radius:8px 8px 0 0">
          <div style="font-size:9px;font-weight:800;letter-spacing:2.5px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:6px">Vue Auto Parts &nbsp;·&nbsp; Careers</div>
          <h2 style="color:#fff;margin:0;font-size:19px;font-weight:900">We received your application</h2>
        </div>
        <div style="background:#fff;padding:24px 28px;border:1px solid #eee;border-top:none">
          <p style="color:#222;font-size:15px;font-weight:700;margin:0 0 6px">Hi ${firstName},</p>
          <p style="color:#444;font-size:14px;line-height:1.75;margin:0 0 18px">
            Thank you for applying for the <strong>${role}</strong> position at Vue Auto Parts. We have received your application and our team will be in touch.
          </p>
          <p style="color:#444;font-size:14px;line-height:1.75;margin:0">
            Questions? WhatsApp us at <strong>+16038662272</strong>.
          </p>
        </div>
        <div style="background:#f9f9f9;padding:14px 28px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
          <p style="color:#9ca3af;font-size:11px;margin:0;line-height:1.6">
            Vue Auto Parts &nbsp;·&nbsp; Chipinge, Manicaland, Zimbabwe &nbsp;·&nbsp;
            <a href="https://wa.me/16038662272" style="color:#0f4f36">+16038662272</a>
          </p>
        </div>
      </div>`;

    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Vue Auto Parts <onboarding@resend.dev>",
        to: [cleanEmail],
        subject: `Application received — ${role} at Vue Auto Parts`,
        html: confirmHtml,
        text: `Hi ${firstName},\n\nThank you for applying for the ${role} position at Vue Auto Parts. We have received your application and our team will be in touch.\n\nQuestions? WhatsApp us at +16038662272.\n\n— Vue Auto Parts, Chipinge, Zimbabwe`,
      }),
    }).then(r => {
      if (r.ok) console.log(`[jobs-apply] confirmation sent to ${cleanEmail}`);
      else r.text().then(t => console.error("[jobs-apply] confirmation error:", r.status, t));
    }).catch(e => console.error("[jobs-apply] confirmation error:", e.message));
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

  const prompt = `Write a short, professional staff message for Vue Auto Parts in Chipinge, Zimbabwe. The staff member is ${actionLabels[action] || action}.

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
          <p style="color:rgba(255,255,255,0.65);margin:4px 0 0;font-size:13px">Vue Auto Parts · ${now}</p>
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
        from: "Vue Auto Parts Staff <onboarding@resend.dev>",
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

function generateLetterPdf({ firstName, lastName, location, role }, status, aiBody) {
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

    // ── Letterhead ────────────────────────────────────────────────────
    doc.rect(72, 72, W, 4).fill(GREEN);
    doc.moveDown(0.6);
    doc.fontSize(20).font("Helvetica-Bold").fillColor(GREEN).text("Vue Auto Parts", { align: "center" });
    doc.fontSize(9).font("Helvetica").fillColor(GREY)
       .text("Chipinge, Manicaland, Zimbabwe  ·  info@vueautoparts.com  ·  vueautoparts.com", { align: "center" });
    doc.moveDown(0.4);
    doc.rect(72, doc.y, W, 1).fill(GOLD);
    doc.moveDown(1.2);

    // ── Date ──────────────────────────────────────────────────────────
    const dateStr = new Date().toLocaleDateString("en-ZW", { day: "numeric", month: "long", year: "numeric" });
    doc.fontSize(10).font("Helvetica").fillColor("#000").text(dateStr, { align: "right" });
    doc.moveDown(0.8);

    // ── Addressee ─────────────────────────────────────────────────────
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#000").text(`${firstName} ${lastName}`);
    doc.font("Helvetica").fillColor(GREY).text(location || "Zimbabwe");
    doc.moveDown(1);

    // ── Reference line + salutation ───────────────────────────────────
    const refSuffix = status === "accepted" ? "Offer of Employment"
                    : status === "rejected"  ? "Application Outcome"
                    : "Application Acknowledgement";
    doc.fontSize(10).font("Helvetica-Bold").fillColor(GREEN)
       .text(`RE: Job Application — ${role} — ${refSuffix}`);
    doc.moveDown(0.6);
    doc.fontSize(10).font("Helvetica").fillColor("#000").text(`Dear ${firstName},`);
    doc.moveDown(0.6);

    // ── Body paragraphs (AI-generated) ───────────────────────────────
    const paras = String(aiBody || "").split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    paras.forEach((para, i) => {
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(para, { lineGap: 4 });
      if (i < paras.length - 1) doc.moveDown(0.7);
    });

    // ── Closing ───────────────────────────────────────────────────────
    doc.moveDown(1.2);
    doc.text(status === "accepted" ? "Yours sincerely," : "Yours respectfully,");
    doc.moveDown(2);
    doc.rect(72, doc.y, 150, 1).fill(GREY);
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Samuel Takwirira");
    doc.font("Helvetica").fillColor(GREY).fontSize(9).text("Director");
    doc.text("Vue Auto Parts");
    doc.text("Chipinge, Manicaland, Zimbabwe");
    doc.text("info@vueautoparts.com");

    // ── Footer rule ───────────────────────────────────────────────────
    doc.rect(72, 841 - 72 - 8, W, 1).fill(GREEN);

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


async function handleStaffSendStatus(request, response) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return sendJson(response, 500, { ok: false, error: "Email service not configured." });
  }

  let body;
  try { body = JSON.parse(await readRequestBody(request) || "{}"); }
  catch { return sendJson(response, 400, { ok: false, error: "Invalid request." }); }

  const director = await verifyDirector(body);
  if (!director) return sendJson(response, 403, { ok: false, error: "Director credentials required." });

  const { applicantFirst, applicantLast, applicantEmail, applicantLocation, role, status, note } = body;

  if (!applicantFirst || !applicantLast || !applicantEmail || !role || !status) {
    return sendJson(response, 400, { ok: false, error: "All required fields must be filled in." });
  }
  if (!["under-review", "accepted", "rejected"].includes(status)) {
    return sendJson(response, 400, { ok: false, error: "Invalid status." });
  }

  const firstName = String(applicantFirst).trim();
  const lastName  = String(applicantLast).trim();
  const email     = String(applicantEmail).trim().toLowerCase();
  const location  = String(applicantLocation || "Zimbabwe").trim();

  // ── Groq: generate formal letter body ─────────────────────────────
  const statusInstructions = {
    "under-review":
      "Acknowledge receipt of the application with warmth. Inform the applicant that it is currently under careful and thorough review by the director. Express sincere appreciation for their interest in joining Vue Auto Parts. Assure them they will be notified of the outcome in due course.",
    "accepted":
      "Warmly congratulate the applicant on being selected for the position. Welcome them formally to the Vue Auto Parts team. Request that they present their original National ID card and any relevant supporting documents upon reporting for duty. State that a team member will be in contact shortly to confirm the start date and further arrangements.",
    "rejected":
      "Thank the applicant sincerely for the time and effort invested in their application. Regretfully inform them that on this occasion their application was unsuccessful after careful consideration of all candidates. Acknowledge their evident potential and effort. Warmly encourage them to consider applying for future positions at Vue Auto Parts.",
  }[status];

  const noteContext = note ? ` Director's note for context: ${note}` : "";
  const groqPrompt  =
    `Write exactly 3 formal paragraphs for an official job application status letter from Vue Auto Parts, Chipinge, Zimbabwe, signed by Samuel Takwirira, Director.\n` +
    `Applicant: ${firstName} ${lastName}. Position: ${role}. Status: ${status}.${noteContext}\n\n` +
    `Rules:\n` +
    `- Very formal, professional British English — dignified and corporate in tone\n` +
    `- Do NOT include a salutation (no "Dear..."), closing (no "Yours sincerely..."), date, subject line, or any labels\n` +
    `- Return ONLY the 3 body paragraphs, each separated by a single blank line\n` +
    `- ${statusInstructions}`;

  let aiBody = "";
  try {
    const gr = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model:       process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        messages:    [{ role: "user", content: groqPrompt }],
        max_tokens:  520,
        temperature: 0.45,
      }),
    });
    if (gr.ok) {
      const gd = await gr.json();
      aiBody = (gd.choices?.[0]?.message?.content || "").trim();
    } else {
      console.error("[send-status] Groq error:", gr.status);
    }
  } catch (e) {
    console.error("[send-status] Groq fetch error:", e.message);
  }

  // Fallback body if AI fails
  if (!aiBody) {
    if (status === "under-review") {
      aiBody =
        `We write to acknowledge receipt of your application for the position of ${role} at Vue Auto Parts. We are grateful for your interest in joining our organisation and for the time and effort you have invested in your application.\n\n` +
        `Your application is currently under careful and thorough review by our director. We are committed to giving every application the consideration it deserves, and we assure you that the process is being conducted with the utmost diligence.\n\n` +
        `We will be in contact with you in due course to advise you of the outcome. Should you have any queries in the meantime, please do not hesitate to reach us via WhatsApp at +16038662272.`;
    } else if (status === "accepted") {
      aiBody =
        `We are delighted to inform you that, following a thorough review of all applications received for the position of ${role} at Vue Auto Parts, you have been selected to join our team. On behalf of the entire organisation, we extend our warmest congratulations.\n\n` +
        `We ask that you present your original National Identity Card and any relevant supporting documents upon reporting for your first day of duty. A member of our team will be in contact with you shortly to confirm your commencement date and any further arrangements that may be required.\n\n` +
        `We look forward to welcoming you to the Vue Auto Parts family and are confident that your contribution will be a valued one. Congratulations once again, and we wish you every success in this new chapter of your career.`;
    } else {
      aiBody =
        `We wish to thank you sincerely for your interest in joining Vue Auto Parts and for the time and effort you devoted to your application for the position of ${role}. It is genuinely appreciated.\n\n` +
        `After careful and thorough consideration of all applications received, we regret to inform you that we are unable to offer you this particular position at this time. We wish to assure you that this decision was not made lightly and is in no way a reflection of your character or ability.\n\n` +
        `We genuinely encourage you to continue pursuing your career aspirations with confidence. Should suitable opportunities arise at Vue Auto Parts in the future, we sincerely hope you will consider applying again. We wish you every success in all your future endeavours.`;
    }
  }

  // ── Generate PDF letter ───────────────────────────────────────────
  let pdfBuffer;
  try {
    pdfBuffer = await generateLetterPdf({ firstName, lastName, location, role }, status, aiBody);
  } catch (e) {
    console.error("[send-status] PDF error:", e.message);
    return sendJson(response, 500, { ok: false, error: "Could not generate the letter. Please try again." });
  }

  // ── Build email ───────────────────────────────────────────────────
  const statusLabel = { "under-review": "Under Review", "accepted": "Accepted", "rejected": "Rejected" }[status];
  const subjectMap  = {
    "under-review": `Your application is under review — ${role} at Vue Auto Parts`,
    "accepted":     `Congratulations — You have been selected for ${role} at Vue Auto Parts`,
    "rejected":     `Your application outcome — ${role} at Vue Auto Parts`,
  };
  const headerMap = {
    "under-review": "Your Application Is Under Review",
    "accepted":     "Congratulations — You Have Been Selected",
    "rejected":     "Your Application Outcome",
  };
  const accentColor = { "under-review": "#b8902a", "accepted": "#0f4f36", "rejected": "#6b7280" }[status];

  const bodyParas = aiBody.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="color:#333;font-size:13px;line-height:1.85;margin:0 0 15px;font-family:Georgia,serif">${p}</p>`)
    .join("");

  const emailHtml = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#062f22 0%,#0f4f36 60%,#1a6b4a 100%);padding:28px 32px 22px">
        <div style="font-size:9px;font-weight:800;letter-spacing:3px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:8px;font-family:sans-serif">Vue Auto Parts &nbsp;·&nbsp; Careers</div>
        <h2 style="color:#fff;margin:0;font-size:20px;font-weight:700;font-family:Georgia,serif">${headerMap[status]}</h2>
      </div>
      <div style="background:#fafafa;padding:28px 32px;border-bottom:3px solid ${accentColor}">
        <p style="color:#111;font-size:13px;margin:0 0 16px;font-family:Georgia,serif">Dear ${firstName} ${lastName},</p>
        ${bodyParas}
        <p style="color:#444;font-size:13px;line-height:1.85;margin:16px 0 0;font-family:Georgia,serif">Yours ${status === "accepted" ? "sincerely" : "respectfully"},</p>
        <p style="color:#0f4f36;font-size:13px;font-weight:700;margin:12px 0 2px;font-family:Georgia,serif">Samuel Takwirira</p>
        <p style="color:#6b7280;font-size:12px;margin:0;font-family:sans-serif">Director, Vue Auto Parts</p>
      </div>
      <div style="background:#fff;padding:16px 32px 20px">
        <p style="color:#9ca3af;font-size:11px;margin:0;line-height:1.7;font-family:sans-serif">
          Vue Auto Parts &nbsp;·&nbsp; Chipinge, Manicaland, Zimbabwe<br>
          <a href="mailto:info@vueautoparts.com" style="color:#0f4f36">info@vueautoparts.com</a> &nbsp;·&nbsp;
          <a href="https://wa.me/16038662272" style="color:#0f4f36">+16038662272</a>
        </p>
      </div>
    </div>`;

  const emailText =
    `Dear ${firstName} ${lastName},\n\n${aiBody}\n\n` +
    `Yours ${status === "accepted" ? "sincerely" : "respectfully"},\n` +
    `Samuel Takwirira\nDirector, Vue Auto Parts\nChipinge, Manicaland, Zimbabwe\ninfo@vueautoparts.com`;

  const safeName = `${firstName}_${lastName}`.replace(/[^a-zA-Z_]/g, "_");
  const pdfName  = `Vue_Auto_Parts_${statusLabel.replace(/ /g, "_")}_Letter_${safeName}.pdf`;

  // ── Send email (awaited) ──────────────────────────────────────────
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from:    "Vue Auto Parts <onboarding@resend.dev>",
        to:      [email],
        cc:      ["info@vueautoparts.com"],
        subject: subjectMap[status],
        html:    emailHtml,
        text:    emailText,
        attachments: [{ filename: pdfName, content: pdfBuffer.toString("base64") }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[send-status] email error:", r.status, errText);
      return sendJson(response, 500, { ok: false, error: "Could not send the status email. Please try again." });
    }
    console.log(`[send-status] ${status} → ${email} | ${role} | by ${director.firstName} ${director.lastName}`);
  } catch (e) {
    console.error("[send-status] fetch error:", e.message);
    return sendJson(response, 500, { ok: false, error: "Could not send the status email. Please try again." });
  }

  return sendJson(response, 200, { ok: true, statusLabel, applicantName: `${firstName} ${lastName}`, email });
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
    if (request.method === "POST" && request.url === "/api/staff/send-status") {
      return await handleStaffSendStatus(request, response);
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
}

initDb()
  .catch(err => console.error("[initDb] error:", err.message))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Vue Auto Parts listening on ${PORT}`);
      insights.startScheduler();
    });
  });
