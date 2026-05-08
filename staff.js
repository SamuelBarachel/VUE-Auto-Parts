(function () {
  const brandBtn   = document.getElementById("brandLogo");
  const overlay    = document.getElementById("stfOverlay");
  if (!overlay || !brandBtn) return;

  const closeBtn      = document.getElementById("stfClose");
  const panel1        = document.getElementById("stfPanel1");
  const panel2        = document.getElementById("stfPanel2");
  const panel3        = document.getElementById("stfPanel3");
  const panel4        = document.getElementById("stfPanel4");
  const panel5        = document.getElementById("stfPanel5");
  const verifyBtn     = document.getElementById("stfVerifyBtn");
  const draftBtn      = document.getElementById("stfDraftBtn");
  const backBtn2      = document.getElementById("stfBack2");
  const backBtn3      = document.getElementById("stfBack3");
  const sendBtn       = document.getElementById("stfSendBtn");
  const err1          = document.getElementById("stfErr1");
  const err2          = document.getElementById("stfErr2");
  const err3          = document.getElementById("stfErr3");
  const draftTA       = document.getElementById("stfDraft");
  const loading       = document.getElementById("stfDraftLoading");
  const verifyLoad    = document.getElementById("stfVerifyLoading");
  const confirmedName = document.getElementById("stfConfirmedName");
  const confirmedRole = document.getElementById("stfConfirmedRole");
  const cardPreview   = document.getElementById("stfCardPreview");
  const cardScaler    = document.getElementById("stfCardScaler");
  const cardStage     = document.getElementById("stfCardStage");
  const cardTitle     = document.getElementById("stfCardTitle");
  const printBtn      = document.getElementById("stfPrintBtn");
  const cardBack      = document.getElementById("stfCardBack");

  const steps = [
    document.getElementById("stfStep1"),
    document.getElementById("stfStep2"),
    document.getElementById("stfStep3"),
  ];

  const actionCards     = document.querySelectorAll(".stf-action-card");
  const contextSections = document.querySelectorAll(".stf-context");

  let selectedAction    = null;
  let verifiedStaff     = null;
  let currentCardSerial = null;

  const CARD_ACTIONS = ["biz-card", "rewards-card"];

  function setStep(n) {
    steps.forEach((s, i) => s.classList.toggle("active", i < n));
  }

  function showPanel(n) {
    panel1.hidden = n !== 1;
    panel2.hidden = n !== 2;
    panel3.hidden = n !== 3;
    panel4.hidden = n !== 4;
    if (panel5) panel5.hidden = n !== 5;
    setStep(n <= 4 ? n : 3);
  }

  function openModal() {
    overlay.hidden = false;
    document.body.style.overflowY = "hidden";
    showPanel(1);
    setTimeout(() => overlay.classList.add("visible"), 10);
    document.getElementById("stfFirstName").focus();
  }

  function closeModal() {
    overlay.classList.remove("visible");
    setTimeout(() => {
      overlay.hidden = true;
      document.body.style.overflowY = "";
      resetModal();
    }, 280);
  }

  function resetModal() {
    showPanel(1);
    ["stfFirstName","stfLastName","stfId","stfRole"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const rwdInput = document.getElementById("stfRwdCustomer");
    if (rwdInput) rwdInput.value = "";
    err1.textContent = "";
    err2.textContent = "";
    err3.textContent = "";
    draftTA.value = "";
    draftTA.hidden = true;
    loading.hidden = false;
    sendBtn.disabled = true;
    selectedAction    = null;
    verifiedStaff     = null;
    currentCardSerial = null;
    actionCards.forEach(c => c.classList.remove("selected"));
    contextSections.forEach(s => s.hidden = true);
    document.getElementById("stfNotesWrap").hidden = true;
    draftBtn.disabled = true;
    draftBtn.textContent = "Draft my message →";
    if (cardPreview) cardPreview.innerHTML = "";
    document.querySelectorAll(".stf-size-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.scale === "1");
    });
    if (cardScaler) cardScaler.style.transform = "scale(1)";
    if (cardStage)  cardStage.style.minHeight  = "272px";
  }

  brandBtn.addEventListener("click", e => { e.preventDefault(); openModal(); });
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  backBtn2.addEventListener("click", () => { err2.textContent = ""; showPanel(1); });
  backBtn3.addEventListener("click", () => { err3.textContent = ""; showPanel(2); });
  if (cardBack) cardBack.addEventListener("click", () => { currentCardSerial = null; showPanel(2); });

  actionCards.forEach(card => {
    card.addEventListener("click", () => {
      actionCards.forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedAction = card.dataset.action;
      contextSections.forEach(s => s.hidden = true);
      err2.textContent = "";
      currentCardSerial = null;

      const isCard = CARD_ACTIONS.includes(selectedAction);
      document.getElementById("stfNotesWrap").hidden = isCard;
      draftBtn.textContent = isCard ? "Preview Card →" : "Draft my message →";

      const ctx = document.getElementById("stfCtx_" + selectedAction);
      if (ctx) ctx.hidden = false;
      if (!isCard) document.getElementById("stfNotesWrap").hidden = false;
      draftBtn.disabled = false;
    });
  });

  verifyBtn.addEventListener("click", async () => {
    const firstName = document.getElementById("stfFirstName").value.trim();
    const lastName  = document.getElementById("stfLastName").value.trim();
    const id        = document.getElementById("stfId").value.trim();
    const role      = document.getElementById("stfRole").value.trim();

    if (!firstName) { err1.textContent = "Please enter your first name.";  return; }
    if (!lastName)  { err1.textContent = "Please enter your last name.";   return; }
    if (!id)        { err1.textContent = "Please enter your ID.";          return; }
    if (!role)      { err1.textContent = "Please enter your role.";        return; }
    err1.textContent = "";

    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifying…";
    verifyLoad.hidden = false;

    try {
      const res  = await fetch("/api/staff-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, id, role }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.ok) {
        verifiedStaff = data.staff;
        confirmedName.textContent = data.staff.firstName + " " + data.staff.lastName;
        confirmedRole.textContent = data.staff.role;
        showPanel(2);
      } else {
        err1.textContent = data.error || "Details not found. Please check and try again.";
      }
    } catch {
      err1.textContent = "Connection error. Please try again.";
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = "Verify →";
      verifyLoad.hidden = true;
    }
  });

  draftBtn.addEventListener("click", async () => {
    if (!selectedAction) { err2.textContent = "Please choose an action."; return; }

    if (CARD_ACTIONS.includes(selectedAction)) {
      if (selectedAction === "rewards-card") {
        const nm = document.getElementById("stfRwdCustomer")?.value.trim() || "";
        if (!nm) { err2.textContent = "Please enter the customer's name."; return; }
      }
      err2.textContent = "";
      renderCardPreview();
      showPanel(5);
      return;
    }

    const details = collectDetails();
    err2.textContent = "";
    draftBtn.disabled = true;
    draftBtn.textContent = "Drafting…";
    showPanel(3);
    loading.hidden = false;
    draftTA.hidden = true;
    sendBtn.disabled = true;

    try {
      const res  = await fetch("/api/staff-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: verifiedStaff.firstName,
          lastName:  verifiedStaff.lastName,
          role:      verifiedStaff.role,
          action:    selectedAction,
          details,
        }),
      });
      const data = await res.json().catch(() => ({}));
      draftTA.value = data.draft || buildFallback(details);
    } catch {
      draftTA.value = buildFallback(details);
    } finally {
      loading.hidden = true;
      draftTA.hidden = false;
      sendBtn.disabled = false;
      draftBtn.disabled = false;
      draftBtn.textContent = "Draft my message →";
      draftTA.focus();
    }
  });

  sendBtn.addEventListener("click", async () => {
    const message = draftTA.value.trim();
    if (!message) { err3.textContent = "Message is empty."; return; }
    err3.textContent = "";
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";

    const details = collectDetails();

    try {
      const res  = await fetch("/api/staff-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: verifiedStaff.firstName,
          lastName:  verifiedStaff.lastName,
          id:        verifiedStaff.id,
          role:      verifiedStaff.role,
          action:    selectedAction,
          details,
          message,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        showPanel(4);
      } else {
        err3.textContent = data.error || "Could not send. Please try WhatsApp.";
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
      }
    } catch {
      err3.textContent = "Network error. Please try WhatsApp at +16038662272.";
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  });

  if (printBtn) {
    printBtn.addEventListener("click", () => {
      if (!cardPreview || !cardPreview.innerHTML) return;
      const win = window.open("", "_blank", "width=620,height=460,menubar=no,toolbar=no,scrollbars=no");
      if (!win) { alert("Allow pop-ups for this site to print cards."); return; }
      const base = window.location.origin;
      win.document.write(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>VUE Card — Print</title>
<link rel="stylesheet" href="${base}/styles.css">
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 36px; background: #d0cfc7; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
@media print {
  @page { size: 85.6mm 54mm; margin: 0; }
  html, body { width: 85.6mm; height: 54mm; padding: 0; background: white; min-height: 0; display: block; }
  .vue-card { width: 85.6mm !important; height: 54mm !important; border-radius: 3mm !important; box-shadow: none !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
<\/style>
</head><body>${cardPreview.innerHTML}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 500); });<\/script>
</body></html>`);
      win.document.close();
    });
  }

  document.querySelectorAll(".stf-size-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".stf-size-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const scale = parseFloat(btn.dataset.scale);
      if (cardScaler) cardScaler.style.transform = `scale(${scale})`;
      if (cardStage)  cardStage.style.minHeight  = (215 * scale + 56) + "px";
    });
  });

  function collectDetails() {
    const notes = document.getElementById("stfNotes").value.trim();
    const d = { notes };
    if (selectedAction === "event") {
      d.eventType = document.getElementById("stfEventType").value;
      d.eventDesc = document.getElementById("stfEventDesc").value.trim();
    }
    if (selectedAction === "pay") {
      d.payMonth = document.getElementById("stfPayMonth").value;
      d.payYear  = document.getElementById("stfPayYear").value;
    }
    return d;
  }

  function buildFallback(details) {
    const full = `${verifiedStaff.firstName} ${verifiedStaff.lastName}`;
    const role = verifiedStaff.role;
    const now  = new Date().toLocaleString("en-ZW", { dateStyle: "full", timeStyle: "short" });
    if (selectedAction === "clock-in")  return `Hi Management,\n\nThis is ${full} (${role}) reporting to work on ${now}.\n\n${details.notes || ""}`.trim();
    if (selectedAction === "clock-out") return `Hi Management,\n\nThis is ${full} (${role}) signing off for the day on ${now}.\n\n${details.notes || ""}`.trim();
    if (selectedAction === "event")     return `Hi Management,\n\nThis is ${full} (${role}) reporting an event on ${now}.\n\nType: ${details.eventType}\n\n${details.eventDesc || ""}`.trim();
    if (selectedAction === "pay")       return `Hi Management,\n\nThis is ${full} (${role}) submitting a pay request for ${details.payMonth} ${details.payYear}.\n\n${details.notes || ""}`.trim();
    return "";
  }

  function generateSerial(prefix) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const rand  = n => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `${prefix}-${new Date().getFullYear()}-${rand(4)}-${rand(4)}`;
  }

  function buildWatermarkRows() {
    const row = Array(22).fill("VUE AUTO PARTS · ").join("");
    return Array(14).fill(`<div class="vue-card-wm-row">${row}</div>`).join("");
  }

  function buildBizCardHtml() {
    if (!currentCardSerial) currentCardSerial = generateSerial("VBC");
    return `<div class="vue-card vue-biz-card">
  <div class="vue-card-wm" aria-hidden="true">${buildWatermarkRows()}</div>
  <div class="vue-biz-inner">
    <div class="vue-biz-top">
      <div class="vue-biz-logomark">
        <div class="vue-biz-v">V</div>
        <div class="vue-biz-brandtext">
          <span class="vue-biz-brand">VUE AUTO PARTS</span>
          <span class="vue-biz-sub">Staff Card</span>
        </div>
      </div>
      <div class="vue-biz-loc">CHIPINGE · ZWE</div>
    </div>
    <div class="vue-biz-name-area">
      <div class="vue-biz-name">${verifiedStaff.firstName} ${verifiedStaff.lastName}</div>
      <div class="vue-biz-role">${verifiedStaff.role}</div>
    </div>
    <div class="vue-biz-bottom">
      <div class="vue-biz-contact">
        <div>WA +1 603 866 2272</div>
        <div>vueautoparts.com</div>
      </div>
      <div class="vue-biz-serial">${currentCardSerial}</div>
    </div>
  </div>
  <div class="vue-biz-strip"></div>
</div>`;
  }

  function buildRwdCardHtml() {
    if (!currentCardSerial) currentCardSerial = generateSerial("VRC");
    const customerName = (document.getElementById("stfRwdCustomer")?.value || "").trim() || "—";
    const issued = new Date().toLocaleDateString("en-ZW", { month: "short", year: "numeric" });
    return `<div class="vue-card vue-rwd-card">
  <div class="vue-card-wm vue-card-wm-light" aria-hidden="true">${buildWatermarkRows()}</div>
  <div class="vue-rwd-header">
    <div class="vue-rwd-header-row">
      <span class="vue-rwd-brand">VUE AUTO PARTS</span>
      <span class="vue-rwd-badge">REWARDS</span>
    </div>
    <div class="vue-rwd-stars">★ ★ ★</div>
  </div>
  <div class="vue-rwd-body">
    <div class="vue-rwd-label">Valued Member</div>
    <div class="vue-rwd-name">${customerName}</div>
    <div class="vue-rwd-cardno">${currentCardSerial}</div>
  </div>
  <div class="vue-rwd-footer">
    <span>Valid for discounts · Chipinge, ZWE</span>
    <span>Issued ${issued}</span>
  </div>
</div>`;
  }

  function renderCardPreview() {
    currentCardSerial = null;
    const html = selectedAction === "biz-card" ? buildBizCardHtml() : buildRwdCardHtml();
    if (cardPreview) cardPreview.innerHTML = html;
    if (cardTitle) cardTitle.textContent = selectedAction === "biz-card" ? "Business Card Preview" : "Rewards Card Preview";
    document.querySelectorAll(".stf-size-btn").forEach(b => b.classList.toggle("active", b.dataset.scale === "1"));
    if (cardScaler) cardScaler.style.transform = "scale(1)";
    if (cardStage)  cardStage.style.minHeight  = "272px";
  }
})();
