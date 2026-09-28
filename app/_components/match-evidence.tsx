import { MIN_MATCH_SCORE, type JobAssessment } from "@/lib/jobs/assessment";

export function MatchEvidence({ assessment }: { assessment?: JobAssessment | null }) {
  if (!assessment) return null;
  return <details className="mt-3 text-sm">
    <summary className="cursor-pointer font-semibold">Why this score? View source evidence</summary>
    <p className="mt-2 text-xs text-zinc-500">This score measures CV evidence coverage, not whether an employer will hire you. Required qualifications carry weight 3; preferred ones weight 1. Partial or transferable evidence earns half credit. Aligned roles with at least {MIN_MATCH_SCORE}/100 and no explicitly contradicted required qualifications can be tailored. Missing tools or experience details are gaps to discuss, not automatic rejection.</p>
    <ul className="mt-3 space-y-3">
      {assessment.requirements.map((item, index) => <li key={index} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
        <p className="font-medium">{item.requirement} · {item.importance} · {item.status.replaceAll("_", " ")}</p>
        <p className="mt-1">{item.explanation}</p>
        <p className="mt-2 text-xs text-zinc-500">Posting: “{item.jobQuote}”</p>
        <p className="mt-1 text-xs text-zinc-500">{item.cvQuote ? `CV: “${item.cvQuote}”` : "CV: not demonstrated in the supplied document."}</p>
      </li>)}
    </ul>
  </details>;
}
