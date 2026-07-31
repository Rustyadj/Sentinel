"use client";

import { useEffect, useState } from "react";
import { useCreatorStudioStore } from "@/store/useCreatorStudioStore";
import { CreatorStudioShell } from "./CreatorStudioShell";
import { DashboardView } from "./DashboardView";
import { BrandsView } from "./BrandsView";
import { ProjectsView } from "./ProjectsView";
import { CalendarView } from "./CalendarView";
import { YouTubeView } from "./YouTubeView";
import { AssetLibraryView } from "./AssetLibraryView";
import { BrandKitView } from "./BrandKitView";
import { SocialView } from "./SocialView";
import { BlogView } from "./BlogView";
import { PodcastView } from "./PodcastView";
import { PublishingView } from "./PublishingView";
import { ShortsView } from "./ShortsView";
import { ThumbnailStudioView } from "./ThumbnailStudioView";
import { ComingSoonView } from "./ComingSoonView";
import { CREATOR_STUDIO_SECTIONS, type Brand } from "../types";

export function CreatorStudioPage({ section = "dashboard" }: { section?: string }) {
  const { activeBrandId, setActiveBrandId } = useCreatorStudioStore();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/creator-studio/brands")
      .then((r) => r.json())
      .then((data: Brand[]) => setBrands(data))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (activeBrandId && brands.some((b) => b.id === activeBrandId)) return;
    setActiveBrandId(brands[0]?.id ?? null);
  }, [loaded, brands, activeBrandId, setActiveBrandId]);

  async function createBrand(name: string) {
    const res = await fetch("/api/creator-studio/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      alert(err.error ?? "Failed to create brand");
      return;
    }
    const brand = (await res.json()) as Brand;
    setBrands((prev) => [...prev, brand]);
    setActiveBrandId(brand.id);
  }

  async function deleteBrand(id: string) {
    await fetch(`/api/creator-studio/brands/${id}`, { method: "DELETE" });
    setBrands((prev) => prev.filter((b) => b.id !== id));
    if (activeBrandId === id) {
      const remaining = brands.filter((b) => b.id !== id);
      setActiveBrandId(remaining[0]?.id ?? null);
    }
  }

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;
  const knownSection = CREATOR_STUDIO_SECTIONS.some((s) => s.id === section) ? section : "dashboard";

  return (
    <CreatorStudioShell
      sections={CREATOR_STUDIO_SECTIONS}
      activeSection={knownSection}
      brands={brands}
      activeBrandId={activeBrandId}
      onSelectBrand={setActiveBrandId}
      onCreateBrand={() => createBrand(`Brand ${brands.length + 1}`)}
    >
      {knownSection === "dashboard" && <DashboardView activeBrand={activeBrand} />}
      {knownSection === "brands" && (
        <BrandsView
          brands={brands}
          activeBrandId={activeBrandId}
          onSelectBrand={setActiveBrandId}
          onCreateBrand={createBrand}
          onDeleteBrand={deleteBrand}
        />
      )}
      {knownSection === "projects" && <ProjectsView activeBrand={activeBrand} />}
      {knownSection === "calendar" && <CalendarView activeBrand={activeBrand} />}
      {knownSection === "youtube" && <YouTubeView activeBrand={activeBrand} />}
      {knownSection === "assets" && <AssetLibraryView activeBrand={activeBrand} />}
      {knownSection === "brand-kit" && (
        <BrandKitView
          activeBrand={activeBrand}
          onBrandUpdated={(updated) =>
            setBrands((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
          }
        />
      )}
      {knownSection === "social" && <SocialView activeBrand={activeBrand} />}
      {knownSection === "blog" && <BlogView activeBrand={activeBrand} />}
      {knownSection === "podcast" && <PodcastView activeBrand={activeBrand} />}
      {knownSection === "publishing" && <PublishingView activeBrand={activeBrand} />}
      {knownSection === "shorts" && <ShortsView activeBrand={activeBrand} />}
      {knownSection === "thumbnails" && <ThumbnailStudioView activeBrand={activeBrand} />}
      {![
        "dashboard", "brands", "projects", "calendar", "youtube", "assets", "brand-kit",
        "social", "blog", "podcast", "publishing", "shorts", "thumbnails",
      ].includes(knownSection) && (
        <ComingSoonView
          label={CREATOR_STUDIO_SECTIONS.find((s) => s.id === knownSection)?.label ?? knownSection}
        />
      )}
    </CreatorStudioShell>
  );
}
