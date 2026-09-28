import type { CvContent } from "./content";

const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;

/**
 * The applicant's saved contact details are the authoritative address on every tailored CV: the model only copies what the
 * source CV says, and a source CV can carry a placeholder or no email at all. The email is placed first, and any other
 * email the model copied is replaced, so employers always get the address the person actually reads.
 */
export function applySavedContactDetails(content: CvContent, details: { email?: string | null; phone?: string | null }): CvContent {
  const email = details.email?.trim();
  const saved = email && EMAIL.test(email) ? [{ text: email, url: `mailto:${email}` }] : [];
  const others = saved.length ? content.contactLine.filter((item) => !EMAIL.test(item.text) && !/^mailto:/i.test(item.url ?? "")) : content.contactLine;
  return { ...content, contactLine: tidyContactLine([...saved, ...others]) };
}

const key = (text: string) => text.toLowerCase().replace(/^(?:https?:\/\/|mailto:|tel:)/, "").replace(/^www\./, "").replace(/\/+$/, "").replace(/\s+/g, "");

/** A model copying the source can repeat an entry or put a phone number where a link belongs; keep each contact once, links only when they are links. */
export function tidyContactLine(contactLine: CvContent["contactLine"]): CvContent["contactLine"] {
  const seen = new Set<string>();
  const tidy: CvContent["contactLine"] = [];
  for (const item of contactLine) {
    const text = item.text.trim();
    if (!text || seen.has(key(text))) continue;
    seen.add(key(text));
    const url = item.url?.trim();
    tidy.push(url && /^(?:https?:\/\/|mailto:|tel:)/i.test(url) ? { text, url } : { text });
  }
  return tidy.slice(0, 8);
}
