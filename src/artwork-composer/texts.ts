/**
 * TEXTS — textos de la carta como REFERENCIAS: contenido + fuente referenciada (asset del
 * manager) + token de color de la paleta + tamaño fraccional. Nunca se renderiza una
 * fuente aquí. Los valores salen del CardSpec y del contexto: jamás se recalculan.
 */
import type { ArtworkEngine } from "@/artwork";
import type { CardSpec } from "@/card-generator";
import { slotLayout, SLOTS } from "./layout";
import { resolveIdRef } from "./resolver";
import type { ComposedElement, ComposerCtx, TextRole } from "./types";

interface TextDef {
  role: TextRole;
  slot: keyof typeof SLOTS;
  content: (spec: CardSpec, ctx: ComposerCtx) => string;
  size: number;
  colorToken: string;
}

const TEXTS: readonly TextDef[] = [
  { role: "player-name", slot: "text-name", size: 0.052, colorToken: "palette.text", content: (s, c) => c.nick ?? s.playerId },
  { role: "ovr", slot: "text-ovr", size: 0.075, colorToken: "palette.primary", content: (s) => String(s.ovr) },
  { role: "rarity", slot: "text-rarity", size: 0.026, colorToken: "palette.secondary", content: (s) => `${s.rarityBucket} · ${s.variantId}` },
  { role: "collection", slot: "text-collection", size: 0.02, colorToken: "palette.text", content: (s, c) => c.collectionName ?? s.series },
  { role: "edition", slot: "text-edition", size: 0.02, colorToken: "palette.secondary", content: (s) => s.serialized ? `/${s.serialLimit ?? "?"}` : "" },
  { role: "tournament", slot: "text-tournament", size: 0.022, colorToken: "palette.text", content: (s, c) => c.tournamentName ?? s.family },
  { role: "season", slot: "text-season", size: 0.02, colorToken: "palette.text", content: (s) => `S${s.season}` },
] as const;

export function composeTexts(spec: CardSpec, ctx: ComposerCtx, artwork: ArtworkEngine): ComposedElement[] {
  const font = resolveIdRef(artwork, "font", "font:display");
  const fontRef = font.asset.id;
  const out: ComposedElement[] = [];
  for (const t of TEXTS) {
    const content = t.content(spec, ctx);
    if (!content) continue; // p.ej. edition en cartas sin serie
    out.push({
      id: `texts:${t.role}`,
      type: "text",
      ref: fontRef,
      category: "font",
      isPlaceholder: font.isPlaceholder,
      layout: slotLayout(t.slot),
      text: { role: t.role, content, fontRef, size: t.size, colorToken: t.colorToken },
    });
  }
  // Etiquetas de badges del spec (texto informativo; los badges gráficos van en su capa).
  spec.badges.slice(0, 3).forEach((b, i) => {
    out.push({
      id: `texts:badge-label-${b}`,
      type: "text",
      ref: fontRef,
      category: "font",
      isPlaceholder: font.isPlaceholder,
      layout: slotLayout("text-season", { x: 0.88, y: 0.10 + i * 0.035, anchor: "top-right", align: "right", priority: 10 + i }),
      text: { role: "badge-label", content: b, fontRef, size: 0.016, colorToken: "palette.secondary" },
    });
  });
  return out;
}
