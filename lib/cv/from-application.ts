import type { CvContent } from "@/lib/cv/content";
import type { LatestApplication } from "@/lib/db/queries";

/**
 * Builds a CV from the application form's stored data.
 *
 * Deliberately has no model in it. The form is already structured, so the mapping
 * is a pure function: instant, free, and incapable of inventing a fact the user
 * did not type. Every string below comes straight from a form field.
 */

function formatMonthYear(date: string | null): string | null {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) return null;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const monthIndex = Number(match[2]) - 1;
  const month = months[monthIndex];
  return month ? `${month} ${match[1]}` : match[1];
}

function dateRange(
  start: string | null,
  end: string | null,
  isCurrent: boolean,
): string {
  const from = formatMonthYear(start);
  const to = isCurrent ? "Present" : formatMonthYear(end);
  if (from && to) return `${from} - ${to}`;
  return from ?? to ?? "";
}

function joinLocation(...parts: Array<string | null>): string | null {
  const value = parts.filter((part) => part && part.trim()).join(", ");
  return value || null;
}

/** Free-text descriptions become bullets; the form has no bullet structure. */
function toBullets(description: string | null): string[] {
  if (!description) return [];
  return description
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[\s•·*-]+/, "").trim())
    .filter((line) => line.length > 1)
    .slice(0, 6);
}

/** Optional form fields are often filled with a dash or "n/a" rather than left blank. */
function isMeaningful(value: string | null): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  return !/^(n\/?a|none|-+|\u2013+|\u2014+)$/i.test(trimmed);
}

function titleCase(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function buildCvFromApplication(
  application: LatestApplication,
): CvContent {
  const name = [application.firstName, application.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  const contactLine: CvContent["contactLine"] = [];
  const push = (text: string | null, url?: string) => {
    if (text && text.trim()) contactLine.push(url ? { text, url } : { text });
  };

  push(application.email, `mailto:${application.email}`);
  push(application.phone);
  push(joinLocation(application.city, application.country));

  const seenHosts = new Set<string>();
  for (const link of [
    application.linkedinUrl,
    application.githubUrl,
    application.websiteUrl,
    application.portfolioUrl,
  ]) {
    if (!link) continue;
    const label = link.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    const host = label.split("/")[0]?.toLowerCase();
    // A portfolio link often points at the same host as the GitHub one; one is enough.
    if (host && seenHosts.has(host)) continue;
    if (host) seenHosts.add(host);
    push(label, link);
  }

  const skills: CvContent["skills"] = [];
  if (application.skills.length) {
    skills.push({
      category: "Skills",
      items: application.skills.map((skill) => skill.name).join(", "),
    });
  }
  if (application.languages.length) {
    skills.push({
      category: "Languages",
      items: application.languages
        .map((language) => `${language.language} (${language.proficiency})`)
        .join(", "),
    });
  }
  if (isMeaningful(application.certifications)) {
    skills.push({
      category: "Certifications",
      items: application.certifications as string,
    });
  }

  const experience: CvContent["experience"] = application.experience.map(
    (entry) => ({
      jobTitle: entry.jobTitle,
      company: entry.company,
      location: entry.location ?? "",
      dateRange: dateRange(entry.startDate, entry.endDate, entry.isCurrent),
      // The template requires at least one bullet per entry.
      bullets: toBullets(entry.description).length
        ? toBullets(entry.description)
        : [`${titleCase(entry.employmentType ?? "role")} at ${entry.company}`],
    }),
  );

  const education: CvContent["education"] = application.education.map((entry) => ({
    school: entry.institution,
    degree: [entry.degree, entry.fieldOfStudy].filter(Boolean).join(", "),
    date: dateRange(entry.startDate, entry.endDate, entry.isCurrent),
  }));

  return {
    name: name || "Applicant",
    ...(application.summary ? { summary: application.summary } : {}),
    contactLine: contactLine.slice(0, 5),
    skills,
    experience,
    // The application form has no projects section.
    projects: [],
    education,
  };
}
