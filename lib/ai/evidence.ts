import { normalizeExtractedText } from "../cv/normalize-extracted-text";

// Preserve words, numbers and punctuation. Never join separate tokens: Java is
// not evidence for JavaScript and 40% is not evidence for 140%.
export function normalizeEvidence(value: string) {
  return normalizeExtractedText(value).normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s+/g, " ").trim().toLowerCase();
}

export function hasEvidence(source: string, quote: string) {
  const needle = normalizeEvidence(quote);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(normalizeEvidence(source));
}
