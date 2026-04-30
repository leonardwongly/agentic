import { readFileSync } from "node:fs";
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

  it("resolves YAML anchors and aliases before validating action pins", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - uses: &checkout actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
      - uses: *checkout
      - { name: Setup, uses: &setup-node actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e }
      - { name: Reuse setup, uses: *setup-node }
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        line: 5,
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      }),
      expect.objectContaining({
        line: 6,
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      }),
      expect.objectContaining({
        line: 7,
        value: "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e"
      }),
      expect.objectContaining({
        line: 8,
        value: "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e"
      })
    ]);
    expect(validateWorkflowActionPins(uses)).toEqual([]);
  });

  it("resolves action aliases from anchors declared on non-uses keys", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
env:
  CHECKOUT_ACTION: &checkout actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
jobs:
  validate:
    steps:
      - uses: *checkout
      - { name: Setup, action: &setup-node actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e }
      - { uses: *setup-node }
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        line: 7,
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      }),
      expect.objectContaining({
        line: 9,
        value: "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e"
      })
    ]);
    expect(validateWorkflowActionPins(uses)).toEqual([]);
  });

  it("rejects mutable tag references and unpinned external actions", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - 'uses' : actions/checkout@v6
      - "uses": actions/setup-node
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

  it("rejects mutable refs in flow-style uses mappings", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - { uses: actions/checkout@v6, with: { fetch-depth: 0 } }
      - { "uses": "actions/setup-node@v6" }
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
        value: "actions/setup-node@v6",
        reason: "External GitHub Action reference must be pinned to a 40-character lowercase commit SHA."
      })
    ]);
  });

  it("detects flow-style uses mappings even when uses is not the first key", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - { name: Checkout, uses: actions/checkout@v6, with: { fetch-depth: 0 } }
      - { name: Setup, "uses": "actions/setup-node@v6" }
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
        value: "actions/setup-node@v6",
        reason: "External GitHub Action reference must be pinned to a 40-character lowercase commit SHA."
      })
    ]);
  });

  it("ignores quoted uses text in flow-style mappings", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - { name: "lint, uses: docs", run: echo ok }
      - { name: Checkout, uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd }
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        line: 6,
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      })
    ]);
  });

  it("strips flow-mapping separators from uses values before pin validation", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd,
        with: { fetch-depth: 0 }
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        ref: "de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      })
    ]);
    expect(validateWorkflowActionPins(uses)).toEqual([]);
  });

  it("detects uses entries in inline flow sequence steps", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps: [{ name: Checkout, uses: actions/checkout@v6 }, { uses: actions/setup-node@v6 }]
`
    );

    expect(validateWorkflowActionPins(uses)).toEqual([
      expect.objectContaining({
        line: 4,
        value: "actions/checkout@v6"
      }),
      expect.objectContaining({
        line: 4,
        value: "actions/setup-node@v6"
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

  it("does not treat uses text inside run block scalars as action references", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - run: |
          echo "uses: actions/checkout@v6"
          # uses: actions/setup-node@v5
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        line: 8,
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      })
    ]);
  });

  it("does not treat uses text inside nested block scalar inputs as action references", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - uses: actions/github-script@6b7254ff8b482b4d753a1e2f286705a42a696a5a
        with:
          script: >-
            core.info("uses: actions/checkout@v6")
            return "uses: actions/setup-node@v5"
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        line: 5,
        value: "actions/github-script@6b7254ff8b482b4d753a1e2f286705a42a696a5a"
      }),
      expect.objectContaining({
        line: 10,
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      })
    ]);
  });

  it("does not treat uses text inside block scalars with indentation indicators as action references", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - run: |2
          echo "uses: actions/checkout@v6"
      - uses: actions/github-script@6b7254ff8b482b4d753a1e2f286705a42a696a5a
        with:
          script: >-2
            core.info("uses: actions/setup-node@v5")
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        line: 7,
        value: "actions/github-script@6b7254ff8b482b4d753a1e2f286705a42a696a5a"
      }),
      expect.objectContaining({
        line: 11,
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      })
    ]);
  });

  it("does not treat uses text inside chomping-only block scalars as action references", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - run: |-
          echo "uses: actions/checkout@v6"
      - name: summary
        run: >+
          echo "uses: actions/setup-node@v5"
      - uses : actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        line: 10,
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      })
    ]);
  });

  it("strips inline YAML comments without truncating quoted scalars", () => {
    const uses = collectWorkflowActionUses(
      ".github/workflows/ci.yml",
      `
jobs:
  validate:
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
      - uses: "example/action@0123456789012345678901234567890123456789#quoted"
`
    );

    expect(uses).toEqual([
      expect.objectContaining({
        value: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"
      }),
      expect.objectContaining({
        value: "example/action@0123456789012345678901234567890123456789#quoted"
      })
    ]);
  });

  it("runs CI provenance validation in a gate before mutable validation steps", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const gateIndex = workflow.indexOf("  provenance-gate:");
    const validateIndex = workflow.indexOf("  validate:");
    const gateBlock = workflow.slice(gateIndex, validateIndex);

    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(validateIndex).toBeGreaterThan(gateIndex);
    expect(workflow).toMatch(/validate:\n\s+needs:\s+provenance-gate/u);
    expect(gateBlock).toContain("Validate GitHub Actions provenance pins");
    expect(gateBlock).toContain("actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6");
    expect(gateBlock).toContain("actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6");
  });
});
