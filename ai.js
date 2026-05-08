const aiTrigger = document.querySelector("#aiTrigger");
const aiPanel = document.querySelector("#aiPanel");
const aiClose = document.querySelector("#aiClose");
const aiForm = document.querySelector("#aiForm");
const aiQuestion = document.querySelector("#aiQuestion");
const aiMessages = document.querySelector("#aiMessages");

let conversationHistory = [];
let greeted = false;

function scrollToBottom() {
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function appendBubble(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `ai-bubble ${role}`;
  wrap.textContent = text;
  aiMessages.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function appendChoices(choices) {
  const row = document.createElement("div");
  row.className = "ai-choices";

  choices.forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-choice-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      row.remove();
      submitQuestion(label);
    });
    row.appendChild(btn);
  });

  aiMessages.appendChild(row);
  scrollToBottom();
}

function showTyping() {
  const dot = document.createElement("div");
  dot.className = "ai-bubble bot ai-typing";
  dot.innerHTML = "<span></span><span></span><span></span>";
  aiMessages.appendChild(dot);
  scrollToBottom();
  return dot;
}

async function submitQuestion(question) {
  appendBubble("user", question);
  aiQuestion.value = "";

  conversationHistory.push({ role: "user", content: question });

  const typing = showTyping();

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        history: conversationHistory.slice(-8),
      }),
    });

    typing.remove();

    const data = res.ok ? await res.json() : { answer: localFallback(question) };
    const answer = data.answer || localFallback(question);

    appendBubble("bot", answer);
    conversationHistory.push({ role: "assistant", content: answer });

    if (Array.isArray(data.choices) && data.choices.length) {
      appendChoices(data.choices);
    }
  } catch (_) {
    typing.remove();
    const fallback = localFallback(question);
    appendBubble("bot", fallback);
    conversationHistory.push({ role: "assistant", content: fallback });
  }
}

function localFallback(question) {
  const rows = window.VUEInventoryTools?.getRows?.() || [];
  const lowered = question.toLowerCase();

  const match = rows.find((row) => {
    const text = [row["Vehicle Model"], row["Part Name"], row.Specification]
      .join(" ")
      .toLowerCase();
    return lowered.split(/\s+/).some((w) => w.length > 2 && text.includes(w));
  });

  if (match) {
    const price = window.VUEInventoryTools?.displayPrice?.(match) || match["Unit Price (USD Base)"] || "Ask for price";
    const avail = window.VUEInventoryTools?.availabilityLabel?.(match["Stock on Hand"]) || "Ask in store";
    return `${match["Vehicle Model"]} — ${match["Part Name"]}: ${price}. ${avail}.`;
  }

  if (lowered.includes("reward") || lowered.includes("refer")) {
    return "Refer 5 buyers → $5. Refer 15+ → $10. No sign-up. T&Cs apply.";
  }

  return "Use Parts Finder above or WhatsApp us directly for fast help.";
}

function showGreeting() {
  if (greeted) return;
  greeted = true;

  appendBubble(
    "bot",
    "Hey! Welcome to VUE Auto Parts. We stock parts for Honda Fit, Toyota Corolla, Probox, Nissan Caravan — plus universal parts like oils, brakes, filters & more."
  );

  setTimeout(() => {
    appendBubble("bot", "What can I help you with today?");
    appendChoices(["Find a specific part", "Check what's in stock", "Tell me about rewards", "Other"]);
  }, 600);
}

function toggleAiPanel(forceOpen) {
  const isOpen = forceOpen ?? aiPanel.hidden;
  aiPanel.hidden = !isOpen;
  aiTrigger.setAttribute("aria-expanded", String(isOpen));

  if (isOpen) {
    showGreeting();
    setTimeout(() => aiQuestion.focus(), 50);
  }
}

aiTrigger.addEventListener("click", () => toggleAiPanel());
aiClose && aiClose.addEventListener("click", () => toggleAiPanel(false));

aiForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = aiQuestion.value.trim();
  if (!q) return;
  submitQuestion(q);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !aiPanel.hidden) toggleAiPanel(false);
});
