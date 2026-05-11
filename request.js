(function () {
  const overlay   = document.getElementById("reqOverlay");
  const closeBtn  = document.getElementById("reqClose");
  const openBtn   = document.getElementById("reqOpen");
  const doneBtn   = document.getElementById("reqDone");
  const submitBtn = document.getElementById("reqSubmit");
  const errorEl   = document.getElementById("reqError");
  const panelForm = document.getElementById("reqPanelForm");
  const panelDone = document.getElementById("reqPanelDone");

  if (!overlay || !openBtn) return;

  function openModal() {
    overlay.hidden = false;
    document.body.style.overflowY = "hidden";
    setTimeout(() => overlay.classList.add("visible"), 10);
    showPanel("form");
    clearError();
  }

  function closeModal() {
    overlay.classList.remove("visible");
    setTimeout(() => {
      overlay.hidden = true;
      document.body.style.overflowY = "";
      resetForm();
    }, 280);
  }

  function showPanel(panel) {
    panelForm.hidden = panel !== "form";
    panelDone.hidden = panel !== "done";
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function resetForm() {
    ["reqName", "reqPhone", "reqVehicle", "reqPart", "reqNote"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    clearError();
    showPanel("form");
  }

  async function submit() {
    clearError();
    const name    = document.getElementById("reqName").value.trim();
    const phone   = document.getElementById("reqPhone").value.trim();
    const vehicle = document.getElementById("reqVehicle").value.trim();
    const part    = document.getElementById("reqPart").value.trim();
    const note    = document.getElementById("reqNote").value.trim();

    if (!name)    return showError("Please enter your name.");
    if (!vehicle) return showError("Please enter your vehicle model.");
    if (!part)    return showError("Please describe the part you need.");

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
      const res = await fetch("/api/part-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, vehicle, part, note }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Something went wrong.");
      showPanel("done");
    } catch (err) {
      showError(err.message || "Could not submit. Please WhatsApp us directly.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit request";
    }
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  doneBtn && doneBtn.addEventListener("click", closeModal);
  submitBtn.addEventListener("click", submit);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });
})();
