import { db } from "@/lib/db";

/**
 * Builds a brand-voice system-prompt fragment from BrandProfile so every
 * Creator Studio AI call reflects this brand's mission, tone, and style
 * instead of a generic assistant voice.
 */
export async function buildBrandContext(brandId: string): Promise<string> {
  const profile = await db.brandProfile.findUnique({ where: { brandId } });
  if (!profile) return "";

  const lines: string[] = [];
  if (profile.mission) lines.push(`Brand mission: ${profile.mission}`);
  if (profile.targetAudience) lines.push(`Target audience: ${profile.targetAudience}`);
  if (profile.toneOfVoice) lines.push(`Tone of voice: ${profile.toneOfVoice}`);
  if (profile.hookStyle) lines.push(`Preferred hook style: ${profile.hookStyle}`);
  if (profile.videoStyle) lines.push(`Preferred video style: ${profile.videoStyle}`);
  if (profile.ctaPreferences) lines.push(`CTA preferences: ${profile.ctaPreferences}`);
  if (profile.frequentPhrases.length) {
    lines.push(`Frequently used phrases (use naturally where fitting): ${profile.frequentPhrases.join(", ")}`);
  }
  if (profile.wordsToAvoid.length) {
    lines.push(`Words/phrases to avoid: ${profile.wordsToAvoid.join(", ")}`);
  }
  if (profile.seoKeywords.length) {
    lines.push(`SEO keywords to weave in where natural: ${profile.seoKeywords.join(", ")}`);
  }

  if (lines.length === 0) return "";
  return `\n\nBrand voice guidelines — follow these consistently:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

export async function getAnthropicKey(req: Request): Promise<string | null> {
  return req.headers.get("x-anthropic-key") ?? process.env.ANTHROPIC_API_KEY ?? null;
}
