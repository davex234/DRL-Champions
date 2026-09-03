"use client";

/**
 * INVENTARIO — lo que tienes y lo que te sobra (desguace añadido en la Fase 11).
 *
 * ────────────────────────── LA FRONTERA DE LAS TRES PANTALLAS ──────────────────────────
 *
 * La Fase 11 pide cerrar de una vez qué es cada superficie. Queda así, y cada una lo dice
 * en su propia cabecera:
 *
 *   · **Colección** (`/coleccion`) — el CATÁLOGO. Las 772 cartas que existen, tengas o no
 *     cada una. Se va ahí a descubrir y a mirar.
 *   · **Inventario** (esta) — lo que POSEES y todavía no has resuelto: sobres sin abrir y
 *     duplicados. Se viene aquí a hacer algo con ello.
 *   · **Mercado** (`/mercado`) — comprar y vender a otras personas.
 *
 * ────────────────────────── EL DESGUACE ──────────────────────────
 *
 * Hasta la Fase 11 los duplicados no valían nada con cuenta iniciada: la venta rápida era
 * local y estaba deshabilitada online desde la Fase B, porque los créditos que daba los
 * borraba la siguiente sincronización.
 *
 * Ahora hay una operación de SERVIDOR. Y no usa el valor de mercado de la carta: usa una
 * tabla anclada al precio del sobre. El motivo, con las cifras, está en
 * `docs/product/economy.md` §6 — resumido: el valor de mercado de lo que sale de un sobre
 * está entre 7 y 15 veces por encima de lo que cuesta el sobre, así que pagar el 80 % de
 * eso convertiría la tienda en una impresora de dinero.
 *
 * El importe NUNCA lo envía esta pantalla. Se pide al servidor (`fetchSalvagePreview`) y se
 * vuelve a calcular allí al confirmar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { SealedPack } from "@/components/packs/SealedPack";
import { useGameStore } from "@/store/useGameStore";
import { getPack } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { duplicates } from "@/store/selectors";
import { quickSellValue } from "@/domain/economy/pricing";
import { formatCredits, cn } from "@/lib/format";
import { fetchSalvagePreview, salvage, type SalvagePreview } from "@/lib/game/economy";
import { syncFromServer } from "@/lib/game/sync";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export default function InventarioPage() {
  return (
    <HydrationGate>
      <Inventory />
    </HydrationGate>
  );
}

function Inventory() {
  const { toast, notify } = useToast();
  const unopenedPacks = useGameStore((s) => s.unopenedPacks);
  const ownedCards = useGameStore((s) => s.ownedCards);
  const quickSellMany = useGameStore((s) => s.quickSellMany);
  // Con cuenta, la economía la lleva el servidor: las ventas locales quedan fuera.
  const { user } = useAuth();
  const online = isSupabaseConfigured() && !!user;

  /*
   * El desguace del SERVIDOR. Solo existe con cuenta: sin ella, la propiedad vive en este
   * dispositivo y la venta rápida local sigue siendo la vía correcta.
   */
  const [preview, setPreview] = useState<SalvagePreview | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!online) { setPreview(null); return; }
    try { setPreview(await fetchSalvagePreview()); }
    catch { setPreview(null); }
  }, [online]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  async function doSalvage() {
    if (!preview || preview.uids.length === 0 || busy) return;
    setBusy(true);
    try {
      const r = await salvage(preview.uids);
      notify(
        r.repeated
          ? "Ese desguace ya estaba hecho"
          : `Desguazadas ${r.salvaged} cartas · 🪙 ${formatCredits(r.paid)}`,
        true,
      );
      // El servidor manda: se recarga el estado en vez de suponer el resultado.
      await syncFromServer().catch(() => {});
      await loadPreview();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo desguazar", false);
    } finally {
      setBusy(false);
    }
  }

  const packEntries = Object.entries(unopenedPacks).filter(([, n]) => n > 0);
  const dups = useMemo(() => duplicates(ownedCards), [ownedCards]);
  const dupsValue = useMemo(
    () =>
      dups.reduce((s, d) => {
        const def = getCard(d.cardId);
        return s + (def ? quickSellValue(def, d.serial) : 0);
      }, 0),
    [dups],
  );

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="nx-label">Colección</span>
          <h1 className="mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
            Inventario
          </h1>
          <p className="mt-2 max-w-lg text-[15px] text-white/55">
            Lo que posees y todavía no has resuelto: sobres por abrir y cartas repetidas.
            El catálogo entero está en{" "}
            <Link href="/coleccion" className="text-drl underline-offset-2 hover:underline">Mis cartas</Link>
            {" "}y comprar o vender a otras personas, en{" "}
            <Link href="/mercado" className="text-drl underline-offset-2 hover:underline">Mercado</Link>.
          </p>
        </div>
        <div className="flex gap-2.5">
          <Stat label="Sobres" value={String(packEntries.reduce((n, [, c]) => n + c, 0))} accent="#19e3ff" />
          <Stat label="Duplicados" value={String(dups.length)} accent="#ffd35c" />
        </div>
      </header>

      {/* Sobres sin abrir */}
      <div>
        <h2 className="nx-label mb-3">Sobres sin abrir</h2>
        {packEntries.length === 0 ? (
          <Empty cta>No tienes sobres sin abrir.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {packEntries.map(([packId, count]) => {
              const pack = getPack(packId);
              if (!pack) return null;
              return (
                <Link
                  key={packId}
                  href={`/abrir/${packId}`}
                  className="nx-panel nx-sweep group relative overflow-hidden p-4 transition duration-fast hover:-translate-y-1"
                >
                  <div
                    className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl transition-opacity duration-fast group-hover:opacity-50"
                    style={{ background: pack.accent }}
                  />
                  {/*
                    El mismo sobre que se ve en la tienda y al abrirlo, no un cuadro con una
                    letra. Centrado en absoluto porque `scale()` no encoge la caja del layout.
                  */}
                  <div className="relative h-[140px] overflow-hidden">
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                      <div style={{ transform: "scale(0.33)" }}>
                        <SealedPack accent={pack.accent} name={pack.name} cutProgress={0} />
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-center font-display text-sm font-bold uppercase text-white">
                    {pack.name}
                  </p>
                  <p className="text-center text-xs text-white/40">×{count} · toca para abrir</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Duplicados */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="nx-label">Duplicados <span className="text-white/25">· {dups.length}</span></h2>

          {/*
            CON CUENTA: desguace de servidor. El importe lo pone el servidor y llega en la
            vista previa; esta pantalla no calcula ni un crédito.
            SIN CUENTA: la venta rápida local de siempre, que en ese modo sí es la autoridad.
          */}
          {online
            ? preview && preview.uids.length > 0 && (
                <button
                  onClick={doSalvage}
                  disabled={busy}
                  className="nx-clip-sm bg-gradient-to-r from-drl-gold to-[#b8860b] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.1em] text-[#2a2000] shadow-glow-gold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy
                    ? "Desguazando…"
                    : `Desguazar ${preview.uids.length} · 🪙 ${formatCredits(preview.total)}`}
                </button>
              )
            : dups.length > 0 && (
                <button
                  onClick={() => {
                    quickSellMany(dups.map((d) => d.uid));
                    notify(`Vendidos ${dups.length} duplicados por 🪙 ${formatCredits(dupsValue)}`, true);
                  }}
                  className="nx-clip-sm bg-gradient-to-r from-drl-gold to-[#b8860b] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.1em] text-[#2a2000] shadow-glow-gold transition hover:brightness-110"
                >
                  Vender todos · 🪙 {formatCredits(dupsValue)}
                </button>
              )}
        </div>

        {/*
          QUÉ SE PAGA Y POR QUÉ. Un botón que da créditos sin explicar de dónde salen invita
          a pensar que el juego tasa mal; explicarlo en una línea evita esa lectura y, de
          paso, dice que se conserva siempre un ejemplar.
        */}
        {online && preview && preview.uids.length > 0 && (
          <div className="nx-clip-sm mb-4 border border-drl-gold/25 bg-drl-gold/[0.06] px-4 py-3">
            <p className="text-[13px] leading-snug text-white/70">
              El desguace convierte cartas repetidas en créditos y{" "}
              <b className="text-white">siempre conserva un ejemplar</b> de cada una. Lo que
              paga no es el valor de mercado de la carta: es una tarifa por rareza, pensada
              para que abrir sobres y desguazarlos no salga rentable.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
              {preview.lines.slice(0, 4).map((l) => (
                <span key={l.cardId} className="text-[12px] text-white/45">
                  <b className="text-white/75">{l.salvageable}×</b>{" "}
                  {getCard(l.cardId)?.id.split("__")[0] ?? l.cardId}{" "}
                  <span className="text-drl-gold">🪙 {formatCredits(l.subtotal)}</span>
                </span>
              ))}
              {preview.lines.length > 4 && (
                <span className="text-[12px] text-white/35">y {preview.lines.length - 4} más</span>
              )}
            </div>
          </div>
        )}
        {dups.length === 0 ? (
          <Empty>No tienes cartas duplicadas.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {dups.map((d) => {
              const def = getCard(d.cardId);
              if (!def) return null;
              return <PlayerCard key={d.uid} card={def} size="sm" interactive={false} serial={d.serial} />;
            })}
          </div>
        )}
      </div>

      <Toast toast={toast} />
    </section>
  );
}

function Empty({ children, cta }: { children: React.ReactNode; cta?: boolean }) {
  return (
    <div className="rounded-panel border border-dashed border-white/12 p-10 text-center">
      <p className="text-white/50">{children}</p>
      {cta && (
        <Link
          href="/tienda"
          className="mt-3 inline-block rounded-control bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.1em] text-white shadow-glow transition duration-fast hover:brightness-110"
        >
          Ir a la tienda
        </Link>
      )}
    </div>
  );
}

/** Cifra de cabecera. Dos datos que se comprueban de un vistazo antes de bajar. */
function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-control border border-white/10 bg-white/[0.04] px-4 py-2.5 text-center">
      <span className="nx-label block">{label}</span>
      <span className="font-display text-xl font-bold tabular-nums" style={{ color: accent }}>{value}</span>
    </div>
  );
}
