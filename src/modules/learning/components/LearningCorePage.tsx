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
import { EvolutionArchiveView } from "./EvolutionArchiveView";
import { EvaluationsView } from "./EvaluationsView";
import { AdversarialView } from "./AdversarialView";
import { PrinciplesView } from "./PrinciplesView";
import { MemoryHealthView } from "./MemoryHealthView";
import { GuardianView } from "./GuardianView";
import { LearningSettingsView } from "./LearningSettingsView";
import { NotYetBuiltView } from "./NotYetBuiltView";

const TAB_LABELS: Record<string, string> = {
  overview: "Overview",
  curiosity: "Curiosity",
  reflections: "Reflections",
  preferences: "Preferences",
  "knowledge-gaps": "Knowledge Gaps",
  hypotheses: "Candidates",
  "evolution-archive": "Evolution",
  evaluations: "Evaluations",
  experiments: "Experience Replay",
  "shadow-runs": "Shadow Runs",
  adversarial: "Adversarial",
  benchmarks: "Benchmarks",
  principles: "Principles",
  "memory-health": "Memory Health",
  skills: "Skills",
  "improvement-queue": "Improvement Queue",
  trust: "Trust",
  guardian: "Guardian",
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
  // The tab id is still "experiments" (matches ModuleTabs.tsx's stable id),
  // but its label was renamed to "Experience Replay" — it was previously
  // mislabeled "Experiments", which read as a distinct unbuilt feature
  // rather than what this tab actually shows.
  if (activeTab === "experiments") return <ReplayView />;
  if (activeTab === "improvement-queue") return <ImprovementQueueView />;
  if (activeTab === "evolution") return <EvolutionView />;
  if (activeTab === "evolution-archive") return <EvolutionArchiveView />;
  if (activeTab === "evaluations") return <EvaluationsView />;
  if (activeTab === "adversarial") return <AdversarialView />;
  if (activeTab === "principles") return <PrinciplesView />;
  if (activeTab === "memory-health") return <MemoryHealthView />;
  if (activeTab === "guardian") return <GuardianView />;
  if (activeTab === "learning-settings") return <LearningSettingsView />;
  return <NotYetBuiltView label={TAB_LABELS[activeTab] ?? activeTab} />;
}
