import { createMemoryRecord, getMemoryFreshness, rankRelevantMemories } from "@agentic/memory";

describe("memory ranking", () => {
  const fixedNow = Date.parse("2026-04-01T00:00:00.000Z");
  const records = [
    createMemoryRecord({
      userId: "user-primary",
      category: "travel",
      memoryType: "confirmed",
      content: "Leonard prefers aisle seats and keeps passport scans in notes.",
      confidence: 0.98,
      source: "test"
    }),
    createMemoryRecord({
      userId: "user-primary",
      category: "calendar",
      memoryType: "observed",
      content: "Weekly planning usually happens on Monday morning.",
      confidence: 0.7,
      source: "test"
    }),
    createMemoryRecord({
      userId: "user-primary",
      category: "email",
      memoryType: "inferred",
      content: "VIP inbox threads should be answered the same day.",
      confidence: 0.62,
      source: "test"
    })
  ];

  it("prefers overlapping confirmed memories", () => {
    const ranked = rankRelevantMemories("travel passport checklist", records, 2);

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.category).toBe("travel");
  });

  it("stays bounded instead of returning the full set", () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      createMemoryRecord({
        userId: "user-primary",
        category: `category-${index}`,
        memoryType: "observed",
        content: `Synthetic memory ${index}`,
        confidence: 0.5,
        source: "benchmark"
      })
    );

    expect(rankRelevantMemories("synthetic", many, 5)).toHaveLength(5);
  });

  it("filters expired and unauthorized memories before ranking", () => {
    const ranked = rankRelevantMemories(
      "travel passport checklist",
      [
        createMemoryRecord({
          userId: "user-primary",
          category: "travel",
          memoryType: "confirmed",
          content: "Passport scans are stored in notes.",
          confidence: 0.99,
          source: "test",
          permissions: ["knowledge"],
          expiryAt: "2026-04-02T00:00:00.000Z"
        }),
        createMemoryRecord({
          userId: "user-primary",
          category: "travel",
          memoryType: "confirmed",
          content: "Old passport note that should not be reused.",
          confidence: 0.99,
          source: "test",
          permissions: ["orchestrator"],
          expiryAt: "2026-03-31T23:59:59.000Z"
        }),
        createMemoryRecord({
          userId: "user-primary",
          category: "travel",
          memoryType: "observed",
          content: "Travel checklist should include passport scans.",
          confidence: 0.8,
          source: "test",
          permissions: ["orchestrator"],
          expiryAt: "2026-04-02T00:00:00.000Z"
        })
      ],
      5,
      {
        agent: "orchestrator",
        now: fixedNow
      }
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.content).toContain("Travel checklist");
  });

  it("classifies memory freshness explicitly", () => {
    const fresh = createMemoryRecord({
      userId: "user-primary",
      category: "travel",
      memoryType: "confirmed",
      content: "Fresh travel preference.",
      confidence: 0.9,
      source: "test"
    });
    const reviewDue = createMemoryRecord({
      userId: "user-primary",
      category: "travel",
      memoryType: "confirmed",
      content: "Needs review.",
      confidence: 0.92,
      source: "test",
      reviewAt: "2026-03-31T23:59:59.000Z"
    });
    const lowConfidence = createMemoryRecord({
      userId: "user-primary",
      category: "travel",
      memoryType: "inferred",
      content: "Maybe prefers red-eye flights.",
      confidence: 0.45,
      source: "test"
    });
    const expired = createMemoryRecord({
      userId: "user-primary",
      category: "travel",
      memoryType: "confirmed",
      content: "Expired note.",
      confidence: 0.98,
      source: "test",
      expiryAt: "2026-03-31T23:59:59.000Z"
    });

    expect(getMemoryFreshness(fresh, fixedNow)).toBe("fresh");
    expect(getMemoryFreshness(reviewDue, fixedNow)).toBe("review_due");
    expect(getMemoryFreshness(lowConfidence, fixedNow)).toBe("low_confidence");
    expect(getMemoryFreshness(expired, fixedNow)).toBe("expired");
  });

  it("deprioritizes low-confidence memories when fresher evidence exists", () => {
    const ranked = rankRelevantMemories(
      "travel seat preference",
      [
        createMemoryRecord({
          userId: "user-primary",
          category: "travel",
          memoryType: "inferred",
          content: "Seat preference might be aisle.",
          confidence: 0.42,
          source: "test"
        }),
        createMemoryRecord({
          userId: "user-primary",
          category: "travel",
          memoryType: "confirmed",
          content: "Seat preference is aisle.",
          confidence: 0.93,
          source: "test"
        })
      ],
      2,
      {
        now: fixedNow
      }
    );

    expect(ranked[0]?.memoryType).toBe("confirmed");
  });
});
