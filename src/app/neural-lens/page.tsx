import { redirect } from "next/navigation";

export const metadata = {
  title: "Neural Lens · Sentinel OS",
};

export default function NeuralLensPage() {
  redirect("/chat?space=graph");
}
