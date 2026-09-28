import "server-only";

const DEFAULT_MAX_CV_BYTES = 10_485_760;

export function maxCvBytes() {
  const configuredMax = Number(process.env.CV_MAX_BYTES);

  return Number.isSafeInteger(configuredMax) && configuredMax > 0
    ? configuredMax
    : DEFAULT_MAX_CV_BYTES;
}
