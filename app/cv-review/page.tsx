import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { Metadata } from "next";
import { connection } from "next/server";

import { CvReviewer } from "@/app/_components/cv-reviewer";
import { defaultProviderId, selectableAiProviders } from "@/lib/ai/provider";
import { maxCvBytes } from "@/lib/config";
import { getLatestCvDocumentWithReview, getApplication, getSelectedApplication, listProfiles } from "@/lib/db/queries";

export const metadata: Metadata = {
  title: "CV Review",
  description: "AI feedback on your CV.",
};

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Vienna",
});

function formattedTimestamp(value: Date) {
  return {
    iso: value.toISOString(),
    text: timestampFormatter.format(value),
  };
}

export default async function CvReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[]; profile?: string; uploads?: string }>;
}) {
  await connection();
  const query = await searchParams;
  const newValue = query.new;
  if (query.profile && !z.uuid().safeParse(query.profile).success) notFound();
  const [profiles, profile] = await Promise.all([listProfiles(), query.profile ? getApplication(query.profile) : getSelectedApplication()]);
  if (query.profile && !profile) notFound();
  const startBlank = Array.isArray(newValue)
    ? newValue.includes("1")
    : newValue === "1";

  // This public load exposes the latest applicant's personal data. It is only
  // acceptable for this local single-user dev tool and must be scoped to an
  // authenticated user before deployment.
  const storedResult = startBlank ? null : query.uploads || !profile
    ? await getLatestCvDocumentWithReview(undefined, Boolean(query.uploads))
    : profile.cvDocumentId ? await getLatestCvDocumentWithReview(profile.cvDocumentId) : null;
  const initialDocument = storedResult
    ? {
        id: storedResult.id,
        originalFilename: storedResult.originalFilename,
        byteSize: storedResult.byteSize,
        extractionStatus: storedResult.extractionStatus,
        extractionError: storedResult.extractionError,
        textPreview: storedResult.textPreview,
      }
    : null;
  const initialReview = storedResult?.review
    ? {
        reviewId: storedResult.review.id,
        provider: storedResult.review.provider,
        model: storedResult.review.model,
        overallScore: storedResult.review.overallScore,
        summary: storedResult.review.summary,
        strengths: storedResult.review.strengths,
        weaknesses: storedResult.review.weaknesses,
        suggestions: storedResult.review.suggestions,
        completedAt: formattedTimestamp(storedResult.review.completedAt),
      }
    : null;
  const initialRewrite = storedResult?.rewrite
    ? {
        rewriteId: storedResult.rewrite.id,
        provider: storedResult.rewrite.provider,
        model: storedResult.rewrite.model,
        content: storedResult.rewrite.content,
        counts: {
          experience: storedResult.rewrite.experienceCount,
          projects: storedResult.rewrite.projectCount,
          education: storedResult.rewrite.educationCount,
        },
        completedAt: formattedTimestamp(storedResult.rewrite.completedAt),
        saved: storedResult.rewrite.saved,
      }
    : null;

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <nav aria-label="CV profiles" className="mb-6 flex flex-wrap gap-3">
          {profiles.map(item => <Link key={item.id} aria-current={!query.uploads && item.id === profile?.id ? "page" : undefined} className="underline aria-[current=page]:font-bold" href={`/cv-review?profile=${item.id}`}>{item.name}</Link>)}
          <Link className="underline" href="/cv-review?uploads=1">Other uploads</Link>
        </nav>
        {profile && !query.uploads && <p className="mb-4">{profile.name} · {profile.cvStatus}{profile.cvError ? ` · ${profile.cvError}` : ""}</p>}
        <CvReviewer
          key={storedResult?.id ?? "new"}
          maxBytes={maxCvBytes()}
          providers={await selectableAiProviders()}
          defaultProvider={await defaultProviderId()}
          initialDocument={initialDocument}
          initialReview={initialReview}
          initialRewrite={initialRewrite}
        />
      </div>
    </main>
  );
}
