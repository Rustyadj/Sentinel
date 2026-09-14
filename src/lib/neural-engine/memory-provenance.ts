// Sentinel — memory provenance classes.
//
// Observed and user-provided knowledge must stay distinguishable from what the
// system inferred or generalized, at every point where a memory can reach a
// prompt. This module owns that vocabulary and the trust it implies; it does
// not decide what is true, only where a claim came from.

export const PROVENANCE_CLASSES = [
  "OBSERVED",
  "USER_PROVIDED",
  "INFERRED",
  "GENERALIZED",
  "SYSTEM_DERIVED",
] as const;

export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

/** Classes Sentinel derived itself rather than observed or was told. */
export const DERIVED_CLASSES: ReadonlySet<ProvenanceClass> = new Set(["INFERRED", "GENERALIZED", "SYSTEM_DERIVED"]);

export function isDerived(provenanceClass: string): boolean {
  return DERIVED_CLASSES.has(provenanceClass as ProvenanceClass);
}

/**
 * Provenance trust is a property of the *source*, not of how often a memory has
 * been read. A first-hand observation and something the system inferred from it
 * are not equally trustworthy, and no amount of retrieval changes that.
 *
 * These feed `provenanceTrust`, one of the previously-unwritten inputs to
 * computeMemoryNetValue.
 */
const TRUST_BY_CLASS: Record<ProvenanceClass, number> = {
  USER_PROVIDED: 1.0,
  OBSERVED: 0.9,
  INFERRED: 0.55,
  GENERALIZED: 0.5,
  SYSTEM_DERIVED: 0.45,
};

export function provenanceTrustFor(provenanceClass: string): number {
  return TRUST_BY_CLASS[provenanceClass as ProvenanceClass] ?? TRUST_BY_CLASS.SYSTEM_DERIVED;
}

/**
 * Map an existing `Memory.source` string onto a provenance class.
 *
 * Sentinel has written `source` as a free string since before this vocabulary
 * existed, so classification has to work from the values actually present
 * rather than a clean enum. Anything unrecognised is treated as OBSERVED: these
 * rows predate derived memory entirely, so they are first-hand captures, and
 * guessing INFERRED would silently downgrade real history.
 */
export function classifyExistingSource(source: string | null | undefined): ProvenanceClass {
  const value = (source ?? "").trim().toLowerCase();
  if (!value) return "OBSERVED";
  if (value.includes("user") || value.includes("preference") || value.includes("manual")) return "USER_PROVIDED";
  if (value.includes("generali")) return "GENERALIZED";
  if (value.includes("infer")) return "INFERRED";
  if (value.includes("consolidat") || value.includes("derived") || value.includes("candidate")) return "SYSTEM_DERIVED";
  return "OBSERVED";
}
