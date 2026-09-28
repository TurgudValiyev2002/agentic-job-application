import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ApplicationForm } from "@/app/_components/application-form";
import { ProfileList } from "@/app/_components/profile-list";
import { maxCvBytes } from "@/lib/config";
import { getApplication, listProfiles } from "@/lib/db/queries";

export const metadata: Metadata = { title: "CV profiles", description: "Named details and reviewed CVs." };
const timestamp = (value: Date) => ({ iso: value.toISOString(), text: value.toLocaleString("en-GB", { timeZone: "Europe/Vienna" }) });

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ new?: string; profile?: string; duplicate?: string; saved?: string }> }) {
  const query = await searchParams;
  if (!query.new && !query.profile && !query.duplicate) {
    const profiles = await listProfiles();
    return <ProfileList initialProfiles={profiles.map(profile => ({ ...profile, updatedAt: profile.updatedAt.toISOString(), selectedAt: profile.selectedAt?.toISOString() ?? null, archivedAt: profile.archivedAt?.toISOString() ?? null }))} saved={query.saved} />;
  }
  const id = query.profile ?? query.duplicate;
  if (!query.new && id && !z.uuid().safeParse(id).success) notFound();
  const stored = !query.new && id ? await getApplication(id) : null;
  if (!query.new && id && !stored) notFound();
  const initialApplication = stored ? { ...stored, ...(query.duplicate ? { id: "", name: `${stored.name} copy`, cvDocument: null, cvDocumentId: null, cvReviewId: null } : {}), submittedAt: timestamp(stored.createdAt), updatedAtDisplay: timestamp(stored.updatedAt) } : null;
  return <ApplicationForm key={query.new ? "new" : `${id}-${Boolean(query.duplicate)}`} initialApplication={initialApplication} maxCvBytes={maxCvBytes()} />;
}
