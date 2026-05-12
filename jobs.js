(function () {
  const TOTAL_STEPS = 14;

  const overlay     = document.getElementById("jobOverlay");
  const closeBtn    = document.getElementById("jobClose");
  const openBtn     = document.getElementById("jobOpen");
  const progressWrap = document.getElementById("jobProgressWrap");
  const progressFill = document.getElementById("jobProgressFill");
  const progressLabel = document.getElementById("jobProgressLabel");

  if (!overlay) return;

  const state = {
    role: "", firstName: "", lastName: "",
    dobMonth: "", dobDay: "", dobYear: "", dobAge: null,
    sex: "", location: "", phone: "", email: "",
    idNumber: "", computer: "",
    medical: "",
    idPhotoBase64: "", idPhotoName: "",
    signature: "",
    draft: "",
  };

  let currentStep = 0;

  function openModal() {
    overlay.hidden = false;
    document.body.style.overflowY = "hidden";
    setTimeout(() => overlay.classList.add("visible"), 10);
    showStep(0);
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
    currentStep = 0;
    Object.keys(state).forEach(k => { state[k] = k === "dobAge" ? null : ""; });
    progressWrap.hidden = true;
    document.querySelectorAll(".job-role-card").forEach(c => c.classList.remove("selected"));
    document.querySelectorAll(".job-choice-btn").forEach(c => c.classList.remove("selected"));
    ["jobFirstName","jobLastName","jobLocation","jobPhone","jobEmail","jobIdNumber","jobSignature"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    ["jobDobMonth","jobDobDay","jobDobYear"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    document.getElementById("jobMedical").value = "";
    document.getElementById("jobDraft").value = "";
    ["jobChkAge","jobChkHours","jobChkBenefits"].forEach(id => {
      const el = document.getElementById(id); if (el) el.checked = false;
    });
    clearIdPhoto();
    document.getElementById("jobIdNotReadyHint").hidden = true;
    document.getElementById("jobAgeResult").hidden = true;
    document.getElementById("jobAgeResult").className = "job-age-result";
    clearErrors();
    showStep(0);
  }

  function clearErrors() {
    for (let i = 1; i <= 14; i++) {
      const el = document.getElementById("jobErr" + i);
      if (el) el.textContent = "";
    }
  }

  function setProgress(step) {
    if (step < 1) { progressWrap.hidden = true; return; }
    progressWrap.hidden = false;
    const pct = Math.round((step / TOTAL_STEPS) * 100);
    progressFill.style.width = pct + "%";
    progressLabel.textContent = "Step " + step + " of " + TOTAL_STEPS;
  }

  function showStep(n) {
    currentStep = n;
    for (let i = 0; i <= 15; i++) {
      const el = document.getElementById("jobStep" + i);
      if (el) el.hidden = i !== n;
    }
    setProgress(n >= 1 && n <= 14 ? n : n === 15 ? TOTAL_STEPS : 0);
    overlay.querySelector(".enq-modal").scrollTop = 0;
  }

  function err(stepN, msg) {
    const el = document.getElementById("jobErr" + stepN);
    if (el) el.textContent = msg;
  }

  function clearErr(stepN) {
    const el = document.getElementById("jobErr" + stepN);
    if (el) el.textContent = "";
  }

  function calcAge(month, day, year) {
    const today = new Date();
    const dob = new Date(year, month - 1, day);
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age;
  }

  function populateDays() {
    const monthSel = document.getElementById("jobDobMonth");
    const daySel   = document.getElementById("jobDobDay");
    const yearSel  = document.getElementById("jobDobYear");
    const month = parseInt(monthSel.value) || 0;
    const year  = parseInt(yearSel.value) || new Date().getFullYear();
    const maxDay = month ? new Date(year, month, 0).getDate() : 31;
    const prev = parseInt(daySel.value) || 0;
    daySel.innerHTML = '<option value="">Day</option>';
    for (let d = 1; d <= maxDay; d++) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      if (d === prev) opt.selected = true;
      daySel.appendChild(opt);
    }
  }

  function populateYears() {
    const yearSel = document.getElementById("jobDobYear");
    const now = new Date().getFullYear();
    yearSel.innerHTML = '<option value="">Year</option>';
    for (let y = now; y >= now - 90; y--) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      yearSel.appendChild(opt);
    }
  }

  function updateAgeResult() {
    const m = parseInt(document.getElementById("jobDobMonth").value);
    const d = parseInt(document.getElementById("jobDobDay").value);
    const y = parseInt(document.getElementById("jobDobYear").value);
    const res = document.getElementById("jobAgeResult");
    if (!m || !d || !y) { res.hidden = true; return; }
    const age = calcAge(m, d, y);
    state.dobAge = age;
    res.hidden = false;
    if (age >= 16) {
      res.className = "job-age-result job-age-ok";
      res.textContent = "✓ You are " + age + " years old — eligible to apply.";
    } else {
      res.className = "job-age-result job-age-fail";
      res.textContent = "✗ You must be at least 16 years old to apply. You are " + age + " years old.";
    }
  }

  function clearIdPhoto() {
    state.idPhotoBase64 = "";
    state.idPhotoName = "";
    document.getElementById("jobIdPhoto").value = "";
    document.getElementById("jobUploadPreview").hidden = true;
    document.getElementById("jobUploadLabel").hidden = false;
  }

  async function generateDraft() {
    const draftTA  = document.getElementById("jobDraft");
    const loading  = document.getElementById("jobDraftLoading");
    const nextBtn  = document.getElementById("jobNext13");
    loading.hidden = false;
    draftTA.hidden = true;
    nextBtn.disabled = true;
    try {
      const res = await fetch("/api/jobs-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: state.role, firstName: state.firstName, lastName: state.lastName,
          dobMonth: state.dobMonth, dobDay: state.dobDay, dobYear: state.dobYear,
          age: state.dobAge, sex: state.sex, location: state.location,
          phone: state.phone, email: state.email,
          idNumber: state.idNumber, computer: state.computer,
          medical: state.medical,
        }),
      });
      const data = await res.json().catch(() => ({}));
      draftTA.value = data.draft || fallbackDraft();
    } catch {
      draftTA.value = fallbackDraft();
    } finally {
      loading.hidden = true;
      draftTA.hidden = false;
      nextBtn.disabled = false;
      state.draft = draftTA.value;
    }
  }

  function fallbackDraft() {
    const dobStr = state.dobMonth + "/" + state.dobDay + "/" + state.dobYear;
    return (
      "Dear VUE Auto Parts Management,\n\n" +
      "I, " + state.firstName + " " + state.lastName + ", would like to apply for the position of " + state.role + ".\n\n" +
      "Personal Details:\n" +
      "- Date of Birth: " + dobStr + " (Age: " + state.dobAge + ")\n" +
      "- Sex: " + state.sex + "\n" +
      "- Location: " + state.location + "\n" +
      "- Phone: " + state.phone + "\n" +
      "- National ID: " + state.idNumber + "\n" +
      "- Computer Skills: " + state.computer + "\n" +
      (state.medical ? "- Health notes: " + state.medical + "\n" : "") +
      "\nI confirm that I am willing to work the required hours and look forward to growing with your team.\n\n" +
      "Regards,\n" + state.firstName + " " + state.lastName
    );
  }

  async function submitApplication() {
    const submitBtn = document.getElementById("jobSubmitBtn");
    const sig = document.getElementById("jobSignature").value.trim();
    if (!sig) { err(14, "Please enter your full name to sign the application."); return; }
    state.signature = sig;
    state.draft = document.getElementById("jobDraft").value.trim();

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    clearErr(14);

    try {
      const res = await fetch("/api/jobs-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: state.role, firstName: state.firstName, lastName: state.lastName,
          dobMonth: state.dobMonth, dobDay: state.dobDay, dobYear: state.dobYear,
          age: state.dobAge, sex: state.sex, location: state.location,
          phone: state.phone, email: state.email,
          idNumber: state.idNumber, computer: state.computer,
          medical: state.medical, signature: state.signature, draft: state.draft,
          idPhotoBase64: state.idPhotoBase64, idPhotoName: state.idPhotoName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showStep(15);
      } else {
        err(14, data.error || "Submission failed. Please try WhatsApp.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Application";
      }
    } catch {
      err(14, "Network error. Please try WhatsApp at +16038662272.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Application";
    }
  }

  openBtn && openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  document.getElementById("jobDone").addEventListener("click", closeModal);

  document.getElementById("jobIdReady").addEventListener("click", () => {
    document.getElementById("jobIdNotReadyHint").hidden = true;
    showStep(1);
  });

  document.getElementById("jobIdNotReady").addEventListener("click", () => {
    document.getElementById("jobIdNotReadyHint").hidden = false;
    const countdownEl = document.getElementById("jobIdCountdown");
    let secs = 5;
    if (countdownEl) countdownEl.textContent = secs;
    const iv = setInterval(() => {
      secs--;
      if (countdownEl) countdownEl.textContent = secs;
      if (secs <= 0) { clearInterval(iv); closeModal(); }
    }, 1000);
  });

  document.querySelectorAll(".job-role-card").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".job-role-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      state.role = card.dataset.role;
    });
  });

  document.getElementById("jobNext1").addEventListener("click", () => {
    if (!state.role) { err(1, "Please select a role."); return; }
    clearErr(1); showStep(2);
    setTimeout(() => document.getElementById("jobFirstName").focus(), 60);
  });

  document.getElementById("jobNext2").addEventListener("click", () => {
    const v = document.getElementById("jobFirstName").value.trim();
    if (!v) { err(2, "Please enter your first name."); return; }
    state.firstName = v; clearErr(2); showStep(3);
    setTimeout(() => document.getElementById("jobLastName").focus(), 60);
  });

  document.getElementById("jobNext3").addEventListener("click", () => {
    const v = document.getElementById("jobLastName").value.trim();
    if (!v) { err(3, "Please enter your last name."); return; }
    state.lastName = v; clearErr(3); showStep(4);
  });

  populateYears();
  populateDays();
  document.getElementById("jobDobMonth").addEventListener("change", () => { populateDays(); updateAgeResult(); });
  document.getElementById("jobDobDay").addEventListener("change", updateAgeResult);
  document.getElementById("jobDobYear").addEventListener("change", () => { populateDays(); updateAgeResult(); });

  document.getElementById("jobNext4").addEventListener("click", () => {
    const m = document.getElementById("jobDobMonth").value;
    const d = document.getElementById("jobDobDay").value;
    const y = document.getElementById("jobDobYear").value;
    if (!m || !d || !y) { err(4, "Please select your full date of birth."); return; }
    const age = calcAge(parseInt(m), parseInt(d), parseInt(y));
    if (age < 16) { err(4, "Applicants must be at least 16 years old."); return; }
    state.dobMonth = m; state.dobDay = d; state.dobYear = y; state.dobAge = age;
    clearErr(4); showStep(5);
  });

  document.getElementById("jobSexList").addEventListener("click", e => {
    const btn = e.target.closest(".job-choice-btn");
    if (!btn) return;
    document.querySelectorAll("#jobSexList .job-choice-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    state.sex = btn.dataset.val;
  });

  document.getElementById("jobNext5").addEventListener("click", () => {
    if (!state.sex) { err(5, "Please select an option."); return; }
    clearErr(5); showStep(6);
    setTimeout(() => document.getElementById("jobLocation").focus(), 60);
  });

  document.getElementById("jobNext6").addEventListener("click", () => {
    const v = document.getElementById("jobLocation").value.trim();
    if (!v) { err(6, "Please enter your town or locality."); return; }
    state.location = v; clearErr(6); showStep(7);
    setTimeout(() => document.getElementById("jobPhone").focus(), 60);
  });

  document.getElementById("jobNext7").addEventListener("click", () => {
    const phone = document.getElementById("jobPhone").value.trim();
    const email = document.getElementById("jobEmail").value.trim();
    if (!phone) { err(7, "Please enter your phone number."); return; }
    if (!email) { err(7, "Please enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err(7, "Please enter a valid email address."); return; }
    state.phone = phone; state.email = email; clearErr(7); showStep(8);
    setTimeout(() => document.getElementById("jobIdNumber").focus(), 60);
  });

  document.getElementById("jobNext8").addEventListener("click", () => {
    const v = document.getElementById("jobIdNumber").value.trim();
    if (!v) { err(8, "Please enter your National ID number."); return; }
    state.idNumber = v; clearErr(8); showStep(9);
  });

  document.getElementById("jobComputerList").addEventListener("click", e => {
    const btn = e.target.closest(".job-choice-btn");
    if (!btn) return;
    document.querySelectorAll("#jobComputerList .job-choice-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    state.computer = btn.dataset.val;
  });

  document.getElementById("jobNext9").addEventListener("click", () => {
    if (!state.computer) { err(9, "Please select an option."); return; }
    clearErr(9); showStep(10);
    setTimeout(() => document.getElementById("jobMedical").focus(), 60);
  });

  document.getElementById("jobNext10").addEventListener("click", () => {
    state.medical = document.getElementById("jobMedical").value.trim();
    showStep(11);
  });

  document.getElementById("jobNext11").addEventListener("click", () => {
    const age  = document.getElementById("jobChkAge").checked;
    const hrs  = document.getElementById("jobChkHours").checked;
    const ben  = document.getElementById("jobChkBenefits").checked;
    if (!age)  { err(11, "Please confirm you are 16 years or older."); return; }
    if (!hrs)  { err(11, "Please confirm you are willing to work the required hours."); return; }
    if (!ben)  { err(11, "Please confirm you are OK with the transport and food benefit."); return; }
    clearErr(11); showStep(12);
  });

  const fileInput = document.getElementById("jobIdPhoto");
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      err(12, "File is too large. Please use an image under 5 MB.");
      fileInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      state.idPhotoBase64 = dataUrl.split(",")[1];
      state.idPhotoName = file.name;
      document.getElementById("jobIdPreviewImg").src = dataUrl;
      document.getElementById("jobUploadPreview").hidden = false;
      document.getElementById("jobUploadLabel").hidden = true;
      clearErr(12);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("jobRemovePhoto").addEventListener("click", () => {
    clearIdPhoto();
  });

  document.getElementById("jobNext12").addEventListener("click", () => {
    if (!state.idPhotoBase64) { err(12, "Please upload a photo of your National ID."); return; }
    clearErr(12); showStep(13);
    generateDraft();
  });

  document.getElementById("jobDraft").addEventListener("input", e => { state.draft = e.target.value; });

  document.getElementById("jobNext13").addEventListener("click", () => {
    state.draft = document.getElementById("jobDraft").value.trim();
    if (!state.draft) { err(13, "The message cannot be empty."); return; }
    clearErr(13); showStep(14);
    setTimeout(() => document.getElementById("jobSignature").focus(), 60);
  });

  document.getElementById("jobSubmitBtn").addEventListener("click", submitApplication);

  overlay.addEventListener("click", e => {
    const btn = e.target.closest("[data-back]");
    if (!btn) return;
    showStep(parseInt(btn.dataset.back));
  });

  document.querySelectorAll(".job-next-btn").forEach(btn => {
    btn.addEventListener("keydown", e => {
      if (e.key === "Enter") btn.click();
    });
  });

  ["jobFirstName","jobLastName","jobLocation","jobPhone","jobIdNumber","jobSignature"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      const step = parseInt(id.replace(/\D/g, "")) || currentStep;
      const next = document.getElementById("jobNext" + currentStep);
      if (next && !next.disabled) next.click();
    });
  });
})();
