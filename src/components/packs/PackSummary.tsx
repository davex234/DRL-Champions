"use client";

/**
 * EL RESUMEN DEL SOBRE (Fase 38 → PACK OPENING 3.0) — el cierre de la ceremonia, con los datos REALES del plan.
 *
 * PACK OPENING 3.0 (2026-10-07) · «He abierto un sobre», no «dashboard + lista de cartas». Jerarquía:
 *
 *   1. LA HERO — la carta de mayor OVR (`summary.featured`, regla canónica de F81: `selectHero`, desempate estable),
 *      grande y con la luz de su calidad; nombre, OVR, edición/rareza y NUEVA / NUEVA VARIANTE / DUPLICADA ×N.
 *   2. EL RESTO DEL SOBRE — las demás cartas, en una rejilla generosa (nunca miniaturas), cada una con su estado y su ficha.
 *   3. UN PANEL SECUNDARIO compacto — resumen (cartas · nuevas · duplicadas · nuevas variantes), momentos, la colección
 *      X → Y / TOTAL y hasta 3 sets que avanzan. Información útil, con menos protagonismo que las cartas.
 *   4. ACCIONES — dock pegado: ABRIR OTRO (o abrir mis sobres / ver sobres) domina; IR A MI COLECCIÓN y JUGAR secundarias.
 *
 * El sobre se hereda con SUTILEZA: su acento (`accent`) tiñe la luz de la escena y la intensidad (`intensity`, 1 Bronce →
 * 6 Icon) decide cuánta. Un solo sistema visual, seis variaciones — no seis pantallas.
 *
 * Qué cuenta y de dónde sale (todo de `domain/packs/reveal`, sobre el resultado persistido y la colección de antes):
 *   · todas las cartas obtenidas, cada una con su ficha real (`Ver carta`) y sus datos de instancia en `data-*`;
 *   · nuevas / duplicadas / nuevas variantes — o «no disponible» si no hubo foto previa de la colección;
 *   · la colección X → Y / TOTAL y % → %; SET COMPLETADO y PRIMERA LEGENDARIA como reconocimiento — sin recompensas.
 *
 * Sin valor en monedas, sin «vender repetidas», sin mercado: la carta es el premio. El arte de cada carta lo pinta
 * `PlayerCard` tal cual (sin marcos añadidos ni cartas dentro de cartas). Movimiento corto y saltable; con movimiento
 * reducido, mismos contenidos con fundidos y sin escalas.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { RevealItem, RevealPlan, CollectionDelta } from "@/domain/packs/reveal";
import { getVariant } from "@/domain/cards/variants";
import { packCardClass, PACK_CLASS_ORDER } from "@/domain/packs/packClass";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { Card3D } from "@/components/visual/Card3D";
import { NxButton } from "@/components/ui/NxButton";
import { Meter } from "@/components/ui/Meter";

const pct = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/** Variable CSS con la que el rótulo de «momento» (abajo, en rutas inmersivas) se aparta del dock de acciones. */
export const MOMENT_OFFSET_VAR = "--nx-moment-offset";

export interface PackSummaryProps {
  packName: string;
  plan: RevealPlan;
  /** Unidades que quedan de ESTE sobre (del inventario real). */
  available: number;
  /** Sobres sin abrir en total. */
  packsLeft: number;
  recovered?: boolean;
  repeated?: boolean;
  reduced?: boolean;
  onOpenAnother?: () => void;
  onNavigate: (href: string) => void;
  onAddToDeck?: (item: RevealItem) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  /** F63 · un bloque ANTES de las cifras (la guía de la primera sesión: tu primera carta / el siguiente paso). */
  lead?: ReactNode;
  /**
   * F63 · con la guía delante, el dock de acciones NO va pegado al pie: en 390 px tapaba los botones de la guía. Las
   * mismas acciones siguen al final del resumen.
   */
  dockStatic?: boolean;
  /** Pack Opening 3.0 · acento del sobre abierto (luz de la escena). */
  accent?: string;
  /** Pack Opening 3.0 · intensidad de la escena según el escalón del sobre (1 Bronce … 6 Icon; 3 si no es de la línea). */
  intensity?: number;
  children?: ReactNode;
}

/** Luz de la hero según la CLASE de la carta (Base → Icon): más clase, más halo. Color = el de su edición. */
function heroGlow(item: RevealItem): { color: string; strength: number } {
  const k = packCardClass(item.card);
  const rank = k ? PACK_CLASS_ORDER.indexOf(k) : 0; // 0..6
  return { color: getVariant(item.card.variantId).palette.primary, strength: 0.35 + rank * 0.1 };
}

/** NUEVA / NUEVA VARIANTE / DUPLICADA ×N — semántica de siempre (`item.status`, `newVariant`, `copiesAfter`). */
function StatusBadge({ item, size = "sm" }: { item: RevealItem; size?: "sm" | "md" }) {
  const base = `nx-clip-sm inline-flex items-center font-display font-bold uppercase ${size === "md" ? "px-3 py-1 text-[12px] tracking-[0.14em]" : "px-2 py-0.5 text-[10.5px] tracking-[0.12em]"}`;
  if (item.status === "new" && item.newVariant) return <span className={`${base} bg-drl-cyan/15 text-drl-cyan shadow-[inset_0_0_0_1px_rgba(25,227,255,0.45)]`} data-caption-status="new-variant">Nueva variante</span>;
  if (item.status === "new") return <span className={`${base} bg-[#3fc07a]/15 text-[#3fc07a] shadow-[inset_0_0_0_1px_rgba(63,192,122,0.5)]`} data-caption-status="new">Nueva</span>;
  if (item.status === "duplicate") return <span className={`${base} bg-white/[0.06] text-ink-secondary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]`} data-caption-status="duplicate">Duplicada ×{item.copiesAfter}</span>;
  return null;
}

export function PackSummary({
  packName, plan, available, packsLeft, recovered = false, repeated = false, reduced = false,
  onOpenAnother, onNavigate, onAddToDeck, headingRef, lead, dockStatic = false, accent = "#19e3ff", intensity = 3, children,
}: PackSummaryProps) {
  const { summary, items } = plan;
  const featured = summary.featured;
  const known = summary.newCount !== null;
  const ordered = plan.order?.length ? plan.order : items;
  const rest = featured ? ordered.filter((it) => it.uid !== featured.uid) : ordered;
  const level = Math.max(1, Math.min(6, Math.round(intensity)));
  const glow = featured ? heroGlow(featured) : null;

  // El rótulo de «momento» (OBJETIVO COMPLETADO…) se pinta abajo en las rutas inmersivas: que nunca tape el dock.
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof document === "undefined") return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty(MOMENT_OFFSET_VAR, `${Math.round(el.getBoundingClientRect().height) + 12}px`);
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty(MOMENT_OFFSET_VAR); };
  }, []);

  const enter = (delay: number) => (reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, delay: Math.min(delay, 0.3) } }
    : { initial: { opacity: 0, y: 14, scale: 0.96 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.42, delay, ease: [0.2, 0.8, 0.2, 1] as const } });

  const sceneStyle = { "--pack-accent": accent } as CSSProperties;
  const noMore = !(available > 0 && onOpenAnother) && packsLeft <= 0;

  return (
    <div className="mx-auto max-w-6xl" data-testid="pack-summary" data-recovered={String(recovered)} data-intensity={level} style={sceneStyle}>
      <div className="flex flex-col items-center text-center">
        <span className="nx-clip-sm inline-flex items-center gap-2 px-3 py-1 font-display text-label font-bold uppercase tracking-wide2" style={{ color: accent, background: `${accent}14`, boxShadow: `inset 0 0 0 1px ${accent}55` }} data-testid="summary-pack">
          {packName}
        </span>
        <h2 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-[clamp(24px,4.6vw,38px)] font-bold uppercase leading-none tracking-[0.04em] text-white outline-none">
          Resultado del sobre
        </h2>
      </div>
      {(recovered || repeated) && (
        <p role="status" className="mx-auto mt-3 max-w-xl text-center text-caption text-ink-muted" data-testid="summary-recovered">
          El sobre ya se abrió correctamente. Estas son las cartas que se guardaron — no se ha abierto otro.
        </p>
      )}

      {lead && <div className="mt-6" data-testid="summary-lead">{lead}</div>}

      {/* ───────── 1 · LA HERO ───────── */}
      {featured && glow && (
        <section aria-label="Carta protagonista" className="relative mt-5 flex flex-col items-center" data-testid="summary-hero">
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-[-24px] -z-10 h-[520px] w-[min(760px,100%)] -translate-x-1/2"
            style={{ background: `radial-gradient(closest-side, ${glow.color}${Math.round(glow.strength * 0.55 * 255).toString(16).padStart(2, "0")}, transparent 72%), radial-gradient(60% 45% at 50% 85%, ${accent}${Math.round((0.08 + level * 0.035) * 255).toString(16).padStart(2, "0")}, transparent 70%)` }} />
          <motion.div {...enter(0.05)} className="flex flex-col items-center" data-testid="summary-featured" data-card-id={featured.cardId}>
            <div data-testid="summary-card" data-hero="true" data-uid={featured.uid} data-card-id={featured.cardId} data-serial={featured.serial ?? ""}
              data-minted={featured.mintedVersion ?? ""} data-status={featured.status} data-rarity={featured.rarity} className="flex flex-col items-center">
              <Card3D mode="static" glow={glow.color} className="w-[300px]">
                <CardVisual uid={featured.uid} alt={`Carta de ${featured.cardId}`} chamfer="18px" className="w-[300px]">
                  <PlayerCard card={featured.card} size="lg" serial={featured.serial ?? undefined} interactive={false} />
                </CardVisual>
              </Card3D>
              <div className="mt-4 flex flex-col items-center gap-1.5">
                <p className="font-display text-[clamp(22px,3.4vw,30px)] font-bold uppercase leading-none tracking-[0.05em] text-white">
                  {featured.player?.nick ?? featured.cardId}<span className="nx-readout ml-2.5" style={{ color: glow.color }}>{featured.card.ovr}</span>
                </p>
                <p className="font-display text-label font-bold uppercase tracking-wide2" style={{ color: glow.color }}>
                  {getVariant(featured.card.variantId).label} · {featured.rarityLabel}
                </p>
                {featured.serialText && <p className="font-display text-label uppercase tracking-wide2 text-ink-secondary">{featured.serialText}</p>}
                <StatusBadge item={featured} size="md" />
                <p className="text-label text-ink-faint" title={summary.featuredCriterion}>Destacada · mayor OVR del sobre</p>
                <Link href={featured.href} className="nx-focus inline-flex min-h-[44px] items-center font-display text-label font-bold uppercase tracking-wide2 text-ink-secondary hover:text-white" aria-label={`Ver la carta ${featured.player?.nick ?? featured.cardId}`}>
                  Ver carta →
                </Link>
              </div>
            </div>
          </motion.div>
        </section>
      )}

      {/* ───────── 2 · EL RESTO DEL SOBRE ───────── */}
      {rest.length > 0 && (
        <section aria-label="Resto del sobre" className="mt-8">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
            <p className="nx-label">{featured ? "Resto del sobre" : "Todas las cartas"}</p>
            <span aria-hidden className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
          </div>
          {/* F81 · orden de presentación: la hero arriba y el resto por OVR descendente (las MISMAS cartas). */}
          <ul className="mt-4 grid grid-cols-2 justify-items-center gap-x-3 gap-y-5 sm:grid-cols-3 lg:flex lg:flex-wrap lg:justify-center lg:gap-x-6" data-testid="summary-cards">
            {rest.map((it, i) => (
              <motion.li
                key={it.uid}
                {...enter(0.25 + i * 0.07)}
                className="flex w-[150px] flex-col items-center lg:w-[178px]"
                data-testid="summary-card"
                data-uid={it.uid}
                data-card-id={it.cardId}
                data-serial={it.serial ?? ""}
                data-minted={it.mintedVersion ?? ""}
                data-status={it.status}
                data-rarity={it.rarity}
              >
                {/* En escritorio, la carta pequeña escala ×1,18 (mismo render, sin marcos nuevos); el margen compensa el alto. */}
                <div className="origin-top lg:mb-[38px] lg:scale-[1.18]">
                  <Card3D mode="static" className="w-[150px]">
                    <CardVisual uid={it.uid} alt={`Carta de ${it.cardId}`} chamfer="11px" className="w-[150px]">
                      <PlayerCard card={it.card} size="sm" serial={it.serial ?? undefined} interactive={false} />
                    </CardVisual>
                  </Card3D>
                </div>
                <Caption item={it} />
                <Link href={it.href} className="nx-focus inline-flex min-h-[44px] items-center font-display text-label font-bold uppercase tracking-wide2 text-ink-secondary hover:text-white" aria-label={`Ver la carta ${it.player?.nick ?? it.cardId}`}>
                  Ver carta →
                </Link>
              </motion.li>
            ))}
          </ul>
        </section>
      )}

      {/* ───────── 3 · PANEL SECUNDARIO ───────── */}
      <section aria-label="Resumen del sobre" className="nx-clip mx-auto mt-8 grid max-w-4xl gap-5 border border-white/[0.08] bg-black/30 p-4 sm:p-5 md:grid-cols-2" data-testid="summary-panel">
        <div className="min-w-0">
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Readout label="Cartas" value={String(summary.total)} />
            <Readout label="Nuevas" value={known ? String(summary.newCount) : "—"} accent="#3fc07a" />
            <Readout label="Duplic." title="Duplicadas" value={known ? String(summary.duplicateCount) : "—"} />
            <Readout label="Variantes" title="Nuevas variantes" value={known ? String(summary.newVariantCount ?? 0) : "—"} accent="#19e3ff" />
          </dl>
          <div className="mt-3 flex flex-wrap gap-2" data-testid="summary-moments">
            {summary.firstLegendary && <Moment tone="gold">Primera legendaria</Moment>}
            {summary.serialHighlight && (
              <Moment tone="gold">
                {summary.serialHighlight.prestige?.tier === "NUMBER_ONE" ? "Serial #1" : `Serial ${summary.serialHighlight.prestige?.label}`} · {summary.serialHighlight.player?.nick ?? summary.serialHighlight.cardId}
              </Moment>
            )}
            {summary.completedSets.map((s) => <Moment key={s.id} tone="ok">Set completado · {s.label}</Moment>)}
          </div>
          {summary.collection ? (
            <CollectionProgress delta={summary.collection} duplicates={summary.duplicateCount ?? 0} reduced={reduced} />
          ) : (
            <p className="mt-4 text-caption text-ink-muted" data-testid="summary-collection-unavailable">
              El progreso de tu colección no está disponible ahora mismo. Tus cartas ya están guardadas.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="nx-label">Sets actualizados</p>
          {summary.sets.length > 0 ? (
            <ul className="mt-2 space-y-1.5" data-testid="summary-sets" aria-label="Sets que avanzan">
              {summary.sets.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 border-b border-white/5 pb-1.5 text-caption">
                  <span className="min-w-0 truncate font-display font-bold uppercase tracking-wide text-white">{s.label}</span>
                  <span className="nx-readout shrink-0 text-ink-secondary">
                    {s.before}/{s.total} → <b className="text-white">{s.after}/{s.total}</b>{s.completed ? " · completado" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-caption text-ink-faint">Ningún set avanza con este sobre.</p>
          )}
        </div>
      </section>

      {/*
        4 · ACCIONES. Fase 44 · EL BUCLE SE CIERRA AQUÍ: dock PEGADO al pie del contenedor de la ceremonia (que es el que
        desplaza): ABRIR OTRO no puede quedar bajo el pliegue. ABRIR OTRO domina si queda de este sobre; si no, abrir los
        demás o ver sobres; IR A MI COLECCIÓN y JUGAR como secundarias. El resto, debajo.
      */}
      <div ref={dock} className={`${dockStatic ? "relative" : "sticky"} bottom-0 z-10 -mx-4 mt-8 px-4 pb-3 pt-8`} data-dock={dockStatic ? "static" : "sticky"} style={{ background: "linear-gradient(0deg, rgba(6,7,13,1) 62%, rgba(6,7,13,0))" }}>
        <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center" data-testid="summary-actions" data-motion-level="2">
          {available > 0 && onOpenAnother ? (
            <NxButton variant="primary" size="lg" onClick={onOpenAnother} data-testid="summary-open-another" data-cta="primary" className="!min-h-[60px] sm:min-w-[300px] !text-[18px]">
              Abrir otro sobre · {available}
            </NxButton>
          ) : (
            <NxButton variant="primary" size="lg" onClick={() => onNavigate(packsLeft > 0 ? "/inventario" : "/packs")} data-testid="summary-no-more" data-cta="primary" className="!min-h-[60px] sm:min-w-[260px] !text-[17px]">
              {packsLeft > 0 ? `Abrir mis sobres · ${packsLeft}` : "Ver sobres"}
            </NxButton>
          )}
          <div className="grid grid-cols-2 gap-2 bg-base-900 sm:flex">
            <NxButton variant="secondary" size="lg" onClick={() => onNavigate("/coleccion")} data-testid="summary-view-collection">
              Ir a mi colección
            </NxButton>
            <NxButton variant="secondary" size="lg" onClick={() => onNavigate("/jugar")} data-testid="summary-play">
              Jugar
            </NxButton>
          </div>
        </div>
        {available > 0 && (
          <p className="mt-2 text-center text-caption text-ink-faint">Te quedan {available} unidades de «{packName}» sin abrir.</p>
        )}
      </div>
      {(featured && onAddToDeck) || !noMore ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {featured && onAddToDeck && (
            <NxButton variant="secondary" size="md" onClick={() => onAddToDeck(featured)}>
              Añadir al equipo
            </NxButton>
          )}
          {/* «Volver a sobres» sobra cuando la acción principal ya es «Ver sobres». */}
          {!noMore && (
            <NxButton variant="tertiary" size="md" onClick={() => onNavigate("/packs")}>
              Volver a sobres
            </NxButton>
          )}
        </div>
      ) : null}

      {children}
    </div>
  );
}

function CollectionProgress({ delta, duplicates, reduced }: { delta: CollectionDelta; duplicates: number; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? delta.pctAfter : delta.pctBefore);
  useEffect(() => {
    if (reduced) { setShown(delta.pctAfter); return; }
    setShown(delta.pctBefore);
    const t = setTimeout(() => setShown(delta.pctAfter), 450);
    return () => clearTimeout(t);
  }, [delta.pctBefore, delta.pctAfter, reduced]);
  const gained = delta.gainedUnique;
  return (
    <div className="mt-4" data-testid="summary-collection" data-before={delta.uniqueBefore} data-after={delta.uniqueAfter} data-total={delta.catalogTotal}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="nx-label">Colección</p>
        <span className="font-display text-label font-bold uppercase tracking-wide text-drl-cyan">{pct(delta.pctBefore)} → {pct(delta.pctAfter)}</span>
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="nx-readout text-[17px] text-ink-secondary">{delta.uniqueBefore}</span>
        <span aria-hidden className="text-ink-faint">→</span>
        <span className="nx-readout text-[22px] text-white">{delta.uniqueAfter}</span>
        <span className="nx-readout text-[15px] text-white/60">/ {delta.catalogTotal}</span>
      </p>
      <Meter value={shown} tone="info" height={6} label={`Colección: de ${delta.uniqueBefore} a ${delta.uniqueAfter} de ${delta.catalogTotal} cartas distintas`} className="mt-1.5" />
      <p className="mt-1.5 text-caption text-ink-muted">
        {gained > 0
          ? `${gained === 1 ? "1 carta nueva" : `${gained} cartas nuevas`} en tu colección${duplicates > 0 ? ` y ${duplicates} ${duplicates === 1 ? "duplicada" : "duplicadas"}` : ""}.`
          : `Sin cartas nuevas: ${duplicates} ${duplicates === 1 ? "duplicada" : "duplicadas"}.`}
      </p>
    </div>
  );
}

/** Pie de carta: quién es, OVR, edición/rareza en TEXTO, serial y su estado (NUEVA / NUEVA VARIANTE / DUPLICADA ×N). */
function Caption({ item }: { item: RevealItem }) {
  const variant = getVariant(item.card.variantId);
  return (
    <div className="mt-1.5 flex w-full flex-col items-center gap-1 text-center">
      <p className="w-full truncate font-display text-caption font-bold uppercase tracking-wide text-white" title={item.player?.nick ?? item.cardId}>
        {item.player?.nick ?? item.cardId}
        <span className="nx-readout ml-1.5 text-ink-secondary">{item.card.ovr}</span>
      </p>
      <p className="w-full truncate font-display text-label uppercase tracking-wide2" style={{ color: variant.palette.primary }} title={`${variant.label} · ${item.rarityLabel}`}>
        {variant.label} · {item.rarityLabel}
      </p>
      {item.serialText && (
        <p className="font-display text-label uppercase tracking-wide2 text-ink-secondary">
          {item.serialText}{item.prestige ? ` · ${item.prestige.tier === "NUMBER_ONE" ? "#1" : item.prestige.label}` : ""}
        </p>
      )}
      <StatusBadge item={item} />
    </div>
  );
}

function Readout({ label, value, accent = "#ffffff", title }: { label: string; value: string; accent?: string; title?: string }) {
  return (
    <div title={title}>
      <dt className="nx-label truncate">{label}</dt>
      <dd className="nx-readout mt-0.5 text-[22px] leading-none" style={{ color: accent }}>{value}</dd>
    </div>
  );
}

function Moment({ tone, children }: { tone: "gold" | "ok" | "info"; children: ReactNode }) {
  const cls = tone === "gold" ? "border-drl-gold/60 bg-drl-gold/15 text-drl-gold" : tone === "ok" ? "border-[#3fc07a]/50 bg-[#3fc07a]/10 text-[#3fc07a]" : "border-drl-cyan/40 bg-drl-cyan/10 text-drl-cyan";
  return <span className={`nx-clip-sm border px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 ${cls}`}>{children}</span>;
}
