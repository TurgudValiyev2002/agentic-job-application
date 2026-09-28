/** This first version controls a local visible browser; it is not a multi-user service. */
export function localRequestError(request: Request, contentType = "application/json"): Response | null {
  // `next start` builds request.url from the bind address (0.0.0.0 in Docker), so judge the host the browser
  // actually addressed. This also turns away DNS-rebinding requests that reach the port under a foreign name.
  const requestUrl = new URL(request.url);
  const url = new URL(`${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return Response.json({ error: "Application automation is available from the local app only." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Open the application from this app to continue." }, { status: 403 });
  }
  if (request.method !== "GET" && !request.headers.get("content-type")?.startsWith(contentType)) {
    return Response.json({ error: contentType === "application/json" ? "Expected a JSON request." : `Expected a ${contentType} request.` }, { status: 415 });
  }
  return null;
}
