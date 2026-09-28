import { z } from "zod";
import { changeProfile, ProfileError } from "@/lib/db/profile-write";
import { localRequestError } from "@/lib/job-applications/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = localRequestError(request); if (denied) return denied;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Profile not found." }, { status: 404 });
  try {
    return Response.json({ profile: await changeProfile(id, "select") });
  } catch (error) {
    if (error instanceof ProfileError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
