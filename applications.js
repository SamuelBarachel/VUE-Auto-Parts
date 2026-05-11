(function () {
  const panel7      = document.getElementById("stfPanel7");
  const appsBack    = document.getElementById("stfAppsBack");
  const appsResults = document.getElementById("stfAppsResults");
  const appsStats   = document.getElementById("stfAppsStats");
  const appsErr     = document.getElementById("stfAppsErr");
  if (!panel7) return;

  let _creds   = null;
  let _allApps = [];
  let _filter  = { status: "all", role: "all", name: "", sort: "newest" };

  window.VUEApps = {
    open: function (verifiedStaff, showPanelFn) {
      _creds = {
        directorFirst: verifiedStaff.firstName,
        directorLast:  verifiedStaff.lastName,
        directorId:    verifiedStaff.id,
        directorRole:  verifiedStaff.role,
      };
      loadApplications(showPanelFn);
    },
  };

  if (appsBack) {
    appsBack.addEventListener("click", () => {
      if (window._stfShowPanel) window._stfShowPanel(2);
    });
  }

  async function loadApplications(showPanelFn) {
    if (appsStats)   appsStats.innerHTML  = '<p class="enq-subtitle">Loading applications…</p>';
    if (appsErr)     appsErr.textContent  = "";
    if (appsResults) appsResults.innerHTML = '<div class="enq-draft-loading"><span class="enq-spinner"></span> Loading…</div>';
    if (showPanelFn) showPanelFn(7);

    try {
      const res  = await fetch("/api/staff/applications", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(_creds),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        if (appsErr)     appsErr.textContent    = data.error || "Could not load applications.";
        if (appsStats)   appsStats.innerHTML    = '<p class="enq-subtitle">Error loading.</p>';
        if (appsResults) appsResults.innerHTML  = "";
        return;
      }
      _allApps = data.applications || [];
      _filter  = { status: "all", role: "all", name: "" };
      renderStats(_allApps);
      renderFilterBar(_allApps);
      applyFilters();
    } catch {
      if (appsErr)     appsErr.textContent    = "Network error. Please try again.";
      if (appsStats)   appsStats.innerHTML    = '<p class="enq-subtitle">Error.</p>';
      if (appsResults) appsResults.innerHTML  = "";
    }
  }

  /* ── Stats block ──────────────────────────────────────────────────── */
  function renderStats(apps) {
    if (!appsStats) return;
    const pending  = apps.filter(a => a.status === "pending").length;
    const approved = apps.filter(a => a.status === "approved").length;
    const denied   = apps.filter(a => a.status === "denied").length;

    const roleMap = {};
    apps.forEach(a => {
      const r = a.role || "Unknown";
      if (!roleMap[r]) roleMap[r] = { total: 0, pending: 0, approved: 0, denied: 0 };
      roleMap[r].total++;
      if (roleMap[r][a.status] !== undefined) roleMap[r][a.status]++;
    });

    const roleRows = Object.entries(roleMap)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([role, c]) => `
        <div class="apps-role-row">
          <span class="apps-role-name">${role}</span>
          <span class="apps-role-counts">
            <span class="apps-rc-total">${c.total}</span>
            ${c.pending  ? `<span class="apps-rc apps-rc-pend">${c.pending} pending</span>`   : ""}
            ${c.approved ? `<span class="apps-rc apps-rc-appr">${c.approved} approved</span>` : ""}
            ${c.denied   ? `<span class="apps-rc apps-rc-deny">${c.denied} denied</span>`     : ""}
          </span>
        </div>`).join("");

    appsStats.innerHTML = `
      <div class="apps-stat-pills">
        <span class="apps-stat apps-stat-total"><strong>${apps.length}</strong> total</span>
        <span class="apps-stat apps-stat-pend"><strong>${pending}</strong> pending</span>
        <span class="apps-stat apps-stat-appr"><strong>${approved}</strong> approved</span>
        <span class="apps-stat apps-stat-deny"><strong>${denied}</strong> denied</span>
      </div>
      ${Object.keys(roleMap).length > 0 ? `
      <div class="apps-role-breakdown">
        <div class="apps-role-label">BY ROLE</div>
        ${roleRows}
      </div>` : ""}`;
  }

  /* ── Filter bar ───────────────────────────────────────────────────── */
  function renderFilterBar(apps) {
    let bar = document.getElementById("appsFilterBar");
    if (bar) bar.remove();

    const roles = [...new Set(apps.map(a => a.role || "Unknown"))].sort();

    bar = document.createElement("div");
    bar.id        = "appsFilterBar";
    bar.className = "apps-filter-bar";
    bar.innerHTML = `
      <div class="apps-filter-search-wrap">
        <svg class="apps-filter-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="8.5" cy="8.5" r="5.5"/><line x1="13" y1="13" x2="17" y2="17"/>
        </svg>
        <input id="appsSearchInput" class="apps-filter-search" type="text" placeholder="Search by name…" value="${escHtml(_filter.name)}" autocomplete="off">
        <button class="apps-filter-clear" id="appsSearchClear" type="button" aria-label="Clear search" style="${_filter.name ? "" : "display:none"}">✕</button>
      </div>
      <div class="apps-filter-row">
        <div class="apps-filter-status" role="group" aria-label="Filter by status">
          ${["all","pending","approved","denied"].map(s => `
            <button class="apps-fs-btn${_filter.status === s ? " active" : ""}" data-status="${s}" type="button">
              ${s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>`).join("")}
        </div>
        <div class="apps-filter-right">
          <select id="appsRoleSelect" class="apps-filter-select">
            <option value="all">All roles</option>
            ${roles.map(r => `<option value="${escHtml(r)}"${_filter.role === r ? " selected" : ""}>${escHtml(r)}</option>`).join("")}
          </select>
          <select id="appsSortSelect" class="apps-filter-select">
            <option value="newest"${_filter.sort === "newest" ? " selected" : ""}>Newest first</option>
            <option value="oldest"${_filter.sort === "oldest" ? " selected" : ""}>Oldest first</option>
            <option value="az"${_filter.sort === "az" ? " selected" : ""}>Name A → Z</option>
            <option value="za"${_filter.sort === "za" ? " selected" : ""}>Name Z → A</option>
          </select>
        </div>
      </div>
      <div class="apps-filter-count" id="appsFilterCount"></div>`;

    if (appsResults) appsResults.before(bar);

    bar.querySelector("#appsSearchInput").addEventListener("input", e => {
      _filter.name = e.target.value;
      bar.querySelector("#appsSearchClear").style.display = _filter.name ? "" : "none";
      applyFilters();
    });
    bar.querySelector("#appsSearchClear").addEventListener("click", () => {
      _filter.name = "";
      bar.querySelector("#appsSearchInput").value = "";
      bar.querySelector("#appsSearchClear").style.display = "none";
      bar.querySelector("#appsSearchInput").focus();
      applyFilters();
    });
    bar.querySelectorAll(".apps-fs-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _filter.status = btn.dataset.status;
        bar.querySelectorAll(".apps-fs-btn").forEach(b => b.classList.toggle("active", b === btn));
        applyFilters();
      });
    });
    bar.querySelector("#appsRoleSelect").addEventListener("change", e => {
      _filter.role = e.target.value;
      applyFilters();
    });
    bar.querySelector("#appsSortSelect").addEventListener("change", e => {
      _filter.sort = e.target.value;
      applyFilters();
    });
  }

  function escHtml(str) {
    return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  /* ── Filter + render list ─────────────────────────────────────────── */
  function applyFilters() {
    let filtered = _allApps.slice();
    if (_filter.status !== "all") filtered = filtered.filter(a => a.status === _filter.status);
    if (_filter.role   !== "all") filtered = filtered.filter(a => (a.role || "Unknown") === _filter.role);
    if (_filter.name.trim()) {
      const q = _filter.name.trim().toLowerCase();
      filtered = filtered.filter(a =>
        (a.first_name + " " + a.last_name).toLowerCase().includes(q)
      );
    }
    if (_filter.sort === "oldest") {
      filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (_filter.sort === "az") {
      filtered.sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name));
    } else if (_filter.sort === "za") {
      filtered.sort((a, b) => (b.last_name + b.first_name).localeCompare(a.last_name + a.first_name));
    } else {
      filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    const countEl = document.getElementById("appsFilterCount");
    if (countEl) {
      const isFiltered = _filter.status !== "all" || _filter.role !== "all" || _filter.name.trim();
      countEl.textContent = isFiltered
        ? `${filtered.length} of ${_allApps.length} application${_allApps.length !== 1 ? "s" : ""}`
        : "";
    }

    renderList(filtered);
  }

  /* ── Application list cards ───────────────────────────────────────── */
  function renderList(apps) {
    if (!appsResults) return;
    if (apps.length === 0) {
      const isFiltered = _filter.status !== "all" || _filter.role !== "all" || _filter.name.trim();
      appsResults.innerHTML = isFiltered
        ? '<p class="apps-empty">No applications match your filters.</p>'
        : '<p class="apps-empty">No applications yet.</p>';
      return;
    }

    appsResults.innerHTML = apps.map(app => {
      const submitted = (() => {
        try { return new Date(app.created_at).toLocaleDateString("en-ZW", { day: "numeric", month: "short", year: "numeric" }); }
        catch { return "—"; }
      })();
      const decidedAt = app.decided_at ? (() => {
        try { return new Date(app.decided_at).toLocaleDateString("en-ZW", { day: "numeric", month: "short", year: "numeric" }); }
        catch { return "—"; }
      })() : null;

      const statusLabel = { pending: "Pending", approved: "Approved", denied: "Denied" }[app.status] || app.status;
      const isPending   = app.status === "pending";
      const isDecided   = app.status === "approved" || app.status === "denied";

      const publishBtn = isDecided ? (
        app.letter_published
          ? `<button class="app-btn app-btn-published" disabled>Letter Published ✓</button>`
          : `<button class="app-btn app-btn-preview" data-op="preview" data-id="${app.id}">Preview Letter</button>
             <button class="app-btn app-btn-publish" data-op="publish" data-id="${app.id}">Publish Letter</button>`
      ) : "";

      const deleteBtn = isDecided
        ? `<button class="app-btn app-btn-delete" data-op="delete" data-id="${app.id}" data-name="${app.first_name} ${app.last_name}" title="Delete this application to free up space">Delete</button>`
        : "";

      const decisionButtons = isPending ? `
        <button class="app-btn app-btn-approve" data-op="approve" data-id="${app.id}">Approve</button>
        <button class="app-btn app-btn-deny"    data-op="deny"    data-id="${app.id}">Deny</button>
      ` : "";

      const notesRow   = app.decision_notes ? `<div class="app-item-notes">Director's note: ${app.decision_notes}</div>` : "";
      const decidedRow = decidedAt ? `<tr><td>Decided</td><td>${decidedAt} by ${app.decided_by || "—"}</td></tr>` : "";

      return `<div class="app-item" id="app-item-${app.id}">
  <div class="app-item-head">
    <div class="app-item-info">
      <div class="app-item-name">${app.first_name} ${app.last_name}</div>
      <div class="app-item-meta">${app.role} · Submitted ${submitted}</div>
    </div>
    <span class="app-status-badge app-status-${app.status}">${statusLabel}</span>
  </div>
  <div class="app-item-body">
    <table>
      <tr><td>ID Number</td><td>${app.id_number || "—"}</td></tr>
      <tr><td>Date of Birth</td><td>${app.dob || "—"}${app.age ? ` (Age ${app.age})` : ""}</td></tr>
      <tr><td>Sex</td><td>${app.sex || "—"}</td></tr>
      <tr><td>Location</td><td>${app.location || "—"}</td></tr>
      <tr><td>Phone</td><td>${app.phone || "—"}</td></tr>
      <tr><td>Email</td><td>${app.email || "—"}</td></tr>
      <tr><td>Computer</td><td>${app.computer_skills || "—"}</td></tr>
      ${app.medical ? `<tr><td>Health notes</td><td>${app.medical}</td></tr>` : ""}
      <tr><td>Signed</td><td>${app.signature || "—"}</td></tr>
      ${decidedRow}
    </table>
    ${app.draft ? `<button class="app-draft-toggle" data-id="${app.id}">Show application message ↓</button>
    <div class="app-draft-text" id="app-draft-${app.id}">${app.draft}</div>` : ""}
  </div>
  ${notesRow}
  <div class="app-item-actions">${decisionButtons}${publishBtn}${deleteBtn}</div>
</div>`;
    }).join("");

    appsResults.querySelectorAll(".app-draft-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const box = document.getElementById("app-draft-" + btn.dataset.id);
        if (!box) return;
        box.classList.toggle("open");
        btn.textContent = box.classList.contains("open") ? "Hide application message ↑" : "Show application message ↓";
      });
    });

    appsResults.querySelectorAll("[data-op]").forEach(btn => {
      btn.addEventListener("click", () => handleOp(btn));
    });
  }

  /* ── Action handlers ──────────────────────────────────────────────── */
  async function handleOp(btn) {
    const op   = btn.dataset.op;
    const id   = btn.dataset.id;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";

    if (op === "approve" || op === "deny") {
      const decision = op === "approve" ? "approved" : "denied";
      const notes    = prompt(`Optional note for this ${decision} decision (will appear on the record):`);
      if (notes === null) { btn.disabled = false; btn.textContent = orig; return; }
      try {
        const res  = await fetch("/api/staff/applications/decide", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ ..._creds, applicationId: id, decision, notes }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { reload(); }
        else { if (appsErr) appsErr.textContent = data.error || "Could not update."; btn.disabled = false; btn.textContent = orig; }
      } catch {
        if (appsErr) appsErr.textContent = "Network error.";
        btn.disabled = false; btn.textContent = orig;
      }

    } else if (op === "preview") {
      btn.textContent = orig; btn.disabled = false;
      try {
        const res = await fetch("/api/staff/applications/preview-pdf", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ ..._creds, applicationId: id }),
        });
        if (!res.ok) { const t = await res.text().catch(() => ""); if (appsErr) appsErr.textContent = "Preview failed: " + t; return; }
        const blobUrl = URL.createObjectURL(await res.blob());
        window.open(blobUrl, "_blank");
      } catch { if (appsErr) appsErr.textContent = "Could not generate preview."; }

    } else if (op === "delete") {
      const name = btn.dataset.name || "this applicant";
      if (!confirm(`Permanently delete the application for ${name}? This cannot be undone.`)) {
        btn.disabled = false; btn.textContent = orig; return;
      }
      try {
        const res  = await fetch("/api/staff/applications/delete", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ ..._creds, applicationId: id }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { reload(); }
        else { if (appsErr) appsErr.textContent = data.error || "Could not delete."; btn.disabled = false; btn.textContent = orig; }
      } catch {
        if (appsErr) appsErr.textContent = "Network error.";
        btn.disabled = false; btn.textContent = orig;
      }

    } else if (op === "publish") {
      if (!confirm("Publish this letter? The applicant will be able to download it immediately.")) {
        btn.disabled = false; btn.textContent = orig; return;
      }
      try {
        const res  = await fetch("/api/staff/applications/publish", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ ..._creds, applicationId: id }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { reload(); }
        else { if (appsErr) appsErr.textContent = data.error || "Could not publish."; btn.disabled = false; btn.textContent = orig; }
      } catch {
        if (appsErr) appsErr.textContent = "Network error.";
        btn.disabled = false; btn.textContent = orig;
      }
    }
  }

  function reload() { loadApplications(null); }
})();
