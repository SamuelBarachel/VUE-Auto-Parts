// Always open at the top — prevent browser from restoring a scroll position or hash
if (history.scrollRestoration) history.scrollRestoration = "manual";
window.scrollTo(0, 0);
if (window.location.hash) {
  history.replaceState(null, "", window.location.pathname);
}

const header = document.querySelector(".site-header");
const mainEl = document.querySelector("main");

function syncHeaderHeight() {
  const h = header.getBoundingClientRect().height;
  mainEl.style.paddingTop = h + "px";
  document.documentElement.style.setProperty("--header-h", h + "px");
}

syncHeaderHeight();
window.addEventListener("resize", syncHeaderHeight);

const navLinks = [...document.querySelectorAll('nav a[href^="#"]')];
const navSections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

function setActiveNav(id) {
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
  });
}

function updateActiveNav() {
  const headerH = header ? header.getBoundingClientRect().height : 0;
  const trigger  = window.scrollY + headerH + 24;
  let current = null;
  for (const section of navSections) {
    if (section.offsetTop <= trigger) current = section.id;
  }
  if (current) setActiveNav(current);
}

window.addEventListener("scroll", updateActiveNav, { passive: true });
window.addEventListener("resize", updateActiveNav, { passive: true });
updateActiveNav();

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const id = link.getAttribute("href").slice(1);
    setActiveNav(id);
  });
});

if (window.location.hash) {
  setActiveNav(window.location.hash.slice(1));
}

// ── Gentle fade-in for the store sign image ──────────────────────────────
(function () {
  const signImg = document.querySelector(".dir-sign-figure img");
  if (!signImg) return;
  const obs = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        signImg.classList.add("sign-revealed");
        obs.disconnect();
      }
    },
    { threshold: 0.1 }
  );
  obs.observe(signImg);
})();

(function () {
  const statusEl = document.getElementById("shopStatus");
  if (!statusEl) return;

  function isOpen() {
    const now = new Date();
    // Zimbabwe is CAT = UTC+2, no DST
    const zwe = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Harare" }));
    const day  = zwe.getDay(); // 0=Sun, 1=Mon … 6=Sat
    const mins = zwe.getHours() * 60 + zwe.getMinutes();

    // Mon–Fri: 7:30–18:00
    if (day >= 1 && day <= 5) return mins >= 450 && mins < 1080;
    // Saturday: 8:00–13:00
    if (day === 6) return mins >= 480 && mins < 780;
    // Sunday: 12:00–17:00
    if (day === 0) return mins >= 720 && mins < 1020;
    return false;
  }

  const HOURS_LABEL = [
    "12:00 – 17:00", // Sun
    "7:30 – 18:00",  // Mon
    "7:30 – 18:00",  // Tue
    "7:30 – 18:00",  // Wed
    "7:30 – 18:00",  // Thu
    "7:30 – 18:00",  // Fri
    "8:00 – 13:00",  // Sat
  ];

  // open/close minutes-of-day per day index
  const OPEN_MINS  = [720, 450, 450, 450, 450, 450, 480];
  const CLOSE_MINS = [1020,1080,1080,1080,1080,1080,780];

  function fmtDuration(mins) {
    if (mins <= 0) return "now";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return m + " min";
    if (m === 0) return h + " hr";
    return h + " hr " + m + " min";
  }

  function countdown(zwe) {
    const day  = zwe.getDay();
    const mins = zwe.getHours() * 60 + zwe.getMinutes();
    const open = isOpen();

    if (open) {
      return "Closes in " + fmtDuration(CLOSE_MINS[day] - mins);
    }

    // before today's opening?
    if (mins < OPEN_MINS[day]) {
      return "Opens in " + fmtDuration(OPEN_MINS[day] - mins);
    }

    // after today's close — find next day's opening
    let daysAhead = 1;
    while (daysAhead <= 7) {
      const nextDay = (day + daysAhead) % 7;
      const minsUntilMidnight = 1440 - mins;
      const minsUntilOpen = minsUntilMidnight + (daysAhead - 1) * 1440 + OPEN_MINS[nextDay];
      return "Opens in " + fmtDuration(minsUntilOpen);
    }
    return "";
  }

  function update() {
    const now  = new Date();
    const zwe  = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Harare" }));
    const open = isOpen();

    // Hero badge — only visible when open
    statusEl.textContent   = "We are Open";
    statusEl.className     = "shop-status open";
    statusEl.style.display = open ? "" : "none";

    // Hours section live block
    const liveEl = document.getElementById("hoursLive");
    if (liveEl) {
      const day = zwe.getDay();
      const cd  = countdown(zwe);
      const statusLabel = open
        ? '<span class="hl-badge open">We are Open</span>'
        : '<span class="hl-badge closed">Currently Closed</span>';
      liveEl.innerHTML =
        statusLabel +
        '<span class="hl-hours">Today: ' + HOURS_LABEL[day] + "</span>" +
        (cd ? '<span class="hl-countdown">' + cd + "</span>" : "");
    }
  }

  update();
  setInterval(update, 60000);

  // Highlight today's row in the hours section
  const zwe = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Harare" }));
  const todayDay = zwe.getDay();
  const todayRow = document.querySelector(`.hours-list li[data-day="${todayDay}"]`);
  if (todayRow) {
    todayRow.classList.add("today");
    const daySpan = todayRow.querySelector(".hours-day");
    if (daySpan) {
      const badge = document.createElement("span");
      badge.className = "today-badge";
      badge.textContent = "Today";
      daySpan.appendChild(badge);
    }
  }
})();
