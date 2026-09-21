import { requireUser } from "@/lib/current-user";
import { loadControlPlane } from "@/lib/control-plane/service";
import { ControlPlane } from "@/modules/control-plane/components/ControlPlane";

export const metadata = {
  title: "Control plane · Sentinel OS",
};

// Observed on every request. A cached rail would be shown with the freshness of
// the request that built it, which is the one thing this page must never do.
export const dynamic = "force-dynamic";

export default async function ControlPlanePage() {
  await requireUser();
  const data = await loadControlPlane();

  return <ControlPlane data={data} />;
}
