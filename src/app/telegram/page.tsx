import { requireUser } from "@/lib/current-user";
import { TelegramPanel } from "@/modules/telegram/TelegramPanel";
export const metadata = { title: "Telegram · Sentinel OS" };
export default async function Page() { await requireUser(); return <TelegramPanel />; }
