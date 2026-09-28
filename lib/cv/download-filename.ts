export function cvDownloadBaseName(name: string) {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9.-]+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "")
    .replace(/-{2,}/g, "-");

  return ascii || "improved-cv";
}

/** Keep upload names short for employer forms, while identifying the exact tailored rewrite. */
export function cvApplicationFilename(name: string, company: string | null, rewriteId: string) {
  const parts = [cvDownloadBaseName(name).slice(0, 24), cvDownloadBaseName(company || "CV").slice(0, 24), rewriteId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)];
  return `${parts.join("-")}.pdf`;
}

export function cvRewriteDownloadFilename({
  name,
  company,
  jobTitle,
  extension,
}: {
  name: string;
  company: string | null;
  jobTitle: string | null;
  extension: "tex" | "pdf";
}) {
  const namePart = cvDownloadBaseName(name);
  const suffix =
    company && jobTitle
      ? `${cvDownloadBaseName(company).toLocaleLowerCase()}-${cvDownloadBaseName(jobTitle).toLocaleLowerCase()}`
      : "improved-cv";
  return `${namePart}-${suffix}.${extension}`;
}
