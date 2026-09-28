/** Cosine similarity of two vectors of the same length; 0 when either is empty or lengths differ. */
export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator ? dot / denominator : 0;
}

/** How much a profile's target role weighs against the CV when ranking jobs. */
export const TARGET_ROLE_WEIGHT = 0.6;

/**
 * A job's ranking similarity: to the CV alone, or, when the profile targets a role, mostly to that role so jobs
 * in the role family are scored first instead of whatever the CV's history resembles most.
 */
export function rankingSimilarity(job: number[], cv: number[], target?: number[] | null) {
  const toCv = cosineSimilarity(job, cv);
  if (!target || target.length !== job.length) return toCv;
  return TARGET_ROLE_WEIGHT * cosineSimilarity(job, target) + (1 - TARGET_ROLE_WEIGHT) * toCv;
}
