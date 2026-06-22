"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardThumb } from "@/components/cards/CardThumb";
import { Chip } from "@/components/ui/Chip";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { TrendBadge } from "@/components/market/TrendBadge";
import { MarketDetail } from "@/components/market/MarketDetail";
import { useMarketStore } from "@/store/useMarketStore";
import { useGameStore } from "@/store/useGameStore";
import { getCard, getPlayer } from "@/data/catalog";
import { PLAYERS } from "@/data/players";
import { getVariant } from "@/domain/cards/variants";
import { groupCollection } from "@/store/selectors";
import { instanceValue } from "@/domain/economy/pricing";
import type { MarketListing } from "@/domain/market/types";
import { formatCredits, formatRelative, cn } from "@/lib/format";
import type { Region, VariantId } from "@/domain/cards/types";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchActiveListings,
  fetchMyListings,
  listCardOnline,
  buyListingOnline,
  cancelListingOnline,
} from "@/lib/supabase/market";
import type { Listing } from "@/lib/supabase/types";

type Tab = "comprar" | "ventas" | "compras" | "global";
const REGIONS: (Region | "Todas")[] = ["Todas", "EMEA", "Americas", "Pacific", "China"];
const RARITIES = ["Todas", "Bronce", "Plata", "Oro", "Prime", "Winner", "MVP", "Icon"] as const;
type RarityLabel = (typeof RARITIES)[number];
type SortKey = "price-asc" | "price-desc" | "ovr" | "rarity" | "recent";
const OVR_MINS = [0, 80, 85, 90];

const TEAMS = Array.from(new Set(PLAYERS.map((p) => p.team))).sort();

function rarityMatches(label: RarityLabel, variantId: string): boolean {
  const v = getVariant(variantId as VariantId);
  switch (label) {
    case "Todas":
      return true;
    case "Bronce":
      return variantId === "bronze";
    case "Plata":
      return variantId === "silver";
    case "Oro":
      return variantId === "gold";
    case "Prime":
      return variantId === "prime";
    case "Winner":
      return v.group === "winner" || variantId.endsWith("-winner");
    case "MVP":
      return v.group === "mvp" || variantId.endsWith("-mvp");
    case "Icon":
      return variantId === "icon-series";
  }
}

export default function MercadoPage() {
  return (
    <HydrationGate>
      <Market />
    </HydrationGate>
  );
}

function Market() {
  const { toast, notify } = useToast();
  const ensureSeeded = useMarketStore((s) => s.ensureSeeded);
  const refreshMarket = useMarketStore((s) => s.refreshMarket);

  useEffect(() => {
    ensureSeeded();
    refreshMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { user } = useAuth();
  const online = isSupabaseConfigured() && !!user;
  const [tab, setTab] = useState<Tab>("comprar");

  const tabs: [Tab, string][] = [
    ["comprar", "Comprar"],
    ["ventas", "Mis ventas"],
    ["compras", "Mis compras"],
  ];
  if (online) tabs.push(["global", "Global 🌐"]);

  return (
    <section className="animate-rise">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            Mercado
          </h1>
          <p className="mt-1 text-white/50">
            {online ? "Local (bots) y Global (jugador ↔ jugador)." : "Compra y vende cartas con DRL Credits."}
          </p>
        </div>
        {tab !== "global" && (
          <button
            onClick={() => {
              refreshMarket();
              notify("Mercado actualizado", true);
            }}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 font-display text-sm uppercase tracking-wide text-white transition hover:bg-white/10"
          >
            ↻ Actualizar
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-white/10 bg-base-700/40 p-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 rounded-lg px-4 py-2 font-display text-sm uppercase tracking-wide transition",
              tab === id ? "bg-drl text-white shadow-glow" : "text-white/55 hover:text-white",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "comprar" && <BuyTab notify={notify} />}
      {tab === "ventas" && <SalesTab notify={notify} />}
      {tab === "compras" && <PurchasesTab />}
      {tab === "global" && user && <GlobalTab userId={user.id} notify={notify} />}

      <Toast toast={toast} />
    </section>
  );
}

/* ----------------------------- MERCADO GLOBAL (jugador ↔ jugador) ----------------------------- */
function GlobalTab({ userId, notify }: { userId: string; notify: (m: string, ok?: boolean) => void }) {
  const ownedCards = useGameStore((s) => s.ownedCards);
  const addOwnedCard = useGameStore((s) => s.addOwnedCard);
  const removeOwnedCard = useGameStore((s) => s.removeOwnedCard);
  const [listings, setListings] = useState<Listing[]>([]);
  const [mine, setMine] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [sellUid, setSellUid] = useState("");
  const [sellPrice, setSellPrice] = useState(1000);

  const owned = useMemo(() => {
    const g = groupCollection(ownedCards);
    return [...g.values()].flatMap((e) => e.instances.map((inst) => ({ inst, def: getCard(e.cardId) }))).filter((x) => x.def);
  }, [ownedCards]);

  async function refresh() {
    setLoading(true);
    const [all, my] = await Promise.all([fetchActiveListings(), fetchMyListings(userId)]);
    setListings(all);
    setMine(my);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function buy(l: Listing) {
    const res = await buyListingOnline(l.id);
    if (res.error) return notify(res.error, false);
    addOwnedCard(l.card_id, l.serial ?? undefined);
    notify("¡Carta comprada en el mercado global!", true);
    refresh();
  }
  async function cancel(l: Listing) {
    const res = await cancelListingOnline(l.id);
    if (res.error) return notify(res.error, false);
    addOwnedCard(l.card_id, l.serial ?? undefined);
    notify("Listado cancelado", true);
    refresh();
  }
  async function publish() {
    const sel = owned.find((o) => o.inst.uid === sellUid);
    if (!sel || !sel.def) return notify("Selecciona una carta", false);
    const removed = removeOwnedCard(sel.inst.uid);
    if (!removed) return notify("Carta no disponible", false);
    const res = await listCardOnline(removed.cardId, removed.serial ?? null, sellPrice);
    if (res.error) {
      addOwnedCard(removed.cardId, removed.serial); // revertir
      return notify(res.error, false);
    }
    notify("Carta publicada en el mercado global", true);
    setSellUid("");
    refresh();
  }

  return (
    <div className="space-y-8">
      {/* Publicar */}
      <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
        <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">Poner a la venta</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1">
            <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Carta</span>
            <select value={sellUid} onChange={(e) => setSellUid(e.target.value)} className="w-full rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none">
              <option value="">Elige una carta…</option>
              {owned.map(({ inst, def }) => (
                <option key={inst.uid} value={inst.uid}>
                  {getPlayer(def!.playerId)?.nick} · {getVariant(def!.variantId).label}
                  {inst.serial != null ? ` #${inst.serial}` : ""} (OVR {def!.ovr})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Precio 🪙</span>
            <input type="number" min={25} value={sellPrice} onChange={(e) => setSellPrice(Number(e.target.value))} className="w-32 rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none" />
          </label>
          <button onClick={publish} className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
            Publicar
          </button>
        </div>
      </div>

      {/* Mis listados globales */}
      {mine.length > 0 && (
        <div>
          <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">Tus listados globales ({mine.length})</h2>
          <div className="space-y-2">
            {mine.map((l) => (
              <OnlineRow key={l.id} listing={l} action={
                <button onClick={() => cancel(l)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-display text-xs uppercase text-white transition hover:bg-white/10">Cancelar</button>
              } />
            ))}
          </div>
        </div>
      )}

      {/* Mercado global */}
      <div>
        <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">Mercado global ({listings.length})</h2>
        {loading ? (
          <div className="grid min-h-[20vh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-drl border-t-transparent" /></div>
        ) : listings.length === 0 ? (
          <p className="py-10 text-center text-white/40">Todavía no hay cartas a la venta. ¡Sé el primero!</p>
        ) : (
          <div className="space-y-2">
            {listings.map((l) => (
              <OnlineRow key={l.id} listing={l} action={
                l.seller_id === userId ? (
                  <span className="text-xs text-white/40">Tuya</span>
                ) : (
                  <button onClick={() => buy(l)} className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-3 py-1.5 font-display text-xs font-bold uppercase text-white shadow-glow transition hover:brightness-110">
                    Comprar 🪙 {formatCredits(l.price)}
                  </button>
                )
              } />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OnlineRow({ listing, action }: { listing: Listing; action: React.ReactNode }) {
  const def = getCard(listing.card_id);
  const player = def ? getPlayer(def.playerId) : undefined;
  if (!def || !player) return null;
  const variant = getVariant(def.variantId);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-700/50 p-3">
      <CardThumb card={def} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold uppercase text-white">{player.nick}</p>
        <p className="truncate text-xs" style={{ color: variant.palette.primary }}>
          {variant.label} · OVR {def.ovr}{listing.serial != null ? ` · #${listing.serial}` : ""}
        </p>
        <p className="text-[11px] text-white/40">Valor ref. 🪙 {formatCredits(instanceValue(def, listing.serial ?? undefined))}</p>
      </div>
      <div className="text-right">
        <p className="font-display text-sm font-bold text-drl-gold">🪙 {formatCredits(listing.price)}</p>
        <div className="mt-1">{action}</div>
      </div>
    </div>
  );
}

/* ----------------------------- COMPRAR ----------------------------- */
function BuyTab({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  const listings = useMarketStore((s) => s.listings);
  const priceHistory = useMarketStore((s) => s.priceHistory);
  const buyListing = useMarketStore((s) => s.buyListing);

  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region | "Todas">("Todas");
  const [rarity, setRarity] = useState<RarityLabel>("Todas");
  const [team, setTeam] = useState("Todos");
  const [ovrMin, setOvrMin] = useState(0);
  const [sort, setSort] = useState<SortKey>("price-asc");
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = listings
      .filter((l) => l.seller === "bot")
      .map((l) => ({ l, def: getCard(l.cardId), player: getPlayer(l.cardId.split("__")[0]) }))
      .filter((r) => {
        if (!r.def || !r.player) return false;
        if (region !== "Todas" && r.player.region !== region) return false;
        if (team !== "Todos" && r.player.team !== team) return false;
        if (!rarityMatches(rarity, r.def.variantId)) return false;
        if (r.def.ovr < ovrMin) return false;
        if (q && !r.player.nick.toLowerCase().includes(q) && !r.player.team.toLowerCase().includes(q))
          return false;
        return true;
      });

    rows.sort((a, b) => {
      switch (sort) {
        case "price-asc":
          return a.l.price - b.l.price;
        case "price-desc":
          return b.l.price - a.l.price;
        case "ovr":
          return b.def!.ovr - a.def!.ovr;
        case "rarity":
          return getVariant(b.def!.variantId).rank - getVariant(a.def!.variantId).rank;
        case "recent":
          return b.l.listedAt - a.l.listedAt;
      }
    });
    return rows;
  }, [listings, query, region, rarity, team, ovrMin, sort]);

  function handleBuy(id: string) {
    const res = buyListing(id);
    notify(res.ok ? "¡Carta comprada!" : res.error ?? "Error", res.ok);
    if (res.ok) setDetailId(null);
  }

  return (
    <>
      {/* Filtros */}
      <div className="mb-6 space-y-3 rounded-2xl border border-white/10 bg-base-700/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar jugador o equipo… (Benjy, Wo0t, Aspas, TenZ)"
            className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none"
          />
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none"
          >
            <option value="Todos">Todos los equipos</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={ovrMin}
            onChange={(e) => setOvrMin(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none"
          >
            {OVR_MINS.map((o) => (
              <option key={o} value={o}>
                {o === 0 ? "Cualquier OVR" : `OVR ${o}+`}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none"
          >
            <option value="price-asc">Precio ↑</option>
            <option value="price-desc">Precio ↓</option>
            <option value="ovr">OVR</option>
            <option value="rarity">Rareza</option>
            <option value="recent">Más recientes</option>
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
          {RARITIES.map((r) => (
            <Chip key={r} active={rarity === r} onClick={() => setRarity(r)}>
              {r}
            </Chip>
          ))}
        </div>
      </div>

      <p className="mb-3 text-sm text-white/40">{filtered.length} cartas a la venta</p>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-white/40">No hay cartas con estos filtros.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map(({ l, def }) => (
            <div key={l.id} className="flex flex-col gap-2">
              <button onClick={() => setDetailId(l.cardId)} className="transition hover:-translate-y-1">
                <PlayerCard card={def!} size="sm" interactive={false} serial={l.serial} />
              </button>
              <div className="flex items-center justify-between px-0.5">
                <TrendBadge record={priceHistory[l.cardId]} />
              </div>
              <button
                onClick={() => handleBuy(l.id)}
                className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-2 py-2 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110"
              >
                Comprar 🪙 {formatCredits(l.price)}
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {detailId && (
          <MarketDetail cardId={detailId} onClose={() => setDetailId(null)} onBuy={handleBuy} />
        )}
      </AnimatePresence>
    </>
  );
}

/* ----------------------------- MIS VENTAS ----------------------------- */
function SalesTab({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  const listings = useMarketStore((s) => s.listings);
  const cancelListing = useMarketStore((s) => s.cancelListing);
  const sales = useMarketStore((s) => s.sales);
  const myListings = listings.filter((l) => l.seller === "user");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">
          En venta <span className="text-white/40">({myListings.length})</span>
        </h2>
        {myListings.length === 0 ? (
          <Empty>No tienes cartas en venta. Publícalas desde tu colección.</Empty>
        ) : (
          <div className="space-y-2">
            {myListings.map((l) => (
              <ListingRow
                key={l.id}
                listing={l}
                action={
                  <button
                    onClick={() => {
                      cancelListing(l.id);
                      notify("Listado cancelado, carta devuelta", true);
                    }}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-display text-xs uppercase text-white transition hover:bg-white/10"
                  >
                    Cancelar
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">
          Ventas completadas <span className="text-white/40">({sales.length})</span>
        </h2>
        {sales.length === 0 ? (
          <Empty>Todavía no has vendido nada.</Empty>
        ) : (
          <div className="space-y-2">
            {sales.map((tx, i) => (
              <TxRow key={`${tx.at}-${i}`} cardId={tx.cardId} serial={tx.serial} price={tx.price} at={tx.at} positive />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- MIS COMPRAS ----------------------------- */
function PurchasesTab() {
  const purchases = useMarketStore((s) => s.purchases);
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">
        Historial de compras <span className="text-white/40">({purchases.length})</span>
      </h2>
      {purchases.length === 0 ? (
        <Empty>Todavía no has comprado nada en el mercado.</Empty>
      ) : (
        <div className="space-y-2">
          {purchases.map((tx, i) => (
            <TxRow key={`${tx.at}-${i}`} cardId={tx.cardId} serial={tx.serial} price={tx.price} at={tx.at} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Filas reutilizables ----------------------------- */
function ListingRow({ listing, action }: { listing: MarketListing; action: React.ReactNode }) {
  const def = getCard(listing.cardId);
  const player = getPlayer(listing.cardId.split("__")[0]);
  if (!def || !player) return null;
  const variant = getVariant(def.variantId);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-700/50 p-3">
      <CardThumb card={def} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold uppercase text-white">{player.nick}</p>
        <p className="truncate text-xs" style={{ color: variant.palette.primary }}>
          {variant.label} · OVR {def.ovr}
          {listing.serial != null ? ` · #${listing.serial}` : ""}
        </p>
        <p className="text-[11px] text-white/40">Publicada {formatRelative(listing.listedAt)}</p>
      </div>
      <div className="text-right">
        <p className="font-display text-sm font-bold text-drl-gold">🪙 {formatCredits(listing.price)}</p>
        <div className="mt-1">{action}</div>
      </div>
    </div>
  );
}

function TxRow({
  cardId,
  serial,
  price,
  at,
  positive,
}: {
  cardId: string;
  serial?: number;
  price: number;
  at: number;
  positive?: boolean;
}) {
  const def = getCard(cardId);
  const player = getPlayer(cardId.split("__")[0]);
  if (!def || !player) return null;
  const variant = getVariant(def.variantId);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-700/50 p-3">
      <CardThumb card={def} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold uppercase text-white">{player.nick}</p>
        <p className="truncate text-xs" style={{ color: variant.palette.primary }}>
          {variant.label} · OVR {def.ovr}
          {serial != null ? ` · #${serial}` : ""}
        </p>
        <p className="text-[11px] text-white/40">{formatRelative(at)}</p>
      </div>
      <p className={cn("font-display text-sm font-bold", positive ? "text-drl-cyan" : "text-drl-gold")}>
        {positive ? "+" : "−"}🪙 {formatCredits(price)}
      </p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-base-700/30 p-8 text-center text-white/50">
      {children}
    </div>
  );
}
