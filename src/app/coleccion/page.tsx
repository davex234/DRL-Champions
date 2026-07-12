"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardViewer, type CardViewerAction } from "@/components/cards/CardViewer";
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
type SortKey = "ovr" | "rarity" | "name";

export default function ColeccionPage() {
  return (
    <HydrationGate>
      <Collection />
    </HydrationGate>
  );
}

function Collection() {
  const ownedCards = useGameStore((s) => s.ownedCards);
  const rosterVersion = useRosterStore((s) => s.version);
  // El motor proyecta catálogo+propiedad a CardViews (cache interna). rosterVersion fuerza
  // reconstrucción cuando el catálogo vivo (CARDS) cambia tras un sync de roster.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => new CollectionEngine(ownedCards), [ownedCards, rosterVersion]);
  const stats = useMemo(() => engineProgress(engine.registry, engine.ownership()), [engine]);
  const ownedIds = useMemo(() => new Set(ownedCards.map((o) => o.cardId)), [ownedCards]);
  const collections = useMemo(() => regionCollections(), [rosterVersion]);

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
    return sortViews(views, spec);
  }, [engine, query, region, group, ownership, sort]);

  return (
    <section className="animate-rise">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            Mi <span className="text-drl">Colección</span>
          </h1>
          <p className="mt-1 text-white/50">
            {stats.distinct} de {stats.total} cartas · {stats.percent}% completado
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


      {/* Colecciones por región (auto-generadas) */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {collections.map((c) => {
          const p = collectionProgress(c, ownedIds);
          return (
            <button
              key={c.id}
              onClick={() => setRegion(c.region)}
              className="rounded-xl border border-white/10 bg-base-700/50 p-3 text-left transition hover:border-drl-cyan/40"
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

      {/* Filtros */}
      <div className="mb-6 space-y-3 rounded-2xl border border-white/10 bg-base-700/40 p-4">
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
        </div>

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
      </div>

      {/* Rejilla */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-white/40">No hay cartas con estos filtros.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((v) => {
            const def = getCard(v.cardId);
            if (!def) return null;
            return (
              <button
                key={v.cardId}
                onClick={() => v.owned && setDetailId(v.cardId)}
                className={cn(
                  "relative text-left transition",
                  v.owned ? "cursor-pointer hover:-translate-y-1" : "cursor-default",
                )}
              >
                <div className={cn(!v.owned && "opacity-30 grayscale")}>
                  <PlayerCard
                    card={def}
                    size="sm"
                    interactive={false}
                    serial={v.bestSerial ?? undefined}
                  />
                </div>
                {!v.owned && (
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="text-2xl">🔒</span>
                  </div>
                )}
                {v.count > 1 && (
                  <span className="absolute right-1 top-1 rounded-full bg-drl px-1.5 py-0.5 font-display text-[10px] font-bold text-white shadow-glow">
                    x{v.count}
                  </span>
                )}
              </button>
            );
          })}
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
        "rounded-full px-3 py-1 font-display text-xs uppercase tracking-wide transition",
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

  const actions: CardViewerAction[] = [
    { label: "Mercado", icon: "💱", onClick: () => router.push("/mercado"), variant: "primary" },
    { label: "Ver colección", icon: "📚", onClick: () => router.push("/colecciones") },
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
                    <button
                      onClick={() => startSell(inst.uid, inst.serial)}
                      disabled={lockedUids.includes(inst.uid)}
                      className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-3 py-1 font-display text-xs uppercase text-white shadow-glow transition hover:brightness-110 disabled:opacity-40"
                    >
                      Vender en Mercado
                    </button>
                    <button
                      onClick={() => {
                        quickSell(inst.uid);
                        if (entry.count <= 1) onClose();
                      }}
                      disabled={lockedUids.includes(inst.uid)}
                      className="rounded-lg border border-drl-gold/40 bg-drl-gold/10 px-3 py-1 font-display text-xs uppercase text-drl-gold transition hover:bg-drl-gold/20 disabled:opacity-40"
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
