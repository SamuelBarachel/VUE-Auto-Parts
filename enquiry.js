(function () {
  const overlay  = document.getElementById("enqOverlay");
  const openBtn  = document.getElementById("enqOpen");
  const closeBtn = document.getElementById("enqClose");
  const panel1   = document.getElementById("enqPanel1");
  const panel2   = document.getElementById("enqPanel2");
  const panel3   = document.getElementById("enqPanel3");
  const nextBtn  = document.getElementById("enqNextBtn");
  const backBtn  = document.getElementById("enqBackBtn");
  const sendBtn  = document.getElementById("enqSendBtn");
  const err1     = document.getElementById("enqErr1");
  const err2     = document.getElementById("enqErr2");
  const draftTA  = document.getElementById("enqDraft");
  const loading  = document.getElementById("enqDraftLoading");
  const steps    = document.querySelectorAll(".enq-step");

  if (!overlay) return;

  function openModal(prefill) {
    if (prefill) {
      if (prefill.vehicle) document.getElementById("enqVehicle").value = prefill.vehicle;
      if (prefill.part)    document.getElementById("enqPart").value    = prefill.part;
    }
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    showPanel(1);
    setTimeout(() => overlay.classList.add("visible"), 10);
    document.getElementById("enqName").focus();
  }

  function closeModal() {
    overlay.classList.remove("visible");
    setTimeout(() => {
      overlay.hidden = true;
      document.body.style.overflow = "";
      resetModal();
    }, 280);
  }

  function resetModal() {
    showPanel(1);
    err1.textContent = "";
    err2.textContent = "";
    draftTA.value = "";
    draftTA.hidden = true;
    loading.hidden = false;
    sendBtn.disabled = true;
  }

  function showPanel(n) {
    panel1.hidden = n !== 1;
    panel2.hidden = n !== 2;
    panel3.hidden = n !== 3;
    steps.forEach(s => s.classList.toggle("active", Number(s.dataset.step) <= n && n < 3));
  }

  openBtn && openBtn.addEventListener("click", () => openModal());
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  backBtn.addEventListener("click", () => {
    err2.textContent = "";
    showPanel(1);
  });

  nextBtn.addEventListener("click", async () => {
    const name    = document.getElementById("enqName").value.trim();
    const phone   = document.getElementById("enqPhone").value.trim();
    const vehicle = document.getElementById("enqVehicle").value.trim();
    const part    = document.getElementById("enqPart").value.trim();

    if (!name)    { err1.textContent = "Please enter your name.";        return; }
    if (!vehicle) { err1.textContent = "Please enter your vehicle model."; return; }
    if (!part)    { err1.textContent = "Please enter the part you need."; return; }
    err1.textContent = "";

    nextBtn.disabled = true;
    nextBtn.textContent = "Drafting…";
    showPanel(2);
    loading.hidden = false;
    draftTA.hidden = true;
    sendBtn.disabled = true;

    try {
      const res  = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, vehicle, part }),
      });
      const data = await res.json().catch(() => ({}));
      draftTA.value = data.draft || "";
    } catch {
      draftTA.value = `Hi VUE Auto Parts,\n\nMy name is ${name}${phone ? " and my number is " + phone : ""}. I'm looking for ${part} for my ${vehicle}.\n\nPlease let me know if you have it and the price. Thank you.`;
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
    const name    = document.getElementById("enqName").value.trim();
    const phone   = document.getElementById("enqPhone").value.trim();
    const vehicle = document.getElementById("enqVehicle").value.trim();
    const part    = document.getElementById("enqPart").value.trim();
    const message = draftTA.value.trim();

    if (!message) { err2.textContent = "Message is empty."; return; }
    err2.textContent = "";
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";

    try {
      const res  = await fetch("/api/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, vehicle, part, message }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        showPanel(3);
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

  window.openEnquiryModal = openModal;
})();
