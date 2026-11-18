import { describe, expect, it } from "vitest";
import { resolveAgentLink, stricterLinkRule, type LinkParty } from "./agent-links";

describe("agent links across owners", () => {
  const mine = (rule?: string | null, canMessageOtherOwners = true): LinkParty => ({ ownerUserId: "rusty", canMessageOtherOwners, rule });
  const theirs = (rule?: string | null, canMessageOtherOwners = true): LinkParty => ({ ownerUserId: "dana", canMessageOtherOwners, rule });

  it("always lets one owner's agents talk to each other", () => {
    expect(resolveAgentLink(mine("BLOCK", false), mine("BLOCK", false))).toEqual({ rule: "ALLOW", reason: "same-owner" });
  });

  it("applies the stricter side, whichever owner set it", () => {
    expect(stricterLinkRule("ALLOW", "ASK")).toBe("ASK");
    expect(stricterLinkRule("BLOCK", "ALLOW")).toBe("BLOCK");
    expect(resolveAgentLink(mine("ALLOW"), theirs("ALLOW"))).toEqual({ rule: "ALLOW", reason: "both-allow" });
    expect(resolveAgentLink(mine("ALLOW"), theirs("BLOCK"))).toEqual({ rule: "BLOCK", reason: "owner-blocked" });
  });

  it("gives the same answer in both directions", () => {
    for (const a of ["ALLOW", "ASK", "BLOCK", null]) {
      for (const b of ["ALLOW", "ASK", "BLOCK", null]) {
        expect(resolveAgentLink(mine(a), theirs(b)).rule).toBe(resolveAgentLink(theirs(b), mine(a)).rule);
      }
    }
  });

  it("asks a person when either side has not set a rule", () => {
    expect(resolveAgentLink(mine("ALLOW"), theirs(null))).toEqual({ rule: "ASK", reason: "needs-person" });
    expect(resolveAgentLink(mine(undefined), theirs(undefined)).rule).toBe("ASK");
  });

  it("treats an unrecognised stored value as ASK, never as ALLOW", () => {
    expect(resolveAgentLink(mine("ALLOW"), theirs("allow")).rule).toBe("ASK");
  });

  it("blocks when either agent is not permitted to message other owners' agents", () => {
    expect(resolveAgentLink(mine("ALLOW", false), theirs("ALLOW"))).toEqual({ rule: "BLOCK", reason: "agent-not-permitted" });
    expect(resolveAgentLink(mine("ALLOW"), theirs("ALLOW", false))).toEqual({ rule: "BLOCK", reason: "agent-not-permitted" });
  });
});
