/**
 * COMPOSER ENGINE — `composeArtwork(spec, artwork, ctx)`: el equivalente visual de
 * generateCards. Toma un CardSpec YA decidido (jamás recalcula OVR/rareza/badges de
 * juego) y produce la ArtworkComposition determinista: 12 capas oficiales en orden, solo
 * referencias del Artwork Asset Manager, placeholder garantizado, cero nulls.
 */
import type { ArtworkEngine } from "@/artwork";
import type { CardSpec } from "@/card-generator";
import { composeBackground, composeOverlay } from "./background";
import { composeBadges, deriveBadges } from "./badges";
import { assemble, assetElement } from "./composition";
import { composeEffects, deriveEffects } from "./effects";
import { composeFrame } from "./frame";
import { composeIcons } from "./icons";
import { slotLayout } from "./layout";
import type { LayerElements } from "./layers";
import { resolveIdRef, resolveSubjectRef } from "./resolver";
import { composeTexts } from "./texts";
import type { ArtworkComposition, ComposedElement, ComposerCtx } from "./types";

function debugElement(spec: CardSpec, artwork: ArtworkEngine): ComposedElement {
  const font = resolveIdRef(artwork, "font", "font:display");
  return {
    id: "debug:info",
    type: "text",
    ref: font.asset.id,
    category: "font",
    isPlaceholder: font.isPlaceholder,
    layout: slotLayout("debug"),
    text: { role: "debug", content: `${spec.cardId} · ${spec.rarityBucket} · s${spec.season}`, fontRef: font.asset.id, size: 0.014, colorToken: "palette.text" },
  };
}

/** CardSpec → ArtworkComposition (pura, determinista, solo referencias). */
export function composeArtwork(spec: CardSpec, artwork: ArtworkEngine, ctx: ComposerCtx = {}): ArtworkComposition {
  const fx = composeEffects(spec, artwork);

  const elements: LayerElements = {
    background: composeBackground(artwork),
    "background-effects": fx["background-effects"],
    tournament: [assetElement("tournament", "logo", resolveSubjectRef(artwork, "tournament-logo", ctx.tournamentId), slotLayout("tournament"))],
    team: [assetElement("team", "logo", resolveSubjectRef(artwork, "team", ctx.teamSlug), slotLayout("team"))],
    player: [
      ...fx.player,
      assetElement("player", "artwork", resolveSubjectRef(artwork, "player", spec.playerId), slotLayout("player")),
    ],
    frame: composeFrame(spec, artwork),
    badges: composeBadges(spec, artwork),
    icons: composeIcons(spec, ctx, artwork),
    texts: composeTexts(spec, ctx, artwork),
    "foreground-effects": fx["foreground-effects"],
    overlay: composeOverlay(artwork),
    debug: ctx.debug ? [debugElement(spec, artwork)] : [],
  };

  return assemble(elements, {
    spec,
    generationId: ctx.generationId,
    badges: deriveBadges(spec),
    effects: deriveEffects(spec),
  });
}
