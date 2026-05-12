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
      renderLookup();
      if (showPanelFn) showPanelFn(7);
    },
  };

  if (appsBack) {
    appsBack.addEventListener("click", () => {
      if (window._stfShowPanel) window._stfShowPanel(2);
    });
  }

  // ── Step 1: Look up by National ID ─────────────────────────────────
  function renderLookup() {
    const container = document.getElementById("stfAppsContainer");
    if (!container) return;
    container.innerHTML = `
      <div class="apps-form-wrap">
        <p class="enq-subtitle" style="margin-bottom:20px">
          Enter the applicant's National ID to look up their saved record, or start a new application entry from scratch.
        </p>
        <div class="enq-field" style="display:flex;gap:10px;align-items:flex-end">
          <div style="flex:1">
            <label for="appsLookupId">National ID Number</label>
            <input id="appsLookupId" class="enq-input" type="text" autocomplete="off" placeholder="e.g. 63-123456 A 00">
          </div>
          <button class="enq-btn" id="appsLookupBtn" type="button" style="white-space:nowrap;flex-shrink:0">Look Up →</button>
        </div>
        <div id="appsLookupErr" class="enq-err" aria-live="polite" style="margin:8px 0 0"></div>
        <div style="margin-top:18px;padding-top:16px;border-top:1px solid #e5e7eb">
          <button class="enq-btn-outline" id="appsNewBtn" type="button">+ New Applicant Entry</button>
        </div>
      </div>`;

    document.getElementById("appsLookupBtn").addEventListener("click", handleLookup);
    document.getElementById("appsLookupId").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleLookup();
    });
    document.getElementById("appsNewBtn").addEventListener("click", () => renderForm({}));
  }

  async function handleLookup() {
    const nationalId = (document.getElementById("appsLookupId")?.value || "").trim();
    const errEl      = document.getElementById("appsLookupErr");
    const btn        = document.getElementById("appsLookupBtn");
    if (errEl) errEl.textContent = "";

    if (!nationalId) {
      if (errEl) errEl.textContent = "Please enter a National ID number.";
      return;
    }

    btn.disabled    = true;
    btn.textContent = "Looking up…";

    try {
      const res  = await fetch("/api/staff/lookup-applicant", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ..._creds, nationalId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.applicant) {
        renderForm(data.applicant);
      } else {
        if (errEl) errEl.textContent = data.error || "No record found. You can enter their details as a new entry below.";
        btn.disabled    = false;
        btn.textContent = "Look Up →";
      }
    } catch {
      if (errEl) errEl.textContent = "Network error. Please try again.";
      btn.disabled    = false;
      btn.textContent = "Look Up →";
    }
  }

  // ── Step 2: Full form (new or pre-filled from lookup) ──────────────
  function renderForm(pre) {
    const container = document.getElementById("stfAppsContainer");
    if (!container) return;
    const isExisting = pre && pre.firstName;
    const badge = isExisting
      ? `<div style="display:inline-block;background:#e8f5ee;color:#0f4f36;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:14px">Record found — details pre-filled</div>`
      : "";

    container.innerHTML = `
      <div class="apps-form-wrap">
        ${badge}
        <p class="enq-subtitle" style="margin-bottom:18px">An AI-written formal letter will be composed and emailed directly to the applicant, signed by Samuel Takwirira, Director.</p>
        <div class="enq-field">
          <label for="appsNationalId">National ID Number <span class="req">*</span></label>
          <input id="appsNationalId" class="enq-input" type="text" autocomplete="off"
            placeholder="e.g. 63-123456 A 00"
            value="${esc(pre.nationalId || "")}">
        </div>
        <div class="enq-fields-grid">
          <div class="enq-field">
            <label for="appsFName">First Name <span class="req">*</span></label>
            <input id="appsFName" class="enq-input" type="text" autocomplete="off"
              placeholder="e.g. Tendai"
              value="${esc(pre.firstName || "")}">
          </div>
          <div class="enq-field">
            <label for="appsLName">Last Name <span class="req">*</span></label>
            <input id="appsLName" class="enq-input" type="text" autocomplete="off"
              placeholder="e.g. Moyo"
              value="${esc(pre.lastName || "")}">
          </div>
        </div>
        <div class="enq-field">
          <label for="appsEmail">Applicant Email Address <span class="req">*</span></label>
          <input id="appsEmail" class="enq-input" type="email" autocomplete="off"
            placeholder="e.g. tendai@gmail.com"
            value="${esc(pre.email || "")}">
        </div>
        <div class="enq-field">
          <label for="appsPhone">Phone Number <span class="enq-opt">(optional)</span></label>
          <input id="appsPhone" class="enq-input" type="text" autocomplete="off"
            placeholder="e.g. +263 77 123 4567"
            value="${esc(pre.phone || "")}">
        </div>
        <div class="enq-field">
          <label for="appsLocation">Location <span class="enq-opt">(optional)</span></label>
          <input id="appsLocation" class="enq-input" type="text" autocomplete="off"
            placeholder="e.g. Chipinge, Zimbabwe"
            value="${esc(pre.location || "")}">
        </div>
        <div class="enq-field">
          <label for="appsRole">Role Applied For <span class="req">*</span></label>
          <input id="appsRole" class="enq-input" type="text" autocomplete="off"
            placeholder="e.g. Sales Assistant"
            value="${esc(pre.role || "")}">
        </div>
        <div class="enq-field">
          <label for="appsStatus">Application Status <span class="req">*</span></label>
          <select id="appsStatus" class="enq-input stf-select">
            <option value="">— Select a status —</option>
            <option value="under-review" ${pre.status === "under-review" ? "selected" : ""}>Under Review</option>
            <option value="accepted"     ${pre.status === "accepted"     ? "selected" : ""}>Accepted</option>
            <option value="rejected"     ${pre.status === "rejected"     ? "selected" : ""}>Rejected</option>
          </select>
        </div>
        <div class="enq-field">
          <label for="appsNote">Director's Note <span class="enq-opt">(optional — guides the AI letter)</span></label>
          <textarea id="appsNote" class="enq-input enq-textarea" rows="2"
            placeholder="e.g. Start date is 1 June. Bring original ID and references.">${esc(pre.note || "")}</textarea>
        </div>
        <div id="appsFormErr" class="enq-err" aria-live="polite" style="margin-bottom:8px"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="enq-btn-outline" id="appsBackBtn" type="button">← Back</button>
          <button class="enq-btn" id="appsSendBtn" type="button">Send Status Email →</button>
        </div>
      </div>`;

    document.getElementById("appsBackBtn").addEventListener("click", renderLookup);
    document.getElementById("appsSendBtn").addEventListener("click", handleSend);
  }

  function esc(str) {
    return String(str).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ── Send ────────────────────────────────────────────────────────────
  async function handleSend() {
    const nationalId = (document.getElementById("appsNationalId")?.value || "").trim();
    const fName      = (document.getElementById("appsFName")?.value      || "").trim();
    const lName      = (document.getElementById("appsLName")?.value      || "").trim();
    const email      = (document.getElementById("appsEmail")?.value      || "").trim();
    const phone      = (document.getElementById("appsPhone")?.value      || "").trim();
    const location   = (document.getElementById("appsLocation")?.value   || "").trim();
    const role       = (document.getElementById("appsRole")?.value       || "").trim();
    const status     = (document.getElementById("appsStatus")?.value     || "");
    const note       = (document.getElementById("appsNote")?.value       || "").trim();
    const errEl      = document.getElementById("appsFormErr");
    const btn        = document.getElementById("appsSendBtn");

    if (errEl) errEl.textContent = "";

    if (!nationalId || !fName || !lName || !email || !role || !status) {
      if (errEl) errEl.textContent = "Please fill in all required fields (National ID, name, email, role, status).";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (errEl) errEl.textContent = "Please enter a valid email address.";
      return;
    }

    btn.disabled    = true;
    btn.textContent = "Sending email…";

    try {
      const res  = await fetch("/api/staff/send-status", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          ..._creds,
          nationalId,
          applicantFirst:    fName,
          applicantLast:     lName,
          applicantEmail:    email,
          applicantPhone:    phone,
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
        btn.textContent = "Send Status Email →";
      }
    } catch {
      if (errEl) errEl.textContent = "Network error. Please try again.";
      btn.disabled    = false;
      btn.textContent = "Send Status Email →";
    }
  }

  // ── Success screen ──────────────────────────────────────────────────
  function showSuccess(data) {
    const container = document.getElementById("stfAppsContainer");
    if (!container) return;
    const colorMap = { "Under Review": "#b8902a", "Accepted": "#0f4f36", "Rejected": "#6b7280" };
    const color    = colorMap[data.statusLabel] || "#0f4f36";
    container.innerHTML = `
      <div class="apps-success">
        <div class="apps-success-icon" style="color:${color}">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8"/>
            <polyline points="2 6 12 12 22 6"/>
            <polyline points="16 19 19 22 23 18"/>
          </svg>
        </div>
        <h3 class="apps-success-title">Email Sent Successfully</h3>
        <p class="apps-success-msg">
          A formal <strong style="color:${color}">${data.statusLabel}</strong> email was written by AI,
          signed by <strong>Samuel Takwirira, Director</strong>, and sent to
          <strong>${data.email}</strong>.
          <br><br>
          The applicant's record has been saved and can be retrieved by National ID next time.
          A copy was also sent to <strong>info@vueautoparts.com</strong>.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:4px">
          <button class="enq-btn-outline" id="appsLookupAnother" type="button">Look Up Another →</button>
          <button class="enq-btn" id="appsSendAnother" type="button">New Entry →</button>
        </div>
      </div>`;
    document.getElementById("appsLookupAnother").addEventListener("click", renderLookup);
    document.getElementById("appsSendAnother").addEventListener("click", () => renderForm({}));
  }
})();
