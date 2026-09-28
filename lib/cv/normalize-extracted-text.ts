const SPACING_DIACRITICS = new Map([
  ["¨", "\u0308"],
  ["´", "\u0301"],
  ["`", "\u0300"],
  ["ˆ", "\u0302"],
  ["˜", "\u0303"],
  ["¸", "\u0327"],
  ["˚", "\u030a"],
]);

const DIACRITIC_PATTERN = /([¨´`ˆ˜¸˚])(\p{L})/gu;
const SPLIT_UPPERCASE_WORD_PATTERN =
  /(^|[^\p{L}])(\p{Lu})[ \u00a0]([¨´`ˆ˜¸˚])(\p{Lu})/gu;

function compose(spacingMark: string, base: string) {
  const combiningMark = SPACING_DIACRITICS.get(spacingMark);
  return combiningMark ? `${base}${combiningMark}` : `${spacingMark}${base}`;
}

export function normalizeExtractedText(value: string) {
  return value
    .replace(
      SPLIT_UPPERCASE_WORD_PATTERN,
      (_match, prefix: string, first: string, spacingMark: string, base: string) =>
        `${prefix}${first}${compose(spacingMark, base)}`,
    )
    .replace(DIACRITIC_PATTERN, (_match, spacingMark: string, base: string) =>
      compose(spacingMark, base),
    )
    .normalize("NFC");
}
