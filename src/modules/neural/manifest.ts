import { moduleRegistry } from "@/lib/modules/registry";

moduleRegistry.register({
  id: "neural",
  label: "Neural Space",
  icon: "Orbit",
  href: "/neural",
  description: "3D knowledge galaxy over the org's knowledge graph",
  category: "core",
  order: 45,
});
