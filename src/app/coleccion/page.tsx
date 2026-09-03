"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardViewer, type CardViewerAction } from "@/components/cards/CardViewer";
import { Card3D, card3DStagger } from "@/components/visual/Card3D";
import { ForgePanel } from "@/components/craft/ForgePanel";
import { useGameStore } from "@/store/useGameStore";
import { useMarketStore } from "@/store/useMarketStore";
import { useRosterStore } from "@/store/useRosterStore";
import { getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { groupCollection } from "@/store/selectors";
import { regionCollections, collectionProgress } from "@/domain/collections";
// COLLECTION ENGINE (Consolidation F1.1): la pantalla ya no recalcula filtros/orden a mano;
// proyecta, filtra y ordena con el motor de colección (fuente única de esa lógica).
import { CollectionEngine, applyFilter, sortViews, progress as engineProgress, type SortSpec } from "@/collection";
import { instanceValue, quickSellValue, marketValue } from "@/domain/economy/pricing";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/format";
import type { Region, VariantGroup } from "@/domain/cards/types";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchMastery, type MasteryView } from "@/lib/game/mastery";
import { MasteryPanel } from "@/components/collection/MasteryPanel";
import { fetchPrestige, type PrestigeView } from "@/lib/game/prestige";
import { PrestigePanel } from "@/components/collection/PrestigePanel";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";

const REGIONS: (Region | "Todas")[] = ["Todas", "EMEA", "Americas", "Pacific", "China"];
const GROUPS: { id: VariantGroup | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "base", label: "Base" },
  { id: "regional", label: "Regional" },
  { id: "winner", label: "Ganadores" },
  { id: "mvp", label: "MVP" },
  { id: "internacional", label: "Internacional" },
  { id: "exclusiva", label: "Exclusivas" },
];
type Ownership = "todas" | "owned" | "missing";

/**
 * Cartas por tanda.
 *
 * Eran 60. Con el arte nuevo cada carta trae su emblema en SVG, y sesenta emblemas
 * empujaban el documento por encima de los 4.000 nodos que vigila `ux:verify` —el punto
 * a partir del cual el desplazamiento se nota en un móvil de gama media—. 48 siguen
 * llenando de sobra una pantalla de 1920 y dejan margen para el arte.
 */
const PAGE = 48;
type SortKey = "ovr" | "rarity" | "name";

export default function ColeccionPage() {
  return (
    <HydrationGate>
      <Collection />
    </HydrationGate>
  );
}

function Collection() {
  const { user } = useAuth();
  const online = isSupabaseConfigured() && !!user;
  const ownedCards = useGameStore((s) => s.ownedCards);
  const rosterVersion = useRosterStore((s) => s.version);
  // El motor proyecta catálogo+propiedad a CardViews (cache interna). rosterVersion fuerza
  // reconstrucción cuando el catálogo vivo (CARDS) cambia tras un sync de roster.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => new CollectionEngine(ownedCards), [ownedCards, rosterVersion]);
  const stats = useMemo(() => engineProgress(engine.registry, engine.ownership()), [engine]);
  const ownedIds = useMemo(() => new Set(ownedCards.map((o) => o.cardId)), [ownedCards]);
  const collections = useMemo(() => regionCollections(), [rosterVersion]);

  /*
   * MAESTRIA (Fase 13). Se pide al servidor y se recarga a mano despues de cobrar: el
   * progreso lo cuenta `services/mastery` contra `user_cards`, que es donde vive la
   * propiedad. Calcularlo aqui con el inventario local ensenaria insignias cobrables que
   * el servidor rechazaria.
   *
   * Falla en silencio: la coleccion no puede quedarse en blanco porque una capa de
   * objetivos no haya llegado.
   */
  const { toast, notify } = useToast();
  const [mastery, setMastery] = useState<MasteryView | null>(null);
  const [prestige, setPrestige] = useState<PrestigeView | null>(null);

  /*
   * Las dos van juntas: cobrar una insignia cambia lo que se puede prestigiar, y comprar
   * un escalon cambia el saldo que la vitrina ensena. Recargar solo una dejaria la otra
   * mintiendo hasta el siguiente refresco.
   */
  const reloadMastery = useCallback(() => {
    if (!online) { setMastery(null); setPrestige(null); return; }
    fetchMastery().then(setMastery).catch(() => setMastery(null));
    fetchPrestige().then(setPrestige).catch(() => setPrestige(null));
  }, [online]);
  useEffect(() => { reloadMastery(); }, [reloadMastery]);

  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region | "Todas">("Todas");
  const [group, setGroup] = useState<VariantGroup | "todos">("todos");
  const [ownership, setOwnership] = useState<Ownership>("todas");
  const [sort, setSort] = useState<SortKey>("rarity");
  const [detailId, setDetailId] = useState<string | null>(null);
  // FORJA (Consolidation F1.1): el Craft Engine, por fin accesible desde la colección.
  const [view, setView] = useState<"cartas" | "forja">("cartas");

  const filtered = useMemo(() => {
    const views = applyFilter(engine.views(), {
      text: query.trim() || undefined,
      regions: region !== "Todas" ? [region] : undefined,
      groups: group !== "todos" ? [group] : undefined,
      owned: ownership === "owned" ? true : ownership === "missing" ? false : undefined,
      includeHidden: true, // la rejilla muestra también las no poseídas (en gris)
    });
    const spec: SortSpec =
      sort === "ovr" ? { key: "ovr", dir: "desc" }
      : sort === "rarity" ? { key: "rank", dir: "desc" }
      : { key: "name", dir: "asc" };
    const sorted = sortViews(views, spec);

    /*
     * Las cartas EN POSESIÓN van primero. Con el orden por rareza —el de por defecto—
     * la rejilla abría con una pared de cartas bloqueadas, así que quien acababa de
     * abrir un sobre no encontraba su carta sin desplazarse. El criterio elegido sigue
     * mandando dentro de cada grupo: solo se separan las que tienes de las que faltan.
     */
    return [...sorted.filter((v) => v.owned), ...sorted.filter((v) => !v.owned)];
  }, [engine, query, region, group, ownership, sort]);

  /*
   * PAGINADO INCREMENTAL (Fase 9J).
   *
   * El catálogo tiene 772 cartas y la rejilla las pintaba TODAS: 17.500 nodos en el DOM,
   * que en un móvil de gama media se nota al desplazarse y al filtrar. Se pintan 60 y el
   * resto llega al pulsar. No es virtualización —la posición de scroll no se recicla—, pero
   * resuelve el problema real con veinte líneas en vez de una librería.
   *
   * El contador se reinicia al cambiar cualquier filtro: si no, al pasar de «Todas» a
   * «Faltan» se seguirían enseñando 400 cartas de una lista que ahora tiene 30.
   */
  const [showFilters, setShowFilters] = useState(false);
  /** Cuántos filtros se apartan de «todo»: se enseña en el botón cuando está plegado. */
  const activeFilters =
    (region !== "Todas" ? 1 : 0) + (group !== "todos" ? 1 : 0) + (ownership !== "todas" ? 1 : 0);

  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setShown(PAGE); }, [query, region, group, ownership, sort]);
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);

  return (
    <section className="animate-rise">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* Misma jerarquía de cabecera que el resto del producto tras la Fase 9A. */}
          <span className="nx-label">Colección</span>
          <h1 className="mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
            Mis cartas
          </h1>
          <p className="mt-2 text-[15px] text-white/55">
            {stats.distinct} de {stats.total} cartas · {stats.percent}% completado
          </p>
          {/* De dónde salen estas cartas: sin esto, la colección parece un dato local. */}
          <p className="mt-1 text-[13px] text-white/35">
            {online
              ? "Tus cartas están guardadas en el servidor, con su número de serie."
              : "Modo local: estas cartas se guardan solo en este dispositivo."}
          </p>
        </div>
        <div className="w-full max-w-xs">
          <div className="mb-1 flex justify-between text-[10px] uppercase tracking-widest text-white/40">
            <span>Progreso</span>
            <span className="text-drl-cyan">{stats.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-drl-cyan to-drl"
              style={{ width: `${stats.percent}%` }}
            />
          </div>
        </div>
      </header>

      {/* Pestañas Colección / Forja */}
      <div className="mb-5 flex gap-1.5">
        <Chip active={view === "cartas"} onClick={() => setView("cartas")}>📚 Cartas</Chip>
        <Chip active={view === "forja"} onClick={() => setView("forja")}>⚒️ Forja</Chip>
      </div>

      {view === "forja" && <ForgePanel />}

      {view === "cartas" && (<>


      {/*
        Filtros PLEGADOS por defecto. Las dos filas de píldoras siempre desplegadas
        empujaban la rejilla otros 120 px y hacían que la pantalla se leyera como una tabla
        con filtros. El buscador y el orden se quedan siempre a la vista, que es lo que se
        usa el 90 % de las veces; el resto se abre a petición.
      */}
      <div className="mb-5 space-y-3 rounded-panel border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar jugador o equipo…"
            className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none"
          >
            <option value="rarity">Rareza ↓</option>
            <option value="ovr">OVR ↓</option>
            <option value="name">Nombre A-Z</option>
          </select>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-control border border-white/12 px-3.5 font-display text-[12px] font-bold uppercase tracking-wide text-white/70 transition duration-fast hover:bg-white/[0.06]"
          >
            Filtros
            <span aria-hidden className={cn("transition-transform duration-fast", showFilters && "rotate-180")}>▾</span>
            {activeFilters > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-drl px-1 text-[9px] font-bold tabular-nums text-white">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <>
        <div className="flex flex-wrap gap-1.5">
          {REGIONS.map((r) => (
            <Chip key={r} active={region === r} onClick={() => setRegion(r)}>
              {r}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GROUPS.map((g) => (
            <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </Chip>
          ))}
          <span className="mx-1 w-px self-stretch bg-white/10" />
          <Chip active={ownership === "todas"} onClick={() => setOwnership("todas")}>
            Todas
          </Chip>
          <Chip active={ownership === "owned"} onClick={() => setOwnership("owned")}>
            En posesión
          </Chip>
          <Chip active={ownership === "missing"} onClick={() => setOwnership("missing")}>
            Faltan
          </Chip>
        </div>
          </>
        )}
      </div>

      {/* Rejilla */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-white/40">No hay cartas con estos filtros.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {/*
            La rejilla usa `Card3D` en modo `static` (Fase 9.6). Antes dibujaba a mano su
            hover, su candado (un emoji del sistema encima del arte) y su contador de
            duplicados; el mismo objeto tenía tres tratamientos distintos segun la pantalla.
            El modo estatico NO monta framer-motion, asi que el presupuesto de nodos que la
            Fase 9.5 dejo al limite en esta pantalla no se mueve.
          */}
          {visible.map((v, i) => {
            const def = getCard(v.cardId);
            if (!def) return null;
            return (
              <Card3D
                key={v.cardId}
                mode="static"
                status={v.owned ? undefined : "locked"}
                count={v.count}
                delay={card3DStagger(i, 0.012, 0.28)}
                label={v.owned ? `Ver ${def.id}` : `${def.id} — todavía no la tienes`}
                onClick={() => setDetailId(v.cardId)}
                disabled={!v.owned}
              >
                <PlayerCard
                  card={def}
                  size="sm"
                  interactive={false}
                  serial={v.bestSerial ?? undefined}
                />
              </Card3D>
            );
          })}
        </div>
      )}

      {/*
        Progreso por región DEBAJO de las cartas.
        Estaba encima, y entre el aviso de instalación, la cabecera, la barra de progreso,
        las pestañas, estas cuatro tarjetas y dos filas de filtros había ~640 px de cromo
        antes de ver una sola carta. En un juego de cartas, las cartas van primero: esto es
        un resumen, y un resumen se consulta después de mirar.
      */}
      <section className="mt-8" aria-label="Progreso por región">
        <h2 className="nx-label mb-2">Progreso por región</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {collections.map((c) => {
          const p = collectionProgress(c, ownedIds);
          return (
            <button
              key={c.id}
              onClick={() => setRegion(c.region)}
              className="nx-card p-3 text-left"
            >
              <p className="font-display text-xs font-bold uppercase tracking-wide text-white">{c.region}</p>
              <p className="text-[11px] text-white/45">
                {p.owned}/{p.total} · {p.pct}%
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-drl-cyan to-drl" style={{ width: `${p.pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      </section>

      {/*
        MAESTRIA — debajo del progreso por region, que es su version corta. Solo con
        sesion: los conjuntos se cuentan contra la coleccion del servidor.
      */}
      {mastery && (
        <MasteryPanel view={mastery} onChanged={reloadMastery} notify={notify} />
      )}

      {/*
        PRESTIGIO — justo debajo de la maestria, porque es su continuacion: primero te ganas
        la insignia coleccionando y despues decides cual de todas merece que le dediques
        creditos. Es el unico sumidero del juego que no es un sobre.
      */}
      {prestige && (
        <PrestigePanel view={prestige} onChanged={reloadMastery} notify={notify} />
      )}

      {/* El aviso de la insignia recien conseguida. */}
      <Toast toast={toast} />

      {/* Quedan cartas por pintar: se piden a mano, no al hacer scroll. */}
      {shown < filtered.length && (
        <div className="mt-6 flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className="rounded-control border border-white/15 px-6 py-3 font-display text-sm font-bold uppercase tracking-[0.12em] text-white/80 transition duration-fast hover:bg-white/[0.07]"
          >
            Ver más cartas
          </button>
          <span className="nx-label">{visible.length} de {filtered.length}</span>
        </div>
      )}
      </>)}

      {/* Modal de detalle */}
      <AnimatePresence>
        {detailId && (
          <CardDetail cardId={detailId} onClose={() => setDetailId(null)} />
        )}
      </AnimatePresence>
    </section>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[34px] items-center rounded-full px-3.5 py-1.5 font-display text-xs uppercase tracking-wide transition",
        active
          ? "bg-drl text-white shadow-glow"
          : "border border-white/10 bg-white/5 text-white/55 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function CardDetail({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const router = useRouter();
  const ownedCards = useGameStore((s) => s.ownedCards);
  const quickSell = useGameStore((s) => s.quickSell);
  // Con cuenta, la economía la lleva el servidor: las acciones locales quedan fuera.
  const { user } = useAuth();
  const online = isSupabaseConfigured() && !!user;
  const lockedUids = useGameStore((s) => s.lockedUids);
  const lockCard = useGameStore((s) => s.lockCard);
  const unlockCard = useGameStore((s) => s.unlockCard);
  const listForSale = useMarketStore((s) => s.listForSale);
  const ensureSeeded = useMarketStore((s) => s.ensureSeeded);
  const priceHistory = useMarketStore((s) => s.priceHistory);
  const [sellUid, setSellUid] = useState<string | null>(null);
  const [sellPrice, setSellPrice] = useState<number>(0);
  useEffect(() => ensureSeeded(), [ensureSeeded]);
  const def = getCard(cardId);
  const grouped = groupCollection(ownedCards);
  const entry = grouped.get(cardId);
  const priceSeries = useMemo(
    () => priceHistory[cardId]?.recent.map((r) => r.price),
    [priceHistory, cardId],
  );
  if (!def || !entry) return null;
  const variant = getVariant(def.variantId);

  function startSell(uid: string, serial?: number) {
    setSellUid(uid);
    setSellPrice(instanceValue(def!, serial) || marketValue(def!));
  }
  function confirmSell(uid: string) {
    const res = listForSale(uid, sellPrice);
    if (res.ok) {
      setSellUid(null);
      if (entry!.count <= 1) onClose();
    }
  }

  /*
   * Con sesión NO se ofrece el mercado: está desactivado en Fase A y llevaría a una
   * pantalla que solo explica por qué no se puede operar. Se ofrece en su lugar el
   * recorrido que sí existe: ver la carta dentro de su colección.
   */
  const actions: CardViewerAction[] = [
    ...(online
      ? []
      : [{ label: "Mercado", icon: "💱", onClick: () => router.push("/mercado"), variant: "primary" as const }]),
    { label: "Ver colección", icon: "📚", onClick: () => router.push("/colecciones"), variant: (online ? "primary" : undefined) as CardViewerAction["variant"] },
    { label: "Cerrar", icon: "✕", onClick: onClose },
  ];

  return (
    <CardViewer
      card={def}
      serial={entry.instances[0]?.serial}
      ownership={{ owned: true, count: entry.count, locked: entry.instances.some((i) => lockedUids.includes(i.uid)) }}
      priceSeries={priceSeries}
      actions={actions}
      onClose={onClose}
    >
      <p className="text-[10px] uppercase tracking-widest text-white/40">
        Copias en posesión ({entry.count})
      </p>
      <div className="space-y-2">
        {entry.instances.map((inst) => (
              <div
                key={inst.uid}
                className="rounded-lg border border-white/10 bg-base-700/50 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm text-white">
                    {inst.serial != null ? `#${inst.serial}/${variant.serialLimit}` : "Sin serie"}
                    <span className="ml-2 text-xs text-white/40">
                      valor 🪙 {formatCredits(instanceValue(def, inst.serial))}
                    </span>
                  </span>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => (lockedUids.includes(inst.uid) ? unlockCard(inst.uid) : lockCard(inst.uid))}
                      title={lockedUids.includes(inst.uid) ? "Desbloquear (permitir venta/forja)" : "Bloquear (proteger de venta/forja)"}
                      aria-label={lockedUids.includes(inst.uid) ? "Desbloquear carta" : "Bloquear carta"}
                      className="rounded-lg border border-white/15 px-2 py-1 text-xs transition hover:bg-white/10"
                    >
                      {lockedUids.includes(inst.uid) ? "🔒" : "🔓"}
                    </button>
                    {/*
                      Publicar en el mercado LOCAL quita la carta de `useGameStore`, pero
                      con sesión la propiedad vive en `user_cards`: la carta desaparecía de
                      la colección y volvía a aparecer en la siguiente sincronización. Se
                      desactiva por el mismo motivo que la venta rápida, hasta que exista
                      la operación de servidor (Fase E).
                    */}
                    <button
                      onClick={() => startSell(inst.uid, inst.serial)}
                      disabled={online || lockedUids.includes(inst.uid)}
                      title={online ? "El mercado entre jugadores llegará con el mercado de servidor" : undefined}
                      className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-3 py-1 font-display text-xs uppercase text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Vender en Mercado
                    </button>
                    {/*
                      La venta rápida sigue siendo una operación LOCAL. Con sesión
                      iniciada la propiedad y el saldo los guarda el servidor, así
                      que venderla en el cliente daría créditos que la siguiente
                      sincronización borraría. Se deshabilita hasta que exista la
                      operación de servidor (Fase E) en lugar de dejarla desincronizar.
                    */}
                    <button
                      onClick={() => {
                        quickSell(inst.uid);
                        if (entry.count <= 1) onClose();
                      }}
                      disabled={online || lockedUids.includes(inst.uid)}
                      title={online ? "La venta rápida llegará con el mercado de servidor" : undefined}
                      className="rounded-lg border border-drl-gold/40 bg-drl-gold/10 px-3 py-1 font-display text-xs uppercase text-drl-gold transition hover:bg-drl-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Rápida 🪙 {formatCredits(quickSellValue(def, inst.serial))}
                    </button>
                  </div>
                </div>

                {/* Publicar en el mercado */}
                {sellUid === inst.uid && (
                  <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
                    <span className="text-xs text-white/50">Precio 🪙</span>
                    <input
                      type="number"
                      min={25}
                      value={sellPrice}
                      onChange={(e) => setSellPrice(Number(e.target.value))}
                      className="w-28 rounded-lg border border-white/10 bg-base-800 px-2 py-1 text-sm text-white focus:border-drl focus:outline-none"
                    />
                    <button
                      onClick={() => confirmSell(inst.uid)}
                      className="rounded-lg bg-drl px-3 py-1 font-display text-xs font-bold uppercase text-white shadow-glow transition hover:brightness-110"
                    >
                      Publicar
                    </button>
                    <button
                      onClick={() => setSellUid(null)}
                      className="rounded-lg border border-white/15 px-3 py-1 font-display text-xs uppercase text-white/60 transition hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            ))}
      </div>
    </CardViewer>
  );
}
