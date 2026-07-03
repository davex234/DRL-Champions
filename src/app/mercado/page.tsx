"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  fetchMyListings,
  listCardOnline,
  buyListingOnline,
  cancelListingOnline,
  searchListings,
  fetchMyOffers,
  cancelOffer,
  fetchMarketConfig,
  type ListingSearchParams,
} from "@/lib/supabase/market";
import type { Listing, ListingSearchRow, Offer, MarketConfig } from "@/lib/supabase/types";
import { OnlineCardDetail } from "@/components/market/OnlineCardDetail";
import { TopCardsRanking } from "@/components/market/TopCardsRanking";
import { RarityStatsPanel } from "@/components/market/RarityStatsPanel";
import { applyTax, taxPercent } from "@/domain/market/fees";

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
type GlobalSub = "comprar" | "ofertas" | "analitica";
type AnalyticsSub = "ranking" | "rarezas";
const RANK_BANDS: { label: string; min?: number; max?: number }[] = [
  { label: "Todas" },
  { label: "Comunes", min: 1, max: 3 },
  { label: "Intermedias", min: 4, max: 8 },
  { label: "Élite", min: 9 },
];
const GLOBAL_SORTS: [ListingSearchParams["sort"], string][] = [
  ["recent", "Más recientes"],
  ["price_asc", "Precio ↑"],
  ["price_desc", "Precio ↓"],
  ["rarity", "Rareza"],
  ["deal", "Chollos"],
];

function GlobalTab({ userId, notify }: { userId: string; notify: (m: string, ok?: boolean) => void }) {
  const ownedCards = useGameStore((s) => s.ownedCards);
  const addOwnedCard = useGameStore((s) => s.addOwnedCard);
  const removeOwnedCard = useGameStore((s) => s.removeOwnedCard);

  const [sub, setSub] = useState<GlobalSub>("comprar");
  const [analytics, setAnalytics] = useState<AnalyticsSub>("ranking");
  const [rows, setRows] = useState<ListingSearchRow[]>([]);
  const [mine, setMine] = useState<Listing[]>([]);
  const [myOffers, setMyOffers] = useState<Offer[]>([]);
  const [cfg, setCfg] = useState<MarketConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailCardId, setDetailCardId] = useState<string | null>(null);

  // Filtros de búsqueda server-side.
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region | "Todas">("Todas");
  const [band, setBand] = useState(0);
  const [sort, setSort] = useState<ListingSearchParams["sort"]>("recent");

  const [sellUid, setSellUid] = useState("");
  const [sellPrice, setSellPrice] = useState(1000);

  const owned = useMemo(() => {
    const g = groupCollection(ownedCards);
    return [...g.values()].flatMap((e) => e.instances.map((inst) => ({ inst, def: getCard(e.cardId) }))).filter((x) => x.def);
  }, [ownedCards]);
  const ownedCardIds = useMemo(() => new Set(ownedCards.map((c) => c.cardId)), [ownedCards]);

  const taxBps = cfg?.tax_bps ?? 500;

  const search = useCallback(async () => {
    setLoading(true);
    const b = RANK_BANDS[band];
    const data = await searchListings({
      query: query || undefined,
      region: region === "Todas" ? undefined : region,
      rankMin: b.min,
      rankMax: b.max,
      sort,
      limit: 60,
    });
    setRows(data);
    setLoading(false);
  }, [query, region, band, sort]);

  const refreshMine = useCallback(async () => {
    const [my, offers] = await Promise.all([fetchMyListings(userId), fetchMyOffers(userId)]);
    setMine(my);
    setMyOffers(offers);
  }, [userId]);

  useEffect(() => { fetchMarketConfig().then(setCfg); }, []);
  useEffect(() => { search(); }, [search]);
  useEffect(() => { refreshMine(); }, [refreshMine]);

  async function buy(row: ListingSearchRow) {
    const res = await buyListingOnline(row.id);
    if (res.error) return notify(res.error, false);
    addOwnedCard(row.card_id, row.serial ?? undefined);
    notify("¡Carta comprada en el mercado global!", true);
    search();
  }
  async function cancelL(l: Listing) {
    const res = await cancelListingOnline(l.id);
    if (res.error) return notify(res.error, false);
    addOwnedCard(l.card_id, l.serial ?? undefined);
    notify("Listado cancelado", true);
    refreshMine();
  }
  async function cancelO(o: Offer) {
    const res = await cancelOffer(o.id);
    if (res.error) return notify(res.error, false);
    notify("Oferta cancelada · créditos reembolsados", true);
    refreshMine();
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
    refreshMine();
    search();
  }

  const sellNet = applyTax(sellPrice, taxBps);
  const subs: [GlobalSub, string][] = [
    ["comprar", "Comprar"],
    ["ofertas", `Mis ofertas${myOffers.length ? ` (${myOffers.length})` : ""}`],
    ["analitica", "Analítica"],
  ];

  return (
    <div className="space-y-6">
      {/* Sub-pestañas del mercado global */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-base-700/40 p-1">
        {subs.map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            className={cn("flex-1 rounded-lg px-3 py-1.5 font-display text-xs uppercase tracking-wide transition",
              sub === id ? "bg-drl text-white shadow-glow" : "text-white/55 hover:text-white")}>
            {label}
          </button>
        ))}
      </div>

      {sub === "comprar" && (
        <>
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
            <p className="mt-2 text-[11px] text-white/40">
              Recibirás 🪙 {formatCredits(sellNet.net)} tras el impuesto de mercado del {taxPercent(taxBps)}% (🪙 {formatCredits(sellNet.tax)}).
            </p>
          </div>

          {/* Mis listados globales */}
          {mine.length > 0 && (
            <div>
              <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">Tus listados globales ({mine.length})</h2>
              <div className="space-y-2">
                {mine.map((l) => (
                  <OnlineRow key={l.id} listing={l} action={
                    <button onClick={() => cancelL(l)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-display text-xs uppercase text-white transition hover:bg-white/10">Cancelar</button>
                  } />
                ))}
              </div>
            </div>
          )}

          {/* Búsqueda server-side */}
          <div className="space-y-3 rounded-2xl border border-white/10 bg-base-700/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar jugador o equipo…"
                className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none" />
              <select value={sort} onChange={(e) => setSort(e.target.value as ListingSearchParams["sort"])}
                className="rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none">
                {GLOBAL_SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {REGIONS.map((r) => <Chip key={r} active={region === r} onClick={() => setRegion(r)}>{r}</Chip>)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RANK_BANDS.map((b, i) => <Chip key={b.label} active={band === i} onClick={() => setBand(i)}>{b.label}</Chip>)}
            </div>
          </div>

          {/* Resultados */}
          {loading ? (
            <div className="grid min-h-[20vh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-drl border-t-transparent" /></div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-white/40">No hay cartas a la venta con estos filtros.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {rows.map((row) => {
                const def = getCard(row.card_id);
                if (!def) return null;
                const isMine = row.seller_id === userId;
                return (
                  <div key={row.id} className="flex flex-col gap-2">
                    <button onClick={() => setDetailCardId(row.card_id)} className="transition hover:-translate-y-1">
                      <PlayerCard card={def} size="sm" interactive={false} serial={row.serial ?? undefined} />
                    </button>
                    {row.deal != null && (
                      <span className={cn("self-start rounded-full px-2 py-0.5 text-[11px]", row.deal < 1 ? "bg-drl-cyan/15 text-drl-cyan" : "bg-white/5 text-white/40")}>
                        ×{row.deal} vs valor
                      </span>
                    )}
                    {isMine ? (
                      <span className="rounded-lg border border-white/10 px-2 py-2 text-center text-xs text-white/40">Tuya</span>
                    ) : (
                      <button onClick={() => buy(row)} className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-2 py-2 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
                        Comprar 🪙 {formatCredits(row.price)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {sub === "ofertas" && (
        <div>
          <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">Tus ofertas activas ({myOffers.length})</h2>
          {myOffers.length === 0 ? (
            <Empty>No tienes ofertas activas. Haz una desde la ficha de una carta.</Empty>
          ) : (
            <div className="space-y-2">
              {myOffers.map((o) => {
                const def = getCard(o.card_id);
                const player = def ? getPlayer(def.playerId) : undefined;
                return (
                  <div key={o.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-700/50 p-3">
                    {def && <CardThumb card={def} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-bold uppercase text-white">{player?.nick ?? o.card_id}</p>
                      <p className="text-[11px] text-white/40">{o.kind === "listing" ? "Oferta a un listado" : "Orden de compra"} · retenido 🪙 {formatCredits(o.price)}</p>
                    </div>
                    <button onClick={() => cancelO(o)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-display text-xs uppercase text-white transition hover:bg-white/10">Cancelar</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {sub === "analitica" && (
        <div className="space-y-4">
          <div className="flex gap-1 rounded-xl border border-white/10 bg-base-700/40 p-1">
            {(["ranking", "rarezas"] as AnalyticsSub[]).map((id) => (
              <button key={id} onClick={() => setAnalytics(id)}
                className={cn("flex-1 rounded-lg px-3 py-1.5 font-display text-xs uppercase tracking-wide transition",
                  analytics === id ? "bg-drl text-white shadow-glow" : "text-white/55 hover:text-white")}>
                {id === "ranking" ? "Cartas más valiosas" : "Por rareza"}
              </button>
            ))}
          </div>
          {analytics === "ranking" ? <TopCardsRanking /> : <RarityStatsPanel />}
        </div>
      )}

      <AnimatePresence>
        {detailCardId && (
          <OnlineCardDetail
            cardId={detailCardId}
            currentUserId={userId}
            ownsMatching={ownedCardIds.has(detailCardId)}
            taxBps={taxBps}
            onClose={() => setDetailCardId(null)}
            onChanged={() => { search(); refreshMine(); }}
            notify={notify}
          />
        )}
      </AnimatePresence>
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
