"use client";

import { LearningCoreShell } from "./LearningCoreShell";
import { OverviewView } from "./OverviewView";
import { CuriosityView } from "./CuriosityView";
import { KnowledgeGapsView } from "./KnowledgeGapsView";
import { ReflectionView } from "./ReflectionView";
import { ReplayView } from "./ReplayView";
import { MetricsView } from "./MetricsView";
import { HypothesesView } from "./HypothesesView";
import { ExperimentsView } from "./ExperimentsView";
import { BenchmarksView } from "./BenchmarksView";
import { SkillsView } from "./SkillsView";
import { ImprovementQueueView } from "./ImprovementQueueView";
import { TrustView } from "./TrustView";
import { FeatureFlagsView } from "./FeatureFlagsView";
import { EvolutionView } from "./EvolutionView";
import { ComingSoonView } from "./ComingSoonView";
import { LEARNING_CORE_SECTIONS } from "../types";

export function LearningCorePage({ section = "overview" }: { section?: string }) {
  const active = LEARNING_CORE_SECTIONS.find((s) => s.id === section);
  const knownSection = active ? section : "overview";

  return (
    <LearningCoreShell sections={LEARNING_CORE_SECTIONS} activeSection={knownSection}>
      {knownSection === "overview" && <OverviewView />}
      {knownSection === "curiosity" && <CuriosityView />}
      {knownSection === "knowledge-gaps" && <KnowledgeGapsView />}
      {knownSection === "reflection" && <ReflectionView />}
      {knownSection === "replay" && <ReplayView />}
      {knownSection === "hypotheses" && <HypothesesView />}
      {knownSection === "experiments" && <ExperimentsView />}
      {knownSection === "benchmarks" && <BenchmarksView />}
      {knownSection === "skills" && <SkillsView />}
      {knownSection === "improvement-queue" && <ImprovementQueueView />}
      {knownSection === "trust" && <TrustView />}
      {knownSection === "feature-flags" && <FeatureFlagsView />}
      {knownSection === "evolution" && <EvolutionView />}
      {knownSection === "metrics" && <MetricsView />}
      {![
        "overview",
        "curiosity",
        "knowledge-gaps",
        "reflection",
        "replay",
        "hypotheses",
        "experiments",
        "benchmarks",
        "skills",
        "improvement-queue",
        "trust",
        "feature-flags",
        "evolution",
        "metrics",
      ].includes(knownSection) && (
        <ComingSoonView
          label={active?.label ?? knownSection}
          owner={active?.owner ?? "shared"}
        />
      )}
    </LearningCoreShell>
  );
}
