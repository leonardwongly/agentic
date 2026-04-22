import { RecommendationEditDistanceSchema, type RecommendationEditDistance } from "@agentic/contracts";

function toCodePoints(value: string): string[] {
  return Array.from(value);
}

export function calculateNormalizedEditDistance(params: {
  baseline: string;
  submitted: string;
}): RecommendationEditDistance {
  const baseline = params.baseline.trim();
  const submitted = params.submitted.trim();

  if (!baseline || !submitted) {
    throw new Error("Both baseline and submitted values must be non-empty strings.");
  }

  if (baseline === submitted) {
    return RecommendationEditDistanceSchema.parse({
      baselineLength: toCodePoints(baseline).length,
      submittedLength: toCodePoints(submitted).length,
      editDistance: 0,
      normalizedEditDistance: 0
    });
  }

  const baselinePoints = toCodePoints(baseline);
  const submittedPoints = toCodePoints(submitted);
  const shorter = baselinePoints.length <= submittedPoints.length ? baselinePoints : submittedPoints;
  const longer = baselinePoints.length <= submittedPoints.length ? submittedPoints : baselinePoints;
  let previousRow = Array.from({ length: shorter.length + 1 }, (_, index) => index);

  for (let longerIndex = 1; longerIndex <= longer.length; longerIndex += 1) {
    const currentRow = [longerIndex];

    for (let shorterIndex = 1; shorterIndex <= shorter.length; shorterIndex += 1) {
      const substitutionCost = longer[longerIndex - 1] === shorter[shorterIndex - 1] ? 0 : 1;
      currentRow[shorterIndex] = Math.min(
        currentRow[shorterIndex - 1]! + 1,
        previousRow[shorterIndex]! + 1,
        previousRow[shorterIndex - 1]! + substitutionCost
      );
    }

    previousRow = currentRow;
  }

  const editDistance = previousRow[shorter.length] ?? 0;
  const normalizationLength = Math.max(baselinePoints.length, submittedPoints.length, 1);

  return RecommendationEditDistanceSchema.parse({
    baselineLength: baselinePoints.length,
    submittedLength: submittedPoints.length,
    editDistance,
    normalizedEditDistance: editDistance / normalizationLength
  });
}
