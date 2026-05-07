import React from "react";

const focusModels = ["Honda Fit", "Toyota Corolla", "Toyota Wish", "Toyota Probox"];
const categories = [
  "Oil, air, fuel, and cabin filters",
  "Brake pads, shoes, and discs",
  "Tyres and jacks",
  "Engine oils, coolant, and DOT 4 brake fluid",
];

export default function App() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <img src="/vueauto-logo.jpeg" alt="VUE Auto Parts logo" style={styles.logo} />
        <p style={styles.eyebrow}>Zimbabwean auto parts shop</p>
        <h1 style={styles.title}>VUE Auto Parts</h1>
        <p style={styles.copy}>
          Retail and distribution for dependable ex-Japanese vehicle parts, tyres,
          engine oils, and everyday repair essentials, with emphasis on Honda Fit,
          Toyota Corolla, Toyota Wish, and Toyota Probox.
        </p>
        <a href="https://wa.me/16038662272" style={styles.button}>
          Request a quote
        </a>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Focus models</h2>
        <div style={styles.grid}>
          {focusModels.map((model) => (
            <article key={model} style={styles.card}>
              {model}
            </article>
          ))}
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Parts categories</h2>
        <div style={styles.grid}>
          {categories.map((category) => (
            <article key={category} style={styles.card}>
              {category}
            </article>
          ))}
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Inventory search</h2>
        <p style={styles.sectionCopy}>
          The deployed static site reads the public Master-Inventory-&-Location tab
          from Google Sheets so customers can search by model, part, specification,
          and shelf location.
        </p>
      </section>
    </main>
  );
}

const styles = {
  page: {
    background: "#fbfaf5",
    color: "#101413",
    fontFamily: "Inter, system-ui, sans-serif",
    minHeight: "100vh",
  },
  hero: {
    background: "linear-gradient(135deg, #062f22, #0f4f36)",
    color: "#fff",
    padding: "88px 24px",
    textAlign: "center",
  },
  logo: {
    borderRadius: "50%",
    height: 96,
    objectFit: "cover",
    width: 96,
  },
  eyebrow: {
    color: "#d6ad3f",
    fontWeight: 900,
    marginTop: 24,
    textTransform: "uppercase",
  },
  title: {
    fontSize: "clamp(3rem, 8vw, 6.5rem)",
    lineHeight: 0.92,
    margin: "12px auto 20px",
  },
  copy: {
    color: "rgba(255,255,255,0.78)",
    fontSize: "1.1rem",
    lineHeight: 1.7,
    margin: "0 auto 32px",
    maxWidth: 720,
  },
  button: {
    background: "#d6ad3f",
    borderRadius: 999,
    color: "#12100a",
    display: "inline-flex",
    fontWeight: 900,
    padding: "15px 24px",
    textDecoration: "none",
  },
  section: {
    margin: "0 auto",
    maxWidth: 1120,
    padding: "64px 24px 0",
  },
  heading: {
    color: "#062f22",
    fontSize: "clamp(2rem, 5vw, 4rem)",
    lineHeight: 1,
  },
  grid: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  },
  card: {
    background: "#fff",
    border: "1px solid rgba(16, 20, 19, 0.12)",
    borderRadius: 8,
    boxShadow: "0 20px 60px rgba(16, 20, 19, 0.06)",
    color: "#0f4f36",
    fontSize: "1.25rem",
    fontWeight: 900,
    minHeight: 140,
    padding: 24,
  },
  sectionCopy: {
    color: "#5d6862",
    fontSize: "1.05rem",
    lineHeight: 1.7,
    maxWidth: 760,
  },
};
