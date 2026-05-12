(function () {
  const panel7   = document.getElementById("stfPanel7");
  const appsBack = document.getElementById("stfAppsBack");
  if (!panel7) return;

  let _creds = null;

  window.VueApps = {
    open: function (verifiedStaff, showPanelFn) {
      _creds = {
        directorFirst: verifiedStaff.firstName,
        directorLast:  verifiedStaff.lastName,
        directorId:    verifiedStaff.id,
        directorRole:  verifiedStaff.role,
      };
      renderForm();
      if (showPanelFn) showPanelFn(7);
    },
  };

  if (appsBack) {
    appsBack.addEventListener("click", () => {
      if (window._stfShowPanel) window._stfShowPanel(2);
    });
  }

  function renderForm() {
    const container = document.getElementById("stfAppsContainer");
    if (!container) return;
    container.innerHTML = `
      <div class="apps-form-wrap">
        <p class="enq-subtitle" style="margin-bottom:20px">Enter the applicant's details and select their new status. An AI-written formal letter will be generated, electronically signed by Samuel Takwirira (Director), and emailed to the applicant as a PDF attachment.</p>
        <div class="enq-fields-grid">
          <div class="enq-field">
            <label for="appsFName">First Name <span class="req">*</span></label>
            <input id="appsFName" class="enq-input" type="text" autocomplete="off" placeholder="e.g. Tendai">
          </div>
          <div class="enq-field">
            <label for="appsLName">Last Name <span class="req">*</span></label>
            <input id="appsLName" class="enq-input" type="text" autocomplete="off" placeholder="e.g. Moyo">
          </div>
        </div>
        <div class="enq-field">
          <label for="appsEmail">Applicant Email Address <span class="req">*</span></label>
          <input id="appsEmail" class="enq-input" type="email" autocomplete="off" placeholder="e.g. tendai@gmail.com">
        </div>
        <div class="enq-field">
          <label for="appsLocation">Applicant Location <span class="enq-opt">(optional — appears on the letter header)</span></label>
          <input id="appsLocation" class="enq-input" type="text" autocomplete="off" placeholder="e.g. Chipinge, Zimbabwe">
        </div>
        <div class="enq-field">
          <label for="appsRole">Role Applied For <span class="req">*</span></label>
          <input id="appsRole" class="enq-input" type="text" autocomplete="off" placeholder="e.g. Sales Assistant">
        </div>
        <div class="enq-field">
          <label for="appsStatus">New Application Status <span class="req">*</span></label>
          <select id="appsStatus" class="enq-input stf-select">
            <option value="">— Select a status —</option>
            <option value="under-review">Under Review</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div class="enq-field">
          <label for="appsNote">Director's Note <span class="enq-opt">(optional — guides the AI letter)</span></label>
          <textarea id="appsNote" class="enq-input enq-textarea" rows="2" placeholder="e.g. Start date is 1 June. Bring original ID and references."></textarea>
        </div>
        <div id="appsFormErr" class="enq-err" aria-live="polite" style="margin-bottom:8px"></div>
        <button class="enq-btn" id="appsSendBtn" type="button">Generate &amp; Send Letter →</button>
      </div>`;

    document.getElementById("appsSendBtn").addEventListener("click", handleSend);
  }

  async function handleSend() {
    const fName    = (document.getElementById("appsFName")?.value   || "").trim();
    const lName    = (document.getElementById("appsLName")?.value   || "").trim();
    const email    = (document.getElementById("appsEmail")?.value   || "").trim();
    const location = (document.getElementById("appsLocation")?.value|| "").trim();
    const role     = (document.getElementById("appsRole")?.value    || "").trim();
    const status   = (document.getElementById("appsStatus")?.value  || "");
    const note     = (document.getElementById("appsNote")?.value    || "").trim();
    const errEl    = document.getElementById("appsFormErr");
    const btn      = document.getElementById("appsSendBtn");

    if (errEl) errEl.textContent = "";

    if (!fName || !lName || !email || !role || !status) {
      if (errEl) errEl.textContent = "Please fill in all required fields.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (errEl) errEl.textContent = "Please enter a valid email address.";
      return;
    }

    btn.disabled    = true;
    btn.textContent = "Generating letter…";

    try {
      const res  = await fetch("/api/staff/send-status", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          ..._creds,
          applicantFirst:    fName,
          applicantLast:     lName,
          applicantEmail:    email,
          applicantLocation: location,
          role,
          status,
          note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        showSuccess(data);
      } else {
        if (errEl) errEl.textContent = data.error || "Could not send. Please try again.";
        btn.disabled    = false;
        btn.textContent = "Generate & Send Letter →";
      }
    } catch {
      if (errEl) errEl.textContent = "Network error. Please try again.";
      btn.disabled    = false;
      btn.textContent = "Generate & Send Letter →";
    }
  }

  function showSuccess(data) {
    const container = document.getElementById("stfAppsContainer");
    if (!container) return;
    const colorMap = { "Under Review": "#b8902a", "Accepted": "#0f4f36", "Rejected": "#6b7280" };
    const color = colorMap[data.statusLabel] || "#0f4f36";
    container.innerHTML = `
      <div class="apps-success">
        <div class="apps-success-icon" style="color:${color}">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8"/>
            <polyline points="2 6 12 12 22 6"/>
            <polyline points="16 19 19 22 23 18"/>
          </svg>
        </div>
        <h3 class="apps-success-title">Letter Sent Successfully</h3>
        <p class="apps-success-msg">
          A formal <strong style="color:${color}">${data.statusLabel}</strong> letter was written by AI,
          signed by <strong>Samuel Takwirira, Director</strong>, and emailed to
          <strong>${data.email}</strong> with the official PDF letter attached.
          <br><br>
          A copy was also sent to <strong>info@vueautoparts.com</strong>.
        </p>
        <button class="enq-btn" id="appsSendAnother" type="button" style="margin-top:4px">Send Another →</button>
      </div>`;
    document.getElementById("appsSendAnother").addEventListener("click", renderForm);
  }
})();
