(function () {
  const form = document.getElementById("enquiryForm");
  const statusEl = document.getElementById("enquiryStatus");
  const submitBtn = form && form.querySelector(".enquiry-submit");

  if (!form) return;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const name = form.querySelector("#enqName").value.trim();
    const vehicle = form.querySelector("#enqVehicle").value.trim();
    const part = form.querySelector("#enqPart").value.trim();
    const notes = form.querySelector("#enqNotes").value.trim();

    if (!name || !vehicle || !part) {
      setStatus("Please fill in your name, vehicle and part needed.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    setStatus("", "");

    try {
      const res = await fetch("/api/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, vehicle, part, notes }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setStatus("Enquiry sent! We'll get back to you soon.", "success");
        form.reset();
      } else {
        setStatus(data.error || "Something went wrong. Please try WhatsApp.", "error");
      }
    } catch {
      setStatus("Network error. Please try WhatsApp at +16038662272.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send enquiry";
    }
  });

  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = "enquiry-status" + (type ? " " + type : "");
  }
})();
