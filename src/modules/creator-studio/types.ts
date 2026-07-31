export interface BrandProfile {
  id: string;
  brandId: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  typography: Record<string, unknown>;
  mission: string | null;
  targetAudience: string | null;
  painPoints: string[];
  toneOfVoice: string | null;
  products: string[];
  services: string[];
  competitors: string[];
  frequentPhrases: string[];
  wordsToAvoid: string[];
  ctaPreferences: string | null;
  thumbnailStyle: string | null;
  videoStyle: string | null;
  hookStyle: string | null;
  seoKeywords: string[];
}

export interface Brand {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  profile: BrandProfile | null;
  _count?: { ideas: number };
}

export const CONTENT_ITEM_STATUSES = [
  "idea",
  "research",
  "writing",
  "editing",
  "review",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "archived",
] as const;

export type ContentItemStatus = (typeof CONTENT_ITEM_STATUSES)[number];

export const CONTENT_ITEM_STATUS_LABELS: Record<ContentItemStatus, string> = {
  idea: "Idea",
  research: "Research",
  writing: "Writing",
  editing: "Editing",
  review: "Review",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  archived: "Archived",
};

// Publishing Center only deals with this subset of the full content lifecycle.
export const PUBLISHING_STATUSES: ContentItemStatus[] = ["scheduled", "publishing", "published", "failed"];

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "linkedin",
  "threads",
  "x",
  "tiktok",
  "pinterest",
  "bluesky",
  "google_business",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  threads: "Threads",
  x: "X",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  bluesky: "Bluesky",
  google_business: "Google Business",
};

export interface ContentProject {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number; tasks: number };
}

export interface ContentChapter {
  timestamp: string;
  title: string;
}

export interface OutlineBeat {
  id: string;
  text: string;
}

export const HOOK_STYLES = [
  "curiosity",
  "authority",
  "fear",
  "statistics",
  "question",
  "contrarian",
  "story",
  "problem_solution",
] as const;

export type HookStyle = (typeof HOOK_STYLES)[number];

export const HOOK_STYLE_LABELS: Record<HookStyle, string> = {
  curiosity: "Curiosity",
  authority: "Authority",
  fear: "Fear",
  statistics: "Statistics",
  question: "Question",
  contrarian: "Contrarian",
  story: "Story",
  problem_solution: "Problem/Solution",
};

export const SCRIPT_MODES = [
  "storytelling",
  "educational",
  "sales",
  "podcast",
  "interview",
  "conversation",
  "technical",
] as const;

export type ScriptMode = (typeof SCRIPT_MODES)[number];

export interface ContentHook {
  id: string;
  contentItemId: string;
  style: string;
  text: string;
  selected: boolean;
  createdAt: string;
}

export const SHORT_PLATFORMS = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "linkedin_clips",
  "x_video",
] as const;

export type ShortPlatform = (typeof SHORT_PLATFORMS)[number];

export const SHORT_PLATFORM_LABELS: Record<ShortPlatform, string> = {
  youtube_shorts: "YouTube Shorts",
  tiktok: "TikTok",
  instagram_reels: "Instagram Reels",
  facebook_reels: "Facebook Reels",
  linkedin_clips: "LinkedIn Clips",
  x_video: "X Video",
};

export interface ShortClipCandidate {
  excerpt: string;
  reason: string;
  suggestedPlatforms: string[];
}

export interface ThumbnailConcept {
  headlineText: string;
  visualDescription: string;
  colorDirection: string;
}

export interface ContentItem {
  id: string;
  brandId: string;
  projectId: string | null;
  sourceItemId: string | null;
  title: string;
  type: string;
  status: ContentItemStatus;
  platform: string | null;
  content: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  chapters: ContentChapter[];
  outline: OutlineBeat[];
  scheduledAt: string | null;
  publishedAt: string | null;
  tags: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  hooks?: ContentHook[];
}

export const ASSET_CATEGORIES = [
  "video",
  "photo",
  "logo",
  "music",
  "font",
  "animation",
  "icon",
  "b_roll",
  "document",
  "intro",
  "outro",
  "watermark",
  "lower_third",
  "transition",
  "thumbnail_template",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  video: "Video",
  photo: "Photo",
  logo: "Logo",
  music: "Music",
  font: "Font",
  animation: "Animation",
  icon: "Icon",
  b_roll: "B-roll",
  document: "Document",
  intro: "Intro",
  outro: "Outro",
  watermark: "Watermark",
  lower_third: "Lower Third",
  transition: "Transition",
  thumbnail_template: "Thumbnail Template",
};

// Kit-slot categories are the curated subset shown in Brand Kit rather than
// the general Asset Library.
export const BRAND_KIT_CATEGORIES: AssetCategory[] = [
  "logo",
  "intro",
  "outro",
  "watermark",
  "lower_third",
  "transition",
  "thumbnail_template",
];

export interface Asset {
  id: string;
  brandId: string;
  name: string;
  category: string;
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
  tags: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  contentProjectId: string | null;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorStudioSection {
  id: string;
  label: string;
  status: "available" | "planned";
}

export const CREATOR_STUDIO_SECTIONS: CreatorStudioSection[] = [
  { id: "dashboard", label: "Dashboard", status: "available" },
  { id: "brands", label: "Brands", status: "available" },
  { id: "calendar", label: "Content Calendar", status: "available" },
  { id: "projects", label: "Projects", status: "available" },
  { id: "youtube", label: "YouTube", status: "available" },
  { id: "shorts", label: "Shorts", status: "available" },
  { id: "thumbnails", label: "Thumbnail Studio", status: "available" },
  { id: "social", label: "Social Media", status: "available" },
  { id: "blog", label: "Blog", status: "available" },
  { id: "podcast", label: "Podcast", status: "available" },
  { id: "assets", label: "Asset Library", status: "available" },
  { id: "brand-kit", label: "Brand Kit", status: "available" },
  { id: "ai-assistant", label: "AI Assistant", status: "planned" },
  { id: "publishing", label: "Publishing", status: "available" },
  { id: "analytics", label: "Analytics", status: "planned" },
  { id: "automation", label: "Automation", status: "planned" },
];
