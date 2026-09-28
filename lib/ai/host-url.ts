/**
 * Inside Docker, "localhost" is the container itself. docker-compose sets ORCH_LOCALHOST_ALIAS to
 * host.docker.internal, so a model URL pointing at localhost (a local Ollama or LM Studio) reaches the host
 * machine instead, and the same saved connection works in and outside Docker. Other hosts are unchanged.
 */
export function reachableUrl(url: string) {
  const alias = process.env.ORCH_LOCALHOST_ALIAS?.trim();
  if (!alias) return url;
  try {
    const parsed = new URL(url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return url;
    parsed.hostname = alias;
    return parsed.toString();
  } catch { return url; }
}
