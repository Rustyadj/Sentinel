import { requireUser } from "@/lib/current-user";
import { PhonePanel } from "@/modules/phone/components/PhonePanel";

export const metadata = {
  title: "Phone · Sentinel OS",
};

export default async function PhonePage() {
  await requireUser();
  return <PhonePanel />;
}
