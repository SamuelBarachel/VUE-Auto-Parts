(function () {
  const panel7      = document.getElementById("stfPanel7");
  const appsBack    = document.getElementById("stfAppsBack");
  const appsResults = document.getElementById("stfAppsResults");
  const appsStats   = document.getElementById("stfAppsStats");
  const appsErr     = document.getElementById("stfAppsErr");
  if (!panel7) return;

  let _creds = null;

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
    if (appsStats)   appsStats.textContent   = "Loading applications…";
    if (appsErr)     appsErr.textContent     = "";
    if (appsResults) appsResults.innerHTML   = '<div class="enq-draft-loading"><span class="enq-spinner"></span> Loading…</div>';
    if (showPanelFn) showPanelFn(7);

    try {
      const res  = await fetch("/api/staff/applications", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(_creds),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        if (appsErr)     appsErr.textContent   = data.error || "Could not load applications.";
        if (appsStats)   appsStats.textContent = "Error loading.";
        if (appsResults) appsResults.innerHTML = "";
        return;
      }
      renderApplications(data.applications || []);
    } catch {
      if (appsErr)     appsErr.textContent   = "Network error. Please try again.";
      if (appsStats)   appsStats.textContent = "Error.";
      if (appsResults) appsResults.innerHTML = "";
    }
  }

  function renderApplications(apps) {
    const pending  = apps.filter(a => a.status === "pending").length;
    const approved = apps.filter(a => a.status === "approved").length;
    const denied   = apps.filter(a => a.status === "denied").length;

    if (appsStats) {
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

    if (!appsResults) return;
    if (apps.length === 0) {
      appsResults.innerHTML = '<p style="color:#9ca3af;font-size:13px;text-align:center;padding:24px 0">No applications yet.</p>';
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

      const decisionButtons = isPending ? `
        <button class="app-btn app-btn-approve" data-op="approve" data-id="${app.id}">Approve</button>
        <button class="app-btn app-btn-deny"    data-op="deny"    data-id="${app.id}">Deny</button>
      ` : "";

      const notesRow = app.decision_notes
        ? `<div class="app-item-notes">Director's note: ${app.decision_notes}</div>`
        : "";

      const decidedRow = decidedAt
        ? `<tr><td>Decided</td><td>${decidedAt} by ${app.decided_by || "—"}</td></tr>` : "";

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
  <div class="app-item-actions">${decisionButtons}${publishBtn}</div>
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
        if (data.ok) {
          reload();
        } else {
          if (appsErr) appsErr.textContent = data.error || "Could not update.";
          btn.disabled = false; btn.textContent = orig;
        }
      } catch {
        if (appsErr) appsErr.textContent = "Network error.";
        btn.disabled = false; btn.textContent = orig;
      }

    } else if (op === "preview") {
      btn.textContent = orig;
      btn.disabled    = false;
      const url = `/api/staff/applications/preview-pdf`;
      try {
        const res = await fetch(url, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ ..._creds, applicationId: id }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          if (appsErr) appsErr.textContent = "Preview failed: " + t;
          return;
        }
        const blob    = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank");
      } catch {
        if (appsErr) appsErr.textContent = "Could not generate preview.";
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
        if (data.ok) {
          reload();
        } else {
          if (appsErr) appsErr.textContent = data.error || "Could not publish.";
          btn.disabled = false; btn.textContent = orig;
        }
      } catch {
        if (appsErr) appsErr.textContent = "Network error.";
        btn.disabled = false; btn.textContent = orig;
      }
    }
  }

  function reload() {
    loadApplications(null);
  }
})();
