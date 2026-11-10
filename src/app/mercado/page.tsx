"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardThumb } from "@/components/cards/CardThumb";
import { Toast } from "@/components/ui/Toast";
import { Chip } from "@/components/ui/Chip";
import { Plate } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Readout } from "@/components/ui/Readout";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Segmented } from "@/components/ui/Segmented";
import { MarketToolbar } from "@/components/market/MarketToolbar";
import { ListingCard, type ListingView } from "@/components/market/ListingCard";
import { SellPanel, type SellableCard } from "@/components/market/SellPanel";
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
import { useServerEconomy } from "@/lib/game/serverEconomy";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
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
import { PlayerMarket, MarketBoundaryNote } from "@/components/market/PlayerMarket";
import { TopCardsRanking } from "@/components/market/TopCardsRanking";
import { RarityStatsPanel } from "@/components/market/RarityStatsPanel";
import { applyTax, taxPercent } from "@/domain/market/fees";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("mercado");

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
  useLocale();
  const { toast, notify } = useToast();
  const ensureSeeded = useMarketStore((s) => s.ensureSeeded);
  const refreshMarket = useMarketStore((s) => s.refreshMarket);

  /*
   * F69 · las salas locales (contra bots) compran, venden y LIQUIDAN en el store del navegador: con cuenta eso
   * inventaba saldo y cartas en el HUD hasta sincronizar. Con cuenta solo existe la sala Global (servidor) y el
   * mercado local ni se siembra ni se liquida.
   */
  const serverEconomy = useServerEconomy();
  useEffect(() => {
    if (serverEconomy) return;
    ensureSeeded();
    refreshMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverEconomy]);

  const { user } = useAuth();
  const online = isSupabaseConfigured() && !!user;
  const [pickedTab, setTab] = useState<Tab>("comprar");
  const tab: Tab = serverEconomy ? "global" : pickedTab;

  const tabs: [Tab, string][] = serverEconomy
    ? [["global", tr("Global")]]
    : [["comprar", tr("Comprar")], ["ventas", tr("Mis anuncios")], ["compras", tr("Historial")]];

  const credits = useGameStore((s) => s.credits);
  const listings = useMarketStore((s) => s.listings);
  const enVenta = listings.filter((l) => l.seller === "bot" && (l.status ?? "active") === "active").length;
  const misAnuncios = listings.filter((l) => l.seller === "user" && (l.status ?? "active") === "active").length;

  return (
    <section className="animate-rise">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          {/* La etiqueta decía «Colección»: era el rótulo de otra pantalla copiado aquí. */}
          <span className="font-display text-label uppercase tracking-wide2 text-drl">{tr("Mercado")}</span>
          <h1 className="mt-1 font-display text-[clamp(30px,5vw,46px)] font-bold uppercase leading-none text-white">
            {tr("Transferencias")}
          </h1>
          <p className="mt-2 max-w-xl text-body text-ink-muted">
            {online
              ? tr("Compra y vende cartas entre jugadores (Global).")
              : tr("Compra y vende cartas con DRL Credits.")}
          </p>
          <div className="mt-1"><MarketBoundaryNote /></div>
        </div>

        <div className="flex flex-wrap items-stretch gap-2.5">
          <Plate className="flex items-center px-4 py-2.5">
            <Readout size="sm" label={tr("A la venta")} value={enVenta} tone="var(--nx-cyan)" />
          </Plate>
          <Plate className="flex items-center px-4 py-2.5">
            <Readout size="sm" label={tr("Tu saldo")} value={`🪙 ${formatCredits(credits)}`} tone="var(--nx-gold)" />
          </Plate>
          {tab !== "global" && (
            <NxButton
              variant="secondary"
              size="md"
              onClick={() => { refreshMarket(); notify(tr("Mercado actualizado"), true); }}
            >
              {tr("↻ Actualizar")}
            </NxButton>
          )}
        </div>
      </header>

      {/* Las tres salas del mercado. Segmentado del sistema: una elección, no tres pestañas. */}
      <div className="mb-5">
        <Segmented
          label={tr("Sala del mercado")}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={tabs.map(([id, label]) => ({ value: id, label }))}
        />
      </div>

      {tab === "comprar" && <BuyTab notify={notify} />}
      {tab === "ventas" && <SalesTab notify={notify} />}
      {tab === "compras" && <PurchasesTab />}
      {/*
        FASE 11 · El mercado entre jugadores pasa a `PlayerMarket`, que habla con
        `/api/game/market` en vez de con las RPC de la base de datos desde el navegador.
        `GlobalTab` reconciliaba a mano dos libros de propiedad y era la causa —no la
        víctima— del cierre de la Fase A. El escaparate se enseña siempre; comprar y vender
        siguen gobernados por `GLOBAL_MARKET_ENABLED`, ahora también en el servidor.
      */}
      {tab === "global" && <PlayerMarket notify={notify} />}

      <Toast toast={toast} />
    </section>
  );
}

/*
 * FASE 7 · EL PANEL DIFERIDO SE QUEDA.
 *
 * Nada de lo que sigue lo pinta hoy la pantalla: la sala «Global» la sirve `PlayerMarket`
 * desde la Fase 11. Es código inalcanzable, y la primera reacción es borrarlo. No se borra:
 * `security-verify` lo pinta como una decisión DELIBERADA («el panel sigue en el repositorio
 * para Fase E») porque aquí vive la corrección de BUG-07 —`restoreOwnedCard`, que devuelve la
 * instancia EXACTA y no acuña un uid nuevo— y es la referencia de lo que Fase E tiene que
 * reconstruir con un único libro en servidor. Retirarlo es una decisión de esa fase, no de
 * una fase visual.
 */
function GlobalMarketDisabled() {
  useLocale();
  return (
    <div className="rounded-2xl border border-drl-gold/30 bg-drl-gold/5 p-8 text-center">
      <p className="text-4xl">🔒</p>
      <p className="mt-3 font-display text-lg font-bold uppercase tracking-wide text-white">
        {tr("Mercado global temporalmente cerrado")}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
        {tr("Estamos migrando la propiedad de las cartas al servidor para que los intercambios entre jugadores sean seguros y verificables. Mientras tanto, el mercado global no acepta operaciones.")}
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm text-white/45">
        {fill(tr("El {local} y tu colección siguen funcionando con normalidad. Ninguna carta ni ningún crédito se pierde.", slots("local")), { local: <span className="text-white/70">{tr("mercado local")}</span> })}
      </p>
    </div>
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
  useLocale();
  const ownedCards = useGameStore((s) => s.ownedCards);
  const addOwnedCard = useGameStore((s) => s.addOwnedCard);
  const removeOwnedCard = useGameStore((s) => s.removeOwnedCard);
  const restoreOwnedCard = useGameStore((s) => s.restoreOwnedCard);

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

  // DEFERRED TO PHASE E — doble autoridad de propiedad.
  // `buy`, `cancelL` y `publish` mantienen DOS libros (localStorage + tabla `inventory`)
  // y los reconcilian a mano, de ahí BUG-01 (compra gratis), BUG-02 (duplicación por
  // publicar→cancelar) y BUG-06 (`listCardOnline` no es atómica). La corrección real es
  // un único libro en servidor + una RPC transaccional `list_card`, no un parche aquí.
  // Hasta entonces esta pestaña está cerrada por partida doble: `GLOBAL_MARKET_ENABLED`
  // en la UI y `revoke execute` en 0010_market_lockdown.sql.
  async function buy(row: ListingSearchRow) {
    const res = await buyListingOnline(row.id);
    if (res.error) return notify(res.error, false);
    addOwnedCard(row.card_id, row.serial ?? undefined);
    notify(tr("¡Carta comprada en el mercado global!"), true);
    search();
  }
  async function cancelL(l: Listing) {
    const res = await cancelListingOnline(l.id);
    if (res.error) return notify(res.error, false);
    addOwnedCard(l.card_id, l.serial ?? undefined);
    notify(tr("Listado cancelado"), true);
    refreshMine();
  }
  async function cancelO(o: Offer) {
    const res = await cancelOffer(o.id);
    if (res.error) return notify(res.error, false);
    notify(tr("Oferta cancelada · créditos reembolsados"), true);
    refreshMine();
  }
  async function publish() {
    const sel = owned.find((o) => o.inst.uid === sellUid);
    if (!sel || !sel.def) return notify(tr("Selecciona una carta"), false);
    const removed = removeOwnedCard(sel.inst.uid);
    if (!removed) return notify(tr("Carta no disponible"), false);
    const res = await listCardOnline(removed.cardId, removed.serial ?? null, sellPrice);
    if (res.error) {
      // BUG-07: `addOwnedCard` acuñaba un uid NUEVO y perdía obtainedAt, el origen sellado
      // en `cardOrigins` y el bloqueo de `lockedUids`. `restoreOwnedCard` devuelve la
      // instancia EXACTA, que es justo para lo que existe.
      restoreOwnedCard(removed);
      return notify(res.error, false);
    }
    notify(tr("Carta publicada en el mercado global"), true);
    setSellUid("");
    refreshMine();
    search();
  }

  const sellNet = applyTax(sellPrice, taxBps);
  const subs: [GlobalSub, string][] = [
    ["comprar", tr("Comprar")],
    ["ofertas", tr("Mis ofertas{v}", { v: myOffers.length ? ` (${myOffers.length})` : "" })],
    ["analitica", tr("Analítica")],
  ];

  return (
    <div className="space-y-6">
      {/* Sub-pestañas del mercado global */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-base-700/40 p-1">
        {subs.map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            className={cn("flex-1 rounded-lg px-3 py-1.5 font-display text-xs uppercase tracking-wide transition",
              sub === id ? "bg-drl text-white shadow-glow" : "text-white/55 hover:text-white")}>
            {td(label)}
          </button>
        ))}
      </div>

      {sub === "comprar" && (
        <>
          {/* Publicar */}
          <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">{tr("Poner a la venta")}</h2>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[220px] flex-1">
                <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">{tr("Carta")}</span>
                <select value={sellUid} onChange={(e) => setSellUid(e.target.value)} className="w-full rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none">
                  <option value="">{tr("Elige una carta…")}</option>
                  {owned.map(({ inst, def }) => (
                    <option key={inst.uid} value={inst.uid}>
                      {getPlayer(def!.playerId)?.nick} · {td(getVariant(def!.variantId).label)}
                      {inst.serial != null ? ` #${inst.serial}` : ""} {tr("(OVR")} {def!.ovr})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">{tr("Precio 🪙")}</span>
                <input type="number" min={25} value={sellPrice} onChange={(e) => setSellPrice(Number(e.target.value))} className="w-32 rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none" />
              </label>
              <button onClick={publish} className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
                {tr("Publicar")}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-white/40">
              {tr("Recibirás 🪙 {neto} tras el impuesto de mercado del {pct}% (🪙 {impuesto}).", { neto: formatCredits(sellNet.net), pct: taxPercent(taxBps), impuesto: formatCredits(sellNet.tax) })}
            </p>
          </div>

          {/* Mis listados globales */}
          {mine.length > 0 && (
            <div>
              <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">{tr("Tus listados globales ({n})", { n: mine.length })}</h2>
              <div className="space-y-2">
                {mine.map((l) => (
                  <OnlineRow key={l.id} listing={l} action={
                    <button onClick={() => cancelL(l)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-display text-xs uppercase text-white transition hover:bg-white/10">{tr("Cancelar")}</button>
                  } />
                ))}
              </div>
            </div>
          )}

          {/* Búsqueda server-side */}
          <div className="space-y-3 rounded-2xl border border-white/10 bg-base-700/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Buscar jugador o equipo…")}
                className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none" />
              <select value={sort} onChange={(e) => setSort(e.target.value as ListingSearchParams["sort"])}
                className="rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none">
                {GLOBAL_SORTS.map(([v, l]) => <option key={v} value={v}>{td(l)}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {REGIONS.map((r) => <Chip key={r} active={region === r} onClick={() => setRegion(r)}>{td(r)}</Chip>)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RANK_BANDS.map((b, i) => <Chip key={b.label} active={band === i} onClick={() => setBand(i)}>{td(b.label)}</Chip>)}
            </div>
          </div>

          {/* Resultados */}
          {loading ? (
            <div className="grid min-h-[20vh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-drl border-t-transparent" /></div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-white/40">{tr("No hay cartas a la venta con estos filtros.")}</p>
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
                        ×{row.deal} {tr("vs valor")}
                      </span>
                    )}
                    {isMine ? (
                      <span className="rounded-lg border border-white/10 px-2 py-2 text-center text-xs text-white/40">{tr("Tuya")}</span>
                    ) : (
                      <button onClick={() => buy(row)} className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-2 py-2 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
                        {tr("Comprar 🪙")} {formatCredits(row.price)}
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
          <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">{tr("Tus ofertas activas (")}{myOffers.length})</h2>
          {myOffers.length === 0 ? (
            <Empty>{tr("No tienes ofertas activas. Haz una desde la ficha de una carta.")}</Empty>
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
                      <p className="text-[11px] text-white/40">{tr("{tipo} · retenido 🪙 {precio}", { tipo: o.kind === "listing" ? tr("Oferta a un listado") : tr("Orden de compra"), precio: formatCredits(o.price) })}</p>
                    </div>
                    <button onClick={() => cancelO(o)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-display text-xs uppercase text-white transition hover:bg-white/10">{tr("Cancelar")}</button>
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
                {id === "ranking" ? tr("Cartas más valiosas") : tr("Por rareza")}
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
  useLocale();
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
          {td(variant.label)} {tr("· OVR")} {def.ovr}{listing.serial != null ? ` · #${listing.serial}` : ""}
        </p>
        <p className="text-[11px] text-white/40">{tr("Valor ref. 🪙")} {formatCredits(instanceValue(def, listing.serial ?? undefined))}</p>
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
  useLocale();
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
  const [showFilters, setShowFilters] = useState(false);
  const [busy, setBusy] = useState(false);

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

  /*
   * Un solo intento por pulsación. La compra local es síncrona, pero el guardián evita que
   * dos clics rápidos disparen dos operaciones sobre el mismo anuncio.
   */
  function handleBuy(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = buyListing(id);
      notify(res.ok ? tr("Carta adquirida") : res.error ?? tr("Error"), res.ok);
      if (res.ok) setDetailId(null);
    } finally {
      setBusy(false);
    }
  }

  const credits = useGameStore((st) => st.credits);
  const activeFilters =
    (region !== "Todas" ? 1 : 0) + (rarity !== "Todas" ? 1 : 0) +
    (team !== "Todos" ? 1 : 0) + (ovrMin !== 0 ? 1 : 0);

  const clearFilters = useCallback(() => {
    setQuery(""); setRegion("Todas"); setRarity("Todas"); setTeam("Todos"); setOvrMin(0);
  }, []);

  /*
   * Proyección de las fichas. La REFERENCIA es `instanceValue` —el índice interno del juego
   * para esa carta y esa serie—, que no es lo mismo que el precio que pide el vendedor. La
   * pantalla las enseña por separado justamente para que no se confundan.
   */
  const views: ListingView[] = useMemo(
    () => filtered.map(({ l, def }) => ({
      id: l.id,
      cardId: l.cardId,
      def: def!,
      price: l.price,
      reference: instanceValue(def!, l.serial),
      serial: l.serial,
      history: priceHistory[l.cardId],
    })),
    [filtered, priceHistory],
  );

  return (
    <>
      <MarketToolbar
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={(v) => setSort(v as SortKey)}
        open={showFilters}
        onToggle={() => setShowFilters((v) => !v)}
        activeCount={activeFilters}
        onClear={clearFilters}
        matched={filtered.length}
        facets={[
          {
            label: tr("Región"),
            value: region,
            onChange: (v) => setRegion(v as Region | "Todas"),
            options: REGIONS.map((r) => ({ value: r, label: r })),
          },
          {
            label: tr("Rareza"),
            value: rarity,
            onChange: (v) => setRarity(v as RarityLabel),
            options: RARITIES.map((r) => ({ value: r, label: r })),
          },
          {
            label: "OVR",
            value: String(ovrMin),
            onChange: (v) => setOvrMin(Number(v)),
            options: OVR_MINS.map((o) => ({ value: String(o), label: o === 0 ? tr("Cualquiera") : `${o}+` })),
          },
          {
            label: tr("Equipo"),
            value: team,
            onChange: setTeam,
            options: [{ value: "Todos", label: /* i18n-id */ "Todos" }, ...TEAMS.map((t) => ({ value: t, label: t }))],
          },
        ]}
      />

      {filtered.length === 0 ? (
        <Plate className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">
            {activeFilters > 0 || query ? tr("Sin resultados") : tr("El mercado está vacío")}
          </p>
          <p className="max-w-[46ch] text-body text-ink-muted">
            {activeFilters > 0 || query
              ? tr("Ninguna carta a la venta coincide con lo que has pedido. Prueba con otro nombre o quita alguna condición.")
              : tr("Ahora mismo no hay cartas a la venta. Pulsa «Actualizar» para ver si han entrado nuevas.")}
          </p>
          {(activeFilters > 0 || query) && (
            <NxButton variant="secondary" size="md" onClick={clearFilters}>
              {tr("Limpiar filtros")}
            </NxButton>
          )}
        </Plate>
      ) : (
        /*
          Columnas del ancho EXACTO de una carta. Antes eran cinco columnas flexibles de
          262 px para cartas de 150: el botón de compra salía más ancho que la carta a la
          que pertenecía y la ficha se leía como una fila de tabla.
        */
        <div className="grid justify-center gap-4 [grid-template-columns:repeat(auto-fill,150px)]">
          {views.map((v) => (
            <ListingCard
              key={v.id}
              listing={v}
              credits={credits}
              busy={busy}
              onOpen={() => setDetailId(v.cardId)}
              onBuy={() => handleBuy(v.id)}
            />
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

/* ----------------------------- MIS ANUNCIOS ----------------------------- */
/**
 * Lo que tengo en venta y lo que ya he vendido — y, por fin, cómo poner algo a la venta.
 * Antes esta sala solo sabía decir «publícalas desde tu colección».
 */
function SalesTab({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  useLocale();
  const listings = useMarketStore((s) => s.listings);
  const cancelListing = useMarketStore((s) => s.cancelListing);
  const listForSale = useMarketStore((s) => s.listForSale);
  const sales = useMarketStore((s) => s.sales);
  const ownedCards = useGameStore((s) => s.ownedCards);
  const lockedUids = useGameStore((s) => s.lockedUids);
  const [busy, setBusy] = useState(false);

  const myListings = listings.filter((l) => l.seller === "user");

  /** Tus cartas, con su referencia y su candado. Datos existentes; nada nuevo. */
  const sellable: SellableCard[] = useMemo(
    () =>
      ownedCards.flatMap((o) => {
        const def = getCard(o.cardId);
        return def
          ? [{
              uid: o.uid,
              def,
              serial: o.serial,
              reference: instanceValue(def, o.serial),
              locked: lockedUids.includes(o.uid),
            }]
          : [];
      }),
    [ownedCards, lockedUids],
  );

  function publish(uid: string, price: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = listForSale(uid, price);
      notify(res.ok ? tr("Carta publicada en el mercado") : res.error ?? tr("No se pudo publicar"), res.ok);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SellPanel cards={sellable} busy={busy} onPublish={publish} />

      <section aria-label={tr("Cartas en venta")}>
        {/*
          El contador desaparece en cero. En la escala de cifras el «0» a este tamaño se lee
          como una «D» —«EN VENTA D»—, y de todas formas la frase de abajo ya dice que no hay
          nada. Un número que hay que descifrar es peor que ningún número.
        */}
        <SectionTitle>
          {tr("En venta")}
          {myListings.length > 0 && <span className="nx-readout ml-1.5 text-ink-secondary">{myListings.length}</span>}
        </SectionTitle>
        {myListings.length === 0 ? (
          <Plate className="px-5 py-8 text-center text-body text-ink-muted">
            {tr("Todavía no tienes ninguna carta publicada.")}
          </Plate>
        ) : (
          <div className="space-y-2">
            {myListings.map((l) => (
              <ListingRow
                key={l.id}
                listing={l}
                action={
                  <NxButton
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      cancelListing(l.id);
                      notify(tr("Anuncio retirado, carta devuelta"), true);
                    }}
                  >
                    {tr("Retirar")}
                  </NxButton>
                }
              />
            ))}
          </div>
        )}
      </section>

      <section aria-label={tr("Ventas completadas")}>
        <SectionTitle>
          {tr("Vendidas")}
          {sales.length > 0 && <span className="nx-readout ml-1.5 text-ink-secondary">{sales.length}</span>}
        </SectionTitle>
        {sales.length === 0 ? (
          <Plate className="px-5 py-8 text-center text-body text-ink-muted">
            {tr("Todavía no has vendido nada.")}
          </Plate>
        ) : (
          <div className="space-y-2">
            {sales.map((tx, i) => (
              <TxRow key={`${tx.at}-${i}`} cardId={tx.cardId} serial={tx.serial} price={tx.price} at={tx.at} positive />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ----------------------------- MIS COMPRAS ----------------------------- */
function PurchasesTab() {
  useLocale();
  const purchases = useMarketStore((s) => s.purchases);
  return (
    <div>
      <SectionTitle>
        {tr("Historial de compras")}
        {purchases.length > 0 && <span className="nx-readout ml-1.5 text-ink-secondary">{purchases.length}</span>}
      </SectionTitle>
      {purchases.length === 0 ? (
        <Plate className="px-5 py-8 text-center text-body text-ink-muted">{tr("Todavía no has comprado nada en el mercado.")}</Plate>
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
/*
 * FASE 7 · Las filas de «Mis anuncios» e «Historial» hablaban la gramática vieja —`rounded-xl`,
 * `border-white/10`, `bg-base-700/50`, `text-[11px]`— dentro de una pantalla ya migrada. Se
 * pasan a `Plate` + `Readout`, que es lo mismo que dicen ahora la ficha y el panel de venta.
 * Ni los datos ni el orden cambian: solo dejan de ser un dialecto aparte.
 */
function ListingRow({ listing, action }: { listing: MarketListing; action: React.ReactNode }) {
  useLocale();
  const def = getCard(listing.cardId);
  const player = getPlayer(listing.cardId.split("__")[0]);
  if (!def || !player) return null;
  const variant = getVariant(def.variantId);
  return (
    <Plate className="flex items-center gap-3 p-3">
      <CardThumb card={def} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-body font-bold uppercase text-white">{player.nick}</p>
        <p className="truncate text-caption" style={{ color: variant.palette.primary }}>
          {td(variant.label)} {tr("· OVR")} {def.ovr}
          {listing.serial != null ? ` · #${listing.serial}` : ""}
        </p>
        <p className="text-caption text-ink-faint">{tr("Publicada")} {formatRelative(listing.listedAt)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Readout size="sm" label={tr("Precio")} value={formatCredits(listing.price)} tone="var(--nx-gold)" />
        {action}
      </div>
    </Plate>
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
  useLocale();
  const def = getCard(cardId);
  const player = getPlayer(cardId.split("__")[0]);
  if (!def || !player) return null;
  const variant = getVariant(def.variantId);
  return (
    <Plate className="flex items-center gap-3 p-3">
      <CardThumb card={def} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-body font-bold uppercase text-white">{player.nick}</p>
        <p className="truncate text-caption" style={{ color: variant.palette.primary }}>
          {td(variant.label)} {tr("· OVR")} {def.ovr}
          {serial != null ? ` · #${serial}` : ""}
        </p>
        <p className="text-caption text-ink-faint">{formatRelative(at)}</p>
      </div>
      {/* El signo dice la dirección; el color, si entra o sale. Cifra en la escala de READOUT. */}
      <Readout
        size="sm"
        label={positive ? tr("Cobrado") : tr("Pagado")}
        value={`${positive ? "+" : "−"}${formatCredits(price)}`}
        tone={positive ? "var(--nx-cyan)" : "var(--nx-gold)"}
      />
    </Plate>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-base-700/30 p-8 text-center text-white/50">
      {children}
    </div>
  );
}
