import { Suspense } from "react";
import { RoundtableSurface } from "@/components/people/RoundtableSurface";

export default function RoundtablePage() {
  return (
    <Suspense fallback={null}>
      <RoundtableSurface />
    </Suspense>
  );
}
