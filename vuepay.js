(function () {
  const overlay    = document.getElementById("vuePayOverlay");
  const openBtn    = document.getElementById("vuePayOpen");
  const closeBtn   = document.getElementById("vuePayClose");
  if (!overlay || !openBtn) return;

  const STEPS = 6;
  const state = {
    description: "", amount: null, note: "",
    name: "", phone: "",
    paymentMethod: "",
    receivingNumber: "",
  };

  /* ── helpers ──────────────────────────────────────────────── */
  function showStep(n) {
    for (let i = 0; i < STEPS; i++) {
      const el = document.getElementById("vpStep" + i);
      if (el) el.hidden = i !== n;
    }
    const prog = document.getElementById("vpProgress");
    const fill = document.getElementById("vpProgressFill");
    if (n === 0 || n === 5) {
      if (prog) prog.hidden = true;
    } else {
      if (prog) prog.hidden = false;
      if (fill) fill.style.width = (Math.min(n, 4) / 4 * 100) + "%";
    }
    const modal = overlay.querySelector(".enq-modal");
    if (modal) modal.scrollTop = 0;
  }

  function setErr(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  }

  function clearErrs() {
    ["vpErr1","vpErr2","vpErr3","vpErr4"].forEach(id => setErr(id, ""));
  }

  async function loadConfig() {
    try {
      const res  = await fetch("/api/vuepay/config");
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.receivingNumber) state.receivingNumber = data.receivingNumber;
    } catch (_) {}
  }

  function openModal() {
    overlay.hidden = false;
    document.body.style.overflowY = "hidden";
    setTimeout(() => overlay.classList.add("visible"), 10);
    showStep(0);
    loadConfig();
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
    state.description = ""; state.amount = null; state.note = "";
    state.name = ""; state.phone = ""; state.paymentMethod = "";
    ["vpDescription","vpAmount","vpNote","vpName","vpPhone"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.querySelectorAll(".vuepay-method-btn").forEach(b => b.classList.remove("selected"));
    clearErrs();
    showStep(0);
  }

  /* ── open / close ─────────────────────────────────────────── */
  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  /* ── back buttons ─────────────────────────────────────────── */
  overlay.addEventListener("click", e => {
    const btn = e.target.closest("[data-vp-back]");
    if (btn) showStep(parseInt(btn.dataset.vpBack));
  });

  /* ── step 0: start ────────────────────────────────────────── */
  document.getElementById("vpStart").addEventListener("click", () => showStep(1));

  /* ── step 1: description + amount ────────────────────────── */
  document.getElementById("vpNext1").addEventListener("click", () => {
    const desc = (document.getElementById("vpDescription")?.value || "").trim();
    if (!desc) { setErr("vpErr1", "Please describe what you are paying for."); return; }
    state.description = desc;
    state.amount = parseFloat(document.getElementById("vpAmount")?.value || "") || null;
    state.note = (document.getElementById("vpNote")?.value || "").trim();
    setErr("vpErr1", "");
    showStep(2);
    setTimeout(() => document.getElementById("vpName")?.focus(), 60);
  });

  /* ── step 2: name + phone ─────────────────────────────────── */
  document.getElementById("vpNext2").addEventListener("click", () => {
    const name  = (document.getElementById("vpName")?.value  || "").trim();
    const phone = (document.getElementById("vpPhone")?.value || "").trim();
    if (!name)  { setErr("vpErr2", "Please enter your full name."); return; }
    if (!phone) { setErr("vpErr2", "Please enter your phone number."); return; }
    state.name  = name;
    state.phone = phone;
    setErr("vpErr2", "");
    showStep(3);
  });

  /* ── step 3: payment method ───────────────────────────────── */
  document.querySelectorAll(".vuepay-method-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.paymentMethod = btn.dataset.method;
      buildStep4();
      showStep(4);
    });
  });

  /* ── step 4: instructions ─────────────────────────────────── */
  function buildStep4() {
    const wrap   = document.getElementById("vpInstructions");
    const title  = document.getElementById("vpStep4Title");
    const confirmBtn = document.getElementById("vpConfirmBtn");
    const amount = state.amount ? "$" + state.amount.toFixed(2) : "the agreed amount";
    const num    = state.receivingNumber || "Contact us for our number";

    if (state.paymentMethod === "ecocash") {
      title.textContent = "Pay via EcoCash";
      confirmBtn.textContent = "I've sent the money \u2192";
      wrap.innerHTML = `
        <div class="vp-ecocash-box">
          <p class="vp-instr-lead">Send <strong>${amount}</strong> to this EcoCash number:</p>
          <div class="vp-receiving-num">${num}</div>
          <ol class="vp-steps-list">
            <li>Dial <strong>*151#</strong> on your Econet line</li>
            <li>Select <strong>Send Money</strong></li>
            <li>Enter number: <strong>${num}</strong></li>
            <li>Enter amount: <strong>${amount}</strong></li>
            <li>Confirm with your EcoCash PIN</li>
          </ol>
          <div class="enq-field" style="margin-top:18px">
            <label for="vpEcoNum">Your EcoCash number <span style="color:#9ca3af;font-weight:400">(so we can confirm receipt)</span></label>
            <input type="tel" id="vpEcoNum" class="enq-input" placeholder="e.g. 0771 234 567" value="${state.phone}">
          </div>
        </div>`;
    } else if (state.paymentMethod === "cash") {
      title.textContent = "Cash on Collection / Delivery";
      confirmBtn.textContent = "Confirm my order \u2192";
      wrap.innerHTML = `
        <div class="vp-cash-box">
          <div class="vp-method-icon-big">💵</div>
          <p class="vp-cash-note">Pay <strong>${amount}</strong> in cash when you collect from our shop in Chipinge, or when we deliver.</p>
          <p class="vp-cash-note" style="color:#6b7280">Our team will contact you on <strong>${state.phone}</strong> to confirm.</p>
        </div>`;
    } else {
      title.textContent = "Other Payment";
      confirmBtn.textContent = "Confirm my order \u2192";
      wrap.innerHTML = `
        <div class="vp-other-box">
          <div class="vp-method-icon-big">💬</div>
          <p class="vp-cash-note">We'll arrange payment with you directly. Our team will reach you at <strong>${state.phone}</strong> to sort out how to pay <strong>${amount}</strong>.</p>
          <p class="vp-cash-note" style="color:#6b7280">You can also WhatsApp us at <strong>+16038662272</strong> to settle payment right away.</p>
        </div>`;
    }
  }

  /* ── step 4: confirm / submit ─────────────────────────────── */
  document.getElementById("vpConfirmBtn").addEventListener("click", async () => {
    let customerPhone = state.phone;
    if (state.paymentMethod === "ecocash") {
      const ecoNum = (document.getElementById("vpEcoNum")?.value || "").trim();
      if (!ecoNum) { setErr("vpErr4", "Please enter your EcoCash number."); return; }
      customerPhone = ecoNum;
    }
    setErr("vpErr4", "");

    const confirmBtn = document.getElementById("vpConfirmBtn");
    const origText   = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Confirming…";

    try {
      const res  = await fetch("/api/vuepay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: state.name,
          customerPhone,
          paymentMethod: state.paymentMethod,
          amountUsd: state.amount,
          description: state.description,
          note: state.note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const refEl = document.getElementById("vpRef");
        if (refEl) refEl.textContent = data.reference;
        showStep(5);
      } else {
        setErr("vpErr4", data.error || "Could not confirm. Please WhatsApp us at +16038662272.");
        confirmBtn.disabled = false;
        confirmBtn.textContent = origText;
      }
    } catch {
      setErr("vpErr4", "Network error. Please try again.");
      confirmBtn.disabled = false;
      confirmBtn.textContent = origText;
    }
  });

  /* ── step 5: done ─────────────────────────────────────────── */
  document.getElementById("vpDone").addEventListener("click", closeModal);

  /* ── enter key on text inputs ─────────────────────────────── */
  [["vpDescription","vpNext1"],["vpName","vpNext2"],["vpPhone","vpNext2"]].forEach(([inputId, btnId]) => {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); document.getElementById(btnId)?.click(); }
    });
  });
})();

/* ── VuePay Admin (director panel) ──────────────────────── */
window.VUEPayAdmin = (function () {
  let _creds = null;

  function open(verifiedStaff, showPanelFn) {
    _creds = {
      directorFirst: verifiedStaff.firstName,
      directorLast:  verifiedStaff.lastName,
      directorId:    verifiedStaff.id,
      directorRole:  verifiedStaff.role,
    };
    loadPanel(showPanelFn);
  }

  async function loadPanel(showPanelFn) {
    const wrap    = document.getElementById("stfVpWrap");
    const err     = document.getElementById("stfVpErr");
    const ordWrap = document.getElementById("stfVpOrders");
    if (wrap)    wrap.innerHTML    = '<p class="enq-subtitle">Loading…</p>';
    if (ordWrap) ordWrap.innerHTML = "";
    if (err)     err.textContent   = "";
    if (showPanelFn) showPanelFn(8);

    /* load config */
    try {
      const r    = await fetch("/api/vuepay/config");
      const data = await r.json().catch(() => ({}));
      const cur  = data.receivingNumber || "";
      if (wrap) {
        wrap.innerHTML = `
          <div class="stfvp-current-row">
            <span class="stfvp-label">Current receiving number</span>
            <span class="stfvp-num">${cur || '<em style="color:#9ca3af">Not set</em>'}</span>
          </div>
          <div class="enq-field stfvp-update-form">
            <label for="stfVpNewNum">Update receiving number</label>
            <div class="stfvp-input-row">
              <input type="tel" id="stfVpNewNum" class="enq-input" placeholder="e.g. 0771 234 567" value="${cur}">
              <button class="enq-btn-primary stfvp-save-btn" id="stfVpSave" type="button">Save</button>
            </div>
            <span class="enq-err" id="stfVpSaveErr" aria-live="polite"></span>
          </div>`;

        document.getElementById("stfVpSave")?.addEventListener("click", async () => {
          const newNum  = (document.getElementById("stfVpNewNum")?.value || "").trim();
          const saveBtn = document.getElementById("stfVpSave");
          const saveErr = document.getElementById("stfVpSaveErr");
          if (!newNum) { if (saveErr) saveErr.textContent = "Please enter a number."; return; }
          saveBtn.disabled = true; saveBtn.textContent = "Saving…";
          if (saveErr) saveErr.textContent = "";
          try {
            const res  = await fetch("/api/vuepay/update-config", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ..._creds, receivingNumber: newNum }),
            });
            const d = await res.json().catch(() => ({}));
            if (d.ok) {
              const cur = wrap.querySelector(".stfvp-num");
              if (cur) cur.textContent = newNum;
              saveBtn.textContent = "Saved ✓";
              setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = "Save"; }, 2000);
            } else {
              if (saveErr) saveErr.textContent = d.error || "Could not save.";
              saveBtn.disabled = false; saveBtn.textContent = "Save";
            }
          } catch {
            if (saveErr) saveErr.textContent = "Network error.";
            saveBtn.disabled = false; saveBtn.textContent = "Save";
          }
        });
      }
    } catch (e) {
      if (wrap) wrap.innerHTML = '<p class="enq-err">Could not load config.</p>';
    }

    /* load recent orders */
    try {
      const r    = await fetch("/api/vuepay/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(_creds),
      });
      const data = await r.json().catch(() => ({}));
      if (!ordWrap) return;
      const orders = data.orders || [];
      if (orders.length === 0) {
        ordWrap.innerHTML = '<p class="apps-empty">No VuePay orders yet.</p>';
        return;
      }
      const methodLabel = { ecocash: "EcoCash", cash: "Cash", bank: "Bank Transfer", other: "Other" };
      ordWrap.innerHTML = orders.map(o => {
        const date = (() => { try { return new Date(o.created_at).toLocaleString("en-ZW", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }); } catch { return "—"; } })();
        const amt  = o.amount_usd ? "$" + parseFloat(o.amount_usd).toFixed(2) : "—";
        return `<div class="stfvp-order-row">
          <div class="stfvp-order-ref">${o.reference}</div>
          <div class="stfvp-order-info">
            <strong>${o.customer_name}</strong> · ${o.customer_phone}
            <span class="stfvp-order-method">${methodLabel[o.payment_method] || o.payment_method}</span>
            <span class="stfvp-order-amt">${amt}</span>
          </div>
          <div class="stfvp-order-desc">${o.items_description}</div>
          <div class="stfvp-order-date">${date}</div>
        </div>`;
      }).join("");
    } catch {
      if (ordWrap) ordWrap.innerHTML = '<p class="enq-err">Could not load orders.</p>';
    }
  }

  return { open };
})();
