/** The target role as a job-board query: the part before any parenthesis, e.g. "AI researcher (LLM evaluation)" → "AI researcher". */
export function searchTitleFromTargetRole(targetRole: string | null | undefined) {
  const title = (targetRole ?? "").split(/[(\[:;|]/)[0].replace(/\s+/g, " ").trim();
  return title.length >= 3 && title.length <= 60 ? title : null;
}

/** The role a profile aims at: its target role, else the desired position from its Details. Never the profile's name, which may be a label like "Profile 1". */
export function profileTargetRole(profile: { targetRole?: string | null; desiredPosition?: string | null }) {
  return profile.targetRole?.trim() || profile.desiredPosition?.trim() || null;
}

const ROLE_NOUN = /\b(?:engineer|developer|programmer|researcher|scientist|architect|analyst|administrator|consultant|designer|manager|lead|specialist|intern)\b/i;

/**
 * The lead search titles for a role: each part of a combined role that names a role ("Backend / Platform Engineer" →
 * "Platform Engineer"; a bare modifier such as "Backend" is not a query on its own). The model that derives the
 * search profile receives the role too and supplies the titles employers post that work under.
 */
export function searchTitlesFromTargetRole(targetRole: string | null | undefined): string[] {
  const cleaned = searchTitleFromTargetRole(targetRole);
  if (!cleaned) return [];
  const parts = cleaned.split(/\s*[/,]\s*/).map((part) => part.trim()).filter(Boolean);
  const named = parts.filter((part) => ROLE_NOUN.test(part));
  return named.length ? named.slice(0, 2) : parts.length === 1 ? [cleaned] : [];
}
