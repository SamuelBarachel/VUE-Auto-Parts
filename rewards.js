(function () {
  const overlay = document.getElementById("rwdOverlay");
  if (!overlay) return;

  const closeBtn        = document.getElementById("rwdClose");
  const tabLookup       = document.getElementById("rwdTabLookup");
  const tabRegister     = document.getElementById("rwdTabRegister");
  const lookupSection   = document.getElementById("rwdLookupSection");
  const registerSection = document.getElementById("rwdRegisterSection");

  const lookupPanel     = document.getElementById("rwdLookupPanel");
  const statusPanel     = document.getElementById("rwdStatusPanel");
  const lookupPhone     = document.getElementById("rwdLookupPhone");
  const lookupBtn       = document.getElementById("rwdLookupBtn");
  const lookupErr       = document.getElementById("rwdLookupErr");
  const cardStatus      = document.getElementById("rwdCardStatus");
  const statusBack      = document.getElementById("rwdStatusBack");

  const panel1  = document.getElementById("rwdPanel1");
  const panel2  = document.getElementById("rwdPanel2");
  const panel3  = document.getElementById("rwdPanel3");
  const nextBtn = document.getElementById("rwdNextBtn");
  const backBtn = document.getElementById("rwdBackBtn");
  const sendBtn = document.getElementById("rwdSendBtn");
  const err1    = document.getElementById("rwdErr1");
  const err2    = document.getElementById("rwdErr2");
  const draftTA = document.getElementById("rwdDraft");
  const loading = document.getElementById("rwdDraftLoading");
  const step1   = document.getElementById("rwdStep1");
  const step2   = document.getElementById("rwdStep2");

  function showTab(tab) {
    const isLookup = tab === "lookup";
    tabLookup.classList.toggle("active", isLookup);
    tabRegister.classList.toggle("active", !isLookup);
    tabLookup.setAttribute("aria-selected", isLookup ? "true" : "false");
    tabRegister.setAttribute("aria-selected", isLookup ? "false" : "true");
    lookupSection.hidden   = !isLookup;
    registerSection.hidden = isLookup;
  }

  function showLookupPanel(n) {
    lookupPanel.hidden = n !== 1;
    statusPanel.hidden = n !== 2;
  }

  function showRegPanel(n) {
    panel1.hidden = n !== 1;
    panel2.hidden = n !== 2;
    panel3.hidden = n !== 3;
    if (step1) step1.classList.toggle("active", n >= 1 && n < 3);
    if (step2) step2.classList.toggle("active", n >= 2 && n < 3);
  }

  function closeEarnPanel() {
    const p = document.getElementById("earnPanel");
    const t = document.getElementById("earnTrigger");
    if (p) { p.hidden = true; }
    if (t) t.setAttribute("aria-expanded", "false");
  }

  function openModal(mode) {
    closeEarnPanel();
    overlay.hidden = false;
    document.body.style.overflowY = "hidden";
    showTab(mode === "register" ? "register" : "lookup");
    showLookupPanel(1);
    showRegPanel(1);
    setTimeout(() => overlay.classList.add("visible"), 10);
    if (mode === "register") {
      document.getElementById("rwdName")?.focus();
    } else {
      lookupPhone?.focus();
    }
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
    showTab("lookup");
    showLookupPanel(1);
    showRegPanel(1);
    if (lookupPhone) lookupPhone.value = "";
    if (lookupErr)   lookupErr.textContent = "";
    if (cardStatus)  cardStatus.innerHTML = "";
    if (err1) err1.textContent = "";
    if (err2) err2.textContent = "";
    if (draftTA) { draftTA.value = ""; draftTA.hidden = true; }
    if (loading) loading.hidden = false;
    if (sendBtn) sendBtn.disabled = true;
    ["rwdName","rwdLocation","rwdPhone","rwdId"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  }

  document.getElementById("rwdCheckOpen")?.addEventListener("click", () => openModal("lookup"));
  document.getElementById("rwdRegOpen")?.addEventListener("click",   () => openModal("register"));
  document.getElementById("rwdOpen")?.addEventListener("click",      () => openModal("register"));

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  tabLookup.addEventListener("click",   () => { showTab("lookup");   showLookupPanel(1); lookupPhone?.focus(); });
  tabRegister.addEventListener("click", () => { showTab("register"); showRegPanel(1); document.getElementById("rwdName")?.focus(); });

  lookupBtn.addEventListener("click", doLookup);
  lookupPhone.addEventListener("keydown", e => { if (e.key === "Enter") doLookup(); });
  statusBack.addEventListener("click", () => { showLookupPanel(1); lookupPhone?.focus(); });

  async function doLookup() {
    const phone = (lookupPhone.value || "").trim();
    if (!phone) { lookupErr.textContent = "Please enter your phone number."; return; }
    lookupErr.textContent = "";
    lookupBtn.disabled = true;
    lookupBtn.textContent = "Checking…";
    try {
      const res  = await fetch("/api/rewards-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        renderStatus(data.cards);
        showLookupPanel(2);
      } else {
        lookupErr.textContent = data.error || "Could not connect. Please try again.";
      }
    } catch {
      lookupErr.textContent = "Connection error. Please try again.";
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = "Check →";
    }
  }

  function renderStatus(cards) {
    if (!cardStatus) return;

    if (cards.length === 0) {
      cardStatus.innerHTML = `<div class="rwd-cs-empty">
        <div class="rwd-cs-empty-icon">🔍</div>
        <p><strong>No card found</strong> for that number.</p>
        <p class="rwd-cs-empty-hint">Rewards cards are issued in store by staff. Visit us to get yours.</p>
        <button class="enq-btn-primary" id="rwdGoRegister" type="button" style="margin-top:14px;width:100%">Register interest →</button>
      </div>`;
      document.getElementById("rwdGoRegister")?.addEventListener("click", () => {
        showTab("register");
        showRegPanel(1);
        document.getElementById("rwdName")?.focus();
      });
      return;
    }

    cardStatus.innerHTML = cards.map(card => {
      const reward   = card.rewardOwed || 0;
      const score    = Math.max(card.referrals || 0, card.purchases || 0);
      const refs     = card.referrals  || 0;
      const purs     = card.purchases  || 0;
      const isActive = card.status === "active";

      const statusLabel = { active: "Active", revoked: "Revoked", paid: "Paid" }[card.status] || card.status;
      const issued = (() => {
        try { return new Date(card.issuedDate).toLocaleDateString("en-ZW", { day: "numeric", month: "short", year: "numeric" }); }
        catch { return ""; }
      })();

      let progressHtml = "";
      if (isActive) {
        if (score >= 15) {
          progressHtml = `<div class="rwd-cs-prog-label">Maximum reward reached!</div>
            <div class="rwd-cs-bar-wrap"><div class="rwd-cs-bar" style="width:100%;background:#d6ad3f"></div></div>`;
        } else if (score >= 5) {
          const pct = Math.round(((score - 5) / 10) * 100);
          progressHtml = `<div class="rwd-cs-prog-label">${score} / 15 toward <strong>$7 max reward</strong> · $3 owed now</div>
            <div class="rwd-cs-bar-wrap"><div class="rwd-cs-bar" style="width:${pct}%"></div></div>`;
        } else {
          const pct = Math.round((score / 5) * 100);
          progressHtml = `<div class="rwd-cs-prog-label">${score} / 5 toward first <strong>$3 reward</strong></div>
            <div class="rwd-cs-bar-wrap"><div class="rwd-cs-bar" style="width:${pct}%"></div></div>`;
        }
      }

      return `<div class="rwd-cs-card">
  <div class="rwd-cs-head">
    <div>
      <div class="rwd-cs-name">${card.name}</div>
      <div class="rwd-cs-serial">${card.serial}</div>
      ${issued ? `<div class="rwd-cs-date">Member since ${issued}</div>` : ""}
    </div>
    <span class="rwd-cs-badge rwd-cs-badge-${card.status}">${statusLabel}</span>
  </div>
  <div class="rwd-cs-stats">
    <div class="rwd-cs-stat">
      <span class="rwd-cs-stat-val">${refs}</span>
      <span class="rwd-cs-stat-lbl">Referrals</span>
    </div>
    <div class="rwd-cs-stat">
      <span class="rwd-cs-stat-val">${purs}</span>
      <span class="rwd-cs-stat-lbl">Purchases</span>
    </div>
    <div class="rwd-cs-stat${reward > 0 ? " rwd-cs-stat-lit" : ""}">
      <span class="rwd-cs-stat-val">$${reward}</span>
      <span class="rwd-cs-stat-lbl">Owed</span>
    </div>
  </div>
  ${isActive ? `<div class="rwd-cs-progress">${progressHtml}</div>` : ""}
  ${reward > 0 && isActive
    ? `<div class="rwd-cs-notice rwd-cs-notice-reward">💰 You have a <strong>$${reward} reward</strong> — visit us in store to claim it!</div>`
    : ""}
  ${card.status === "revoked"
    ? `<div class="rwd-cs-notice rwd-cs-notice-warn">This card has been revoked. Speak to staff to renew it if eligible.</div>`
    : ""}
  ${card.status === "paid"
    ? `<div class="rwd-cs-notice rwd-cs-notice-info">Your $${card.paidAmount || reward} reward was paid out. Ask staff to renew your card for a fresh start.</div>`
    : ""}
</div>`;
    }).join("");
  }

  backBtn.addEventListener("click", () => { err2.textContent = ""; showRegPanel(1); });

  nextBtn.addEventListener("click", async () => {
    const name     = document.getElementById("rwdName").value.trim();
    const location = document.getElementById("rwdLocation").value.trim();
    const phone    = document.getElementById("rwdPhone").value.trim();
    const idNumber = document.getElementById("rwdId").value.trim();
    if (!name)     { err1.textContent = "Please enter your full name.";    return; }
    if (!location) { err1.textContent = "Please enter where you live.";    return; }
    if (!phone)    { err1.textContent = "Please enter your phone number."; return; }
    if (!idNumber) { err1.textContent = "Please enter your ID number.";    return; }
    err1.textContent = "";
    nextBtn.disabled = true;
    nextBtn.textContent = "Drafting…";
    showRegPanel(2);
    loading.hidden = false;
    draftTA.hidden = true;
    sendBtn.disabled = true;
    try {
      const res  = await fetch("/api/reward-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, location, phone, idNumber }),
      });
      const data = await res.json().catch(() => ({}));
      draftTA.value = data.draft || "";
    } catch {
      draftTA.value = `Hi VUE Auto Parts,\n\nMy name is ${name} and I live in ${location}. My phone is ${phone} and my ID number is ${idNumber}.\n\nI'd like to register for the referral rewards programme. Please let me know the next steps. Thank you.`;
    } finally {
      loading.hidden = true;
      draftTA.hidden = false;
      sendBtn.disabled = false;
      nextBtn.disabled = false;
      nextBtn.textContent = "Draft my message →";
      draftTA.focus();
    }
  });

  sendBtn.addEventListener("click", async () => {
    const name     = document.getElementById("rwdName").value.trim();
    const location = document.getElementById("rwdLocation").value.trim();
    const phone    = document.getElementById("rwdPhone").value.trim();
    const idNumber = document.getElementById("rwdId").value.trim();
    const message  = draftTA.value.trim();
    if (!message) { err2.textContent = "Message is empty."; return; }
    err2.textContent = "";
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    try {
      const res  = await fetch("/api/reward-enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, location, phone, idNumber, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showRegPanel(3);
      } else {
        err2.textContent = data.error || "Could not send. Please try WhatsApp.";
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
      }
    } catch {
      err2.textContent = "Network error. Please try WhatsApp at +16038662272.";
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  });
})();
