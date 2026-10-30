import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_IMAGE, isSafeImageReference, resolveHomePath, resolveWorkspaceImage,
} from "@/lib/agent-workspaces/policy";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

describe("workspace image allowlist", () => {
  it("defaults to the configured image", () => {
    delete process.env.AGENT_WORKSPACE_IMAGE;
    expect(resolveWorkspaceImage()).toBe(DEFAULT_WORKSPACE_IMAGE);
    process.env.AGENT_WORKSPACE_IMAGE = "registry.local/ws:1";
    expect(resolveWorkspaceImage("")).toBe("registry.local/ws:1");
  });

  it("refuses images that are not allowlisted", () => {
    delete process.env.AGENT_WORKSPACE_ALLOWED_IMAGES;
    expect(() => resolveWorkspaceImage("attacker/miner:latest")).toThrow(/allowlist/);
    process.env.AGENT_WORKSPACE_ALLOWED_IMAGES = "attacker/miner:latest, other/img:2";
    expect(resolveWorkspaceImage("attacker/miner:latest")).toBe("attacker/miner:latest");
  });

  it("never lets an image be parsed as a docker flag", () => {
    process.env.AGENT_WORKSPACE_ALLOWED_IMAGES = "--privileged";
    for (const image of ["--privileged", "-v=/:/host", "img name", "img\nx"]) {
      expect(isSafeImageReference(image), image).toBe(false);
    }
    expect(() => resolveWorkspaceImage("--privileged")).toThrow();
    expect(isSafeImageReference("ghcr.io/org/img@sha256:abc123")).toBe(true);
  });
});

describe("workspace homePath", () => {
  it("normalizes valid absolute paths", () => {
    expect(resolveHomePath()).toBe("/workspace");
    expect(resolveHomePath("/home/agent/")).toBe("/home/agent");
    expect(resolveHomePath("/a/b/../c")).toBe("/a/c");
  });

  it("rejects relative, root, and volume-spec-altering paths", () => {
    for (const path of ["workspace", "/", "/x:/host", "/x,readonly", "/../"]) {
      expect(() => resolveHomePath(path), path).toThrow();
    }
  });
});
