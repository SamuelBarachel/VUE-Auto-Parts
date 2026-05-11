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

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveNav(visible.target.id);
    },
    {
      rootMargin: "-32% 0px -52% 0px",
      threshold: [0.2, 0.45, 0.7],
    },
  );

  navSections.forEach((section) => observer.observe(section));
}

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const id = link.getAttribute("href").slice(1);
    setActiveNav(id);
  });
});

if (window.location.hash) {
  setActiveNav(window.location.hash.slice(1));
}

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

  function update() {
    const open = isOpen();
    statusEl.textContent = open ? "We are Open" : "Currently Closed";
    statusEl.className = "shop-status " + (open ? "open" : "closed");
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
