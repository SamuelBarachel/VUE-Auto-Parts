const aiTrigger = document.querySelector("#aiTrigger");
const aiPanel = document.querySelector("#aiPanel");
const aiForm = document.querySelector("#aiForm");
const aiQuestion = document.querySelector("#aiQuestion");
const aiAnswer = document.querySelector("#aiAnswer");

function toggleAiPanel(forceOpen) {
  const isOpen = forceOpen ?? aiPanel.hidden;
  aiPanel.hidden = !isOpen;
  aiTrigger.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    aiQuestion.focus();
  }
}

function compactFallbackAnswer(question) {
  const rows = window.VUEInventoryTools?.getRows?.() || [];
  const lowered = question.toLowerCase();
  const matches = rows.filter((row) => {
    const text = [
      row["Vehicle Model"],
      row["Part Name"],
      row.Specification,
      row["Unit Price (USD Base)"],
    ]
      .join(" ")
      .toLowerCase();
    return lowered.split(/\s+/).some((word) => word.length > 2 && text.includes(word));
  });

  if (matches.length) {
    const row = matches[0];
    const price = window.VUEInventoryTools.displayPrice(row);
    const availability = window.VUEInventoryTools.availabilityLabel(row["Stock on Hand"]);
    return `${row["Vehicle Model"]} ${row["Part Name"]}: ${price}. ${availability}.`;
  }

  if (lowered.includes("whatsapp") || lowered.includes("contact")) {
    return "Use the WhatsApp button or email info@vueautoparts.com.";
  }

  if (lowered.includes("location") || lowered.includes("address")) {
    return "Chipinge, Manicaland.";
  }

  return "Please search Parts Finder or send the part details on WhatsApp.";
}

async function askAi(question) {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    throw new Error("AI endpoint unavailable");
  }

  const data = await response.json();
  return data.answer || compactFallbackAnswer(question);
}

aiTrigger.addEventListener("click", () => toggleAiPanel());

aiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = aiQuestion.value.trim();
  if (!question) return;

  aiAnswer.textContent = "Checking...";

  try {
    aiAnswer.textContent = await askAi(question);
  } catch (error) {
    aiAnswer.textContent = compactFallbackAnswer(question);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !aiPanel.hidden) {
    toggleAiPanel(false);
  }
});
