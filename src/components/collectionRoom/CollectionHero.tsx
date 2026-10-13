"use client";

/**
 * COLLECTION ROOM · CABECERA (Fase 37). No es un panel de KPIs: es la sala. El progreso del álbum (definiciones únicas,
 * nunca copias) con su barra, las copias y duplicadas, el serial más bajo y la carta de mayor OVR como objeto real.
 *
 * «Mayor OVR» se dice tal cual y con su criterio: OVR ↓ → rareza ↓ → serial ↑. Nada de «mejor carta» sin definir.
 *
 * FASE 44.1 · LA BÓVEDA. La cabecera es translúcida (se ve la bóveda del ambiente detrás) y la carta de mayor OVR se
 * expone como pieza de vitrina: cono de luz, pedestal y halo del color de su rareza, y un flotado lento (nada con
 * `prefers-reduced-motion`). Presentación pura: no cambia qué carta se elige ni ningún dato.
 */
import Link from "next/link";
import type { CardDef } from "@/domain/cards/types";
import type { CollectionSnapshot } from "@/domain/collection/room";
import { BUCKET_LABEL, cardHref, formatSerial } from "@/domain/collection/room";
import { getVariant } from "@/domain/cards/variants";
import { rarityOf } from "@/domain/collection/room";
import { getCard } from "@/data/catalog";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { Card3D } from "@/components/visual/Card3D";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";

const BUCKET_TONE = { legendary: "gold", epic: "key", rare: "info", uncommon: "ok", common: "muted" } as const;
/** Luz de vitrina por rareza (rgb). */
export const VAULT_LIGHT = { legendary: "255,211,92", epic: "190,120,255", rare: "25,227,255", uncommon: "63,192,122", common: "200,210,230" } as const;

export function CollectionHero({ snap, bestDef, mode, loading = false }: {
  snap: CollectionSnapshot;
  bestDef: CardDef | null;
  /** `server` = foto del servidor · `local` = modo local · `anon` = sin sesión (catálogo público). */
  mode: "server" | "local" | "anon";
  loading?: boolean;
}) {
  const lowest = snap.serials.lowest;
  const lowestDef = lowest ? bestDefFor(lowest.cardId) : null;
  return (
    <section aria-labelledby="collection-title" data-testid="collection-hero" className="nx-clip relative isolate overflow-hidden border border-white/10"
      style={{ background: "radial-gradient(900px 420px at 0% 110%, rgba(123,92,255,0.22), transparent 62%), radial-gradient(700px 380px at 100% -10%, rgba(25,227,255,0.12), transparent 60%), linear-gradient(160deg, rgba(12,15,26,0.70), rgba(6,8,14,0.84))" }}>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-25" />
      {/* F64 · en móvil la cabecera cede el sitio al álbum: menos alto, sin desglose por rareza, carta de vitrina menor. */}
      <div className="grid gap-5 px-5 py-5 sm:gap-6 sm:px-9 sm:py-9 lg:min-h-[440px] lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] lg:items-center">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-drl-cyan">Colección</span>
            <Badge tone={mode === "server" ? "ok" : "muted"} dot>{mode === "server" ? "Guardada en el servidor" : mode === "local" ? "Modo local" : "Catálogo público"}</Badge>
          </p>
          <h1 id="collection-title" className="mt-2 font-display text-[clamp(34px,6vw,64px)] font-bold uppercase leading-[0.92] text-white">
            {mode === "anon" ? "El álbum de NEXUS" : "Mi colección"}
          </h1>

          {mode === "anon" ? (
            // Sin sesión no hay colección que medir: se enseña el catálogo, no un «0 / 772» que parece tuyo.
            <div className="mt-5 max-w-xl" data-testid="collection-hero-public">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="nx-readout text-[clamp(30px,5vw,46px)] leading-none text-white">{snap.catalogTotal}</span>
                <span className="nx-readout text-[20px] text-white/60">cartas en el catálogo</span>
              </p>
              <p className="mt-2 text-body text-ink-muted">Inicia sesión para guardar tu colección y ver cuántas tienes.</p>
            </div>
          ) : (
          <div className="mt-5 max-w-xl">
            <p className="flex flex-wrap items-baseline gap-x-3" aria-live="polite">
              <span className="nx-readout text-[clamp(30px,5vw,46px)] leading-none text-white">{loading ? "…" : snap.uniqueOwned}</span>
              <span className="nx-readout text-[20px] text-white/60">/ {snap.catalogTotal} cartas</span>
              {!loading && <span className="font-display text-[15px] font-bold uppercase tracking-[0.08em] text-drl-cyan">{snap.completionPct.toLocaleString("es-ES", { minimumFractionDigits: 1 })} %</span>}
            </p>
            <Meter value={loading ? 0 : snap.completionPct} tone="info" height={10} label={`Álbum: ${snap.uniqueOwned} de ${snap.catalogTotal} cartas distintas`} className="mt-3" />
            {!loading && (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
                <Fact label="Copias" value={String(snap.totalCopies)} />
                <Fact label="Duplicadas" value={String(snap.duplicates)} />
                <Fact label="OVR más alto" value={snap.highestOvr !== null ? String(snap.highestOvr) : "—"} />
                <Fact label="Serial más bajo" value={lowest && lowestDef ? formatSerial(lowest.serial, getVariant(lowestDef.variantId).serialLimit) ?? "—" : "—"} />
              </dl>
            )}
          </div>
          )}

          <ul className="mt-5 hidden max-w-xl grid-cols-1 gap-1.5 sm:grid sm:grid-cols-2" data-mobile="hidden" aria-label={mode === "anon" ? "Cartas por rareza" : "Progreso por rareza"}>
            {snap.sets.rarity.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[12px]">
                <Badge tone={BUCKET_TONE[s.key as keyof typeof BUCKET_TONE] ?? "muted"} className="w-[104px] justify-center">{BUCKET_LABEL[s.key as keyof typeof BUCKET_LABEL] ?? s.label}</Badge>
                {mode === "anon"
                  ? <span className="nx-readout flex-1 text-right text-white/75">{s.total}</span>
                  : <>
                    <Meter value={s.pct} tone="info" height={5} label={`${s.label}: ${s.owned} de ${s.total}`} className="flex-1" />
                    <span className="nx-readout w-14 text-right text-white/75">{s.owned}/{s.total}</span>
                  </>}
              </li>
            ))}
          </ul>
        </div>

        {bestDef && snap.best && (() => {
          const light = VAULT_LIGHT[rarityOf(bestDef)];
          return (
            <figure className="nx-vault-stage relative mx-auto flex flex-col items-center gap-3 pb-2 lg:mx-0" data-testid="collection-best" data-rarity={rarityOf(bestDef)}
              style={{ ["--vault-rgb" as string]: light }}>
              {/* Cono de luz desde arriba y halo detrás de la pieza. */}
              <span aria-hidden className="nx-vault-cone pointer-events-none absolute -top-10 left-1/2 -z-10 h-[120%] w-[340px] -translate-x-1/2" />
              <span aria-hidden className="nx-vault-halo pointer-events-none absolute left-1/2 top-[38%] -z-10 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2" />
              <div className="nx-vault-float">
                <Link href={cardHref(bestDef.id)} className="nx-focus block" aria-label={`Tu carta de mayor OVR: ${bestDef.id}, OVR ${bestDef.ovr}. Abrir ficha`}>
                  <Card3D mode="hover" tilt={10} className="w-[140px] sm:w-[220px]">
                    <CardVisual uid={snap.best.uid} alt={`Carta ${bestDef.id}`} chamfer="12px" className="w-full">
                      <PlayerCard card={bestDef} size="md" interactive={false} serial={snap.best.serial ?? undefined} />
                    </CardVisual>
                  </Card3D>
                </Link>
              </div>
              {/* Pedestal: dos elipses con el borde encendido del color de la rareza. */}
              <svg aria-hidden viewBox="0 0 320 70" className="nx-vault-pedestal pointer-events-none -mt-6 h-[62px] w-[300px]">
                <ellipse cx="160" cy="22" rx="130" ry="16" fill={`rgba(${light},0.10)`} stroke={`rgba(${light},0.75)`} strokeWidth="1.5" />
                <ellipse cx="160" cy="22" rx="92" ry="10" fill="none" stroke={`rgba(${light},0.35)`} />
                <path d="M30 22v22c0 9 58 17 130 17s130-8 130-17V22" fill="rgba(6,8,14,0.85)" stroke={`rgba(${light},0.30)`} />
              </svg>
              <figcaption className="text-center">
                <span className="block font-display text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: `rgb(${light})` }}>Tu carta de mayor OVR</span>
                <span className="block text-caption text-ink-muted">OVR, después rareza y serial</span>
              </figcaption>
            </figure>
          );
        })()}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">{label}</dt>
      <dd className="nx-readout text-[18px] text-white">{value}</dd>
    </div>
  );
}

// El serial más bajo se enseña con el tope de SU variante: sin la definición no hay tope que citar.
const bestDefFor = (cardId: string) => getCard(cardId) ?? null;
