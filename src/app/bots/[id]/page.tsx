import { BotDetail } from "@/modules/bots/components/BotDetail";

export const metadata = { title: "Bot · Sentinel OS" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <BotDetail botId={id} initialTab={tab} />;
}
