import { db } from "@/lib/db";

export async function requireOwnedBrand(brandId: string, userId: string) {
  const brand = await db.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.ownerId !== userId) return null;
  return brand;
}

export async function requireOwnedProject(projectId: string, userId: string) {
  const project = await db.contentProject.findUnique({
    where: { id: projectId },
    include: { brand: true },
  });
  if (!project || project.brand.ownerId !== userId) return null;
  return project;
}

export async function requireOwnedItem(itemId: string, userId: string) {
  const item = await db.contentItem.findUnique({
    where: { id: itemId },
    include: { brand: true },
  });
  if (!item || item.brand.ownerId !== userId) return null;
  return item;
}

export async function requireOwnedHook(hookId: string, userId: string) {
  const hook = await db.contentHook.findUnique({
    where: { id: hookId },
    include: { contentItem: { include: { brand: true } } },
  });
  if (!hook || hook.contentItem.brand.ownerId !== userId) return null;
  return hook;
}

export async function requireOwnedAsset(assetId: string, userId: string) {
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    include: { brand: true },
  });
  if (!asset || asset.brand.ownerId !== userId) return null;
  return asset;
}

export async function requireOwnedIdea(ideaId: string, userId: string) {
  const idea = await db.idea.findUnique({
    where: { id: ideaId },
    include: { brand: true },
  });
  if (!idea || idea.brand.ownerId !== userId) return null;
  return idea;
}
