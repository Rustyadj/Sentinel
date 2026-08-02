"use client";

import { useEffect, useState } from "react";
import { OverviewView } from "./OverviewView";
import { CuriosityView } from "./CuriosityView";
import { ReflectionsView } from "./ReflectionsView";
import { PreferencesView } from "./PreferencesView";
import { KnowledgeGapsView } from "./KnowledgeGapsView";
import { HypothesesView } from "./HypothesesView";
import { BenchmarksView } from "./BenchmarksView";
import { ShadowRunsView } from "./ShadowRunsView";
import { TrustView } from "./TrustView";
import { FeatureFlagsView } from "./FeatureFlagsView";
import { SkillsView } from "./SkillsView";
import { ReplayView } from "./ReplayView";
import { ImprovementQueueView } from "./ImprovementQueueView";
import { EvolutionView } from "./EvolutionView";
import { NotYetBuiltView } from "./NotYetBuiltView";

const TAB_LABELS: Record<string, string> = {
  overview: "Overview",
  curiosity: "Curiosity",
  reflections: "Reflections",
  preferences: "Preferences",
  "knowledge-gaps": "Knowledge Gaps",
  hypotheses: "Hypotheses",
  experiments: "Experiments",
  "shadow-runs": "Shadow Runs",
  benchmarks: "Benchmarks",
  skills: "Skills",
  "improvement-queue": "Improvement Queue",
  trust: "Trust",
  "feature-flags": "Feature Flags",
  evolution: "Evolution Timeline",
  "learning-settings": "Settings",
};

export default function LearningCorePage() {
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    const onModuleTab = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId: string; tabId: string }>).detail;
      if (detail?.moduleId !== "learning") return;
      setActiveTab(detail.tabId);
    };
    window.addEventListener("sentinel:module-tab", onModuleTab);
    return () => window.removeEventListener("sentinel:module-tab", onModuleTab);
  }, []);

  if (activeTab === "overview") return <OverviewView />;
  if (activeTab === "curiosity") return <CuriosityView />;
  if (activeTab === "reflections") return <ReflectionsView />;
  if (activeTab === "preferences") return <PreferencesView />;
  if (activeTab === "knowledge-gaps") return <KnowledgeGapsView />;
  if (activeTab === "hypotheses") return <HypothesesView />;
  if (activeTab === "benchmarks") return <BenchmarksView />;
  if (activeTab === "shadow-runs") return <ShadowRunsView />;
  if (activeTab === "trust") return <TrustView />;
  if (activeTab === "feature-flags") return <FeatureFlagsView />;
  if (activeTab === "skills") return <SkillsView />;
  // Experience Replay's natural tab slot per the original spec doesn't have
  // its own entry in ModuleTabs — "Experiments" was still unbuilt and is
  // the closest semantic fit (replay batches feed the same candidate
  // pipeline experiments do), so it's mapped here rather than adding yet
  // another shared ModuleTabs entry for one view.
  if (activeTab === "experiments") return <ReplayView />;
  if (activeTab === "improvement-queue") return <ImprovementQueueView />;
  if (activeTab === "evolution") return <EvolutionView />;
  // "learning-settings" (budgets/thresholds/model allowlist) has no real
  // backing service anywhere in this branch — left honestly unbuilt rather
  // than faked. See the final release report's known-limitations section.
  return <NotYetBuiltView label={TAB_LABELS[activeTab] ?? activeTab} />;
}
