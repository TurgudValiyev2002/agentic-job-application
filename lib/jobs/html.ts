function decodeEntity(entity: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  if (entity.startsWith("#x")) {
    const point = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(point) ? String.fromCodePoint(point) : `&${entity};`;
  }
  if (entity.startsWith("#")) {
    const point = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : `&${entity};`;
  }
  return named[entity] ?? `&${entity};`;
}

/** Plain text from a job posting's HTML: block tags become line breaks, entities are decoded, whitespace is tidied. */
export function stripHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+|#\d+|#x[\da-f]+);/gi, (_, entity: string) =>
      decodeEntity(entity.toLowerCase()),
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
