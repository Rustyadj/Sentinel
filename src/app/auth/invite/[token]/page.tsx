import { InviteAccept } from "./InviteAccept";

export const metadata = { title: "You're invited · Sentinel" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteAccept token={token} />;
}
