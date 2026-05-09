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
  const panel6        = document.getElementById("stfPanel6");
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
  const copyBtn       = document.getElementById("stfCopyBtn");
  const waBtn         = document.getElementById("stfWaBtn");
  const cardBack      = document.getElementById("stfCardBack");
  const rwdResults    = document.getElementById("stfRwdResults");
  const rwdResultCt   = document.getElementById("stfRwdResultCount");
  const rwdManageErr  = document.getElementById("stfRwdManageErr");
  const rwdManageBack = document.getElementById("stfRwdManageBack");

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

  const CARD_ACTIONS = ["biz-card", "rewards-card", "manage-rewards", "insights"];

  function setStep(n) {
    steps.forEach((s, i) => s.classList.toggle("active", i < n));
  }

  function showPanel(n) {
    panel1.hidden = n !== 1;
    panel2.hidden = n !== 2;
    panel3.hidden = n !== 3;
    panel4.hidden = n !== 4;
    if (panel5) panel5.hidden = n !== 5;
    if (panel6) panel6.hidden = n !== 6;
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
    ["stfRwdCustomer","stfRwdPhone","stfManageSearch"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
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
    if (cardPreview)  cardPreview.innerHTML = "";
    if (rwdResults)   rwdResults.innerHTML  = "";
    if (rwdManageErr) rwdManageErr.textContent = "";
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
  if (cardBack)      cardBack.addEventListener("click",      () => { currentCardSerial = null; showPanel(2); });
  if (rwdManageBack) rwdManageBack.addEventListener("click", () => showPanel(2));

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

      if (selectedAction === "manage-rewards")    draftBtn.textContent = "Search →";
      else if (selectedAction === "biz-card")     draftBtn.textContent = "Preview Card →";
      else if (selectedAction === "rewards-card") draftBtn.textContent = "Register & Preview →";
      else if (selectedAction === "insights")     draftBtn.textContent = "Send Report →";
      else { draftBtn.textContent = "Draft my message →"; document.getElementById("stfNotesWrap").hidden = false; }

      const ctx = document.getElementById("stfCtx_" + selectedAction);
      if (ctx) ctx.hidden = false;
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

    if (selectedAction === "manage-rewards") {
      await doSearchRewards();
      return;
    }

    if (selectedAction === "rewards-card") {
      const name  = (document.getElementById("stfRwdCustomer")?.value || "").trim();
      const phone = (document.getElementById("stfRwdPhone")?.value   || "").trim();
      if (!name)  { err2.textContent = "Please enter the customer's name.";         return; }
      if (!phone) { err2.textContent = "Please enter the customer's phone number."; return; }
      err2.textContent = "";
      draftBtn.disabled = true;
      draftBtn.textContent = "Registering…";
      try { await registerAndPreviewRewardsCard(name, phone); }
      finally { draftBtn.disabled = false; draftBtn.textContent = "Register & Preview →"; }
      return;
    }

    if (selectedAction === "biz-card") {
      err2.textContent = "";
      currentCardSerial = null;
      renderBizCardPreview();
      showPanel(5);
      return;
    }

    if (selectedAction === "insights") {
      const type = document.querySelector("input[name='stfInsightType']:checked")?.value || "daily";
      err2.textContent = "";
      draftBtn.disabled = true;
      draftBtn.textContent = "Generating…";
      try {
        const res  = await fetch("/api/insights-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          showInsightsSuccess(type);
        } else {
          err2.textContent = data.error || "Could not generate report. Please try again.";
        }
      } catch {
        err2.textContent = "Connection error. Please try again.";
      } finally {
        draftBtn.disabled = false;
        draftBtn.textContent = "Send Report →";
      }
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
    printBtn.addEventListener("click", async () => {
      if (!cardPreview || !cardPreview.querySelector(".vue-card")) return;
      const isRwd   = selectedAction === "rewards-card";
      const cardEl  = cardPreview.querySelector(".vue-card");
      const origTxt = printBtn.textContent;
      printBtn.disabled = true;
      printBtn.textContent = "Generating…";

      try {
        const { jsPDF } = window.jspdf;
        const CARD_W_MM = 85.6;
        const CARD_H_MM = 54;
        const SCALE     = 4;

        const frontCanvas = await html2canvas(cardEl, {
          scale: SCALE,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
          logging: false,
        });

        const pdf = new jsPDF({
          orientation: "landscape",
          unit: "mm",
          format: [CARD_W_MM, CARD_H_MM],
        });
        pdf.addImage(frontCanvas.toDataURL("image/png"), "PNG", 0, 0, CARD_W_MM, CARD_H_MM);

        if (isRwd) {
          const backWrap = document.createElement("div");
          backWrap.style.cssText = "position:fixed;top:-9999px;left:0;z-index:-999;width:340px;";
          backWrap.innerHTML = buildRwdBackHtml();
          document.body.appendChild(backWrap);
          const backEl = backWrap.querySelector(".vue-card");
          const backCanvas = await html2canvas(backEl, {
            scale: SCALE,
            useCORS: true,
            allowTaint: true,
            backgroundColor: null,
            logging: false,
          });
          document.body.removeChild(backWrap);
          pdf.addPage([CARD_W_MM, CARD_H_MM], "landscape");
          pdf.addImage(backCanvas.toDataURL("image/png"), "PNG", 0, 0, CARD_W_MM, CARD_H_MM);
          pdf.save("VUE_Card_—_Rewards.pdf");
        } else {
          pdf.save("VUE_Card_—_Print.pdf");
        }
      } catch (err) {
        console.error("[printBtn] PDF generation failed:", err);
        alert("Could not generate PDF. Please try again.");
      } finally {
        printBtn.disabled = false;
        printBtn.textContent = origTxt;
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      if (!cardPreview || !cardPreview.querySelector(".vue-card")) return;
      const cardEl  = cardPreview.querySelector(".vue-card");
      const origTxt = copyBtn.textContent;
      copyBtn.disabled = true;
      copyBtn.textContent = "Copying…";

      try {
        const canvas = await html2canvas(cardEl, {
          scale: 4,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
          logging: false,
        });
        canvas.toBlob(async (blob) => {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            copyBtn.textContent = "Copied!";
            setTimeout(() => { copyBtn.textContent = origTxt; copyBtn.disabled = false; }, 2000);
          } catch {
            copyBtn.textContent = "Not supported";
            setTimeout(() => { copyBtn.textContent = origTxt; copyBtn.disabled = false; }, 2000);
          }
        }, "image/png");
      } catch (err) {
        console.error("[copyBtn] failed:", err);
        copyBtn.textContent = "Failed";
        setTimeout(() => { copyBtn.textContent = origTxt; copyBtn.disabled = false; }, 2000);
      }
    });
  }

  if (waBtn) {
    waBtn.addEventListener("click", async () => {
      if (!cardPreview || !cardPreview.querySelector(".vue-card")) return;
      const cardEl  = cardPreview.querySelector(".vue-card");
      const origTxt = waBtn.textContent;
      waBtn.disabled = true;
      waBtn.textContent = "Preparing…";

      try {
        const canvas = await html2canvas(cardEl, {
          scale: 4,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
          logging: false,
        });
        canvas.toBlob(async (blob) => {
          const cardName = verifiedStaff
            ? `${verifiedStaff.firstName} ${verifiedStaff.lastName}`
            : "Customer";
          const fileName = selectedAction === "rewards-card"
            ? "VUE_Rewards_Card.png"
            : "VUE_Business_Card.png";
          const file = new File([blob], fileName, { type: "image/png" });

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
              await navigator.share({
                files: [file],
                title: "VUE Auto Parts Card",
                text: `Here is the VUE Auto Parts card for ${cardName}. Please forward to the customer.`,
              });
            } catch (err) {
              if (err.name !== "AbortError") {
                window.open("https://wa.me/16038662272?text=" + encodeURIComponent(`Card for ${cardName} — please forward to customer. (Attach card image manually)`), "_blank");
              }
            }
          } else {
            window.open("https://wa.me/16038662272?text=" + encodeURIComponent(`Card ready for ${cardName} — open the website to download and forward.`), "_blank");
          }

          waBtn.textContent = origTxt;
          waBtn.disabled = false;
        }, "image/png");
      } catch (err) {
        console.error("[waBtn] failed:", err);
        waBtn.textContent = origTxt;
        waBtn.disabled = false;
      }
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

  // ── Manage Rewards ─────────────────────────────────────────────

  async function doSearchRewards() {
    const query = (document.getElementById("stfManageSearch")?.value || "").trim();
    if (!query) { err2.textContent = "Enter a name or card number."; return; }
    err2.textContent = "";
    draftBtn.disabled = true;
    draftBtn.textContent = "Searching…";
    try {
      const res  = await fetch("/api/rewards-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { renderManagePanel(data.cards, query); showPanel(6); }
      else err2.textContent = data.error || "Search failed.";
    } catch {
      err2.textContent = "Connection error.";
    } finally {
      draftBtn.disabled = false;
      draftBtn.textContent = "Search →";
    }
  }

  function renderManagePanel(cards, query) {
    if (rwdResultCt)  rwdResultCt.textContent  = cards.length;
    if (rwdManageErr) rwdManageErr.textContent  = "";
    if (!rwdResults) return;

    if (cards.length === 0) {
      rwdResults.innerHTML = `<p class="stf-rwd-empty">No cards found for "<strong>${query}</strong>".</p>`;
      return;
    }

    rwdResults.innerHTML = cards.map(card => {
      const reward   = card.rewardOwed || 0;
      const isActive = card.status === "active";
      const issued   = (() => { try { return new Date(card.issuedDate).toLocaleDateString("en-ZW", { month: "short", year: "numeric" }); } catch { return "—"; } })();
      const statusLabel = { active: "Active", revoked: "Revoked", paid: "Paid" }[card.status] || card.status;
      return `<div class="stf-rwd-item">
  <div class="stf-rwd-item-header">
    <div class="stf-rwd-item-info">
      <strong class="stf-rwd-item-name">${card.name}</strong>
      <span class="stf-rwd-item-serial">${card.serial}</span>
      <span class="stf-rwd-item-date">Issued ${issued}${card.issuedBy ? " · " + card.issuedBy : ""}</span>
    </div>
    <span class="stf-rwd-status-badge stf-rwd-status-${card.status}">${statusLabel}</span>
  </div>
  <div class="stf-rwd-item-stats">
    <span>↗ <strong>${card.referrals || 0}</strong> referral${card.referrals === 1 ? "" : "s"}</span>
    <span>🛒 <strong>${card.purchases || 0}</strong> purchase${card.purchases === 1 ? "" : "s"}</span>
    <span class="${reward > 0 ? "stf-rwd-owed-active" : ""}">💰 <strong>$${reward}</strong> owed</span>
  </div>
  <div class="stf-rwd-item-actions">
    ${isActive ? `
    <button class="stf-rwd-btn" data-op="referral" data-serial="${card.serial}" data-query="${query}">+ Referral</button>
    <button class="stf-rwd-btn" data-op="purchase" data-serial="${card.serial}" data-query="${query}">+ Purchase</button>
    ${reward > 0 ? `<button class="stf-rwd-btn stf-rwd-btn-pay" data-op="pay" data-serial="${card.serial}" data-query="${query}" data-amount="${reward}">Pay $${reward} &amp; Revoke</button>` : ""}
    <button class="stf-rwd-btn stf-rwd-btn-revoke" data-op="revoke" data-serial="${card.serial}" data-query="${query}">Revoke</button>
    ` : `
    <button class="stf-rwd-btn stf-rwd-btn-renew" data-op="renew" data-serial="${card.serial}" data-query="${query}">Renew Card</button>
    `}
  </div>
</div>`;
    }).join("");

    rwdResults.querySelectorAll(".stf-rwd-btn").forEach(btn => {
      btn.addEventListener("click", () => handleManageOp(btn));
    });
  }

  async function handleManageOp(btn) {
    const op = btn.dataset.op, serial = btn.dataset.serial, query = btn.dataset.query || "";
    const orig = btn.textContent;

    if (op === "revoke") {
      const reason = prompt("Reason for revocation (optional):") ?? "Policy violation";
      btn.disabled = true; btn.textContent = "…";
      await callOp("/api/rewards-revoke", { serial, revokedBy: `${verifiedStaff.firstName} ${verifiedStaff.lastName}`, reason }, query, btn, orig);
    } else if (op === "pay") {
      const amount = btn.dataset.amount;
      if (!confirm(`Confirm: pay $${amount} reward and auto-revoke this card?`)) return;
      btn.disabled = true; btn.textContent = "…";
      await callOp("/api/rewards-pay", { serial, paidBy: `${verifiedStaff.firstName} ${verifiedStaff.lastName}` }, query, btn, orig);
    } else if (op === "renew") {
      btn.disabled = true; btn.textContent = "…";
      await callOp("/api/rewards-renew", { serial, renewedBy: `${verifiedStaff.firstName} ${verifiedStaff.lastName}` }, query, btn, orig);
    } else {
      btn.disabled = true; btn.textContent = "…";
      await callOp("/api/rewards-add", { serial, type: op, count: 1 }, query, btn, orig);
    }
  }

  async function callOp(url, body, query, btn, orig) {
    try {
      const res  = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const lr   = await fetch("/api/rewards-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
        const ld   = await lr.json().catch(() => ({}));
        if (ld.ok) renderManagePanel(ld.cards, query);
      } else {
        if (rwdManageErr) rwdManageErr.textContent = data.error || "Operation failed.";
        btn.disabled = false; btn.textContent = orig;
      }
    } catch {
      if (rwdManageErr) rwdManageErr.textContent = "Network error.";
      btn.disabled = false; btn.textContent = orig;
    }
  }

  // ── Card generation ────────────────────────────────────────────

  async function registerAndPreviewRewardsCard(name, phone) {
    currentCardSerial = generateSerial("VRC");
    if (cardPreview) cardPreview.innerHTML = buildRwdCardHtml(name);
    if (cardTitle)   cardTitle.textContent = "Rewards Card Preview";
    document.querySelectorAll(".stf-size-btn").forEach(b => b.classList.toggle("active", b.dataset.scale === "1"));
    if (cardScaler) cardScaler.style.transform = "scale(1)";
    if (cardStage)  cardStage.style.minHeight  = "272px";
    try {
      const res  = await fetch("/api/rewards-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serial: currentCardSerial, customerName: name, phone,
          staffName: `${verifiedStaff.firstName} ${verifiedStaff.lastName}`,
          staffRole: verifiedStaff.role,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { err2.textContent = data.error || "Card could not be registered."; return; }
    } catch {
      err2.textContent = "Card generated but could not be registered — check connection.";
      return;
    }
    showPanel(5);
  }

  function renderBizCardPreview() {
    if (cardPreview) cardPreview.innerHTML = buildBizCardHtml();
    if (cardTitle)   cardTitle.textContent = "Business Card Preview";
    document.querySelectorAll(".stf-size-btn").forEach(b => b.classList.toggle("active", b.dataset.scale === "1"));
    if (cardScaler) cardScaler.style.transform = "scale(1)";
    if (cardStage)  cardStage.style.minHeight  = "272px";
  }

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

  function showInsightsSuccess(type) {
    const label = type === "monthly" ? "Monthly Intelligence Brief" : "Daily Business Report";
    if (cardPreview) cardPreview.innerHTML = `
      <div style="text-align:center;padding:32px 16px">
        <div style="font-size:48px;margin-bottom:12px">📬</div>
        <div style="font-size:17px;font-weight:800;color:#0f4f36;margin-bottom:6px">${label} Sent!</div>
        <div style="font-size:13px;color:#666;line-height:1.5">Check <strong>info@vueautoparts.com</strong><br>for your AI-powered report.</div>
      </div>`;
    if (cardTitle) cardTitle.textContent = "Report Sent";
    if (cardScaler) cardScaler.style.transform = "scale(1)";
    if (cardStage)  cardStage.style.minHeight  = "200px";
    document.getElementById("stfCopyBtn").hidden = true;
    document.getElementById("stfWaBtn").hidden   = true;
    document.getElementById("stfPrintBtn").hidden = true;
    showPanel(5);
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

  function buildRwdCardHtml(customerName) {
    if (!currentCardSerial) currentCardSerial = generateSerial("VRC");
    const name   = customerName || (document.getElementById("stfRwdCustomer")?.value || "").trim() || "—";
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
    <div class="vue-rwd-name">${name}</div>
    <div class="vue-rwd-cardno">${currentCardSerial}</div>
  </div>
  <div class="vue-rwd-footer">
    <span>Valid for discounts · Chipinge, ZWE</span>
    <span>Issued ${issued}</span>
  </div>
</div>`;
  }

  function buildRwdBackHtml() {
    const serial = currentCardSerial || "—";
    return `<div class="vue-card vue-rwd-back">
  <div class="vue-card-wm vue-card-wm-light" aria-hidden="true">${buildWatermarkRows()}</div>
  <div class="vue-rwd-back-inner">
    <div class="vue-rwd-back-head">
      <span class="vue-rwd-back-brand">VUE AUTO PARTS</span>
      <span class="vue-rwd-back-sub">REWARDS PROGRAMME</span>
    </div>
    <div class="vue-rwd-back-rule"></div>
    <div class="vue-rwd-back-tiers">
      <div class="vue-rwd-back-tier">
        <span class="vue-rwd-back-stars">★★★★★</span>
        <span class="vue-rwd-back-tier-desc">5 referrals or purchases</span>
        <span class="vue-rwd-back-tier-val">$3.00</span>
      </div>
      <div class="vue-rwd-back-tier">
        <span class="vue-rwd-back-stars">★ × 15</span>
        <span class="vue-rwd-back-tier-desc">15 referrals or purchases</span>
        <span class="vue-rwd-back-tier-val">$7.00 max</span>
      </div>
    </div>
    <div class="vue-rwd-back-rule"></div>
    <p class="vue-rwd-back-terms">Not transferable. Valid at VUE Auto Parts, Chipinge, Zimbabwe only. This card may be revoked without prior notice for rude behaviour or any violation of store policy.</p>
    <div class="vue-rwd-back-serial">${serial}</div>
  </div>
</div>`;
  }
})();
