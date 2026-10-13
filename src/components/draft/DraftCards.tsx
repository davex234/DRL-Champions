"use client";

/**
 * DRAFT GAUNTLET · CARTAS (Fase 39).
 *
 *   · `DraftOption`  — una de las TRES opciones: la carta canónica grande (`PlayerCard`, el renderer de siempre) dentro
 *                       de `Card3D` (las únicas tres cartas «pesadas» de la pantalla) y los datos en texto.
 *   · `RosterStrip`  — la plantilla temporal: miniaturas estáticas (`CardThumb`), sin 3D.
 *   · `ComparePanel` — la opción frente a lo ya elegido del mismo rol. Números lado a lado, sin veredicto.
 *
 * Las cartas del draft no son ejemplares: sin serial, sin artwork por `uid`, sin «nueva». Si el catálogo del cliente
 * no conoce la carta (o se fuerza el fallo de arte), se pinta una cara de texto con los mismos datos del servidor.
 *
 * F72 · ESPECTÁCULO SIN TAPAR LA CARTA. «The card is the asset»: el `PlayerCard` canónico se pinta tal cual; todo el
 * efecto va DETRÁS o ALREDEDOR (foco de luz, aura del color de su edición, chispas que suben por detrás), nunca un
 * marco encima. La presencia escala con la rareza REAL de la edición (`bucketForRank(variant.rank)`): solo
 * presentación, ni OVR, ni stats, ni probabilidades. Entrada escalonada, elevación al pasar, la elegida avanza y las
 * otras bajan de énfasis. Con movimiento reducido: fundidos, sin desplazamientos, sin chispas continuas.
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { Card3D } from "@/components/visual/Card3D";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardThumb } from "@/components/cards/CardThumb";
import { getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { cardHref } from "@/domain/collection/room";
import type { DraftCardDTO } from "@/domain/draft/snapshot";
import type { RoleId } from "@/domain/cards/types";
import { ROLE_SHORT, STAT_KEYS, STAT_LABEL, type StatKey } from "@/lib/draft/presentation";

function FallbackFace({ card, className }: { card: DraftCardDTO; className?: string }) {
  const v = getVariant(card.variantId);
  return (
    <div data-testid="draft-card-fallback" className={cn("nx-clip flex aspect-[5/7] w-full flex-col justify-between border-2 p-3 text-left", className)} style={{ borderColor: v.palette.primary, background: `linear-gradient(160deg, ${v.palette.primary}33, #07080e 70%)` }}>
      <div className="flex items-start justify-between gap-2">
        <span className="nx-readout text-[34px] leading-none text-white">{card.ovr}</span>
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">{ROLE_SHORT[card.role]}</span>
      </div>
      <div>
        <p className="break-words font-display text-[22px] font-bold uppercase leading-none text-white">{card.nick}</p>
        <p className="mt-1 break-words text-[12px] uppercase tracking-[0.1em] text-white/60">{card.team}</p>
      </div>
    </div>
  );
}

/** La cara canónica si el catálogo del cliente la tiene; si no, la de texto. */
export function DraftCardFace({ card, forceFallback = false, size = "md" }: { card: DraftCardDTO; forceFallback?: boolean; size?: "sm" | "md" }) {
  const def = forceFallback ? undefined : getCard(card.cardId);
  if (!def) return <FallbackFace card={card} />;
  return <PlayerCard card={def} size={size} interactive={false} />;
}

function StatRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-white/[0.06] py-1 last:border-b-0">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-white/55">{label}</dt>
      <dd className="nx-readout text-[16px] tabular-nums text-white">{value ?? "—"}</dd>
    </div>
  );
}

/** Presencia de la carta por la rareza de su edición (solo presentación). */
export const DRAFT_PRESENCE: Record<RarityBucket, { aura: number; spark: number; ring: boolean }> = {
  common: { aura: 0.2, spark: 0, ring: false },
  uncommon: { aura: 0.28, spark: 0, ring: false },
  rare: { aura: 0.38, spark: 3, ring: false },
  epic: { aura: 0.5, spark: 6, ring: true },
  legendary: { aura: 0.66, spark: 9, ring: true },
};
export const draftPresence = (variantId: DraftCardDTO["variantId"]) => {
  const v = getVariant(variantId);
  const bucket = bucketForRank(v.rank);
  return { bucket, color: v.palette.primary, ...DRAFT_PRESENCE[bucket] };
};

/** Chispas que suben DETRÁS de la carta (nunca encima). No se montan con movimiento reducido. */
function Sparks({ n, color, seed }: { n: number; color: string; seed: number }) {
  const reduced = useReducedMotion();
  if (reduced || n === 0) return null;
  return (
    <span aria-hidden data-testid="draft-sparks" className="pointer-events-none absolute inset-x-[8%] bottom-[18%] top-[6%] -z-10">
      {Array.from({ length: n }, (_, i) => {
        const x = ((seed * 37 + i * 53) % 100);
        const d = 3.2 + ((seed + i * 7) % 5) * 0.45;
        return (
          <motion.span key={i} className="absolute bottom-0 h-1 w-1 rounded-full"
            style={{ left: `${x}%`, background: color, boxShadow: `0 0 8px ${color}` }}
            initial={{ y: 0, opacity: 0 }} animate={{ y: [-4, -220], opacity: [0, 0.8, 0] }}
            transition={{ duration: d, delay: i * 0.35, repeat: Infinity, ease: "easeOut" }} />
        );
      })}
    </span>
  );
}

export function DraftOption({
  card, index, selected, dimmed, disabled, onSelect, forceFallback = false,
}: {
  card: DraftCardDTO;
  index: number;
  selected: boolean;
  dimmed: boolean;
  disabled: boolean;
  onSelect: (index: number) => void;
  forceFallback?: boolean;
}) {
  const v = getVariant(card.variantId);
  const fx = draftPresence(card.variantId);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  // En el carrusel móvil la elegida puede quedar fuera: se centra (sin salto brusco con movimiento reducido).
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [selected, reduced]);
  return (
    <motion.article
      ref={ref}
      data-testid="draft-option"
      data-card-id={card.cardId}
      data-selected={selected ? "true" : "false"}
      data-presence={fx.bucket}
      initial={{ opacity: 0, y: 42, scale: 0.92 }}
      animate={{ opacity: dimmed ? 0.42 : 1, y: selected ? -12 : 0, scale: selected ? 1.05 : dimmed ? 0.95 : 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.06 + index * 0.12 }}
      style={{ filter: dimmed ? "saturate(0.55) brightness(0.8)" : undefined, zIndex: selected ? 2 : 1 }}
      className="relative flex w-[78vw] max-w-[320px] shrink-0 snap-center flex-col gap-3 md:w-auto md:max-w-none"
    >
      <div className="relative isolate">
        {/* Aura DETRÁS de la carta: el color de su edición, más intensa cuanto más rara (y al elegirla). */}
        <span aria-hidden data-testid="draft-aura" className="pointer-events-none absolute -inset-6 -z-10 rounded-[50%] transition-opacity duration-300"
          style={{ background: `radial-gradient(closest-side, ${fx.color}${Math.round(Math.min(1, fx.aura + (selected ? 0.25 : 0)) * 255).toString(16).padStart(2, "0")}, transparent 72%)`, filter: "blur(10px)" }} />
        {fx.ring && (
          // Pulso de luz ELÍPTICO (nunca una caja): una silueta rectangular detrás se leía como un marco.
          <motion.span aria-hidden data-testid="draft-pulse" className="pointer-events-none absolute -inset-x-8 -inset-y-4 -z-10 rounded-[50%]"
            style={{ background: `radial-gradient(closest-side, ${fx.color}55, transparent 75%)`, filter: "blur(14px)" }}
            animate={{ opacity: [0.35, 0.8, 0.35] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }} />
        )}
        <Sparks n={fx.spark} color={fx.color} seed={index + card.ovr} />
        <motion.div whileHover={disabled ? undefined : { y: -8 }} transition={{ type: "spring", stiffness: 320, damping: 22 }}>
          <Card3D
            mode={selected ? "selected" : "hover"}
            glow={v.palette.primary}
            onClick={disabled ? undefined : () => onSelect(index)}
            disabled={disabled}
            label={`Opción ${index + 1}: ${card.nick}, ${card.team}, ${card.role}, OVR ${card.ovr}`}
            className="mx-auto w-full max-w-[250px]"
          >
            <DraftCardFace card={card} forceFallback={forceFallback} />
          </Card3D>
        </motion.div>
        {/* Luz de suelo: la carta «pisa» el escenario (debajo, no encima). */}
        <span aria-hidden className="pointer-events-none absolute -bottom-3 left-1/2 -z-10 h-5 w-[70%] -translate-x-1/2 rounded-[50%]"
          style={{ background: `radial-gradient(closest-side, ${fx.color}${selected ? "aa" : "55"}, transparent)` }} />
      </div>
      <div className={cn("nx-clip-sm border px-3 py-2 transition-colors", selected ? "border-drl-gold/70 bg-drl-gold/[0.08]" : "border-white/10 bg-white/[0.02]")}>
        <p className="flex items-center justify-between gap-2">
          <span className="break-words font-display text-[20px] font-bold uppercase leading-none text-white" data-testid="draft-option-nick">{card.nick}</span>
          <span aria-hidden className={cn("grid h-7 min-w-7 place-items-center rounded-[4px] border px-1 font-display text-[13px] font-bold", selected ? "border-drl-gold bg-drl-gold text-black" : "border-white/25 text-white/70")}>{selected ? "✓" : index + 1}</span>
        </p>
        <p className="mt-0.5 break-words text-[12px] uppercase tracking-[0.1em] text-white/60">{card.team}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] uppercase tracking-[0.12em] text-white/70">
          <span>{card.role}</span><span style={{ color: v.palette.primary }}>{v.label}</span><span>OVR <b className="nx-readout text-white">{card.ovr}</b></span>
        </p>
        <dl className="mt-1.5">
          {STAT_KEYS.map((k) => <StatRow key={k} label={STAT_LABEL[k]} value={card.combat?.[k] ?? null} />)}
        </dl>
        <Link href={cardHref(card.cardId)} className="nx-focus mt-1 inline-flex min-h-[44px] items-center text-[11px] font-bold uppercase tracking-[0.14em] text-drl-cyan hover:text-white">Ver carta ›</Link>
      </div>
    </motion.article>
  );
}

/** F72 · `freshIndex` = el hueco recién incorporado: entra con un destello corto (sin él, estático). */
export function RosterStrip({ slots, className, freshIndex = null }: { slots: { index: number; role: RoleId; card: DraftCardDTO | null; current: boolean }[]; className?: string; freshIndex?: number | null }) {
  return (
    <ol aria-label="Plantilla temporal" data-testid="draft-roster" className={cn("grid grid-cols-5 gap-1.5 sm:grid-cols-10", className)}>
      {slots.map((s) => {
        const def = s.card ? getCard(s.card.cardId) : undefined;
        return (
          <li
            key={s.index}
            data-testid="draft-roster-slot"
            data-filled={s.card ? "true" : "false"}
            aria-current={s.current ? "step" : undefined}
            className={cn("flex flex-col items-center gap-1 rounded-[4px] border px-1 py-1.5", s.current ? "border-drl-gold bg-drl-gold/10" : s.card ? "border-transparent bg-transparent" : "border-dashed border-white/15")}
          >
            {s.card ? (
              <motion.span key={s.card.cardId} className="relative block" data-fresh={s.index === freshIndex ? "true" : undefined}
                initial={s.index === freshIndex ? { opacity: 0, scale: 1.45, y: -18 } : false} animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}>
                {s.index === freshIndex && (
                  <motion.span aria-hidden className="pointer-events-none absolute -inset-1.5 rounded-md border-2 border-drl-gold"
                    initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.9, delay: 0.25 }} />
                )}
                {def ? <CardThumb card={def} width={40} /> : <span className="nx-readout grid aspect-[5/7] w-10 place-items-center rounded-md border border-white/20 text-[14px] text-white">{s.card.ovr}</span>}
              </motion.span>
            ) : <span className="grid aspect-[5/7] w-10 place-items-center rounded-md text-[16px] text-white/25">+</span>}
            <span className="w-full truncate text-center text-[10px] uppercase tracking-[0.08em] text-white/60">{s.card ? s.card.nick : ROLE_SHORT[s.role]}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ComparePanel({ option, rows }: { option: DraftCardDTO; rows: { against: DraftCardDTO; rows: { stat: StatKey | "ovr"; option: number; picked: number }[] }[] }) {
  return (
    <section aria-label="Comparar con tu plantilla" data-testid="draft-compare" className="nx-clip-sm border border-white/10 bg-black/30 px-3 py-2">
      <p className="nx-label">Comparar · {option.role}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-caption text-ink-muted">Aún no tienes ningún {option.role} en la plantilla.</p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[260px] text-left text-[12px]">
            <thead>
              <tr className="text-white/50">
                <th className="py-1 font-normal uppercase tracking-[0.1em]">Stat</th>
                <th className="py-1 font-normal uppercase tracking-[0.1em]">{option.nick}</th>
                {rows.map((r) => <th key={r.against.cardId} className="py-1 font-normal uppercase tracking-[0.1em]">{r.against.nick}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows[0].rows.map((row, i) => (
                <tr key={row.stat} className="border-t border-white/[0.06]">
                  <td className="py-1 uppercase tracking-[0.1em] text-white/60">{row.stat === "ovr" ? "OVR" : STAT_LABEL[row.stat]}</td>
                  <td className="nx-readout py-1 tabular-nums text-white">{row.option}</td>
                  {rows.map((r) => <td key={r.against.cardId} className="nx-readout py-1 tabular-nums text-white/80">{r.rows[i].picked}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
