import type { PurchaseIntent } from "../brain/types";

export const DEFAULT_MATERIALS = ["pla", "petg", "asa"] as const;

export type PrintSize = { x: number; y: number; z: number };

export type DesignLicense = {
  source: string;
  type: string;
  attribution: string;
  commercialPrint: boolean;
  commercialSale: boolean;
};

export type DesignProposal = {
  id: string;
  title: string;
  original: boolean;
  license: DesignLicense | null;
  material: string;
  sizeMm: PrintSize;
  infillPercent: number;
  layerMm: number;
  estimatedCostCents: number | null;
  priceCents: number | null;
};

export type PrintBounds = {
  materials: string[];
  maxMm: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  approvedProductTypes: string[];
};

export type DesignDecision =
  | { ok: true; design: DesignProposal }
  | { ok: false; reason: string };

const SUPPLY_TYPES = new Set(["filament", "printer_parts", "printer"]);

export function licenseAllowsSale(design: { original: boolean; license: DesignLicense | null }): { ok: true } | { ok: false; reason: string } {
  if (design.original) return { ok: true };
  const license = design.license;
  if (!license) return { ok: false, reason: "LICENSE_REQUIRED" };
  if (!license.source.trim() || !license.type.trim() || !license.attribution.trim()) return { ok: false, reason: "LICENSE_INCOMPLETE" };
  if (!license.commercialPrint || !license.commercialSale) return { ok: false, reason: "LICENSE_NOT_COMMERCIAL" };
  return { ok: true };
}

export function proposeDesign(input: DesignProposal, bounds: PrintBounds): DesignDecision {
  const license = licenseAllowsSale(input);
  if (!license.ok) return license;
  if (!bounds.materials.includes(input.material)) return { ok: false, reason: "MATERIAL_NOT_ALLOWED" };
  for (const axis of [input.sizeMm.x, input.sizeMm.y, input.sizeMm.z]) {
    if (!Number.isFinite(axis) || axis <= 0 || axis > bounds.maxMm) return { ok: false, reason: "SIZE_OUT_OF_BOUNDS" };
  }
  if (!Number.isInteger(input.infillPercent) || input.infillPercent < 5 || input.infillPercent > 100) return { ok: false, reason: "INFILL_OUT_OF_BOUNDS" };
  if (!Number.isFinite(input.layerMm) || input.layerMm < 0.08 || input.layerMm > 0.4) return { ok: false, reason: "LAYER_OUT_OF_BOUNDS" };
  if (input.estimatedCostCents != null && (!Number.isInteger(input.estimatedCostCents) || input.estimatedCostCents < 0)) {
    return { ok: false, reason: "ESTIMATE_INVALID" };
  }
  return { ok: true, design: { ...input, estimatedCostCents: input.estimatedCostCents } };
}

export function listItemForSale(design: DesignProposal, bounds: PrintBounds): DesignDecision {
  const proposed = proposeDesign(design, bounds);
  if (!proposed.ok) return proposed;
  if (design.priceCents == null) return { ok: false, reason: "PRICE_UNSET" };
  if (bounds.minPriceCents == null || bounds.maxPriceCents == null) return { ok: false, reason: "PRICE_BOUNDS_UNSET" };
  if (!Number.isInteger(design.priceCents) || design.priceCents < bounds.minPriceCents || design.priceCents > bounds.maxPriceCents) {
    return { ok: false, reason: "PRICE_OUT_OF_BOUNDS" };
  }
  if (!bounds.approvedProductTypes.includes("printed_object")) return { ok: false, reason: "NEW_PRODUCT_TYPE" };
  return proposed;
}

/** Filament, parts, and a printer are ordinary card intents. Chat cannot build one. */
export function supplyIntent(input: { id: string; productType: "filament" | "printer_parts" | "printer"; merchant: string; amountCents: number; reason: string }): PurchaseIntent {
  if (!SUPPLY_TYPES.has(input.productType)) throw new Error("SUPPLY_TYPE");
  return {
    id: input.id,
    origin: "needs_loop",
    merchant: input.merchant,
    productType: input.productType,
    amountCents: input.amountCents,
    reason: input.reason,
    influencedByVisitor: false,
    influencedByOwnerChat: false,
    influencedByWeb: false,
  };
}

export function supplyIntentFromChat(_text: string): null {
  return null;
}

export function printBoundsFromEnv(env: Record<string, string | undefined>, approvedProductTypes: string[]): PrintBounds {
  const materials = (env.LUMEN_PRINT_MATERIALS ?? DEFAULT_MATERIALS.join(",")).split(",").map((item) => item.trim()).filter(Boolean);
  const maxMm = positiveInt(env.LUMEN_PRINT_MAX_MM) ?? 250;
  return {
    materials,
    maxMm,
    minPriceCents: positiveInt(env.LUMEN_PRINT_MIN_PRICE_CENTS),
    maxPriceCents: positiveInt(env.LUMEN_PRINT_MAX_PRICE_CENTS),
    approvedProductTypes,
  };
}

function positiveInt(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
