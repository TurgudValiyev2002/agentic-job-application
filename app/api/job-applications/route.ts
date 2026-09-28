import { listApplications, workerActive } from "@/lib/job-applications/store";
import { localRequestError } from "@/lib/job-applications/http";
export async function GET(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  return Response.json({ applications: await listApplications(), workerActive: await workerActive() });
}
