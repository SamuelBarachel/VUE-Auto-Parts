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

const WHATSAPP_FALLBACK_MSG =
  "Sorry, I'm having a bit of trouble right now. Please reach out to us directly on WhatsApp at +16038662272 — we respond fast and can help you with anything.";

async function submitQuestion(question) {
  appendBubble("user", question);
  aiQuestion.value = "";

  // Snapshot history BEFORE adding the current message so it isn't sent twice
  const historySnapshot = conversationHistory.slice(-10);
  conversationHistory.push({ role: "user", content: question });

  const typing = showTyping();

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        history: historySnapshot,
      }),
    });

    typing.remove();

    if (!res.ok) {
      appendBubble("bot", WHATSAPP_FALLBACK_MSG);
      conversationHistory.push({ role: "assistant", content: WHATSAPP_FALLBACK_MSG });
      return;
    }

    const data = await res.json();
    const answer = data.answer || WHATSAPP_FALLBACK_MSG;

    appendBubble("bot", answer);
    conversationHistory.push({ role: "assistant", content: answer });

    if (Array.isArray(data.choices) && data.choices.length) {
      appendChoices(data.choices);
    }
  } catch (_) {
    typing.remove();
    appendBubble("bot", WHATSAPP_FALLBACK_MSG);
    conversationHistory.push({ role: "assistant", content: WHATSAPP_FALLBACK_MSG });
  }
}

function showGreeting() {
  if (greeted) return;
  greeted = true;

  const greeting = "Hey! Welcome to VUE Auto Parts. We stock parts for Honda Fit, Toyota Corolla, Probox, Nissan Caravan — and universal parts like oils, brakes, filters & more. What can I help you with?";
  appendBubble("bot", greeting);
  conversationHistory.push({ role: "assistant", content: greeting });

  setTimeout(() => {
    appendChoices(["Find a specific part", "Check what's in stock", "Tell me about rewards", "Other"]);
  }, 400);
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
