import { parseIntent } from "../apps/web/components/ui/nl-intent";

describe("parseIntent", () => {
  it("preserves the original case for create-goal requests", () => {
    expect(parseIntent("Create goal to Draft Q2 OKR Review")).toEqual({
      type: "command",
      action: "create-goal",
      params: {
        request: "Draft Q2 OKR Review"
      }
    });
  });

  it("only treats approve all R2 as a server-backed NL approval command", () => {
    expect(parseIntent("approve all R2")).toEqual({
      type: "command",
      action: "approve",
      params: {
        riskClass: "R2",
        all: true
      },
      requiresConfirm: true
    });

    expect(parseIntent("approve all")).toEqual({
      type: "clarify",
      question: "The NL bar only supports the bounded batch command 'approve all R2' right now.",
      options: ["approve all R2", "show approvals"]
    });
  });

  it("routes reject phrasing into a clarification path instead of implying full support", () => {
    expect(parseIntent("reject this approval")).toEqual({
      type: "clarify",
      question: "Reject decisions stay in the approvals queue until the NL rejection flow is explicitly hardened.",
      options: ["show approvals"]
    });
  });
});
