"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Check, Save, Palette } from "lucide-react";
import {
  ASSET_CATEGORY_LABELS,
  BRAND_KIT_CATEGORIES,
  type Asset,
  type Brand,
} from "../types";

function ProfileForm({ brand, onSaved }: { brand: Brand; onSaved: (brand: Brand) => void }) {
  const p = brand.profile;
  const typography = (p?.typography ?? {}) as { heading?: string; body?: string };

  const [logoUrl, setLogoUrl] = useState(p?.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(p?.primaryColor ?? "#6366F1");
  const [secondaryColor, setSecondaryColor] = useState(p?.secondaryColor ?? "#8B5CF6");
  const [headingFont, setHeadingFont] = useState(typography.heading ?? "");
  const [bodyFont, setBodyFont] = useState(typography.body ?? "");
  const [toneOfVoice, setToneOfVoice] = useState(p?.toneOfVoice ?? "");
  const [hookStyle, setHookStyle] = useState(p?.hookStyle ?? "");
  const [videoStyle, setVideoStyle] = useState(p?.videoStyle ?? "");
  const [thumbnailStyle, setThumbnailStyle] = useState(p?.thumbnailStyle ?? "");
  const [ctaPreferences, setCtaPreferences] = useState(p?.ctaPreferences ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/creator-studio/brands/${brand.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: {
          logoUrl: logoUrl || null,
          primaryColor,
          secondaryColor,
          typography: { heading: headingFont, body: bodyFont },
          toneOfVoice: toneOfVoice || null,
          hookStyle: hookStyle || null,
          videoStyle: videoStyle || null,
          thumbnailStyle: thumbnailStyle || null,
          ctaPreferences: ctaPreferences || null,
        },
      }),
    });
    setSaving(false);
    if (res.ok) {
      const updated = (await res.json()) as Brand;
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  const field = "h-9 w-full rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] outline-none focus:border-[--primary]/50";
  const label = "text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-1 block";

  return (
    <div className="rounded-xl border border-[--border] bg-[--card] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-[--foreground] flex items-center gap-1.5">
          <Palette className="w-4 h-4 text-[--primary]" /> Brand Profile
        </h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs bg-[--primary] text-[--primary-foreground] rounded-lg px-3 py-1.5 disabled:opacity-60"
        >
          {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>Logo URL</label>
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className={field} placeholder="https://…" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Primary color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-9 rounded border border-[--border] bg-[--muted]" />
              <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className={field} />
            </div>
          </div>
          <div>
            <label className={label}>Secondary color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="h-9 w-9 rounded border border-[--border] bg-[--muted]" />
              <input value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className={field} />
            </div>
          </div>
        </div>
        <div>
          <label className={label}>Heading font</label>
          <input value={headingFont} onChange={(e) => setHeadingFont(e.target.value)} className={field} placeholder="e.g. Inter" />
        </div>
        <div>
          <label className={label}>Body font</label>
          <input value={bodyFont} onChange={(e) => setBodyFont(e.target.value)} className={field} placeholder="e.g. Inter" />
        </div>
        <div>
          <label className={label}>Tone of voice</label>
          <input value={toneOfVoice} onChange={(e) => setToneOfVoice(e.target.value)} className={field} placeholder="e.g. confident, no-nonsense" />
        </div>
        <div>
          <label className={label}>Hook style</label>
          <input value={hookStyle} onChange={(e) => setHookStyle(e.target.value)} className={field} placeholder="e.g. contrarian" />
        </div>
        <div>
          <label className={label}>Video style</label>
          <input value={videoStyle} onChange={(e) => setVideoStyle(e.target.value)} className={field} placeholder="e.g. fast-paced, b-roll heavy" />
        </div>
        <div>
          <label className={label}>Thumbnail style</label>
          <input value={thumbnailStyle} onChange={(e) => setThumbnailStyle(e.target.value)} className={field} placeholder="e.g. bold text, high contrast" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>CTA preferences</label>
          <input value={ctaPreferences} onChange={(e) => setCtaPreferences(e.target.value)} className={field} placeholder="e.g. always end with subscribe + next video" />
        </div>
      </div>
    </div>
  );
}

function KitSlot({
  category,
  assets,
  onAdd,
  onDelete,
}: {
  category: string;
  assets: Asset[];
  onAdd: (category: string, name: string, url: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const items = assets.filter((a) => a.category === category);

  return (
    <div className="rounded-lg border border-[--border] bg-[--card] p-3">
      <div className="text-xs font-medium text-[--foreground] mb-2">
        {ASSET_CATEGORY_LABELS[category as keyof typeof ASSET_CATEGORY_LABELS] ?? category}
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-[--muted-foreground] mb-2">None yet.</p>
      ) : (
        <div className="space-y-1 mb-2">
          {items.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-[11px]">
              <a href={a.url} target="_blank" rel="noreferrer" className="text-[--primary] hover:underline truncate">
                {a.name}
              </a>
              <button onClick={() => onDelete(a.id)} className="text-[--muted-foreground] hover:text-[--destructive] shrink-0">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-20 h-7 rounded border border-[--border] bg-[--muted] px-1.5 text-[10px] text-[--foreground]"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL"
          className="flex-1 h-7 rounded border border-[--border] bg-[--muted] px-1.5 text-[10px] text-[--foreground]"
        />
        <button
          onClick={() => {
            if (!name.trim() || !url.trim()) return;
            onAdd(category, name.trim(), url.trim());
            setName("");
            setUrl("");
          }}
          className="text-[--primary] shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function BrandKitView({
  activeBrand,
  onBrandUpdated,
}: {
  activeBrand: Brand | null;
  onBrandUpdated: (brand: Brand) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/assets?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: Asset[]) => setAssets(data))
      .catch(() => {});
  }, [activeBrand]);

  async function addKitAsset(category: string, name: string, url: string) {
    if (!activeBrand) return;
    const res = await fetch("/api/creator-studio/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: activeBrand.id, name, category, url }),
    });
    if (res.ok) {
      const asset = (await res.json()) as Asset;
      setAssets((prev) => [asset, ...prev]);
    }
  }

  async function deleteKitAsset(id: string) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/creator-studio/assets/${id}`, { method: "DELETE" });
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Brand Kit</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to see its kit.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1">Brand Kit</h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        {activeBrand.name}&rsquo;s visual identity and reusable creative templates.
      </p>

      <div className="mb-6">
        <ProfileForm brand={activeBrand} onSaved={onBrandUpdated} />
      </div>

      <h2 className="text-xs font-medium text-[--foreground] mb-3">Templates</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {BRAND_KIT_CATEGORIES.map((category) => (
          <KitSlot key={category} category={category} assets={assets} onAdd={addKitAsset} onDelete={deleteKitAsset} />
        ))}
      </div>
    </div>
  );
}
