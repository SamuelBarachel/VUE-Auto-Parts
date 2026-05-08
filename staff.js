(function () {
  const brandBtn   = document.getElementById("brandLogo");
  const overlay    = document.getElementById("stfOverlay");
  if (!overlay || !brandBtn) return;

  const closeBtn   = document.getElementById("stfClose");
  const panel1     = document.getElementById("stfPanel1");
  const panel2     = document.getElementById("stfPanel2");
  const panel3     = document.getElementById("stfPanel3");
  const panel4     = document.getElementById("stfPanel4");
  const verifyBtn  = document.getElementById("stfVerifyBtn");
  const draftBtn   = document.getElementById("stfDraftBtn");
  const backBtn2   = document.getElementById("stfBack2");
  const backBtn3   = document.getElementById("stfBack3");
  const sendBtn    = document.getElementById("stfSendBtn");
  const err1       = document.getElementById("stfErr1");
  const err2       = document.getElementById("stfErr2");
  const err3       = document.getElementById("stfErr3");
  const draftTA    = document.getElementById("stfDraft");
  const loading    = document.getElementById("stfDraftLoading");
  const verifyLoad = document.getElementById("stfVerifyLoading");
  const confirmedName = document.getElementById("stfConfirmedName");
  const confirmedRole = document.getElementById("stfConfirmedRole");
  const steps      = [
    document.getElementById("stfStep1"),
    document.getElementById("stfStep2"),
    document.getElementById("stfStep3"),
  ];

  const actionCards = document.querySelectorAll(".stf-action-card");
  const contextSections = document.querySelectorAll(".stf-context");

  let selectedAction = null;
  let verifiedStaff  = null;

  function setStep(n) {
    steps.forEach((s, i) => {
      s.classList.toggle("active", i < n);
    });
  }

  function showPanel(n) {
    panel1.hidden = n !== 1;
    panel2.hidden = n !== 2;
    panel3.hidden = n !== 3;
    panel4.hidden = n !== 4;
    setStep(n);
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
    err1.textContent = "";
    err2.textContent = "";
    err3.textContent = "";
    draftTA.value = "";
    draftTA.hidden = true;
    loading.hidden = false;
    sendBtn.disabled = true;
    selectedAction = null;
    verifiedStaff = null;
    actionCards.forEach(c => c.classList.remove("selected"));
    contextSections.forEach(s => s.hidden = true);
    document.getElementById("stfNotesWrap").hidden = true;
    draftBtn.disabled = true;
  }

  brandBtn.addEventListener("click", e => {
    e.preventDefault();
    openModal();
  });
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  backBtn2.addEventListener("click", () => {
    err2.textContent = "";
    showPanel(1);
  });

  backBtn3.addEventListener("click", () => {
    err3.textContent = "";
    showPanel(2);
  });

  actionCards.forEach(card => {
    card.addEventListener("click", () => {
      actionCards.forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedAction = card.dataset.action;
      contextSections.forEach(s => s.hidden = true);
      document.getElementById("stfNotesWrap").hidden = false;
      const ctx = document.getElementById("stfCtx_" + selectedAction);
      if (ctx) ctx.hidden = false;
      draftBtn.disabled = false;
      err2.textContent = "";
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
})();
