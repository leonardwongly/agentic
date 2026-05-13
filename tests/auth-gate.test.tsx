import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthGate } from "../apps/web/components/auth-gate";

describe("AuthGate", () => {
  it("renders a semantic access-key form with the local fallback guidance in development", () => {
    const markup = renderToStaticMarkup(
      <AuthGate
        authMode={{
          requiresConfiguredKey: false,
          usesDevelopmentFallback: true
        }}
      />
    );

    expect(markup).toContain("<form");
    expect(markup).toContain("type=\"submit\"");
    expect(markup).toContain("autoComplete=\"one-time-code\"");
    expect(markup).toContain("agentic-local-dev-key");
  });

  it("keeps the unlock action disabled when a configured key is required", () => {
    const markup = renderToStaticMarkup(
      <AuthGate
        authMode={{
          requiresConfiguredKey: true,
          usesDevelopmentFallback: false
        }}
      />
    );

    expect(markup).toContain("Set `AGENTIC_ACCESS_KEY`");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).not.toContain("agentic-local-dev-key");
  });
});
