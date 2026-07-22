import { AppShell } from "@/components/layout/AppShell";
import { NeuralLens } from "@/components/neural-lens/NeuralLens";

export const metadata = {
  title: "Neural Lens · Sentinel OS",
};

export default function NeuralLensPage() {
  return (
    <AppShell>
      <NeuralLens />
    </AppShell>
  );
}
