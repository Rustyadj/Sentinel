import { LearningCorePage } from "@/modules/learning-core";

export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section } = await params;
  return <LearningCorePage section={section?.[0]} />;
}
