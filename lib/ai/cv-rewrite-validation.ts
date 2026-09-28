import { hasEvidence } from "./evidence";
import type { CvContent } from "@/lib/cv/content";
import { normalizeExtractedText } from "../cv/normalize-extracted-text";

export type RewriteNameValidation =
  | { ok: true }
  | { ok: false; message: string };

export type RewriteSkillValidation =
  | { ok: true }
  | { ok: false; message: string; inventedTerm: string };

const KNOWN_TECHNOLOGIES = [
  ".NET",
  "Angular",
  "Ansible",
  "Apache",
  "Argo CD",
  "Astro",
  "AWS",
  "Azure",
  "BigQuery",
  "Bootstrap",
  "Bun",
  "C#",
  "C++",
  "Cloudflare D1",
  "Cloudflare R2",
  "CSS",
  "Databricks",
  "dbt",
  "Deno",
  "Django",
  "Docker",
  "DynamoDB",
  "Firebase",
  "Elasticsearch",
  "Express",
  "FastAPI",
  "Flask",
  "GCP",
  "Git",
  "GitHub",
  "GitLab",
  "Go",
  "gRPC",
  "GraphQL",
  "Hadoop",
  "Helm",
  "Heroku",
  "HTML",
  "Hugging Face",
  "Java",
  "JavaScript",
  "Jenkins",
  "JWT",
  "Kafka",
  "Keras",
  "Kotlin",
  "Kubernetes",
  "LangChain",
  "LangGraph",
  "Laravel",
  "Linux",
  "MATLAB",
  "MariaDB",
  "MongoDB",
  "MySQL",
  "Netlify",
  "Next.js",
  "Nginx",
  "Node.js",
  "NumPy",
  "OAuth",
  "OpenAI",
  "OpenCV",
  "Ollama",
  "Oracle",
  "Pandas",
  "Postgres",
  "PostgreSQL",
  "Prisma",
  "Pulumi",
  "PyTorch",
  "Python",
  "React",
  "React Native",
  "Redis",
  "Remix",
  "REST",
  "Ruby",
  "Ruby on Rails",
  "Rust",
  "Salesforce",
  "Scala",
  "Scikit-learn",
  "Snowflake",
  "SOAP",
  "Spark",
  "Spring",
  "SQL",
  "SQLite",
  "Supabase",
  "Svelte",
  "Swift",
  "TensorFlow",
  "Terraform",
  "Travis CI",
  "TypeScript",
  "Unity",
  "Unreal",
  "Vercel",
  "Vue",
  "WebSocket",
  "Webpack",
] as const;

const BULLET_WORDS_TO_IGNORE = new Set([
  "achieved",
  "architected",
  "api",
  "apis",
  "automated",
  "built",
  "collaborated",
  "created",
  "delivered",
  "designed",
  "developed",
  "engineered",
  "implemented",
  "improved",
  "increased",
  "integrated",
  "led",
  "managed",
  "optimized",
  "reduced",
  "supported",
  "used",
]);

const SKILL_WORDS_TO_IGNORE = new Set([
  "and",
  "etc",
  "including",
  "other",
  "tools",
  "with",
]);

function comparable(value: string) {
  return normalizeExtractedText(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function sourceContainsTerm(sourceCvText: string, term: string) {
  return hasEvidence(sourceCvText, term);
}

// Explicit product aliases, not arbitrary combinations of words from the CV.
// https://developers.cloudflare.com/d1/ and https://developers.cloudflare.com/r2/
const TECHNOLOGY_ALIASES = [
  ["Postgres", "PostgreSQL"],
  ["Node.js", "NodeJS"],
  ["Next.js", "NextJS"],
  ["Cloudflare D1", "D1 SQL Database"],
  ["Cloudflare R2", "R2 Storage"],
] as const;

function sourceContainsTechnology(sourceCvText: string, term: string) {
  const candidate = comparable(term);
  const aliases = TECHNOLOGY_ALIASES.find((group) =>
    group.some((alias) => comparable(alias) === candidate),
  );
  if (!aliases) return sourceContainsTerm(sourceCvText, term);

  const source = comparable(sourceCvText);
  return aliases.some((alias) => {
    const escaped = comparable(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Keep boundaries: D10 and R20 must not count as D1 and R2 evidence.
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(source);
  });
}

export function splitSkillItems(items: string) {
  return items
    .split(/[,;|\n]|\s+&\s+/)
    .map((term) => term.trim().replace(/^[\s•·-]+|[\s.]+$/g, ""))
    .filter(Boolean);
}

function bulletTechnologyTerms(bullet: string) {
  const terms = new Set<string>();
  const lowerBullet = bullet.toLocaleLowerCase();

  for (const technology of KNOWN_TECHNOLOGIES) {
    const escaped = technology
      .toLocaleLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const technologyPattern = new RegExp(
      `(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`,
    );
    if (technologyPattern.test(lowerBullet)) {
      terms.add(technology);
    }
  }

  const tokens = bullet.match(/(?:\.?[A-Z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9+#-]+)+|[A-Z]{2,}|[A-Za-z]+[A-Z][A-Za-z0-9]*)/g) ?? [];
  for (const token of tokens) {
    const normalized = token.toLocaleLowerCase();
    if (token.length < 3 || BULLET_WORDS_TO_IGNORE.has(normalized)) continue;
    terms.add(token);
  }

  return terms;
}

export function validateTailoredRewriteSkills(
  rewrite: Pick<CvContent, "skills" | "experience" | "projects"> & {
    summary?: string;
  },
  sourceCvText: string,
  addedSkills: string[] = [],
): RewriteSkillValidation {
  const terms = new Set<string>();

  for (const skill of rewrite.skills) {
    for (const term of splitSkillItems(skill.items)) {
      const normalized = comparable(term);
      if (
        normalized.length < 3 ||
        SKILL_WORDS_TO_IGNORE.has(normalized) ||
        addedSkills.some(added => comparable(added) === normalized)
      ) {
        continue;
      }
      terms.add(term);
    }
  }

  for (const entry of [...rewrite.experience, ...rewrite.projects]) {
    for (const bullet of entry.bullets) {
      for (const term of bulletTechnologyTerms(bullet)) terms.add(term);
    }
  }

  if (rewrite.summary) {
    for (const term of bulletTechnologyTerms(rewrite.summary)) terms.add(term);
  }

  for (const term of terms) {
    if (!sourceContainsTechnology(sourceCvText, term)) {
      return {
        ok: false,
        inventedTerm: term,
        message: `The tailored CV introduced unsupported skill or technology "${term}" that does not appear in the source CV.`,
      };
    }
  }

  return { ok: true };
}

// Normalize only the authorized Skills additions. Source evidence and prose are
// still validated independently; normalization never confers experience credit.
export function normalizeAddedSkills(rewrite: CvContent): CvContent {
  if (!rewrite.addedSkills?.length) return rewrite;
  const plainName = (value: string) => value.replace(/^(?:basic|intermediate|advanced|expert)\s+/i, "").trim();
  const replacements = new Map<string, string>();
  const seen = new Set<string>();
  const addedSkills = rewrite.addedSkills.flatMap(item => splitSkillItems(item.skill).flatMap(name => {
    const skill = plainName(name);
    replacements.set(comparable(name), skill);
    const key = comparable(skill);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...item, skill }];
  }));
  const skills = rewrite.skills.map(group => {
    const items = splitSkillItems(group.items);
    if (!items.some(item => replacements.has(comparable(item)))) return group;
    const names = items.map(item => replacements.get(comparable(item)) ?? item);
    return { ...group, items: names.filter((item, index) => names.findIndex(other => comparable(other) === comparable(item)) === index).join(", ") };
  });
  // A declared addition the model forgot to list goes into the first skills group, where additions belong anyway.
  // Invalid additions are still rejected (or dropped in lenient mode) by the checks that follow.
  const listed = new Set(skills.flatMap(group => splitSkillItems(group.items).map(comparable)));
  const missing = addedSkills.filter(item => !listed.has(comparable(item.skill))).map(item => item.skill);
  if (missing.length) {
    if (skills.length) skills[0] = { ...skills[0], items: [...splitSkillItems(skills[0].items), ...missing].join(", ") };
    else skills.push({ category: "Skills", items: missing.join(", ") });
  }
  return { ...rewrite, addedSkills, skills };
}

/** Why one added skill is not allowed, or null. Shared by the strict check and lenient pruning. */
function addedSkillProblem(item: NonNullable<CvContent["addedSkills"]>[number], rewrite: CvContent, source: string, posting: string) {
  if (splitSkillItems(item.skill).length !== 1) return `Invalid added skill "${item.skill}": use one distinct skill name per entry; remove duplicates and separate grouped tools (maximum three total).`;
  if (/\b(certified|certification|license|licence|clearance|fluent|native|expert|advanced|senior|years?)\b/i.test(item.skill)) return `Invalid added skill "${item.skill}": use a plain tool or capability name such as SQL, without proficiency, credentials or years. Remove unsupported credentials or experience claims from Skills; do not move them into other sections.`;
  if (!hasEvidence(posting, item.jobQuote) || !hasEvidence(item.jobQuote, item.skill)) return `Added skill "${item.skill}" must be named in an exact quotation from the target posting.`;
  if (sourceContainsTechnology(source, item.skill)) return `"${item.skill}" already appears in the CV; preserve it as an existing skill, not an addition.`;
  if (!rewrite.skills.some(group => splitSkillItems(group.items).some(skill => comparable(skill) === comparable(item.skill)))) return `Added skill "${item.skill}" is missing from the Skills section.`;
  return null;
}

/**
 * Lenient mode: removes additions that break a rule (and their Skills entries) instead of failing the CV.
 * Removing a skill that was only ever an addition cannot introduce a false claim.
 */
export function pruneInvalidAddedSkills(rewrite: CvContent, source: string, posting?: string): CvContent {
  const additions = rewrite.addedSkills ?? [];
  if (!additions.length) return rewrite;
  const seen = new Set<string>();
  const keep = additions.filter(item => {
    const key = comparable(item.skill);
    const ok = Boolean(posting) && Boolean(key) && !seen.has(key) && seen.size < 3 && !addedSkillProblem(item, rewrite, source, posting!);
    if (ok) seen.add(key);
    return ok;
  });
  const dropped = new Set(additions.filter(item => !keep.includes(item)).map(item => comparable(item.skill)));
  if (!dropped.size) return rewrite;
  return { ...rewrite, addedSkills: keep, skills: rewrite.skills.map(group => ({ ...group, items: splitSkillItems(group.items).filter(item => !dropped.has(comparable(item)) || sourceContainsTechnology(source, item)).join(", ") })).filter(group => group.items) };
}

export function validateAddedSkills(rewrite: CvContent, source: string, posting?: string): RewriteNameValidation {
  const additions = rewrite.addedSkills ?? [];
  if (!additions.length) return { ok: true };
  if (!posting || additions.length > 3) return { ok: false, message: "Added skills require a target posting and are limited to three." };
  const seen = new Set<string>();
  for (const item of additions) {
    const key = comparable(item.skill);
    if (!key || seen.has(key)) return { ok: false, message: `Invalid added skill "${item.skill}": use one distinct skill name per entry; remove duplicates and separate grouped tools (maximum three total).` };
    seen.add(key);
    const problem = addedSkillProblem(item, rewrite, source, posting);
    if (problem) return { ok: false, message: problem };
  }
  return { ok: true };
}

export function validateRewriteName(
  rewrite: Pick<CvContent, "name" | "projects">,
  sourceCvText: string,
): RewriteNameValidation {
  const name = comparable(rewrite.name);
  const matchesProject = rewrite.projects.some(
    (project) => comparable(project.title) === name,
  );

  if (matchesProject) {
    return {
      ok: false,
      message:
        "The generated CV used a project title as the applicant name. Please retry the rewrite.",
    };
  }

  const sourceOpening = comparable(sourceCvText.slice(0, 400));
  if (!sourceOpening.includes(name)) {
    return {
      ok: false,
      message:
        "The generated applicant name could not be verified near the top of the source CV. Please retry the rewrite.",
    };
  }

  return { ok: true };
}

export type RewriteClaimValidation =
  | { ok: true }
  | { ok: false; message: string; inventedClaim: string };

// Dashes and unicode separators vary between the source PDF and model output, so
// normalise them before comparing numbers.
function numericComparable(value: string) {
  return comparable(value)
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*%/g, "%");
}

const COUNTABLE_UNITS =
  "months?|weeks?|years?|days?|hours?|minutes?|seconds?|users?|customers?|clients?|downloads?|stars?|times";

// Only bullets are checked. Section headers and date ranges get legitimately
// reformatted (e.g. "2023 - 2026" -> "2023 – 2026"), which would be false positives.
function bulletNumericClaims(bullet: string): string[] {
  const claims: string[] = [];
  const text = numericComparable(bullet);

  for (const m of text.matchAll(/\d+(?:[.,]\d+)*\s*%/g)) claims.push(m[0].trim());
  for (const m of text.matchAll(
    new RegExp(`\\d+(?:[.,]\\d+)*\\s+(?:${COUNTABLE_UNITS})\\b`, "g"),
  ))
    claims.push(m[0].trim());
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+|\d{4,}/g)) claims.push(m[0].trim());

  return [...new Set(claims)];
}

function rewriteBullets(rewrite: CvContent): string[] {
  return [
    // The summary is free prose, which is exactly where an invented figure such as
    // "3 years of experience" tends to appear.
    ...(rewrite.summary ? [rewrite.summary] : []),
    ...rewrite.experience.flatMap((entry) => entry.bullets),
    ...rewrite.projects.flatMap((entry) => entry.bullets),
  ];
}

/**
 * Every quantified claim in a bullet must already exist in the source CV. This is the
 * check that catches an invented metric such as "40% month-over-month increase" or
 * "within 3 months of launch" - the most damaging thing this pipeline can produce,
 * because it puts a false performance claim on a real application.
 */
export function validateRewriteNumericClaims(
  rewrite: CvContent,
  sourceCvText: string,
): RewriteClaimValidation {
  const source = numericComparable(sourceCvText);

  for (const bullet of rewriteBullets(rewrite)) {
    for (const claim of bulletNumericClaims(bullet)) {
      const compact = claim.replace(/\s+/g, "");
      if (hasEvidence(source, claim) || hasEvidence(source, compact)) continue;

      return {
        ok: false,
        inventedClaim: claim,
        message:
          `The rewrite invented the figure "${claim}", which does not appear in the ` +
          `source CV. Try again; a CV must not state metrics you did not provide.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Contact details must be copied from the source, never regenerated - a model that
 * writes a URL can invent one (e.g. "github.com/your-username").
 */
/**
 * Structured output can still carry a malformed field: a model that starts an array where the schema wants a
 * string yields items such as ":[" that pass a min-length check and print as garbage on the CV.
 */
export function validateRewriteSkillsText(rewrite: CvContent): RewriteClaimValidation {
  for (const group of rewrite.skills) {
    for (const value of [group.category, group.items]) {
      if (!/\p{L}{2}/u.test(value) || /^[\s"'`:;,.\[\]{}()]+$/u.test(value)) {
        return { ok: false, inventedClaim: value, message: `The rewrite produced an unreadable skills entry "${value.slice(0, 40)}". Skills must be written out as text.` };
      }
    }
  }
  return { ok: true };
}

export function validateRewriteContacts(
  rewrite: CvContent,
  sourceCvText: string,
): RewriteClaimValidation {
  for (const contact of rewrite.contactLine) {
    for (const value of [contact.text, contact.url]) {
      if (!value) continue;
      // Adding a scheme to a bare domain is a formatting change, not a fabrication:
      // the CV says "linkedin.com", the model may emit "https://linkedin.com".
      const candidate = value
        .replace(/^mailto:|^tel:/i, "")
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/+$/, "")
        .trim();
      if (!candidate || sourceContainsTerm(sourceCvText, candidate)) continue;
      // Phone spacing/punctuation and tel: links may differ; digits must match
      // one complete source number, never digits assembled across CV fields.
      const digits = candidate.replace(/\D/g, "");
      if (/^\+?[\d\s().-]+$/.test(candidate) && digits.length >= 9 && digits.length <= 15 &&
        [...sourceCvText.matchAll(/\+?\d[\d \t().-]{6,}\d/g)].some(match => match[0].replace(/\D/g, "") === digits)) continue;

      return {
        ok: false,
        inventedClaim: candidate,
        message:
          `The rewrite invented the contact detail "${candidate}", which does not ` +
          `appear in the source CV. Contact details must be copied verbatim.`,
      };
    }
  }

  return { ok: true };
}

/**
 * A rewrite that drops whole sections passes every fabrication check while being
 * useless - an empty CV invents nothing. If the source has a section, the rewrite
 * must keep at least one entry of it.
 */
export function validateRewriteCompleteness(
  rewrite: CvContent,
  sourceCvText: string,
): RewriteClaimValidation {
  const source = comparable(sourceCvText);

  const sections: Array<{
    label: string;
    present: boolean;
    kept: number;
  }> = [
    {
      label: "experience",
      present: /\bexperience\b|\bintern\b|\bemploy/.test(source),
      kept: rewrite.experience.length,
    },
    {
      label: "skills",
      present: /\bskills?\b|\btechnolog/.test(source),
      kept: rewrite.skills.length,
    },
    {
      label: "projects",
      present: /\bprojects?\b/.test(source),
      kept: rewrite.projects.length,
    },
    {
      label: "education",
      present: /\beducation\b|\buniversity\b|\bb\.?s\b|\bdegree\b/.test(source),
      kept: rewrite.education.length,
    },
  ];

  const dropped = sections.filter((s) => s.present && s.kept === 0);
  if (dropped.length) {
    const names = dropped.map((s) => s.label).join(", ");
    return {
      ok: false,
      inventedClaim: names,
      message:
        `The rewrite dropped the ${names} section${dropped.length > 1 ? "s" : ""}, ` +
        `which the source CV contains. Try again; tailoring may reorder and trim, ` +
        `not delete whole sections.`,
    };
  }

  return { ok: true };
}

/** Check every immutable field, including dates and degrees, in both rewrite modes. */
export function validateRewriteFacts(rewrite: CvContent, source: string): RewriteClaimValidation {
  const fields = [
    ...rewrite.experience.flatMap((entry) => [entry.jobTitle, entry.company, entry.location, entry.dateRange]),
    ...rewrite.education.flatMap((entry) => [entry.school, entry.degree, entry.date]),
    ...rewrite.projects.map((entry) => entry.title),
  ];
  for (const field of fields) {
    if (field && !hasEvidence(source, field)) return { ok: false, inventedClaim: field,
      message: `The rewrite changed or invented the factual field "${field}". Copy names, titles, employers, schools, degrees, dates and locations from the source exactly.` };
  }
  return { ok: true };
}
