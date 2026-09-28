import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CV_LATEX_PREAMBLE,
  escapeLatexText,
  escapeLatexUrl,
  renderCvToLatex,
} from "./render-cv.ts";

const baseCv = {
  name: "Ada Lovelace",
  contactLine: [],
  skills: [],
  experience: [],
  projects: [],
  education: [],
};

test("matches the user's template preamble byte-for-byte", async () => {
  const templatePreamble = await readFile(
    new URL("./test-fixtures/user-template-preamble.tex", import.meta.url),
    "utf8",
  );

  assert.equal(`${CV_LATEX_PREAMBLE}\n`, templatePreamble);
});

test("escapes every LaTeX-special text character", () => {
  assert.equal(
    escapeLatexText("A & % $ # _ { } ~ ^ " + "\\"),
    "A \\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}",
  );
});

test("escapes URL fragments and percent signs without text escaping", () => {
  assert.equal(
    escapeLatexUrl("https://example.com/a_b?q=50%#result"),
    "https://example.com/a_b?q=50\\%\\#result",
  );
});

test("omits an empty Projects section", () => {
  const latex = renderCvToLatex({
    ...baseCv,
    experience: [
      {
        jobTitle: "Engineer",
        company: "Example",
        location: "Vienna",
        dateRange: "2024 -- Present",
        bullets: ["Built a renderer"],
      },
    ],
    education: [{ school: "TU", degree: "BSc", date: "2024" }],
  });

  assert.equal(latex.includes("\\section*{Projects}"), false);
  assert.equal(latex.includes("\\section*{Experience}"), true);
  assert.equal(latex.includes("\\section*{Education}"), true);
});

test("escapes a literal backslash in a bullet and preserves the preamble", () => {
  const latex = renderCvToLatex({
    ...baseCv,
    experience: [
      {
        jobTitle: "Engineer",
        company: "Example",
        location: "Vienna",
        dateRange: "2024",
        bullets: ["Automated C:\\build output"],
      },
    ],
  });

  assert.ok(latex.startsWith(`${CV_LATEX_PREAMBLE}\n`));
  assert.match(latex, /Automated C:\\textbackslash\{\}build output/);
});
