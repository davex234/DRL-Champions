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
  buyFromMarket, cancelMyListing,
  type ListingView, type TradeRow, type MarketConfigView,
} from "@/lib/game/market";
import { syncFromServer } from "@/lib/game/sync";
import { Loading, EmptyState } from "@/components/ui/States";
import { formatCredits, cn } from "@/lib/format";

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
  const [tab, setTab] = useState<Tab>("escaparate");
  const [cfg, setCfg] = useState<MarketConfigView | null>(null);

  const [listings, setListings] = useState<ListingView[] | null>(null);
  const [mine, setMine] = useState<(ListingView & { status: string })[] | null>(null);
  const [trades, setTrades] = useState<TradeRow[] | null>(null);

  const [region, setRegion] = useState<(typeof REGIONS)[number]>("Todas");
  const [sort, setSort] = useState<Sort>("recent");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

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

  async function buy(l: ListingView) {
    if (busy) return;
    setBusy(l.id);
    try {
      const r = await buyFromMarket(l.id);
      notify(r.repeated ? "Esa compra ya estaba hecha" : `Comprada por 🪙 ${formatCredits(r.price)}`, true);
      await syncFromServer().catch(() => {});
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo comprar", false);
    } finally { setBusy(null); }
  }

  async function cancel(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await cancelMyListing(id);
      notify("Listado retirado", true);
      const r = await fetchMyListings();
      setMine(r.listings);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo retirar", false);
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
          <span className="nx-label !text-warn">Escaparate abierto · comercio cerrado</span>
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/65">
            Puedes mirar, filtrar y comparar precios. Comprar y vender siguen desactivados
            hasta que el precio de referencia de las cartas se ajuste al de los sobres — el
            porqué, con cifras, está en la documentación de economía.
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
            {t === "escaparate" ? "Escaparate" : t === "mis-ventas" ? "Mis ventas" : "Historial"}
          </button>
        ))}
        {cfg && (
          <span className="nx-label ml-auto">
            Comisión {feePct} % · mínimo 🪙 {formatCredits(cfg.minPrice)}
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
              placeholder="Buscar jugador o equipo…"
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
                  {r}
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
                  {label}
                </button>
              ))}
            </div>
          </div>

          {listings === null ? (
            <Loading label="Cargando el mercado" />
          ) : listings.length === 0 ? (
            <EmptyState
              icon="🏷️"
              title="No hay nada en venta"
              hint="Cuando alguien publique una carta aparecerá aquí."
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {listings.map((l, i) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  busy={busy === l.id}
                  canBuy={GLOBAL_MARKET_ENABLED}
                  delay={card3DStagger(i, 0.02, 0.3)}
                  onBuy={() => buy(l)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══════════ MIS VENTAS ═══════════ */}
      {tab === "mis-ventas" && (
        mine === null ? <Loading label="Cargando tus listados" />
        : mine.length === 0 ? (
          <EmptyState
            icon="📤"
            title="No has publicado nada"
            hint="Tus cartas repetidas se publican desde el inventario."
            action={{ href: "/inventario", label: "Ir al inventario" }}
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
                    {l.nick} <span className="text-white/35">{l.variantLabel}</span>
                  </b>
                  <span className="text-[12px] text-white/40">
                    OVR {l.ovr}{l.serial ? ` · #${l.serial}` : ""}
                  </span>
                </span>
                <span className="nx-readout shrink-0 text-[16px] text-drl-gold">
                  🪙 {formatCredits(l.price)}
                </span>
                {l.status === "active" && (
                  <button
                    onClick={() => cancel(l.id)}
                    disabled={busy === l.id}
                    className="nx-clip-sm shrink-0 border border-white/15 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                  >
                    Retirar
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ═══════════ HISTORIAL ═══════════ */}
      {tab === "historial" && (
        trades === null ? <Loading label="Cargando tu historial" />
        : trades.length === 0 ? (
          <EmptyState icon="🧾" title="Todavía no has comprado ni vendido nada" />
        ) : (
          <div className="grid gap-2">
            {trades.map((t) => (
              <div
                key={t.id}
                className="nx-clip-sm flex flex-wrap items-center gap-x-4 gap-y-1 border border-white/[0.09] bg-white/[0.025] px-4 py-3"
              >
                <span
                  className="nx-label w-[72px] shrink-0"
                  style={{ color: t.side === "buy" ? "#19e3ff" : "#3fc07a" }}
                >
                  {t.side === "buy" ? "Compra" : "Venta"}
                </span>
                <b className="min-w-0 flex-1 truncate font-display text-[14px] font-bold uppercase text-white">
                  {t.nick}
                </b>
                <span className="nx-readout shrink-0 text-[15px] text-drl-gold">
                  🪙 {formatCredits(t.price)}
                </span>
                {t.side === "sell" && t.fee > 0 && (
                  <span className="nx-label shrink-0">comisión −{formatCredits(t.fee)}</span>
                )}
                <span className="nx-label shrink-0 w-[92px] text-right">
                  {new Date(t.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

const statusLabel = (s: string) =>
  s === "active" ? "En venta" : s === "sold" ? "Vendida" : s === "cancelled" ? "Retirada" : "Caducada";

const statusTint = (s: string) =>
  s === "active" ? "#19e3ff" : s === "sold" ? "#3fc07a" : "rgba(255,255,255,0.35)";

/**
 * Una carta del escaparate.
 *
 * Lleva SIEMPRE el precio de referencia al lado del precio pedido. Es lo que convierte un
 * número en una decisión: sin la referencia, «12.400» no dice si es una ganga o un atraco.
 */
function ListingCard({
  listing: l, busy, canBuy, delay, onBuy,
}: {
  listing: ListingView;
  busy: boolean;
  canBuy: boolean;
  delay: number;
  onBuy: () => void;
}) {
  const def = useMemo(() => getCard(l.cardId), [l.cardId]);
  const ratio = l.reference > 0 ? l.price / l.reference : 1;
  const tone = ratio <= 0.8 ? "#3fc07a" : ratio >= 1.5 ? "#ff4d5e" : "rgba(255,255,255,0.45)";

  return (
    <div className="flex flex-col">
      {def && (
        <Card3D mode="static" delay={delay}>
          <PlayerCard card={def} size="sm" interactive={false} serial={l.serial ?? undefined} />
        </Card3D>
      )}

      <div className="mt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="nx-readout text-[17px] text-drl-gold">🪙 {formatCredits(l.price)}</span>
          <span className="nx-label !text-[9px]" style={{ color: tone }}>
            {ratio <= 0.8 ? "por debajo" : ratio >= 1.5 ? "por encima" : "en precio"}
          </span>
        </div>
        <span className="mt-0.5 block text-[11px] text-white/35">
          Referencia 🪙 {formatCredits(l.reference)}
        </span>

        <button
          onClick={onBuy}
          disabled={!canBuy || busy}
          title={canBuy ? undefined : "El comercio entre jugadores todavía no está abierto"}
          className="nx-clip-sm mt-2 w-full bg-drl px-3 py-2 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/35 disabled:shadow-none"
        >
          {busy ? "Comprando…" : canBuy ? "Comprar" : "Cerrado"}
        </button>
      </div>
    </div>
  );
}

/** Enlace de vuelta, para que la frontera entre las tres pantallas quede dicha. */
export function MarketBoundaryNote() {
  return (
    <p className="text-[13px] text-white/45">
      El catálogo completo está en{" "}
      <Link href="/coleccion" className="text-drl underline-offset-2 hover:underline">Mis cartas</Link>
      {" "}y tus repetidas, en{" "}
      <Link href="/inventario" className="text-drl underline-offset-2 hover:underline">Inventario</Link>.
    </p>
  );
}
