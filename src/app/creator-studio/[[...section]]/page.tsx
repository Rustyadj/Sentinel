import { CreatorStudioPage } from "@/modules/creator-studio";

export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section } = await params;
  return <CreatorStudioPage section={section?.[0]} />;
}
