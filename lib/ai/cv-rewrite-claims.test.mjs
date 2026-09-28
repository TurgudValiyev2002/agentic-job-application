import assert from "node:assert/strict";
import test from "node:test";

import {
  validateRewriteCompleteness,
  validateRewriteContacts,
  validateRewriteNumericClaims,
} from "./cv-rewrite-validation.ts";

// The real source text this pipeline was caught fabricating against.
const SOURCE = `SÜLEYMAN EMIRHAN DONCU
sedmirhandoncu@gmail.com ⋄ linkedin.com ⋄ github.com
EDUCATION
B.S Computer Engineering, Alanya Alaaddin Keykubat University 2023 - 2026
EXPERIENCE
AI/Software Engineering Intern, Universität Innsbruck
SKILLS
Programming TypeScript, Java, JavaScript, SQL
PROJECTS
makecaption.com — Auto-Caption Generator
• Fully client-side AI caption generator running transcription in the browser
• Grew to 2,000-6,000 monthly visitors organically
Polymarket Automated BTC Trading Bot
• Automated trading bot for Polymarket BTC 5-minute and 15-minute prediction markets`;

const base = {
  name: "Süleyman Emirhan Doncu",
  contactLine: [{ text: "sedmirhandoncu@gmail.com" }, { text: "github.com" }],
  skills: [],
  experience: [],
  projects: [],
  education: [],
};

const withBullets = (bullets) => ({
  ...base,
  projects: [{ title: "makecaption.com", bullets }],
});

test("rejects an invented percentage", () => {
  const r = validateRewriteNumericClaims(
    withBullets(["Grew to 2,000–6,000 monthly visitors, achieving a 40% month-over-month increase"]),
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert.equal(r.inventedClaim, "40%");
});

test("rejects an invented timeframe", () => {
  const r = validateRewriteNumericClaims(
    withBullets(["Grew to 2,000–6,000 monthly visitors within 3 months of launch"]),
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert.equal(r.inventedClaim, "3 months");
});

test("accepts genuine figures reworded, including an en-dash swap", () => {
  const r = validateRewriteNumericClaims(
    withBullets([
      "Grew to 2,000–6,000 monthly visitors organically",
      "Built a bot for BTC 5-minute and 15-minute prediction markets",
    ]),
    SOURCE,
  );
  assert.equal(r.ok, true);
});

test("rejects an invented contact URL", () => {
  const r = validateRewriteContacts(
    { ...base, contactLine: [{ text: "github.com/your-username" }] },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert.equal(r.inventedClaim, "github.com/your-username");
});

test("accepts contacts copied from the source", () => {
  const r = validateRewriteContacts(base, SOURCE);
  assert.equal(r.ok, true);
});

test("accepts a bare domain that gained a scheme", () => {
  const r = validateRewriteContacts(
    { ...base, contactLine: [{ text: "linkedin.com", url: "https://linkedin.com" }] },
    SOURCE,
  );
  assert.equal(r.ok, true);
});

test("rejects a rewrite that dropped whole sections", () => {
  const r = validateRewriteCompleteness(
    { ...base, education: [{ school: "Alanya", degree: "B.S", date: "2023" }] },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /dropped the/);
});

test("accepts a rewrite that kept every section", () => {
  const r = validateRewriteCompleteness(
    {
      ...base,
      skills: [{ category: "Languages", items: "TypeScript" }],
      experience: [{ jobTitle: "Intern", company: "X", location: null, dateRange: "2026", bullets: ["did work"] }],
      projects: [{ title: "makecaption.com", bullets: ["shipped"] }],
      education: [{ school: "Alanya", degree: "B.S", date: "2023" }],
    },
    SOURCE,
  );
  assert.equal(r.ok, true);
});

test("rejects an invented figure inside the summary", () => {
  const r = validateRewriteNumericClaims(
    { ...base, summary: "Engineer with 5 years experience building AI products." },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert.equal(r.inventedClaim, "5 years");
});

test("accepts a summary built only from source facts", () => {
  const r = validateRewriteNumericClaims(
    { ...base, summary: "Computer engineering student building AI products with TypeScript and Next.js." },
    SOURCE,
  );
  assert.equal(r.ok, true);
});
