(function () {
  const overlay   = document.getElementById("rwdOverlay");
  const openBtn   = document.getElementById("rwdOpen");
  const closeBtn  = document.getElementById("rwdClose");
  const panel1    = document.getElementById("rwdPanel1");
  const panel2    = document.getElementById("rwdPanel2");
  const panel3    = document.getElementById("rwdPanel3");
  const nextBtn   = document.getElementById("rwdNextBtn");
  const backBtn   = document.getElementById("rwdBackBtn");
  const sendBtn   = document.getElementById("rwdSendBtn");
  const err1      = document.getElementById("rwdErr1");
  const err2      = document.getElementById("rwdErr2");
  const draftTA   = document.getElementById("rwdDraft");
  const loading   = document.getElementById("rwdDraftLoading");
  const step1     = document.getElementById("rwdStep1");
  const step2     = document.getElementById("rwdStep2");

  if (!overlay) return;

  function showPanel(n) {
    panel1.hidden = n !== 1;
    panel2.hidden = n !== 2;
    panel3.hidden = n !== 3;
    step1.classList.toggle("active", n >= 1 && n < 3);
    step2.classList.toggle("active", n >= 2 && n < 3);
  }

  function openModal() {
    overlay.hidden = false;
    document.body.style.overflowY = "hidden";
    showPanel(1);
    setTimeout(() => overlay.classList.add("visible"), 10);
    document.getElementById("rwdName").focus();
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
    err1.textContent = "";
    err2.textContent = "";
    draftTA.value = "";
    draftTA.hidden = true;
    loading.hidden = false;
    sendBtn.disabled = true;
    ["rwdName", "rwdLocation", "rwdPhone", "rwdId"].forEach(id => {
      document.getElementById(id).value = "";
    });
  }

  openBtn && openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  backBtn.addEventListener("click", () => {
    err2.textContent = "";
    showPanel(1);
  });

  nextBtn.addEventListener("click", async () => {
    const name     = document.getElementById("rwdName").value.trim();
    const location = document.getElementById("rwdLocation").value.trim();
    const phone    = document.getElementById("rwdPhone").value.trim();
    const idNumber = document.getElementById("rwdId").value.trim();

    if (!name)     { err1.textContent = "Please enter your full name.";     return; }
    if (!location) { err1.textContent = "Please enter where you live.";     return; }
    if (!phone)    { err1.textContent = "Please enter your phone number.";  return; }
    if (!idNumber) { err1.textContent = "Please enter your ID number.";     return; }
    err1.textContent = "";

    nextBtn.disabled = true;
    nextBtn.textContent = "Drafting…";
    showPanel(2);
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
})();
