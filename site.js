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
