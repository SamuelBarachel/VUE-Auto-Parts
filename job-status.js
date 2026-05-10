(function () {
  const overlay    = document.getElementById("jobStatusOverlay");
  const closeBtn   = document.getElementById("jobStatusClose");
  const openBtn    = document.getElementById("jobStatusOpen");
  const panelSearch = document.getElementById("jobStatusPanelSearch");
  const panelResult = document.getElementById("jobStatusPanelResult");
  const resultContent = document.getElementById("jsResultContent");
  const jsErr      = document.getElementById("jsErr");
  const checkBtn   = document.getElementById("jsCheckBtn");
  const backBtn    = document.getElementById("jsBackBtn");
  const daySelect  = document.getElementById("jsDobDay");
  const yearSelect = document.getElementById("jsDobYear");
  const monthSelect = document.getElementById("jsDobMonth");

  if (!overlay || !openBtn) return;

  function openModal() {
    overlay.hidden = false;
    document.body.style.overflowY = "hidden";
    setTimeout(() => overlay.classList.add("visible"), 10);
    showSearch();
    populateYears();
  }

  function closeModal() {
    overlay.classList.remove("visible");
    setTimeout(() => {
      overlay.hidden = true;
      document.body.style.overflowY = "";
    }, 280);
  }

  function showSearch() {
    panelSearch.hidden = false;
    panelResult.hidden = true;
    if (jsErr) jsErr.textContent = "";
  }

  function showResult() {
    panelSearch.hidden = true;
    panelResult.hidden = false;
  }

  function populateYears() {
    if (!yearSelect) return;
    const cur = parseInt(yearSelect.value) || 0;
    yearSelect.innerHTML = '<option value="">Year</option>';
    const now = new Date().getFullYear();
    for (let y = now - 16; y >= now - 80; y--) {
      const opt = document.createElement("option");
      opt.value = y; opt.textContent = y;
      if (y === cur) opt.selected = true;
      yearSelect.appendChild(opt);
    }
  }

  function populateDays() {
    if (!daySelect || !monthSelect || !yearSelect) return;
    const month  = parseInt(monthSelect.value) || 0;
    const year   = parseInt(yearSelect.value)  || new Date().getFullYear();
    const maxDay = month ? new Date(year, month, 0).getDate() : 31;
    const prev   = parseInt(daySelect.value) || 0;
    daySelect.innerHTML = '<option value="">Day</option>';
    for (let d = 1; d <= maxDay; d++) {
      const opt = document.createElement("option");
      opt.value = d; opt.textContent = d;
      if (d === prev) opt.selected = true;
      daySelect.appendChild(opt);
    }
  }

  if (monthSelect) monthSelect.addEventListener("change", populateDays);
  if (yearSelect)  yearSelect.addEventListener("change",  populateDays);

  openBtn.addEventListener("click",  openModal);
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click",  e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });
  if (backBtn) backBtn.addEventListener("click", showSearch);

  if (checkBtn) {
    checkBtn.addEventListener("click", async () => {
      const firstName = (document.getElementById("jsFirstName")?.value || "").trim();
      const lastName  = (document.getElementById("jsLastName")?.value  || "").trim();
      const idNumber  = (document.getElementById("jsIdNumber")?.value  || "").trim();
      const dobMonth  = (monthSelect?.value || "").trim();
      const dobDay    = (daySelect?.value   || "").trim();
      const dobYear   = (yearSelect?.value  || "").trim();

      if (!firstName) { jsErr.textContent = "Please enter your first name.";        return; }
      if (!lastName)  { jsErr.textContent = "Please enter your last name.";         return; }
      if (!idNumber)  { jsErr.textContent = "Please enter your National ID number."; return; }
      if (!dobMonth || !dobDay || !dobYear) { jsErr.textContent = "Please enter your full date of birth."; return; }

      jsErr.textContent = "";
      checkBtn.disabled = true;
      checkBtn.textContent = "Checking…";

      try {
        const res  = await fetch("/api/jobs-status", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ firstName, lastName, idNumber, dobMonth, dobDay, dobYear }),
        });
        const data = await res.json().catch(() => ({}));

        if (!data.ok) {
          jsErr.textContent = data.error || "No application found.";
          return;
        }

        renderResult(data, firstName, lastName, idNumber);
        showResult();
      } catch {
        jsErr.textContent = "Connection error. Please try again.";
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = "Check Status →";
      }
    });
  }

  function renderResult(data, firstName, lastName, idNumber) {
    const statusMessages = {
      pending:  "Your application is being reviewed. Our director will make a decision soon — we appreciate your patience.",
      approved: "Congratulations! Your application has been approved. A member of our team will be in contact with you to discuss next steps and your start date.",
      denied:   "Thank you sincerely for your interest in VUE Auto Parts. After careful review, we are unable to offer you this position at this time. We wish you every success in your future endeavours.",
    };

    const statusIcons = { pending: "⏳", approved: "✓", denied: "✕" };
    const statusLabels = { pending: "Under Review", approved: "Approved", denied: "Not Selected" };

    const submittedAt = (() => {
      try { return new Date(data.submittedAt).toLocaleDateString("en-ZW", { day: "numeric", month: "long", year: "numeric" }); }
      catch { return "—"; }
    })();

    const isDecided = data.status === "approved" || data.status === "denied";
    const letterUrl = `/api/jobs/letter?id=${data.applicationId}&fn=${encodeURIComponent(firstName.toLowerCase())}&ln=${encodeURIComponent(lastName.toLowerCase())}&idn=${encodeURIComponent(idNumber.replace(/-/g, "").toLowerCase())}`;
    const letterType = data.status === "approved" ? "Offer Letter" : "Outcome Letter";

    const tl = (stage) => {
      if (stage === "received") return "tl-done";
      if (stage === "review")   return isDecided ? "tl-done" : "tl-current";
      if (stage === "decision") return isDecided ? "tl-done" : "";
      if (stage === "letter")   return data.letterAvailable ? "tl-done" : (isDecided ? "tl-current" : "");
      return "";
    };
    const tlDot = (stage) => {
      const cls = tl(stage);
      if (cls === "tl-done")    return "✓";
      if (cls === "tl-current") return "·";
      return "";
    };

    const letterSection = data.letterAvailable
      ? `<div class="js-download-wrap">
           <div class="js-download-info">
             <div class="js-download-title">${letterType} ready</div>
             <div class="js-download-sub">Tap to download your official letter (PDF)</div>
           </div>
           <a class="js-download-btn" href="${letterUrl}" target="_blank" download>
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
             Download
           </a>
         </div>`
      : (isDecided
          ? `<div class="js-letter-pending">
               <strong>Letter being prepared</strong><br>
               Your ${letterType.toLowerCase()} will appear here once it's published by the director.
             </div>`
          : "");

    if (resultContent) {
      resultContent.innerHTML = `
        <div class="js-result-card">
          <div class="js-result-head">
            <div class="js-result-eyebrow">VUE Auto Parts &middot; Application Status</div>
            <div class="js-result-name">${firstName} ${lastName}</div>
            <div class="js-result-role">Applied for: ${data.role || "Position"}</div>
          </div>
          <div class="js-result-body">
            <div class="js-timeline">
              <div class="js-tl-item tl-done">
                <div class="js-tl-dot">✓</div>
                <div class="js-tl-label">Received</div>
              </div>
              <div class="js-tl-item ${tl("review")}">
                <div class="js-tl-dot">${tlDot("review")}</div>
                <div class="js-tl-label">Review</div>
              </div>
              <div class="js-tl-item ${tl("decision")}">
                <div class="js-tl-dot">${tlDot("decision")}</div>
                <div class="js-tl-label">Decision</div>
              </div>
              <div class="js-tl-item ${tl("letter")}">
                <div class="js-tl-dot">${tlDot("letter")}</div>
                <div class="js-tl-label">Letter</div>
              </div>
            </div>
            <div class="js-status-badge js-status-${data.status}">
              ${statusIcons[data.status] || ""} ${statusLabels[data.status] || data.status}
            </div>
            <p class="js-result-msg">${statusMessages[data.status] || "Status unknown."}</p>
            ${letterSection}
            <div class="js-result-meta">Submitted ${submittedAt}</div>
          </div>
        </div>
      `;
    }
  }
})();
