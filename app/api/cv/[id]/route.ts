import type { NextRequest } from "next/server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { cvDocuments, db } from "@/lib/db";
import { deleteFile } from "@/lib/storage";

// This endpoint is public and unauthenticated. Add authentication and rate
// limiting here before exposing it in a production environment.
export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/cv/[id]">,
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "CV document not found." }, { status: 404 });
  }

  let deleted: { storagePath: string } | undefined;
  try {
    [deleted] = await db
      .delete(cvDocuments)
      .where(eq(cvDocuments.id, id))
      .returning({ storagePath: cvDocuments.storagePath });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : error;
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23503") {
      return Response.json(
        { error: "This CV is used by a saved pipeline run and cannot be deleted." },
        { status: 409 },
      );
    }
    throw error;
  }

  if (!deleted) {
    return Response.json({ error: "CV document not found." }, { status: 404 });
  }

  try {
    await deleteFile(deleted.storagePath);
  } catch (error) {
    console.error("Failed to delete stored CV after removing its row", error);
    return Response.json(
      { error: "The CV record was removed, but its stored file could not be deleted." },
      { status: 500 },
    );
  }

  return new Response(null, { status: 204 });
}
