import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ControlPlaneData } from "@/lib/control-plane/service";
import type { Drift, RevisionPosition, Stage, StageId } from "@/lib/control-plane/types";
import { ControlPlane } from "./ControlPlane";
import { buildRailModel } from "./rail-model";

const HEAD = { sha: "a".repeat(40), shortSha: "aaaaaaa", subject: "add the rail", author: "Test", committedAt: "2026-09-20T12:00:00Z" };

function stage(id: StageId, overrides: Partial<Stage> = {}): Stage {
  return { id, state: "reached", sha: null, detail: `${id} detail`, evidence: [], ...overrides };
}

function position(overrides: Partial<RevisionPosition> = {}, drift: Partial<Drift> = {}): RevisionPosition {
  return {
    repositoryId: "repo-1",
    name: "Sentinel OS",
    path: "/opt/sentinel-os",
    branch: "main",
    head: HEAD,
    environment: "production",
    observedAt: new Date().toISOString(),
    position: "verified",
    stages: [
      stage("working", { state: "not_reached", detail: "No uncommitted changes." }),
      stage("committed"),
      stage("pushed"),
      stage("pr", { state: "not_connected", detail: "No forge integration is configured.", missingIntegration: "GitHub API" }),
      stage("merged"),
      stage("built"),
      stage("deployed"),
      stage("verified"),
    ],
    drift: {
      status: "match",
      deployedSha: HEAD.sha,
      defaultBranchSha: HEAD.sha,
      defaultBranch: "main",
      commitsBehind: 0,
      defaultBranchAsOf: new Date().toISOString(),
      stale: false,
      detail: "Production is running main.",
      ...drift,
    },
    ...overrides,
  };
}

function data(overrides: Partial<ControlPlaneData> = {}): ControlPlaneData {
  return { positions: [position()], problems: [], generatedAt: new Date().toISOString(), ...overrides };
}

describe("buildRailModel", () => {
  it("severs the line at a diverged stage and leaves everything after it unconnected", () => {
    const rail = buildRailModel(
      position({
        position: "committed",
        stages: [
          stage("working", { state: "reached" }),
          stage("committed"),
          stage("pushed", { state: "not_reached" }),
          stage("pr", { state: "not_connected" }),
          stage("merged", { state: "not_reached" }),
          stage("built", { state: "diverged" }),
          stage("deployed", { state: "diverged" }),
          stage("verified", { state: "reached" }),
        ],
      }),
    );

    expect(rail.markerIndex).toBe(1);
    expect(rail.divergedIndex).toBe(5);
    // The carried line stops at the first stage this revision has not reached.
    expect(rail.stops.map((stop) => stop.connector)).toEqual([
      "carried", "carried", "pending", "unknown", "pending", "severed", "severed", "pending",
    ]);
  });
});

describe("ControlPlane", () => {
  it("states drift in words rather than leaving it to a colour", () => {
    render(
      <ControlPlane
        data={data({
          positions: [position({}, { status: "behind", commitsBehind: 4, detail: "Production is 4 commits behind main." })],
        })}
      />,
    );

    expect(screen.getByText("Production is 4 commits behind main.")).toBeInTheDocument();
    // And it is counted in the instrumentation strip.
    const drifted = screen.getByText("Drifted").closest("div")!;
    expect(within(drifted).getByText("1")).toBeInTheDocument();
  });

  it("shows a stage's evidence, in place, when it is selected", async () => {
    const user = userEvent.setup();
    render(
      <ControlPlane
        data={data({
          positions: [
            position({
              stages: [
                stage("working", { state: "not_reached" }),
                stage("committed", {
                  detail: "aaaaaaa — add the rail",
                  evidence: [{ label: "Commit", value: HEAD.sha, source: "git log", observedAt: null }],
                }),
                stage("pushed"), stage("pr"), stage("merged"), stage("built"), stage("deployed"), stage("verified"),
              ],
            }),
          ],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Commit: aaaaaaa — add the rail/ }));

    expect(screen.getByText(HEAD.sha)).toBeInTheDocument();
    expect(screen.getByText("git log")).toBeInTheDocument();
  });

  it("names the missing integration instead of implying the stage failed", async () => {
    const user = userEvent.setup();
    render(<ControlPlane data={data()} />);

    await user.click(screen.getByRole("button", { name: /PR: No forge integration is configured/ }));

    expect(screen.getByText(/Connect/)).toHaveTextContent("GitHub API");
    expect(screen.getByText("not connected")).toBeInTheDocument();
  });

  it("surfaces a registered repository that could not be read, rather than dropping it", () => {
    render(
      <ControlPlane
        data={data({
          positions: [],
          problems: [{ repositoryId: "repo-2", name: "Plumbline", path: "/root/Plumbline", reason: "Not a git work tree." }],
        })}
      />,
    );

    expect(screen.getByText("Registered but not observable")).toBeInTheDocument();
    expect(screen.getByText("Plumbline")).toBeInTheDocument();
  });

  it("says a checkout has never fetched instead of presenting its comparison as current", () => {
    render(
      <ControlPlane
        data={data({ positions: [position({}, { stale: true, defaultBranchAsOf: null })] })}
      />,
    );

    expect(screen.getByText(/refs never fetched/)).toBeInTheDocument();
  });

  it("explains the empty state instead of showing an empty page", () => {
    render(<ControlPlane data={data({ positions: [] })} />);

    expect(screen.getByText("No repositories are registered yet.")).toBeInTheDocument();
    expect(screen.getByText(/does not scan the filesystem on its own/)).toBeInTheDocument();
  });

  it("labels every stage for a screen reader with its state, not just its name", () => {
    render(<ControlPlane data={data()} />);

    expect(screen.getByRole("group", { name: /Release position for Sentinel OS: verified/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(8);
  });
});
