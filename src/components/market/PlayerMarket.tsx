"use client";

/**
 * MERCADO ENTRE JUGADORES — el escaparate (Fase 11).
 *
 * ────────────────────────── QUÉ SUSTITUYE ──────────────────────────
 *
 * A `GlobalTab`, que hablaba directamente con las RPC de la base de datos desde el
 * navegador y reconciliaba a mano dos libros de propiedad. Esa pestaña era la que estaba
 * cerrada desde la Fase A, y no por su interfaz: por su arquitectura.
 *
 * Esto habla con `/api/game/market`. El navegador no escribe propiedad ni saldo, y el
 * precio de cada carta llega resuelto del servidor junto con su valor de referencia.
 *
 * ────────────────────────── LAS TRES DECISIONES ──────────────────────────
 *
 * **1. El escaparate se enseña aunque el mercado esté cerrado.** Las lecturas no mueven
 * nada, así que se pueden servir siempre; lo que se apaga es comprar y vender, con su
 * motivo escrito. Enseñar una pantalla vacía con un cartel sería esconder el sistema en
 * lugar de explicarlo.
 *
 * **2. Una carta se enseña como CARTA.** Es un juego de cartas: el escaparate usa el mismo
 * `PlayerCard` de todo el producto, no una fila de tabla con un precio a la derecha. El
 * precio va debajo, con su referencia al lado, que es lo que permite juzgar si es caro.
 *
 * **3. El precio de referencia se enseña siempre.** Sin él, un número suelto no significa
 * nada. Con él se ve de un vistazo si alguien pide el doble de lo que vale.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Card3D, card3DStagger } from "@/components/visual/Card3D";
import { getCard } from "@/data/catalog";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import {
  browseMarket, fetchMarketConfig, fetchMyListings, fetchMyTrades,
  buyFromMarket, cancelMyListing, listCardOnMarket,
  type ListingView, type TradeRow, type MarketConfigView,
} from "@/lib/game/market";
import { syncFromServer } from "@/lib/game/sync";
import { useGameStore } from "@/store/useGameStore";
import { duplicates } from "@/store/selectors";
import { marketValue } from "@/domain/economy/pricing";
import type { CardDef } from "@/domain/cards/types";
import { ListingDetail } from "@/components/market/ListingDetail";
import { Loading, EmptyState } from "@/components/ui/States";
import { formatCredits, cn } from "@/lib/format";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";
import { LoadMore } from "@/components/ui/LoadMore";
import { fetchCardInstances } from "@/lib/game/instances";

const tr = ns("market");

/**
 * Un ejemplar que el jugador puede publicar: su `uid` (lo único que viaja al servidor),
 * la definición para pintarlo y su valor de referencia (`marketValue`, el mismo ancla que
 * el escaparate enseña bajo cada carta). El precio final y la banda los valida el servidor;
 * aquí `reference` es solo el punto de partida honesto del formulario.
 */
export interface SellableInstance {
  uid: string;
  def: CardDef;
  serial?: number;
  reference: number;
}

/** Cartas repetidas cuya copia vendible se resuelve de una vez (una consulta por carta). */
const SPARE_PAGE = 12;

type Tab = "escaparate" | "mis-ventas" | "historial";
type Sort = "recent" | "price-asc" | "price-desc" | "ovr";

const REGIONS = ["Todas", "EMEA", "Americas", "Pacific", "China"] as const;

const SORTS: [Sort, string][] = [
  ["recent", "Recientes"],
  ["price-asc", "Precio ↑"],
  ["price-desc", "Precio ↓"],
  ["ovr", "Media"],
];

export function PlayerMarket({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  useLocale();
  const [tab, setTab] = useState<Tab>("escaparate");
  const [cfg, setCfg] = useState<MarketConfigView | null>(null);

  const [listings, setListings] = useState<ListingView[] | null>(null);
  const [mine, setMine] = useState<(ListingView & { status: string })[] | null>(null);
  const [trades, setTrades] = useState<TradeRow[] | null>(null);

  const [region, setRegion] = useState<(typeof REGIONS)[number]>("Todas");
  const [sort, setSort] = useState<Sort>("recent");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Filtros de cliente (rareza y media): se aplican sobre los listados YA cargados, sin una
  // sola petición extra (§15: nada de N+1). Región/orden/búsqueda sí van al servidor.
  const [rarity, setRarity] = useState<string>("Todas");
  const [minOvr, setMinOvr] = useState<number>(0);

  // La carta abierta en la ficha de detalle (null = ninguna).
  const [detail, setDetail] = useState<ListingView | null>(null);
  // Confirmación de retirada de un listado (id del listado en confirmación).
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  // Filtro del historial: todo / solo compras / solo ventas.
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");

  const credits = useGameStore((s) => s.credits);

  /*
   * PARA VENDER hace falta saber qué ejemplares tiene el jugador. Salen del estado ya
   * sincronizado del servidor (`ownedCards`/`lockedUids` los rellena `syncFromServer`), no
   * de un segundo inventario: el navegador no declara propiedad, solo ofrece publicar lo que
   * el servidor ya dice que es suyo. La RPC vuelve a comprobar la posesión de todos modos.
   */
  const ownedCards = useGameStore((s) => s.ownedCards);
  const lockedUids = useGameStore((s) => s.lockedUids);

  /*
   * Vendibles = tus REPETIDAS (el mismo criterio que el desguace: se conserva un ejemplar de
   * cada carta) menos las que ya están retenidas —bloqueadas por ti o ya publicadas—. Se
   * excluyen por partida doble: por `lockedUids` y por tus listados activos, para que una
   * carta recién publicada desaparezca del formulario aunque el estado tarde en sincronizar.
   */
  const ownedCounts = useGameStore((s) => s.ownedCounts);
  const lockedCounts = useGameStore((s) => s.lockedCounts);
  /*
   * COLECCIONES ILIMITADAS. Sin cuenta sincronizada (`ownedCounts === null`, demo local o harness) `ownedCards` es la
   * colección entera y las repetidas se sacan de ahí, como siempre. Con cuenta, `ownedCards` trae UN ejemplar por
   * carta: qué cartas tienen copias de sobra lo dicen los recuentos, y la copia concreta que se ofrece (nunca la mejor,
   * que se conserva) se pide al servidor carta a carta, SOLO con el mercado abierto y solo de las cartas a la vista.
   */
  const listed = useMemo(() => new Set(
    (mine ?? []).filter((l) => l.status === "active" && l.cardUid).map((l) => l.cardUid as string),
  ), [mine]);
  const localSellable = useMemo<SellableInstance[]>(() => {
    if (ownedCounts) return [];
    const locked = new Set(lockedUids);
    return duplicates(ownedCards)
      .filter((o) => !locked.has(o.uid) && !listed.has(o.uid))
      .map((o): SellableInstance | null => {
        const def = getCard(o.cardId);
        return def ? { uid: o.uid, def, serial: o.serial, reference: marketValue(def) } : null;
      })
      .filter((c): c is SellableInstance => c !== null);
  }, [ownedCards, ownedCounts, lockedUids, listed]);
  /** Cartas con al menos una copia libre además de la que se conserva, de más a menos valiosa. */
  const spareCards = useMemo(() => {
    if (!ownedCounts) return [];
    return ownedCards
      .filter((o) => (ownedCounts[o.cardId] ?? 0) >= 2 && (ownedCounts[o.cardId] ?? 0) - (lockedCounts?.[o.cardId] ?? 0) >= 2)
      .map((o) => ({ rep: o, def: getCard(o.cardId) }))
      .filter((x): x is { rep: typeof ownedCards[number]; def: CardDef } => !!x.def)
      .sort((a, b) => marketValue(b.def) - marketValue(a.def) || (a.def.id < b.def.id ? -1 : 1));
  }, [ownedCards, ownedCounts, lockedCounts]);
  const [spareShown, setSpareShown] = useState(SPARE_PAGE);
  const [remoteSellable, setRemoteSellable] = useState<SellableInstance[]>([]);
  const [spareLoading, setSpareLoading] = useState(false);
  const [spareError, setSpareError] = useState<string | null>(null);
  const [spareEpoch, setSpareEpoch] = useState(0);
  useEffect(() => {
    if (!GLOBAL_MARKET_ENABLED || !ownedCounts || tab !== "mis-ventas") return;
    let alive = true;
    const wanted = spareCards.slice(0, spareShown);
    setSpareLoading(true); setSpareError(null);
    void (async () => {
      const out: SellableInstance[] = [];
      try {
        for (const { rep, def } of wanted) {
          // Las tres primeras copias libres por serie: se descarta la mejor (la que se conserva) y las ya publicadas.
          const page = await fetchCardInstances({ cardId: def.id, locked: false, sort: "serial", limit: 3 });
          if (!alive) return;
          const spare = (page?.items ?? []).find((i) => i.uid !== rep.uid && !listed.has(i.uid));
          if (spare) out.push({ uid: spare.uid, def, serial: spare.serial ?? undefined, reference: marketValue(def) });
        }
        if (alive) setRemoteSellable(out);
      } catch (e) {
        if (alive) { setRemoteSellable(out); setSpareError(e instanceof Error ? e.message : tr("No se pudieron cargar tus repetidas")); }
      } finally {
        if (alive) setSpareLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [ownedCounts, spareCards, spareShown, listed, tab, spareEpoch]);
  const sellable = ownedCounts ? remoteSellable : localSellable;

  useEffect(() => { fetchMarketConfig().then(setCfg).catch(() => setCfg(null)); }, []);

  const load = useCallback(async () => {
    try {
      const r = await browseMarket({
        region: region === "Todas" ? undefined : region,
        sort,
        search: search.trim() || undefined,
        limit: 60,
      });
      setListings(r.listings);
    } catch { setListings([]); }
  }, [region, sort, search]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (tab === "mis-ventas") fetchMyListings().then((r) => setMine(r.listings)).catch(() => setMine([]));
    if (tab === "historial") fetchMyTrades().then((r) => setTrades(r.trades)).catch(() => setTrades([]));
  }, [tab]);

  const feePct = cfg ? (cfg.feeBps / 100).toFixed(cfg.feeBps % 100 === 0 ? 0 : 1) : "5";

  // Rarezas presentes en lo cargado (data-driven, ordenadas por rango): así el filtro no
  // inventa rarezas ni se queda obsoleto cuando se añade una nueva.
  const rarityOptions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const l of listings ?? []) if (!seen.has(l.variantLabel)) seen.set(l.variantLabel, l.rank);
    return ["Todas", ...[...seen.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label)];
  }, [listings]);

  // Lo que se pinta = lo cargado, filtrado en cliente por rareza y media. Sin peticiones.
  const visible = useMemo(() => {
    let out = listings ?? [];
    if (rarity !== "Todas") out = out.filter((l) => l.variantLabel === rarity);
    if (minOvr > 0) out = out.filter((l) => l.ovr >= minOvr);
    return out;
  }, [listings, rarity, minOvr]);

  const visibleTrades = useMemo(
    () => (trades ?? []).filter((t) => side === "all" || t.side === side),
    [trades, side],
  );

  /*
   * COMPRA. La lleva la ficha de detalle por sus pasos (ver → confirmar → resultado); aquí
   * solo se hace la llamada de servidor y se refresca. Devuelve el precio pagado o lanza, y
   * es la ficha quien enseña el «Carta adquirida» o el mensaje humano de error. El servidor
   * sigue siendo la autoridad (precio, saldo, estado, concurrencia, idempotencia).
   */
  const buyListing = useCallback(async (l: ListingView): Promise<{ price: number }> => {
    const r = await buyFromMarket(l.id);
    await syncFromServer().catch(() => {});
    await load();
    return { price: r.price };
  }, [load]);

  async function cancel(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await cancelMyListing(id);
      notify(tr("Listado retirado"), true);
      const r = await fetchMyListings();
      setMine(r.listings);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : tr("No se pudo retirar"), false);
    } finally { setBusy(null); }
  }

  /*
   * PUBLICAR. El navegador manda un `uid` y un precio; nada más. El servidor comprueba la
   * posesión, aplica la banda de precio y retiene la carta (`locked`), todo en la RPC. Al
   * volver, se resincroniza para que la carta salga del formulario y el listado aparezca en
   * «Mis ventas». La clave de idempotencia la pone el cliente de mercado por cada gesto.
   */
  async function publish(uid: string, price: number) {
    if (busy) return;
    setBusy(`sell:${uid}`);
    try {
      const r = await listCardOnMarket(uid, price);
      notify(r.repeated ? tr("Esa carta ya estaba publicada") : tr("Publicada por 🪙 {price}", { price: formatCredits(r.price) }), true);
      await syncFromServer().catch(() => {});
      const m = await fetchMyListings();
      setMine(m.listings);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : tr("No se pudo publicar"), false);
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      {/*
        EL ESTADO DEL MERCADO, dicho antes que nada. Un escaparate en el que no se puede
        comprar tiene que explicarlo arriba, no cuando alguien pulsa y falla.
      */}
      {!GLOBAL_MARKET_ENABLED && (
        <div className="nx-clip-sm flex flex-wrap items-center gap-x-4 gap-y-2 border border-warn/35 bg-warn/[0.07] px-4 py-3">
          <span className="nx-label !text-warn">{tr("El mercado entre jugadores abrirá próximamente")}</span>
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/65">
            {tr("Puedes explorar el escaparate, abrir cualquier carta y comparar precios. Comprar y vender se activarán cuando Operaciones abra el mercado; hasta entonces sus botones se muestran, pero desactivados.")}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["escaparate", "mis-ventas", "historial"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "nx-clip-sm px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.12em] transition duration-fast",
              tab === t ? "bg-drl text-white shadow-glow" : "border border-white/12 text-white/55 hover:text-white",
            )}
          >
            {t === "escaparate" ? tr("Escaparate") : t === "mis-ventas" ? tr("Mis ventas") : tr("Historial")}
          </button>
        ))}
        {cfg && (
          <span className="nx-label ml-auto">
            {tr("Comisión")} {td(feePct)} {tr("% · mínimo 🪙")} {formatCredits(cfg.minPrice)}
          </span>
        )}
      </div>

      {/* ═══════════ ESCAPARATE ═══════════ */}
      {tab === "escaparate" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("Buscar jugador o equipo…")}
              className="min-w-[200px] flex-1 rounded-control border border-white/10 bg-white/[0.04] px-3 py-2 text-sm outline-none transition-colors duration-fast focus:border-drl/60"
            />
            <div className="flex flex-wrap gap-1">
              {REGIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRegion(r)}
                  className={cn(
                    "nx-clip-sm border px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.1em] transition duration-fast",
                    region === r ? "border-drl-cyan/60 bg-drl-cyan/10 text-drl-cyan" : "border-white/10 text-white/50 hover:text-white/80",
                  )}
                >
                  {td(r)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {SORTS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setSort(id)}
                  className={cn(
                    "nx-clip-sm border px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.1em] transition duration-fast",
                    sort === id ? "border-white/40 bg-white/[0.08] text-white" : "border-white/10 text-white/50 hover:text-white/80",
                  )}
                >
                  {td(label)}
                </button>
              ))}
            </div>
          </div>

          {/* Rareza y media: filtro de cliente sobre lo cargado, sin peticiones. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label={tr("Filtrar por rareza")}>
              {rarityOptions.map((r) => (
                <button
                  key={r}
                  onClick={() => setRarity(r)}
                  aria-pressed={rarity === r}
                  className={cn(
                    "nx-clip-sm border px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.1em] transition duration-fast",
                    rarity === r ? "border-drl/60 bg-drl/10 text-white" : "border-white/10 text-white/50 hover:text-white/80",
                  )}
                >
                  {td(r)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label={tr("Media mínima")}>
              {[0, 80, 85, 90].map((o) => (
                <button
                  key={o}
                  onClick={() => setMinOvr(o)}
                  aria-pressed={minOvr === o}
                  className={cn(
                    "nx-clip-sm border px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.1em] transition duration-fast",
                    minOvr === o ? "border-drl-gold/60 bg-drl-gold/10 text-drl-gold" : "border-white/10 text-white/50 hover:text-white/80",
                  )}
                >
                  {o === 0 ? tr("OVR ·") : `${o}+`}
                </button>
              ))}
            </div>
          </div>

          {listings === null ? (
            <Loading label={tr("Cargando el mercado")} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="🏷️"
              title={listings.length === 0 ? tr("No hay nada en venta") : tr("Nada con estos filtros")}
              hint={listings.length === 0
                ? tr("Cuando alguien publique una carta aparecerá aquí.")
                : tr("Prueba con otra rareza o baja la media mínima.")}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {visible.map((l, i) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  canBuy={GLOBAL_MARKET_ENABLED}
                  delay={card3DStagger(i, 0.02, 0.3)}
                  onOpen={() => setDetail(l)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══════════ MIS VENTAS ═══════════ */}
      {tab === "mis-ventas" && (
        mine === null ? <Loading label={tr("Cargando tus listados")} />
        : (
          <div className="space-y-5">
            {/* Fase 23.1 · publicar una repetida en el mercado, por el camino del servidor. */}
            <SellComposer cards={sellable} cfg={cfg} busy={busy} onPublish={publish} />
            {ownedCounts && GLOBAL_MARKET_ENABLED && (
              <LoadMore hasMore={spareCards.length > spareShown} loading={spareLoading} error={spareError}
                onMore={() => setSpareShown((n) => n + SPARE_PAGE)} onRetry={() => setSpareEpoch((n) => n + 1)} shown={Math.min(spareShown, spareCards.length)} total={spareCards.length} testId="market-spares-more" />
            )}

            {mine.length === 0 ? (
              <EmptyState
                icon="📤"
                title={tr("No tienes cartas en venta")}
                hint={sellable.length > 0
                  ? tr("Elige una de tus repetidas aquí arriba, ponle precio y publícala.")
                  : tr("Cuando abras sobres y tengas repetidas, podrás publicarlas aquí.")}
              />
            ) : (
          <div className="grid gap-2">
            {mine.map((l) => (
              <div
                key={l.id}
                className="nx-clip-sm flex flex-wrap items-center gap-x-4 gap-y-2 border border-white/[0.09] bg-white/[0.025] px-4 py-3"
              >
                <span className="nx-label w-[92px] shrink-0" style={{ color: statusTint(l.status) }}>
                  {statusLabel(l.status)}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-display text-[14px] font-bold uppercase text-white">
                    {l.nick} <span className="text-white/35">{td(l.variantLabel)}</span>
                  </b>
                  <span className="text-[12px] text-white/40">
                    {tr("OVR")} {l.ovr}{l.serial ? ` · #${l.serial}` : ""}
                  </span>
                </span>
                <span className="nx-readout shrink-0 text-[16px] text-drl-gold">
                  🪙 {formatCredits(l.price)}
                </span>
                {l.status === "active" && (
                  confirmCancel === l.id ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <span className="text-[11px] text-white/55">{tr("¿Retirar del mercado?")}</span>
                      <button
                        onClick={() => { setConfirmCancel(null); cancel(l.id); }}
                        disabled={busy === l.id}
                        className="nx-focus nx-clip-sm border border-drl/50 bg-drl/15 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-white transition hover:bg-drl/25 disabled:opacity-40"
                      >
                        {tr("Sí, retirar")}
                      </button>
                      <button
                        onClick={() => setConfirmCancel(null)}
                        className="nx-focus nx-clip-sm border border-white/15 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-white/60 transition hover:text-white"
                      >
                        {tr("No")}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmCancel(l.id)}
                      disabled={busy === l.id}
                      className="nx-focus nx-clip-sm shrink-0 border border-white/15 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                    >
                      {tr("Retirar")}
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
            )}
          </div>
        )
      )}

      {/* ═══════════ HISTORIAL ═══════════ */}
      {tab === "historial" && (
        trades === null ? <Loading label={tr("Cargando tu historial")} />
        : trades.length === 0 ? (
          <EmptyState icon="🧾" title={tr("Todavía no has comprado ni vendido nada")} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1" role="group" aria-label={tr("Filtrar el historial")}>
              {([["all", tr("Todo")], ["buy", tr("Mis compras")], ["sell", tr("Mis ventas")]] as [typeof side, string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setSide(id)}
                  aria-pressed={side === id}
                  className={cn(
                    "nx-clip-sm border px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.1em] transition duration-fast",
                    side === id ? "border-white/40 bg-white/[0.08] text-white" : "border-white/10 text-white/50 hover:text-white/80",
                  )}
                >
                  {td(label)}
                </button>
              ))}
            </div>
            {visibleTrades.length === 0 ? (
              <EmptyState icon="🧾" title={side === "buy" ? tr("Todavía no has comprado nada") : tr("Todavía no has vendido nada")} />
            ) : (
            <div className="grid gap-2">
            {visibleTrades.map((t) => (
              <div
                key={t.id}
                className="nx-clip-sm flex flex-wrap items-center gap-x-4 gap-y-1 border border-white/[0.09] bg-white/[0.025] px-4 py-3"
              >
                <span
                  className="nx-label w-[72px] shrink-0"
                  style={{ color: t.side === "buy" ? "#19e3ff" : "#3fc07a" }}
                >
                  {t.side === "buy" ? tr("Compra") : tr("Venta")}
                </span>
                <b className="min-w-0 flex-1 truncate font-display text-[14px] font-bold uppercase text-white">
                  {t.nick}
                </b>
                <span className="nx-readout shrink-0 text-[15px] text-drl-gold">
                  🪙 {formatCredits(t.price)}
                </span>
                {t.side === "sell" && t.fee > 0 && (
                  <span className="nx-label shrink-0">{tr("comisión −{n}", { n: formatCredits(t.fee) })}</span>
                )}
                <span className="nx-label shrink-0 w-[92px] text-right">
                  {new Date(t.createdAt).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
            </div>
            )}
          </div>
        )
      )}

      {/* ═══════════ FICHA DE DETALLE + COMPRA ═══════════ */}
      {detail && (
        <ListingDetail
          listing={detail}
          credits={credits}
          canBuy={GLOBAL_MARKET_ENABLED}
          onBuy={buyListing}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

const statusLabel = (s: string) =>
  s === "active" ? tr("En venta") : s === "sold" ? tr("Vendida") : s === "cancelled" ? tr("Retirada") : tr("Caducada");

const statusTint = (s: string) =>
  s === "active" ? "#19e3ff" : s === "sold" ? "#3fc07a" : "rgba(255,255,255,0.35)";

/**
 * Una carta del escaparate.
 *
 * Lleva SIEMPRE el precio de referencia al lado del precio pedido. Es lo que convierte un
 * número en una decisión: sin la referencia, «12.400» no dice si es una ganga o un atraco.
 */
function ListingCard({
  listing: l, canBuy, delay, onOpen,
}: {
  listing: ListingView;
  canBuy: boolean;
  delay: number;
  onOpen: () => void;
}) {
  useLocale();
  const def = useMemo(() => getCard(l.cardId), [l.cardId]);
  const ratio = l.reference > 0 ? l.price / l.reference : 1;
  const tone = ratio <= 0.8 ? "#3fc07a" : ratio >= 1.5 ? "#ff4d5e" : "rgba(255,255,255,0.45)";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={tr("Ver {nick} {variantLabel}, OVR {ovr}, 🪙 {price}", { nick: l.nick, variantLabel: td(l.variantLabel), ovr: l.ovr, price: formatCredits(l.price) })}
      /* Microinteracción solo con movimiento permitido (§28): sin él, sin salto. */
      className="nx-focus group flex flex-col text-left transition duration-fast motion-safe:hover:-translate-y-0.5"
    >
      {def && (
        <Card3D mode="static" delay={delay}>
          <PlayerCard card={def} size="sm" interactive={false} serial={l.serial ?? undefined} />
        </Card3D>
      )}

      <div className="mt-2 w-full">
        <div className="flex items-baseline justify-between gap-2">
          <span className="nx-readout text-[17px] text-drl-gold">🪙 {formatCredits(l.price)}</span>
          <span className="nx-label !text-[9px]" style={{ color: tone }}>
            {ratio <= 0.8 ? tr("por debajo") : ratio >= 1.5 ? tr("por encima") : tr("en precio")}
          </span>
        </div>
        <span className="mt-0.5 block text-[11px] text-white/35">
          {tr("Referencia 🪙")} {formatCredits(l.reference)}
        </span>

        <span
          className="nx-clip-sm mt-2 block w-full bg-white/[0.05] px-3 py-2 text-center font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white/75 transition group-hover:bg-white/[0.1] group-hover:text-white"
        >
          {canBuy ? tr("Ver carta") : tr("Ver carta · cerrado")}
        </span>
      </div>
    </button>
  );
}

/**
 * PUBLICAR UNA CARTA en el mercado entre jugadores (Fase 23.1).
 *
 * ────────────────────────── QUÉ HACE Y QUÉ NO ──────────────────────────
 *
 * Es el único hueco que le faltaba al bucle: el escaparate, la compra, «mis ventas» y el
 * historial ya existían; vender no tenía puerta y «Mis ventas» mandaba al inventario, donde
 * solo se desguaza. Esta pieza cierra el bucle SIN sistema nuevo: manda `uid` + precio a
 * `/api/game/market`, que es quien retiene la carta y crea el listado.
 *
 * A diferencia del `SellPanel` del mercado LOCAL —que por diseño no cobra comisión—, aquí
 * se enseña la retención del 5 % y el neto, porque en el mercado entre jugadores SÍ se
 * aplica y esconderla sería mentir sobre lo que vas a cobrar.
 *
 * El precio final, la banda y la posesión los valida el servidor. Este formulario no decide
 * nada: parte de `marketValue` como ancla honesta y deja que el servidor rechace lo que se
 * salga de la banda, con su mensaje.
 */
export function SellComposer({
  cards, cfg, busy, onPublish,
}: {
  cards: SellableInstance[];
  cfg: MarketConfigView | null;
  busy: string | null;
  onPublish: (uid: string, price: number) => void;
}) {
  useLocale();
  const minPrice = cfg?.minPrice ?? 25;
  // Selección y precio arrancan resueltos en el primer render (no solo por efecto): así no
  // hay un parpadeo sin carta elegida y el formulario es utilizable de inmediato.
  const [uid, setUid] = useState<string | null>(cards[0]?.uid ?? null);
  const elegida = useMemo(() => cards.find((c) => c.uid === uid) ?? null, [cards, uid]);
  const [price, setPrice] = useState<number>(
    () => Math.max(minPrice, Math.round(cards[0]?.reference ?? minPrice)),
  );

  // La selección sigue a la lista: si la carta elegida se publica (y sale de `cards`), se
  // pasa a la primera vendible; si no queda ninguna, se suelta.
  useEffect(() => {
    if (cards.length === 0) { if (uid !== null) setUid(null); return; }
    if (!uid || !cards.some((c) => c.uid === uid)) setUid(cards[0].uid);
  }, [cards, uid]);

  // Al cambiar de carta el precio parte de SU referencia (mínimo el suelo del mercado).
  useEffect(() => {
    if (elegida) setPrice(Math.max(minPrice, Math.round(elegida.reference)));
  }, [elegida?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cards.length === 0) return null;

  const feeBps = cfg?.feeBps ?? 500;
  const fee = Number.isFinite(price) ? Math.floor((price * feeBps) / 10000) : 0;
  const net = Number.isFinite(price) ? price - fee : 0;
  const feePct = (feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 1);
  const valido = Number.isFinite(price) && price >= minPrice && elegida !== null;
  const cerrado = !GLOBAL_MARKET_ENABLED;

  return (
    <div className="nx-clip-sm border border-white/[0.09] bg-white/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="nx-label !text-white/80">{tr("Publicar una repetida")}</span>
        <span className="nx-label">{tr("Comisión")} {td(feePct)} {tr("% · mínimo 🪙")} {formatCredits(minPrice)}</span>
      </div>

      {/* ── Qué vendes: tus repetidas, como cartas ── */}
      <div
        className="nx-scroll mt-3 flex gap-2 overflow-x-auto pb-2"
        role="listbox"
        aria-label={tr("Elige la carta que vas a vender")}
      >
        {cards.map((c) => {
          const activa = c.uid === uid;
          return (
            <button
              key={c.uid}
              type="button"
              role="option"
              aria-selected={activa}
              onClick={() => setUid(c.uid)}
              aria-label={`${getCard(c.def.id)?.id.split("__")[0] ?? c.def.id}${c.serial ? tr(" número {serial}", { serial: c.serial }) : ""}`}
              className={cn(
                "nx-focus nx-clip-sm relative shrink-0 p-1 transition-colors duration-fast",
                activa ? "bg-white/[0.12] ring-1 ring-drl-cyan/60" : "hover:bg-white/[0.05]",
              )}
            >
              <span className="pointer-events-none relative block h-[134px] w-[96px] overflow-hidden">
                <span className="absolute left-0 top-0 origin-top-left scale-[0.64]">
                  <PlayerCard card={c.def} size="sm" interactive={false} serial={c.serial} />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ── A qué precio, y qué recibes ── */}
      {elegida && (
        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
          <label className="block">
            <span className="nx-label mb-1 block">{tr("Precio de venta")}</span>
            <input
              type="number"
              min={minPrice}
              step={25}
              value={Number.isFinite(price) ? price : ""}
              onChange={(e) => setPrice(Math.round(Number(e.target.value)))}
              aria-label={tr("Precio de venta en créditos")}
              className="nx-focus min-h-[44px] w-[140px] rounded-control border border-white/12 bg-white/[0.04] px-3 text-body text-white outline-none transition-colors duration-fast focus:border-drl/60"
            />
          </label>

          <div>
            <span className="nx-label block">{tr("Referencia")}</span>
            <span className="nx-readout text-[15px] text-white/70">🪙 {formatCredits(elegida.reference)}</span>
          </div>

          <div>
            <span className="nx-label block">{tr("Recibes (tras comisión)")}</span>
            <span className="nx-readout text-[16px] text-drl-gold">🪙 {formatCredits(net)}</span>
          </div>

          <button
            type="button"
            disabled={!valido || cerrado || busy !== null}
            onClick={() => elegida && onPublish(elegida.uid, price)}
            title={cerrado ? tr("El comercio entre jugadores todavía no está abierto") : undefined}
            className="nx-clip-sm ml-auto min-h-[44px] bg-drl px-5 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/35 disabled:shadow-none"
          >
            {busy === `sell:${elegida.uid}` ? tr("Publicando…") : cerrado ? tr("Cerrado") : tr("Publicar")}
          </button>
        </div>
      )}

      {/* Qué implica publicar, dicho antes de pulsar. */}
      <p className="mt-3 text-[12px] leading-snug text-white/45">
        {fill(tr("La carta queda {estado} mientras está en venta —sigues viéndola en tu colección, pero no puedes desguazarla ni usarla— y puedes retirarla cuando quieras. Al venderse recibes el precio menos la comisión.", slots("estado")), { estado: <b className="text-white/70">{tr("retenida")}</b> })}
      </p>
    </div>
  );
}

/** Enlace de vuelta, para que la frontera entre las tres pantallas quede dicha. */
export function MarketBoundaryNote() {
  useLocale();
  return (
    <p className="text-[13px] text-white/45">
      {fill(tr("El catálogo completo está en {cartas} y tus repetidas, en {inventario}.", slots("cartas", "inventario")), {
        cartas: <Link href="/coleccion" className="text-drl underline-offset-2 hover:underline">{tr("Mis cartas")}</Link>,
        inventario: <Link href="/inventario" className="text-drl underline-offset-2 hover:underline">{tr("Inventario")}</Link>,
      })}
    </p>
  );
}
