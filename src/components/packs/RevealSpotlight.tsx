"use client";

/**
 * APERTURA DE SOBRES · UNA CARTA EN ESCENA (2026-10-15). PRESENTACIÓN PURA, compartida por la hero (`HeroReveal`) y por
 * cada carta del resto (`RestReveal`): el dorso que se carga, el giro, el aterrizaje proporcionado a la rareza y la ficha
 * (rareza, edición, nueva/duplicada, serial, jugador, OVR, rol, equipo). La sala (color de fondo) NO está aquí: la pinta
 * `RevealAtmosphere`, una sola capa persistente, para que el cambio de color entre cartas sea un fundido y no un salto.
 *
 * `fresh` = esta carta se está revelando AHORA (giro + efectos + sonido). Al volver a una carta ya vista, aparece
 * directamente boca arriba: ni gira otra vez ni repite efectos.
 *
 * Efectos por `tier` del ambiente (nunca destellos agresivos): 0 solo el giro · 1 onda + chispas · 2 onda, esquirlas y
 * chispas · 3 lo anterior y un florecer suave de luz. Movimiento reducido: fundido de la cara y halo quieto.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { CardDef } from "@/domain/cards/types";
import type { RevealItem } from "@/domain/packs/reveal";
import type { RevealAtmosphere } from "@/domain/packs/atmosphere";
import { getVariant } from "@/domain/cards/variants";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { EASE } from "@/design/motion";
import { cn } from "@/lib/format";
import { CardBack } from "./CardBack";
import { ParticleBurst } from "./Particles";
import { MAX_BURST } from "./ceremony";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("packs");

export const SPOT_CARD_W = 300; // `PlayerCard` lg
export const SPOT_CARD_H = (SPOT_CARD_W * 7) / 5;
/** Espacio vertical reservado bajo la carta (ficha + botones + márgenes). */
export const SPOT_RESERVED_H = 300;

/** Escala de la carta para que carta + ficha + botones quepan SIEMPRE en el viewport (sin scroll, sin cortes). */
export function spotlightScale(viewportW: number, viewportH: number, reserved = SPOT_RESERVED_H): number {
  const byW = (viewportW - 32) / SPOT_CARD_W;
  const byH = (viewportH - reserved) / SPOT_CARD_H;
  return Math.max(0.5, Math.min(1, byW, byH));
}

export function useSpotlightScale(reserved = SPOT_RESERVED_H): number {
  const [s, setS] = useState(0.78);
  useEffect(() => {
    const m = () => setS(spotlightScale(window.innerWidth, window.innerHeight, reserved));
    m();
    window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, [reserved]);
  return s;
}

/** Partículas del aterrizaje por intensidad (con el tope global de la ceremonia). */
const BURST_BY_TIER = [0, 16, 28, MAX_BURST] as const;
const SHARDS_BY_TIER = [0, 0, 7, 11] as const;

export function RevealSpotlight({
  item, card, uid, serial, atmosphere, revealed, fresh, reduced, flipMs, charge, accent, scale, header, children, ids,
}: {
  item: RevealItem;
  card: CardDef;
  uid: string;
  serial: number | null | undefined;
  /** El ambiente de ESTA carta (efectos y ficha); el fondo lo pinta la sala. */
  atmosphere: RevealAtmosphere;
  revealed: boolean;
  fresh: boolean;
  reduced: boolean;
  flipMs: number;
  /** Carga del dorso antes del giro (0–1). */
  charge: number;
  /** Color con el que se carga el dorso (anticipación). */
  accent: string;
  scale: number;
  /** Lo que va encima de la ficha mientras la carta aún no ha girado. */
  header?: ReactNode;
  /** Botones (siempre en el mismo hueco: la escena no salta). */
  children?: ReactNode;
  /** `data-testid` de la caja de la carta y de la ficha (la hero conserva los suyos de F81). */
  ids?: { box?: string; info?: string };
}) {
  useLocale();
  const variant = getVariant(card.variantId);
  const a = atmosphere;
  const light = a.tone === "light";
  const animateReveal = fresh && !reduced;
  // Los efectos de aterrizaje se disparan UNA vez, cuando ESTA carta gira (no al volver a ella).
  const [landed, setLanded] = useState(revealed && fresh);
  const wasRevealed = useRef(revealed);
  useEffect(() => {
    if (revealed && !wasRevealed.current) setLanded(true);
    wasRevealed.current = revealed;
  }, [revealed]);
  const effects = landed && animateReveal;
  const shards = useMemo(() => Array.from({ length: SHARDS_BY_TIER[a.tier] }, (_, i) => ({
    id: i, x: (i / Math.max(1, SHARDS_BY_TIER[a.tier] - 1)) * 100 - 50, delay: 0.05 + (i % 5) * 0.07, size: 7 + ((i * 13) % 11), drift: 140 + ((i * 37) % 120),
  })), [a.tier]);
  const player = item.player;
  const team = player ? canonicalCardTeam(card, player).label : null;

  const startFaceUp = revealed && !fresh;
  return (
    <>
      {/* ATERRIZAJE · onda, esquirlas, chispas y (cúspide) un florecer suave. Proporcionado a la clase. */}
      {effects && a.tier >= 1 && (
        <motion.span aria-hidden className="pointer-events-none absolute rounded-full border-2" style={{ borderColor: a.glow, width: 300, height: 300, top: "44%", left: "50%", x: "-50%", y: "-50%" }}
          initial={{ scale: 0.4, opacity: 0.85 }} animate={{ scale: 3, opacity: 0 }} transition={{ duration: 1.1, ease: "easeOut" }} data-testid="spot-ring" />
      )}
      {effects && a.tier >= 3 && (
        <motion.span aria-hidden data-testid="spot-bloom" className="pointer-events-none absolute h-[90vmin] w-[90vmin] rounded-full"
          style={{ top: "44%", left: "50%", x: "-50%", y: "-50%", background: `radial-gradient(closest-side, ${a.glow}cc, ${a.highlight}44 45%, transparent 72%)` }}
          initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: [0, 0.6, 0], scale: [0.5, 1, 1.12] }} transition={{ duration: 1.3, times: [0, 0.3, 1], ease: "easeOut" }} />
      )}
      {effects && shards.map((s) => (
        <motion.span key={s.id} aria-hidden className="pointer-events-none absolute" style={{ top: "50%", left: "50%", width: s.size, height: s.size * 2.1, background: a.highlight, clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }}
          initial={{ x: s.x * 2.4, y: 120, opacity: 0 }} animate={{ y: -s.drift, opacity: [0, 0.9, 0], rotate: s.x > 0 ? 28 : -28 }} transition={{ duration: 1.4, delay: s.delay, ease: "easeOut" }} />
      ))}
      {effects && BURST_BY_TIER[a.tier] > 0 && <ParticleBurst color={a.glow} big={a.tier >= 3} count={BURST_BY_TIER[a.tier]} />}

      {/* LA CARTA · dibujada a 300 px y ESCALADA al viewport (transform: no ocupa espacio, no provoca scroll). */}
      <div className="relative grid shrink-0 place-items-center" style={{ width: SPOT_CARD_W * scale, height: SPOT_CARD_H * scale }} data-testid={ids?.box ?? "spot-card-box"}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "center" }} className="relative">
          <motion.div
            className="relative"
            // OJO: nada de `filter`/`opacity<1` de grupo aquí: aplanan `preserve-3d` y el dorso se ve ESPEJADO tras el giro.
            style={{ transformStyle: "preserve-3d", transformPerspective: 1200, width: SPOT_CARD_W }}
            initial={startFaceUp ? (reduced ? { opacity: 1 } : { rotateY: 180, opacity: 1, scale: 1 }) : { rotateY: 0, scale: reduced ? 1 : 0.9, opacity: 0, y: reduced ? 0 : 14 }}
            animate={
              reduced
                ? { rotateY: 0, scale: 1, opacity: 1, y: 0 }
                : revealed
                  ? { rotateY: 180, scale: fresh ? [1.05, 0.98, 1] : 1, opacity: 1, y: 0 }
                  : { rotateY: 0, scale: 1, opacity: 1, y: 0 }
            }
            transition={
              revealed
                ? { rotateY: { duration: flipMs / 1000, ease: EASE.out }, scale: { duration: flipMs / 1000, ease: EASE.out } }
                : { duration: 0.35, ease: "easeOut" }
            }
          >
            <CardBack accent={accent} chargeColor={accent} charged={revealed ? 1 : charge} className="w-[300px]" reducedOverride={reduced}
              style={{ backfaceVisibility: "hidden", ...(reduced ? { opacity: revealed ? 0 : 1, transition: `opacity ${flipMs}ms ease` } : {}) }} />
            {!revealed && !reduced && (
              <motion.span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ backfaceVisibility: "hidden" }}>
                <motion.span className="absolute inset-y-0 w-1/3" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.32), transparent)", skewX: -18 }}
                  initial={{ x: "-120%" }} animate={{ x: "320%" }} transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.4 }} />
              </motion.span>
            )}
            <div className="absolute inset-0" data-face="front" aria-hidden={!revealed}
              style={reduced ? { opacity: revealed ? 1 : 0, transition: `opacity ${flipMs}ms ease ${Math.round(flipMs * 0.2)}ms` } : { backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
              <CardVisual uid={uid} alt={tr("Carta de {cardId}", { cardId: item.cardId })} chamfer="21px" className="w-[300px]">
                <PlayerCard card={card} size="lg" serial={serial ?? undefined} interactive={false} />
              </CardVisual>
            </div>
          </motion.div>
        </div>
      </div>

      {/* LA FICHA + BOTONES · mismo hueco en todos los estados. Tinta oscura en la sala clara (Icon). */}
      <div className="relative mt-4 flex min-h-[170px] w-full max-w-md shrink-0 flex-col items-center gap-2 text-center" onClick={(e) => e.stopPropagation()} data-testid="spot-info-area">
        {!revealed && header}
        {revealed && (
          <motion.div className="flex flex-col items-center gap-1.5" initial={fresh ? { opacity: 0, y: reduced ? 0 : 12 } : false} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: fresh ? (reduced ? 0.12 : (flipMs / 1000) * 0.6) : 0 }} data-testid={ids?.info ?? "spot-info"}>
            <div className="flex flex-wrap items-center justify-center gap-2" data-testid="spot-badges">
              <span className="nx-clip-sm px-4 py-1 font-display text-caption font-bold uppercase tracking-wide" style={{ background: a.glow, color: a.ink, boxShadow: `0 0 18px ${a.glow}66` }} data-badge="rarity">{td(item.rarityLabel)}</span>
              <span className={cn("nx-clip-sm border px-3 py-1 font-display text-label font-bold uppercase tracking-wide2", light ? "border-black/20 bg-white/50 text-[#1a1408]" : "border-white/15 bg-black/25 text-white/85")} data-badge="edition">{td(variant?.label ?? item.variantLabel)}</span>
              {item.status === "new" && <span className="nx-clip-sm bg-drl px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white" data-badge="new">{item.newVariant ? tr("Nueva variante") : tr("Nueva en tu colección")}</span>}
              {item.status === "duplicate" && <span className={cn("nx-clip-sm px-3 py-1 font-display text-label font-bold uppercase tracking-wide2", light ? "bg-black/10 text-[#1a1408]" : "bg-white/10 text-white/85")} data-badge="duplicate">{tr("Duplicada · ×")}{item.copiesAfter}</span>}
              {item.serialText && <span className={cn("nx-clip-sm px-3 py-1 font-display text-label font-bold uppercase tracking-wide2", light ? "bg-black/10 text-[#1a1408]" : "bg-white/10 text-white/85")} data-badge="serial">{td(item.serialText)}</span>}
            </div>
            {player && (
              <p className={cn("font-display text-caption uppercase tracking-wide2", light ? "text-[#3a3226]" : "text-ink-muted")} data-testid="spot-line">
                <b className={light ? "text-[#120d04]" : "text-white"}>{player.nick}</b><span className={cn("mx-1.5", light ? "text-black/30" : "text-ink-faint")}>·</span>
                <span className={cn("nx-readout", light ? "text-[#120d04]" : "text-white")}>{card.ovr}</span> {tr("OVR")}<span className={cn("mx-1.5", light ? "text-black/30" : "text-ink-faint")}>·</span>
                {td(card.role) ?? td(player.role)}{team && <><span className={cn("mx-1.5", light ? "text-black/30" : "text-ink-faint")}>·</span>{team}</>}
              </p>
            )}
          </motion.div>
        )}
        {children}
      </div>
    </>
  );
}
