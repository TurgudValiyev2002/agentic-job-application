import type { CvContent } from "./content";

/**
 * Renders an improved CV as Markdown. This is the text the pipeline reads when an
 * improved CV is chosen instead of an upload, so it must carry every fact the
 * LaTeX rendering prints; the section order mirrors the PDF.
 */
export function renderCvToText(cv: CvContent) {
  const lines: string[] = [`# ${cv.name}`];

  if (cv.contactLine.length) {
    lines.push("", cv.contactLine.map((item) => item.url && item.url !== item.text && !item.url.startsWith("mailto:") ? `${item.text} (${item.url})` : item.text).join(" · "));
  }
  if (cv.summary) lines.push("", "## Summary", "", cv.summary);

  if (cv.skills.length) {
    lines.push("", "## Skills", "");
    for (const group of cv.skills) lines.push(`- ${group.category}: ${group.items}`);
  }

  if (cv.experience.length) {
    lines.push("", "## Experience");
    for (const role of cv.experience) {
      const where = [role.company, role.location].filter((part) => part.trim()).join(", ");
      lines.push("", `### ${role.jobTitle} — ${where}`);
      if (role.dateRange.trim()) lines.push(role.dateRange);
      lines.push("");
      for (const bullet of role.bullets) lines.push(`- ${bullet}`);
    }
  }

  if (cv.projects.length) {
    lines.push("", "## Projects");
    for (const project of cv.projects) {
      const link = project.linkUrl ? ` (${project.linkText && project.linkText !== project.linkUrl ? `${project.linkText}: ` : ""}${project.linkUrl})` : "";
      lines.push("", `### ${project.title}${link}`, "");
      for (const bullet of project.bullets) lines.push(`- ${bullet}`);
    }
  }

  if (cv.education.length) {
    lines.push("", "## Education", "");
    for (const entry of cv.education) {
      lines.push(`- ${entry.degree}, ${entry.school}${entry.date.trim() ? ` (${entry.date})` : ""}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}
