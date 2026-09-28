import type { JobAssessment } from "@/lib/jobs/assessment";

function compactLabel(value: string) {
  const text = value.replace(/\s*\((?:partial|not demonstrated|contradicted)\)\s*$/, "").trim();
  if (text.length <= 48) return text;
  const prefix = text.slice(0, 47);
  return `${prefix.slice(0, prefix.lastIndexOf(" ") > 20 ? prefix.lastIndexOf(" ") : 47)}…`;
}

export function GapSummary({ assessment, missing }: { assessment?: JobAssessment | null; missing: string[] }) {
  const gaps = assessment
    ? assessment.requirements.filter(item => item.status !== "met").map(item => item.shortLabel ?? item.requirement)
    : missing;
  if (!gaps.length) return null;
  return <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
    <span className="font-medium">Gaps to discuss: </span>
    {gaps.slice(0, 3).map(compactLabel).join(" · ")}
    {gaps.length > 3 ? ` · +${gaps.length - 3} more` : ""}
  </p>;
}
