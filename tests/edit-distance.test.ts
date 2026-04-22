import { calculateNormalizedEditDistance } from "../packages/observability/src/edit-distance";

describe("recommendation edit distance", () => {
  it("returns zero when trimmed recommendation text is unchanged", () => {
    expect(
      calculateNormalizedEditDistance({
        baseline: "  Keep the reviewer handoff summary.  ",
        submitted: "Keep the reviewer handoff summary."
      })
    ).toEqual({
      baselineLength: 34,
      submittedLength: 34,
      editDistance: 0,
      normalizedEditDistance: 0
    });
  });

  it("handles Unicode code points without splitting surrogate pairs", () => {
    const result = calculateNormalizedEditDistance({
      baseline: "Ship ✅ soon",
      submitted: "Ship soon"
    });

    expect(result).toEqual({
      baselineLength: 11,
      submittedLength: 9,
      editDistance: 2,
      normalizedEditDistance: 2 / 11
    });
  });

  it("fails closed when either side of the comparison is empty after trimming", () => {
    expect(() =>
      calculateNormalizedEditDistance({
        baseline: "   ",
        submitted: "Keep reviewer sign-off."
      })
    ).toThrow("Both baseline and submitted values must be non-empty strings.");

    expect(() =>
      calculateNormalizedEditDistance({
        baseline: "Keep reviewer sign-off.",
        submitted: "\n\t  "
      })
    ).toThrow("Both baseline and submitted values must be non-empty strings.");
  });
});
