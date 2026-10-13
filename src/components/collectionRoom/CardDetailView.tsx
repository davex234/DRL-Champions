"use client";

/**
 * FICHA DE CARTA 3.0 (Fase 37). La carta como objeto: grande, girable (reverso NEXUS original), con sus stats de
 * combate, sus copias REALES con serial y prestigio visual, sus variantes, en qué sobres a la venta puede salir y qué
 * puedes hacer con ella (favorita, vitrina, equipo, comparar).
 *
 * Reglas: sin sesión no hay copias ni seriales; una carta no poseída no finge instancia; el serial no cambia stats;
 * no hay precio, valor, venta ni mercado; no se afirma de qué sobre salió ninguna copia; «puede salir en» no es garantía.
 */
import { useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import type { CardDef, Player } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import { canonicalCardTeam } from "@/data/teamIdentities";
import {
  BUCKET_LABEL, cardHref, compareHref, formatSerial, rarityOf, serialPrestige,
  type CardOwnership, type CollectionSetProgress, type DeckUsageFact, type PackAvailability, type PlayerVariantRow,
} from "@/domain/collection/room";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { cn } from "@/lib/format";
import { CardBack } from "./CardBack";
import { StatBars } from "./StatBars";

const BUCKET_TONE = { legendary: "gold", epic: "key", rare: "info", uncommon: "ok", common: "muted" } as const;
export const SHOWCASE_MAX = 3;

export interface CardDetailProps {
  def: CardDef;
  player: Player;
  access: "server" | "local" | "anon";
  loading?: boolean;
  offline?: boolean;
  ownership: CardOwnership | null;
  variants: { rows: PlayerVariantRow[]; owned: number; total: number };
  availability: PackAvailability[] | null;
  sets: { team: CollectionSetProgress | null; region: CollectionSetProgress | null };
  decks: DeckUsageFact[] | null;
  favorite: { available: boolean; active: boolean; busy?: boolean; onToggle?: () => void };
  showcase: { available: boolean; count: number; busy?: boolean; onAdd?: (uid: string) => void };
  onAddToDeck?: () => void;
  message?: string | null;
  initialFlipped?: boolean;
}

export function CardDetailView(p: CardDetailProps) {
  const { def, player, ownership, access } = p;
  const reduce = useReducedMotion();
  const [flipped, setFlipped] = useState(!!p.initialFlipped);
  const variant = getVariant(def.variantId);
  const rarity = rarityOf(def);
  const owned = !!ownership && ownership.count > 0;
  const rep = ownership?.instances[0] ?? null;
  const activeDeck = (p.decks ?? []).find((d) => d.active) ?? null;
  const teamCompareHref = access === "server" && activeDeck
    ? owned && rep
      ? activeDeck.cardUids.includes(rep.uid) ? null : `/duelos/mazos?deck=${activeDeck.id}&add=${rep.uid}`
      : `/duelos/mazos?deck=${activeDeck.id}&explorar=${encodeURIComponent(def.id)}`
    : null;
  const mutationsOff = access !== "server" || !!p.offline;
  const showcaseFull = p.showcase.count >= SHOWCASE_MAX;

  return (
    <article data-testid="card-detail" data-owned={owned ? "true" : "false"} className="grid gap-8 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
      {/* ── La carta ── */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-full max-w-[300px]" style={{ perspective: "1200px" }}>
          <div
            className="relative w-full"
            data-flipped={flipped ? "true" : "false"}
            style={{ transformStyle: "preserve-3d", transition: reduce ? "none" : "transform 600ms cubic-bezier(0.4,0,0.2,1)", transform: flipped ? "rotateY(180deg)" : "none" }}
          >
            <div style={{ backfaceVisibility: "hidden" }} aria-hidden={flipped}>
              <CardVisual uid={rep?.uid} alt={`Carta de ${player.nick}, ${variant.label}`} chamfer="16px" className="w-full">
                <PlayerCard card={def} size="lg" interactive={false} serial={rep?.serial ?? undefined} />
              </CardVisual>
            </div>
            <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }} aria-hidden={!flipped}>
              <CardBack def={def} player={player} />
            </div>
          </div>
        </div>
        <NxButton variant="secondary" size="md" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped} data-testid="card-flip">
          {flipped ? "Ver el anverso" : "Girar la carta"}
        </NxButton>
      </div>

      {/* ── La ficha ── */}
      <div className="min-w-0 space-y-6">
        <header>
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={BUCKET_TONE[rarity]}>{BUCKET_LABEL[rarity]}</Badge>
            <Badge tone="muted">{variant.label}</Badge>
            {access !== "anon" && (owned
              ? <Badge tone="ok" dot>{ownership!.count > 1 ? `En tu colección · ×${ownership!.count}` : "En tu colección"}</Badge>
              : <Badge tone="warn">No conseguida</Badge>)}
            {ownership && ownership.showcaseUids.length > 0 && <Badge tone="gold">En tu vitrina</Badge>}
            {ownership?.inActiveDeck && <Badge tone="info">En tu equipo activo</Badge>}
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="break-words font-display text-[clamp(34px,6vw,58px)] font-bold uppercase leading-[0.92] text-white">{player.nick}</h1>
              <p className="mt-1 text-body text-ink-muted">{canonicalCardTeam(def, player).label} · {def.role ?? player.role} · {player.region}</p>
            </div>
            <p className="text-right">
              <span className="block font-display text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">OVR</span>
              <span className="nx-readout text-[46px] leading-none text-white">{def.ovr}</span>
            </p>
          </div>
        </header>

        <section aria-labelledby="stats-title">
          <h2 id="stats-title" className="mb-2 font-display text-[14px] font-bold uppercase tracking-[0.12em] text-white/70">Stats de combate</h2>
          <StatBars def={def} />
        </section>

        {/* Acciones */}
        <div className="flex flex-wrap gap-2.5" data-testid="card-actions">
          {access === "server" && (
            <NxButton variant={p.favorite.active ? "primary" : "secondary"} size="md" onClick={p.favorite.onToggle}
              disabled={mutationsOff || !p.favorite.available || p.favorite.busy} aria-pressed={p.favorite.active}
              aria-label={p.favorite.active ? "Quitar de favoritos" : "Añadir a favoritos"} data-testid="card-favorite">
              <span aria-hidden>{p.favorite.active ? "★" : "☆"}</span> {p.favorite.available ? (p.favorite.active ? "Favorita" : "Favorito") : "Favoritos no disponibles"}
            </NxButton>
          )}
          {owned && access !== "anon" && p.onAddToDeck && (
            <NxButton variant="secondary" size="md" onClick={p.onAddToDeck} disabled={!!p.offline} data-testid="card-add-deck">Añadir al equipo</NxButton>
          )}
          <NxButton variant="secondary" size="md" href={compareHref(def.id)} data-testid="card-compare-link">Comparar</NxButton>
          {/* Fase 43 · comparar para tu equipo activo: si es tuya, con opción de cambio en el constructor; si no, solo informativo. */}
          {teamCompareHref && def.combat && (
            <NxButton variant="secondary" size="md" href={teamCompareHref} data-testid="card-team-compare" data-actionable={owned}>
              {owned ? "Comparar para equipo" : "Comparar con mi equipo"}
            </NxButton>
          )}
          <NxButton variant="tertiary" size="md" href={`/coleccion?q=${encodeURIComponent(player.nick.toLowerCase())}`}>Ver en el álbum</NxButton>
        </div>
        {p.message && <p role="status" className="text-caption text-warn">{p.message}</p>}
        {p.offline && access === "server" && <p role="status" className="text-caption text-warn">Sin conexión: favoritos, vitrina y equipos vuelven cuando recuperes la red.</p>}

        {/* Tus copias */}
        {access === "anon" ? (
          <p className="nx-clip-sm border border-white/10 bg-black/25 p-4 text-body text-ink-muted">
            <Link href="/cuenta" className="nx-focus inline-flex min-h-[44px] items-center text-drl-cyan underline-offset-2 hover:underline">Inicia sesión</Link> para ver tus copias, sus números de serie y añadirla a tu equipo.
          </p>
        ) : (
          <section aria-labelledby="copies-title" data-testid="card-copies">
            <h2 id="copies-title" className="mb-2 font-display text-[14px] font-bold uppercase tracking-[0.12em] text-white/70">
              {p.loading ? "Tus copias…" : owned ? `Tus copias · ${ownership!.count}` : "Tus copias"}
            </h2>
            {!owned ? (
              <p className="text-body text-ink-muted">{p.loading ? "Leyendo tu colección…" : "Todavía no tienes ninguna copia de esta carta."}</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {ownership!.instances.map((inst, i) => {
                    const serial = formatSerial(inst.serial, variant.serialLimit);
                    const prestige = serialPrestige(inst.serial);
                    const inShowcase = ownership!.showcaseUids.includes(inst.uid);
                    const deckNames = (p.decks ?? []).filter((d) => d.cardUids.includes(inst.uid)).map((d) => (d.active ? `${d.name} (activo)` : d.name));
                    return (
                      <li key={inst.uid} data-serial={inst.serial ?? ""} className="nx-clip-sm flex flex-wrap items-center justify-between gap-2 border border-white/10 bg-black/25 px-3 py-2.5">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="nx-readout text-[16px] text-white">{serial ?? `Copia ${i + 1}`}</span>
                          {!serial && <span className="text-caption text-ink-muted">Sin número de serie</span>}
                          {prestige && <Badge tone="gold">{prestige.label}</Badge>}
                          {inShowcase && <Badge tone="gold">En vitrina</Badge>}
                          {deckNames.length > 0 && <span className="text-caption text-ink-muted">En {deckNames.join(", ")}</span>}
                        </span>
                        {access === "server" && p.showcase.available && !inShowcase && (
                          showcaseFull
                            ? <Link href="/jugador/me?editar=1" className="nx-focus inline-flex min-h-[44px] items-center text-caption text-drl-cyan hover:underline">Vitrina llena · editar en tu perfil</Link>
                            : <NxButton variant="tertiary" size="md" disabled={mutationsOff || p.showcase.busy} onClick={() => p.showcase.onAdd?.(inst.uid)}>Poner en vitrina</NxButton>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-caption text-ink-muted">El número de serie es prestigio: no cambia las stats ni da recompensas.</p>
                {p.decks && <p className="mt-1 text-caption text-ink-muted">{ownership!.deckIds.length === 0 ? "No la usas en ningún equipo." : `Usada en ${ownership!.deckIds.length} ${ownership!.deckIds.length === 1 ? "equipo" : "equipos"}${ownership!.inActiveDeck ? ", incluido tu equipo activo" : ""}.`}</p>}
              </>
            )}
          </section>
        )}

        {/* Variantes del jugador */}
        <section aria-labelledby="variants-title" data-testid="card-variants">
          <h2 id="variants-title" className="mb-2 font-display text-[14px] font-bold uppercase tracking-[0.12em] text-white/70">
            Variantes de {player.nick}{access !== "anon" ? ` · ${p.variants.owned}/${p.variants.total}` : ` · ${p.variants.total}`}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {p.variants.rows.map((r) => (
              <li key={r.cardId}>
                <Link href={cardHref(r.cardId)} aria-current={r.cardId === def.id ? "page" : undefined}
                  aria-label={`${r.label}, OVR ${r.ovr}${access !== "anon" ? (r.owned ? `, la tienes${r.count > 1 ? ` ×${r.count}` : ""}` : ", no conseguida") : ""}`}
                  className={cn("nx-focus nx-clip-sm inline-flex min-h-[44px] items-center gap-2 border px-3 text-[13px]",
                    r.cardId === def.id ? "border-drl-cyan/60 bg-drl-cyan/10 text-white" : "border-white/10 bg-black/25 text-white/80 hover:border-white/30")}>
                  <span>{r.label}</span><span className="nx-readout">{r.ovr}</span>
                  {access !== "anon" && <span className="text-[11px] text-white/55">{r.owned ? (r.count > 1 ? `×${r.count}` : "✓") : "—"}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Sets a los que pertenece */}
        {(p.sets.team || p.sets.region) && access !== "anon" && (
          <section aria-labelledby="sets-title" className="grid gap-2 sm:grid-cols-2" data-testid="card-sets">
            <h2 id="sets-title" className="sr-only">Sets de esta carta</h2>
            {[p.sets.team, p.sets.region].filter((s): s is CollectionSetProgress => !!s).map((s) => (
              <div key={s.id} className="nx-clip-sm border border-white/10 bg-black/25 p-3">
                <p className="flex items-center justify-between gap-2 text-[13px]"><span className="font-semibold text-white">{s.label}</span><span className="nx-readout text-white/75">{s.owned}/{s.total}</span></p>
                <Meter value={s.pct} tone={s.complete ? "ok" : s.near ? "gold" : "info"} height={5} label={`${s.label}: ${s.owned} de ${s.total}`} className="mt-1.5" />
              </div>
            ))}
          </section>
        )}

        {/* Dónde puede salir */}
        {p.availability && (
          <section aria-labelledby="packs-title" data-testid="card-availability">
            <h2 id="packs-title" className="mb-2 font-display text-[14px] font-bold uppercase tracking-[0.12em] text-white/70">Dónde puede salir</h2>
            {p.availability.length === 0 ? (
              <p className="text-body text-ink-muted">Ahora mismo no entra en ningún sobre a la venta.</p>
            ) : (
              <>
                <p className="text-body text-ink-muted">Puede salir en {p.availability.length === 1 ? "este sobre" : `estos ${p.availability.length} sobres`} a la venta. No es una garantía: depende del sorteo de cada sobre.</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {p.availability.slice(0, 8).map((a) => <li key={a.packId}><Badge tone="muted">{a.name}</Badge></li>)}
                  {p.availability.length > 8 && <li><Badge tone="muted">+{p.availability.length - 8} más</Badge></li>}
                </ul>
                <NxButton variant="tertiary" size="md" href="/packs" className="mt-2">Ver sobres</NxButton>
              </>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
