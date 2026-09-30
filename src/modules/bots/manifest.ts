import { moduleRegistry } from "@/lib/modules/registry";

moduleRegistry.register({
  id: "bots",
  label: "Bots",
  icon: "Boxes",
  href: "/bots",
  description: "Specialised Hermes bots other agents can delegate to",
  category: "core",
  order: 32,
});
