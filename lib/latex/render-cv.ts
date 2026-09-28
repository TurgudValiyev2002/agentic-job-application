import type { CvContent } from "@/lib/cv/content";

export const CV_LATEX_PREAMBLE = `\\documentclass[11pt]{article}       % set main text size
\\usepackage[letterpaper,                % set paper size to letterpaper. change to a4paper for resumes outside of North America
top=0.5in,                          % specify top page margin
bottom=0.5in,                       % specify bottom page margin
left=0.5in,                         % specify left page margin
right=0.5in]{geometry}              % specify right page margin
                       
\\usepackage{XCharter}               % set font. comment this line out if you want to use the default LaTeX font Computer Modern
\\usepackage[T1]{fontenc}            % output encoding
\\usepackage[utf8]{inputenc}         % input encoding
\\usepackage{enumitem}               % enable lists for bullet points: itemize and \\item
\\usepackage[hidelinks]{hyperref}    % format hyperlinks
\\usepackage{titlesec}               % enable section title customization
\\raggedright                        % disable text justification
\\pagestyle{empty}                   % disable page numbering

% ensure PDF output will be all-Unicode and machine-readable
\\input{glyphtounicode}
\\pdfgentounicode=1

% format section headings: bolding, size, white space above and below
\\titleformat{\\section}{\\bfseries\\large}{}{0pt}{}[\\vspace{1pt}\\titlerule\\vspace{-6.5pt}]

% format bullet points: size, white space above and below, white space between bullets
\\renewcommand\\labelitemi{$\\vcenter{\\hbox{\\small$\\bullet$}}$}
\\setlist[itemize]{itemsep=-2pt, leftmargin=12pt, topsep=7pt} %%% Test various topsep values to fix vertical spacing errors

% resume starts here
\\begin{document}`;

const BACKSLASH_TOKEN = "\uE000\uE001";

export function escapeLatexText(value: string) {
  return value
    .replaceAll("\\", BACKSLASH_TOKEN)
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("$", "\\$")
    .replaceAll("&", "\\&")
    .replaceAll("#", "\\#")
    .replaceAll("^", "\\textasciicircum{}")
    .replaceAll("_", "\\_")
    .replaceAll("~", "\\textasciitilde{}")
    .replaceAll("%", "\\%")
    .replaceAll(BACKSLASH_TOKEN, "\\textbackslash{}");
}

export function escapeLatexUrl(value: string) {
  return value
    .replaceAll("\\", "%5C")
    .replaceAll("{", "%7B")
    .replaceAll("}", "%7D")
    .replaceAll("%", "\\%")
    .replaceAll("#", "\\#")
    .replace(/[\u0000-\u001F\u007F]/g, "");
}

function renderLink(text: string, url?: string) {
  const display = escapeLatexText(text);
  return url ? `\\href{${escapeLatexUrl(url)}}{${display}}` : display;
}

function renderBullets(bullets: string[]) {
  return `\\vspace{-9pt}
\\begin{itemize}
${bullets.map((bullet) => `  \\item ${escapeLatexText(bullet)}`).join("\n")}
\\end{itemize}`;
}

function renderSummary(summary: CvContent["summary"]) {
  if (!summary) return "";

  return `% summary section
\\section*{Summary}
${escapeLatexText(summary)}`;
}

function renderSkills(skills: CvContent["skills"]) {
  if (!skills.length) return "";

  return `% skills section
\\section*{Skills}
${skills
  .map(
    ({ category, items }) =>
      `\\textbf{${escapeLatexText(category)}:} ${escapeLatexText(items)} \\\\`,
  )
  .join("\n")}`;
}

function renderExperience(experience: CvContent["experience"]) {
  if (!experience.length) return "";

  return `% experience section
\\section*{Experience}
${experience
  .map(
    (entry) =>
      `\\textbf{${escapeLatexText(entry.jobTitle)},} ${escapeLatexText(entry.company)}${entry.location ? ` -- ${escapeLatexText(entry.location)}` : ""} \\hfill ${escapeLatexText(entry.dateRange)} \\\\
${renderBullets(entry.bullets)}`,
  )
  .join("\n\n")}`;
}

function renderProjects(projects: CvContent["projects"]) {
  if (!projects.length) return "";

  return `% projects section
\\section*{Projects}
${projects
  .map((project) => {
    const link = project.linkText
      ? ` \\hfill ${renderLink(project.linkText, project.linkUrl)}`
      : "";
    return `\\textbf{${escapeLatexText(project.title)}}${link} \\\\
${renderBullets(project.bullets)}`;
  })
  .join("\n\n")}`;
}

function renderEducation(education: CvContent["education"]) {
  if (!education.length) return "";

  return `% education section
\\section*{Education}
${education
  .map(
    (entry) =>
      `\\textbf{${escapeLatexText(entry.school)}} -- ${escapeLatexText(entry.degree)} \\hfill ${escapeLatexText(entry.date)}`,
  )
  .join(" \\\\\n")}`;
}

export function renderCvToLatex(cv: CvContent) {
  const contactLine = cv.contactLine
    .map(({ text, url }) => renderLink(text, url))
    .join(" | ");
  const sections = [
    renderSummary(cv.summary),
    renderSkills(cv.skills),
    renderExperience(cv.experience),
    renderProjects(cv.projects),
    renderEducation(cv.education),
  ].filter(Boolean);
  const separatedSections = sections
    .map((section, index) => {
      if (index === 0) return section;
      const spacing =
        index === 1 && (cv.summary || cv.skills.length) ? "-6.5pt" : "-18.5pt";
      return `\\vspace{${spacing}}\n\n${section}`;
    })
    .join("\n\n");

  return `${CV_LATEX_PREAMBLE}

% name
\\centerline{\\Huge ${escapeLatexText(cv.name)}}

\\vspace{5pt}

% contact information
\\centerline{${contactLine}}

\\vspace{-10pt}

${separatedSections}

\\end{document}
`;
}
