"use client";

/**
 * COLLECTION ROOM 3.0 · PANTALLA (Fase 37). La sala entera a partir de un modelo (`CollectionRoomModel`) y una consulta:
 * la ruta `/coleccion` la conecta a la sesión y a la URL; el arnés QA la conecta a fotos QA SYNTHETIC. Una sola pantalla.
 *
 * Cabecera con el álbum (definiciones únicas, nunca copias) y la carta de mayor OVR; formas de descubrir (favoritas y
 * mayor OVR); y el álbum con búsqueda, filtros y orden. LIMPIEZA DE /COLECCION (2026-10-07): solo cartas — el libro de
 * sets, «Casi completos», Maestría y objetivos salen de aquí; los sets viven en la Sala de Trofeos (enlace de abajo). Buscar y filtrar no piden nada al servidor. Rendimiento:
 * rejilla paginada de 48 en 48, `Card3D` estático; la profundidad se reserva para la cabecera y la ficha.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { BUCKET_LABEL, rarityOf } from "@/domain/collection/room";
import {
  DEFAULT_QUERY, OWNERSHIP_LABEL, SORTS, SORT_LABEL, activeFilterCount, runCollectionQuery, serializeCollectionQuery,
  type CollectionQuery, type CollectionSort, type OwnershipFilter,
} from "@/domain/collection/query";
import { AlbumEmpty, AlbumGrid, AlbumNoResults, type AlbumCard } from "@/components/album/AlbumGrid";
import { Segmented } from "@/components/ui/Segmented";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { CollectionHero } from "./CollectionHero";
import { CollectionDiscovery } from "./CollectionDiscovery";
import { CollectionFilters } from "./CollectionFilters";
import { CollectionCoach } from "@/components/journey/CollectionCoach";
import { OnboardingCollectionCoach } from "@/components/onboarding/OnboardingCollectionCoach";
import type { OnboardingView } from "@/domain/onboarding";
import type { CollectionRoomModel } from "./roomModel";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("collectionRoom");

/** Cartas por tanda: la rejilla nunca monta el catálogo entero de golpe. */
const COLLECTION_PAGE = 48;
const SEARCH_DEBOUNCE_MS = 250;

export interface CollectionRoomScreenProps {
  room: CollectionRoomModel;
  query: CollectionQuery;
  onQuery: (q: CollectionQuery) => void;
  onOpen: (cardId: string) => void;
  /** Sobres sin abrir (para el estado vacío). */
  packs?: number;
  /** Pestaña «Forja» (pieza existente). */
  forge?: ReactNode;
  /**
   * F63 · guía de la primera sesión (servidor). `undefined` = sin sesión o sin leer: comportamiento anterior (coach F40).
   * `null` o completada: ningún coach (la guía no se queda pegada tras terminarla o saltarla).
   */
  onboarding?: OnboardingView | null;
}

export function CollectionRoomScreen({ room, query, onQuery, onOpen, packs = 0, forge, onboarding }: CollectionRoomScreenProps) {
  useLocale();
  // Búsqueda con retardo: la URL no cambia por cada tecla.
  const [text, setText] = useState(query.q);
  useEffect(() => { setText(query.q); }, [query.q]);
  useEffect(() => {
    if (text === query.q) return;
    const id = window.setTimeout(() => onQuery({ ...query, q: text }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [text, query, onQuery]);

  const [view, setView] = useState<"cartas" | "forja">("cartas");
  const [panel, setPanel] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState(COLLECTION_PAGE);
  const albumRef = useRef<HTMLElement>(null);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const queryKey = serializeCollectionQuery(query);
  useEffect(() => { setShown(COLLECTION_PAGE); }, [queryKey]);

  const results = useMemo(() => runCollectionQuery(room.engine.views(), query, room.aliasesOf), [room.engine, query, room.aliasesOf]);
  const visible = results.slice(0, shown);
  const albumCards: AlbumCard[] = useMemo(() => visible.flatMap((v) => {
    const def = getCard(v.cardId);
    if (!def) return [];
    const own = room.snap.byCard.get(v.cardId);
    const rep = own?.instances[0];
    const rarity = BUCKET_LABEL[rarityOf(def)];
    const state = room.access === "anon" ? "" : own ? tr(", la tienes{v}", { v: own.count > 1 ? ` ×${own.count}` : "" }) : tr(", no conseguida");
    return [{
      cardId: v.cardId, def, owned: room.access === "anon" ? true : !!own, count: own?.count ?? 0, serial: rep?.serial ?? undefined, uid: rep?.uid,
      favorite: own?.favorite, inShowcase: (own?.showcaseUids.length ?? 0) > 0, inActiveDeck: own?.inActiveDeck,
      label: tr("{nick}, OVR {ovr}, {rarity}, {label}{state}. Abrir ficha", { nick: v.nick, ovr: v.ovr, rarity: td(rarity), label: td(getVariant(def.variantId).label), state: td(state) }),
    }];
  }), [visible, room.snap, room.access]);

  const bestDef = room.snap.best ? getCard(room.snap.best.cardId) ?? null : null;
  const favoriteDefs = useMemo(() => room.snap.favorites.map((id) => getCard(id)).filter((d): d is NonNullable<typeof d> => !!d && room.snap.byCard.has(d.id)), [room.snap]);
  const topOwned = useMemo(() => [...room.snap.byCard.keys()].map((id) => getCard(id)).filter((d): d is NonNullable<typeof d> => !!d)
    .sort((a, b) => b.ovr - a.ovr || getVariant(b.variantId).rank - getVariant(a.variantId).rank || a.id.localeCompare(b.id)).slice(0, 8), [room.snap]);

  const openFilters = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches) setSheet(true);
    else setPanel((p) => !p);
  };
  const closeSheet = useCallback(() => { setSheet(false); filtersButton.current?.focus(); }, []);
  const filters = activeFilterCount(query);
  const clear = () => { setText(""); onQuery({ ...DEFAULT_QUERY, sort: query.sort }); };

  return (
    <div className="space-y-6" data-testid="collection-room" data-access={room.access}>
      {room.access === "server" && room.stale && (
        <p role="status" className="nx-clip-sm border border-warn/40 bg-warn/[0.08] px-4 py-2 text-caption text-warn" data-testid="collection-offline">
          {room.offline ? tr("Sin conexión: enseñamos tu colección tal como la teníamos. Favoritos, vitrina y equipos vuelven con la red.") : tr("El servidor no ha respondido: enseñamos la última foto de tu colección.")}
        </p>
      )}

      <CollectionHero snap={room.snap} bestDef={bestDef} mode={room.access} loading={room.loading} />
      {/* Fase 40 · primera sesión: un solo bloque, arriba, mientras tiene cartas y aún no ha guardado ningún equipo. */}
      {/* F63 · con la guía leída manda la guía: su bloque mientras está activa; ninguno después. */}
      {onboarding?.active && onboarding.current !== "welcome" && onboarding.current !== "open" && <OnboardingCollectionCoach view={onboarding} />}
      {onboarding === undefined && room.access !== "anon" && !room.loading && room.snap.uniqueOwned > 0 && room.snap.decksCount === 0 && (
        <CollectionCoach cardIds={[...room.snap.byCard.keys()]} packs={packs} onShowOwned={query.own === "owned" ? undefined : () => onQuery({ ...query, own: "owned" })} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label={tr("Vista de la colección")} value={view} onChange={setView} options={[{ value: "cartas", label: tr("Cartas") }, { value: "forja", label: tr("Forja") }]} />
        <div className="flex flex-wrap items-center gap-4">
          {/* F82 · la Sala de Trofeos: colecciones de equipo/edición con progreso real e insignias. */}
          {room.access !== "anon" && <Link href="/coleccion/trofeos" data-testid="trophy-room-link" className="nx-focus inline-flex min-h-[44px] items-center font-display text-label font-bold uppercase tracking-wide2 text-[#ffce4f] hover:text-white">{tr("Sala de Trofeos →")}</Link>}
          <Link href="/coleccion/equipos" className="nx-focus inline-flex min-h-[44px] items-center font-display text-label font-bold uppercase tracking-wide2 text-ink-secondary hover:text-white">{tr("Por equipo →")}</Link>
        </div>
      </div>

      {view === "forja" && forge}

      {view === "cartas" && (
        <>
          {room.access !== "anon" && (
            <CollectionDiscovery favorites={favoriteDefs} topOwned={topOwned} />
          )}

          <section ref={albumRef} aria-labelledby="album-title" data-testid="collection-album" className="scroll-mt-24">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 id="album-title" className="font-display text-[22px] font-bold uppercase tracking-[0.04em] text-white">{tr("Álbum")}</h2>
              <p className="text-caption text-ink-muted" aria-live="polite"><span className="nx-readout text-white">{results.length}</span> {results.length === 1 ? tr("carta") : tr("cartas")}</p>
            </div>

            <div className="nx-clip-sm mb-4 border border-white/10 bg-black/25 p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="flex min-h-[44px] min-w-[200px] flex-1 items-center gap-2 border border-white/15 bg-black/30 px-3">
                  <span aria-hidden className="text-ink-faint">⌕</span>
                  <span className="sr-only">{tr("Buscar por jugador, equipo o carta")}</span>
                  <input value={text} onChange={(e) => setText(e.target.value.slice(0, 48))} placeholder={tr("Buscar jugador o equipo…")} data-testid="collection-search"
                    className="nx-focus min-h-[44px] w-full bg-transparent text-body text-white placeholder:text-ink-faint focus:outline-none" />
                  {text && <button type="button" onClick={() => setText("")} aria-label={tr("Borrar la búsqueda")} className="nx-focus min-h-[44px] px-1 text-ink-muted hover:text-white">✕</button>}
                </label>
                {room.access !== "anon" && (
                  <Segmented<OwnershipFilter> label={tr("Estado de la carta")} value={query.own} onChange={(own) => onQuery({ ...query, own })}
                    options={(["all", "owned", "missing"] as OwnershipFilter[]).map((o) => ({ value: o, label: OWNERSHIP_LABEL[o] }))} />
                )}
                <label className="flex min-h-[44px] items-center gap-2 text-caption text-ink-muted">
                  <span>{tr("Orden")}</span>
                  <select value={query.sort} onChange={(e) => onQuery({ ...query, sort: e.target.value as CollectionSort })} data-testid="collection-sort"
                    className="nx-focus min-h-[44px] border border-white/15 bg-black/40 px-2 text-[14px] text-white">
                    {SORTS.map((s) => <option key={s} value={s}>{td(SORT_LABEL[s])}</option>)}
                  </select>
                </label>
                <NxButton ref={filtersButton} variant={panel || filters > 0 ? "primary" : "secondary"} size="md" onClick={openFilters} aria-expanded={panel || sheet} data-testid="collection-filters-toggle">
                  {tr("Filtros")} {filters > 0 && <span className="nx-readout">{filters}</span>}
                </NxButton>
              </div>
              {(filters > 0 || query.q) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2.5">
                  {query.q && <Badge tone="info">{tr("Buscando «{query}»", { query: query.q })}</Badge>}
                  {query.own !== "all" && <Badge tone="key">{td(OWNERSHIP_LABEL[query.own])}</Badge>}
                  {[...query.rarity.map((r) => BUCKET_LABEL[r]), ...query.role, ...query.region, ...query.team.map((k) => room.teamOptions.find((t) => t.key === k)?.label ?? k), ...(query.dup ? [tr("Duplicadas")] : []), ...(query.fav ? [tr("Favoritas")] : []), ...(query.minOvr !== null ? [`OVR ≥ ${query.minOvr}`] : []), ...(query.maxOvr !== null ? [`OVR ≤ ${query.maxOvr}`] : [])]
                    .map((label) => <Badge key={label} tone="muted">{td(label)}</Badge>)}
                  <button type="button" onClick={clear} className="nx-focus ml-auto inline-flex min-h-[44px] items-center font-display text-label uppercase tracking-wide2 text-ink-muted hover:text-white">{tr("Limpiar")}</button>
                </div>
              )}
              {panel && <div className="hidden sm:block"><CollectionFilters variant="panel" query={query} onChange={onQuery} teams={room.teamOptions} favoritesAvailable={room.snap.favoritesAvailable} matched={results.length} /></div>}
            </div>
            {sheet && <CollectionFilters variant="sheet" query={query} onChange={onQuery} teams={room.teamOptions} favoritesAvailable={room.snap.favoritesAvailable} matched={results.length} onClose={closeSheet} />}

            {room.access !== "anon" && !room.loading && room.snap.uniqueOwned === 0 && filters === 0 && !query.q && <AlbumEmpty packs={packs} />}
            {results.length === 0 ? (
              <AlbumNoResults onClear={clear} />
            ) : (
              <AlbumGrid cards={albumCards} onOpen={onOpen} remaining={Math.max(0, results.length - shown)} onMore={() => setShown((n) => n + COLLECTION_PAGE)} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
