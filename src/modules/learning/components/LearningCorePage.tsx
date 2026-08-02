"use client";

import { useEffect, useState } from "react";
import { OverviewView } from "./OverviewView";
import { CuriosityView } from "./CuriosityView";
import { ReflectionsView } from "./ReflectionsView";
import { NotYetBuiltView } from "./NotYetBuiltView";

const TAB_LABELS: Record<string, string> = {
  overview: "Overview",
  curiosity: "Curiosity",
  reflections: "Reflections",
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
  return <NotYetBuiltView label={TAB_LABELS[activeTab] ?? activeTab} />;
}
