import assert from "node:assert/strict";
import test from "node:test";

import {
  validateRewriteName,
  validateRewriteSkillsText,
  validateTailoredRewriteSkills,
} from "./cv-rewrite-validation.ts";

function tailoredContent(overrides = {}) {
  return {
    skills: [{ category: "Languages", items: "Python, TypeScript" }],
    experience: [
      {
        jobTitle: "Developer",
        company: "Example",
        location: "Vienna",
        dateRange: "2024",
        bullets: ["Built Python services with TypeScript tooling."],
      },
    ],
    projects: [],
    ...overrides,
  };
}

test("rejects a name equal to a project title", () => {
  const result = validateRewriteName(
    {
      name: "POLYMARKET AUTOMATED BTC TRADING BOT",
      projects: [
        { title: "Polymarket Automated BTC Trading Bot", bullets: ["Built it"] },
      ],
    },
    "Polymarket Automated BTC Trading Bot\nSÜLEYMAN EMIRHAN DONCU",
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /project title/i);
});

test("rejects a name absent from the source opening", () => {
  const result = validateRewriteName(
    { name: "Wrong Person", projects: [] },
    "SÜLEYMAN EMIRHAN DONCU\nExperience",
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /near the top/i);
});

test("accepts the person's name from the source opening", () => {
  assert.deepEqual(
    validateRewriteName(
      { name: "SÜLEYMAN EMIRHAN DONCU", projects: [] },
      "SÜLEYMAN   EMIRHAN DONCU\nExperience",
    ),
    { ok: true },
  );
});

test("rejects an invented tailored skill", () => {
  const result = validateTailoredRewriteSkills(
    tailoredContent({
      skills: [
        { category: "Languages", items: "Python" },
        { category: "Infrastructure", items: "Kubernetes" },
      ],
      experience: [],
    }),
    "Skills: Python, Docker",
  );

  assert.equal(result.ok, false);
  assert.equal(result.inventedTerm, "Kubernetes");
  assert.match(result.message, /Kubernetes/);
});

test("rejects an invented technology mentioned only in a bullet", () => {
  const result = validateTailoredRewriteSkills(
    tailoredContent({
      skills: [],
      experience: [],
      projects: [
        { title: "Service", bullets: ["Built the service with Kotlin."] },
      ],
    }),
    "Built the service with Java.",
  );

  assert.equal(result.ok, false);
  assert.equal(result.inventedTerm, "Kotlin");
});

test("accepts genuine content reordered for a tailored CV", () => {
  assert.deepEqual(
    validateTailoredRewriteSkills(
      tailoredContent({
        projects: [
          { title: "Relevant", bullets: ["Built Docker services with Python."] },
          { title: "Earlier", bullets: ["Developed TypeScript tooling."] },
        ],
        experience: [],
      }),
      "Earlier project used TypeScript. Relevant project used Python and Docker.",
    ),
    { ok: true },
  );
});

test("accepts case variants and explicit Postgres aliases", () => {
  assert.deepEqual(
    validateTailoredRewriteSkills(
      tailoredContent({
        skills: [{ category: "Data", items: "Postgres, Python" }],
        experience: [],
      }),
      "PYTHON development with PostgreSQL databases",
    ),
    { ok: true },
  );
});

const CLOUDFLARE_SOURCE = "Used Cloudflare Workers to deploy and used Cloudflare services like D1 SQL Database and R2 Storage";

test("accepts Cloudflare product names supported by the source CV's aliases", () => {
  assert.deepEqual(validateTailoredRewriteSkills(tailoredContent({
    skills: [{ category: "Cloud", items: "Cloudflare D1, Cloudflare R2" }],
    experience: [],
    projects: [{ title: "App", bullets: ["Used Cloudflare D1 and Cloudflare R2."] }],
    summary: "Developer using Cloudflare D1 and Cloudflare R2.",
  }), CLOUDFLARE_SOURCE), { ok: true });
});

test("recognizes product aliases across case and PDF line breaks", () => {
  assert.deepEqual(validateTailoredRewriteSkills(tailoredContent({
    skills: [{ category: "Cloud", items: "Cloudflare D1, Cloudflare R2" }],
    experience: [],
  }), "Cloudflare services: d1 SQL\nDatabase and r2\nStorage."), { ok: true });
});

test("supports the reverse product naming change", () => {
  assert.deepEqual(validateTailoredRewriteSkills(tailoredContent({
    skills: [{ category: "Cloud", items: "D1 SQL Database, R2 Storage" }],
    experience: [],
  }), "Used Cloudflare D1 and Cloudflare R2."), { ok: true });
});

test("does not infer Cloudflare products from a vendor, another product, or a partial name", () => {
  for (const [term, source] of [
    ["Cloudflare D1", "Used Cloudflare Workers and SQL databases."],
    ["Cloudflare D1", "Used Cloudflare R2 Storage."],
    ["Cloudflare R2", "Used Cloudflare D1 SQL Database."],
    ["Cloudflare D1", "Used Cloudflare D10."],
    ["Cloudflare R2", "Used Cloudflare R20."],
    ["Cloudflare D1", "Used Cloudflare and the XD1 SQL Database."],
  ]) {
    const result = validateTailoredRewriteSkills(tailoredContent({
      skills: [{ category: "Cloud", items: term }], experience: [],
    }), source);
    assert.equal(result.ok, false, `${term} must not be inferred from ${source}`);
    assert.equal(result.inventedTerm, term);
  }
});

test("checks unsupported Cloudflare products in bullets and summaries too", () => {
  for (const content of [
    { summary: "Developer using Cloudflare D1." },
    { projects: [{ title: "App", bullets: ["Used Cloudflare D1."] }] },
  ]) {
    const result = validateTailoredRewriteSkills(tailoredContent({
      skills: [], experience: [], ...content,
    }), "Used Cloudflare Workers.");
    assert.equal(result.ok, false);
    assert.equal(result.inventedTerm, "Cloudflare D1");
  }
});

test("rejects skills entries that are punctuation instead of text, which structured output can still produce", () => {
  assert.equal(validateRewriteSkillsText(tailoredContent()).ok, true);
  for (const items of [":[", "[]", "{}", "\"", " , ", ""]) {
    const result = validateRewriteSkillsText(tailoredContent({ skills: [{ category: "Machine Learning & Systems", items }] }));
    assert.equal(result.ok, false, JSON.stringify(items));
    assert.match(result.message, /unreadable skills entry/);
  }
  assert.equal(validateRewriteSkillsText(tailoredContent({ skills: [{ category: "::", items: "Go, Python" }] })).ok, false, "the category is checked too");
  assert.equal(validateRewriteSkillsText(tailoredContent({ skills: [{ category: "Sprachen", items: "Deutsch (Muttersprache), Englisch" }] })).ok, true, "non-ASCII letters count");
});
