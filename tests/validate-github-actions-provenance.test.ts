import {
  collectWorkflowActionUses,
  validateWorkflowActionPins,
  type WorkflowActionUse
} from "../scripts/validate-github-actions-provenance";

describe("GitHub Actions provenance pin validation", () => {
  it("accepts external actions pinned to full commit SHAs", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
      - uses: "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e"
`
    );

    expect(validateWorkflowActionPins(uses)).toEqual([]);
  });

  it("rejects mutable tag references and unpinned external actions", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node
`
    );

    expect(validateWorkflowActionPins(uses)).toEqual([
      expect.objectContaining({
        line: 5,
        value: "actions/checkout@v6",
        reason: "External GitHub Action reference must be pinned to a 40-character lowercase commit SHA."
      }),
      expect.objectContaining({
        line: 6,
        value: "actions/setup-node",
        reason: "External GitHub Action reference must include an immutable commit SHA."
      })
    ]);
  });

  it("allows local and docker action references", () => {
    const uses: WorkflowActionUse[] = [
      {
        filePath: ".github/workflows/ci.yml",
        line: 10,
        value: "./.github/actions/local",
        ref: null
      },
      {
        filePath: ".github/workflows/ci.yml",
        line: 11,
        value: "docker://alpine:3.20",
        ref: null
      }
    ];

    expect(validateWorkflowActionPins(uses)).toEqual([]);
  });
});
