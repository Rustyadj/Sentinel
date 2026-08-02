import { moduleRegistry } from "@/lib/modules/registry";

moduleRegistry.register({
  id: "learning",
  label: "Learning Core",
  icon: "Sparkles",
  href: "/learning",
  description: "Observation, evaluation, experimentation, and governance layer over the Neural Engine.",
  category: "core",
  order: 85,
});
