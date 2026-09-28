import assert from "node:assert/strict";
import test from "node:test";

import { renderCvToText } from "./render-text.ts";

const cv = {
  name: "Ada Lovelace",
  summary: "Analytical engineer with a focus on computation.",
  contactLine: [
    { text: "ada@example.com", url: "mailto:ada@example.com" },
    { text: "London, UK" },
    { text: "github.com/ada", url: "https://github.com/ada" },
  ],
  skills: [{ category: "Languages", items: "Python, Rust" }],
  experience: [{
    jobTitle: "Engineer", company: "Analytical Engines Ltd", location: "London", dateRange: "Jan 2020 - Present",
    bullets: ["Designed the first algorithm.", "Cut runtime by 40%."],
  }],
  projects: [{ title: "Notes on the Engine", linkText: "Read", linkUrl: "https://example.com/notes", bullets: ["Documented the architecture."] }],
  education: [{ school: "Home tutoring", degree: "Mathematics", date: "1830 - 1835" }],
};

test("renders every section in PDF order with all facts present", () => {
  const text = renderCvToText(cv);
  assert.equal(text, `# Ada Lovelace

ada@example.com · London, UK · github.com/ada (https://github.com/ada)

## Summary

Analytical engineer with a focus on computation.

## Skills

- Languages: Python, Rust

## Experience

### Engineer — Analytical Engines Ltd, London
Jan 2020 - Present

- Designed the first algorithm.
- Cut runtime by 40%.

## Projects

### Notes on the Engine (Read: https://example.com/notes)

- Documented the architecture.

## Education

- Mathematics, Home tutoring (1830 - 1835)
`);
});

test("omits empty sections and blank dates", () => {
  const text = renderCvToText({ name: "Sam", contactLine: [], skills: [], experience: [{ jobTitle: "Dev", company: "Acme", location: "", dateRange: "", bullets: ["Shipped."] }], projects: [], education: [] });
  assert.equal(text, "# Sam\n\n## Experience\n\n### Dev — Acme\n\n- Shipped.\n");
  assert.ok(!text.includes("Summary") && !text.includes("Skills") && !text.includes("Education"));
});
