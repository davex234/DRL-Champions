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
import { Plate } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { SealedPack } from "@/components/packs/SealedPack";
import { PackOpenStage } from "@/components/packs/PackOpenStage";
import { useGameStore } from "@/store/useGameStore";
import { getPack } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { duplicates } from "@/store/selectors";
import { salvageValue } from "@/domain/economy/salvage";
import { formatCredits, cn } from "@/lib/format";
import { fetchSalvagePreview, salvage, type SalvagePreview } from "@/lib/game/economy";
import { syncFromServer } from "@/lib/game/sync";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useAuth } from "@/lib/supabase/auth";
import { GameEmpty } from "@/components/ui/game/GameStates";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { CreditGlyph } from "@/components/ui/game/GameGlyph";
import { useServerEconomy, SESSION_PENDING } from "@/lib/game/serverEconomy";

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
  const serverEconomy = useServerEconomy();

  /*
   * El desguace del SERVIDOR. Solo existe con cuenta: sin ella, la propiedad vive en este
   * dispositivo y la venta rápida local sigue siendo la vía correcta.
   */
  const [preview, setPreview] = useState<SalvagePreview | null>(null);
  const [busy, setBusy] = useState(false);
  // F79.1 · copias protegidas (favorita/vitrina) que el jugador marca UNA A UNA para desguazarlas igualmente.
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const protectedList = preview?.protectedCopies ?? [];
  const confirmedValue = protectedList.filter((c) => confirmed.includes(c.uid)).reduce((n, c) => n + c.each, 0);
  const salvageCount = (preview?.uids.length ?? 0) + confirmed.length;

  const loadPreview = useCallback(async () => {
    if (!online) { setPreview(null); return; }
    try { setPreview(await fetchSalvagePreview()); setConfirmed([]); }
    catch { setPreview(null); }
  }, [online]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  async function doSalvage() {
    if (!preview || salvageCount === 0 || busy) return;
    setBusy(true);
    try {
      const r = await salvage([...preview.uids, ...confirmed], undefined, confirmed);
      notify(
        r.repeated
          ? "Ese desguace ya estaba hecho"
          : `Desguazadas ${r.salvaged} cartas · ${formatCredits(r.paid)} créditos`,
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
        return s + (def ? salvageValue(def) : 0);
      }, 0),
    [dups],
  );

  const totalPacks = packEntries.reduce((n, [, c]) => n + c, 0);
  const [firstPackId] = packEntries[0] ?? [];
  const firstPack = firstPackId ? getPack(firstPackId) : null;

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="nx-label">Colección · Inventario</span>
          <h1 className="mt-1 font-display text-[clamp(30px,5vw,52px)] font-bold uppercase leading-none text-white">
            Mis sobres
          </h1>
          {/* Fase 44 · el Mercado está cerrado: la pantalla ya no lo anuncia. */}
          <p className="mt-2 max-w-lg text-[15px] text-white/60">
            Tus sobres sin abrir y tus cartas repetidas. Todas tus cartas están en{" "}
            <Link href="/coleccion" className="text-drl-cyan underline-offset-2 hover:underline">tu colección</Link>.
          </p>
        </div>
        <div className="flex gap-2.5">
          <Stat label="Sobres" value={String(totalPacks)} tone="var(--nx-cyan)" />
          <Stat label="Duplicados" value={String(dups.length)} tone="var(--nx-gold)" />
        </div>
      </header>

      {/*
        FASE 44 · SI TIENES SOBRES, ABRIR DOMINA. Un escenario con el sobre como OBJETO (inclinado, con luz) y ABRIR
        SOBRE como la acción principal de la pantalla. Es el primer sobre del inventario real; el resto, debajo.
      */}
      {firstPack && firstPackId && <PackOpenStage pack={firstPack} packId={firstPackId} total={totalPacks} />}

      {/*
        ═══ SOBRES SIN ABRIR ═══

        FASE 13 · ESTA ES LA PANTALLA A LA QUE LLEGA UN JUGADOR NUEVO.

        El ciclo del vestíbulo le da a «abre tus sobres» la prioridad 0 —por delante
        incluso de las predicciones que caducan— y le manda aquí. La auditoría midió qué
        se encuentra al llegar: los sobres son paneles oscuros sobre fondo oscuro con un
        «toca para abrir» de 11 px en gris, y el elemento más saturado de toda la pantalla
        es el botón rosa de «INSTALAR» del aviso de la aplicación.

        Ha seguido la única instrucción que se le ha dado y ha aterrizado donde la cosa que
        venía a hacer es más apagada que un anuncio. No está bloqueado —los sobres se ven y
        se pulsan— pero la jerarquía dice lo contrario del paso que lo trajo.

        Se corrige diciendo cuántos son en el título y convirtiendo el pie de cada sobre en
        una llamada de verdad. Ni un dato nuevo: el recuento ya estaba.
      */}
      <div>
        <SectionTitle>
          Sobres sin abrir
          {packEntries.length > 0 && (
            <span className="text-drl-cyan"> · {packEntries.reduce((n, [, c]) => n + c, 0)}</span>
          )}
        </SectionTitle>
        {packEntries.length === 0 ? (
          <GameEmpty
            glyph="pack"
            title="No tienes sobres"
            hint="Los sobres se consiguen en la tienda con créditos, y jugando te llevas créditos y recompensas."
            primary={{ href: "/tienda", label: "Conseguir sobres" }}
            secondary={[{ href: "/jugar", label: "Jugar" }]}
            testId="inventory-empty-packs"
          />
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
                        <SealedPack pack={pack} cutProgress={0} />
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-center font-display text-sm font-bold uppercase text-white">
                    {pack.name} <span className="text-white/40">×{count}</span>
                  </p>
                  {/*
                    FASE 13 · Era «×3 · toca para abrir» en gris del 40 %. Es la acción
                    principal de la pantalla y se leía como un pie de foto.
                  */}
                  <p className="mt-2 flex min-h-[44px] items-center justify-center bg-drl-cyan/10 font-display text-[15px] font-bold uppercase tracking-[0.14em] text-drl-cyan transition-colors duration-fast group-hover:bg-drl-cyan/20">
                    Abrir
                  </p>
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
            SIN CUENTA: el desguace local (en ese modo el dispositivo es la autoridad), con la
            MISMA cifra que el servidor: `salvageValue`. Hasta la F57.6 pagaba el 80 % del valor.
          */}
          {online
            ? preview && salvageCount > 0 && (
                <NxButton variant="primary" accent="gold" onClick={doSalvage} disabled={busy} data-testid="salvage-confirm">
                  {busy
                    ? "Desguazando…"
                    : `Desguazar ${salvageCount} · ${formatCredits(preview.total + confirmedValue)} créditos`}
                </NxButton>
              )
            : dups.length > 0 && (
                <NxButton
                  variant="primary"
                  accent="gold"
                  onClick={() => {
                    if (serverEconomy) { notify(SESSION_PENDING, false); return; } // F69 · sesión resolviéndose
                    quickSellMany(dups.map((d) => d.uid));
                    notify(`Desguazadas ${dups.length} cartas · ${formatCredits(dupsValue)} créditos`, true);
                  }}
                >
                  Desguazar {dups.length} · <CreditGlyph className="align-[-2px]" /> {formatCredits(dupsValue)}
                </NxButton>
              )}
        </div>

        {/*
          QUÉ SE PAGA Y POR QUÉ. Un botón que da créditos sin explicar de dónde salen invita
          a pensar que el juego tasa mal; explicarlo en una línea evita esa lectura y, de
          paso, dice que se conserva siempre un ejemplar.
        */}
        {((online && preview && preview.uids.length > 0) || (!online && dups.length > 0)) && (
          <div className="nx-clip-sm mb-4 border border-drl-gold/25 bg-drl-gold/[0.06] px-4 py-3">
            <p className="text-[13px] leading-snug text-white/70">
              El desguace convierte cartas repetidas en créditos y{" "}
              <b className="text-white">siempre conserva un ejemplar</b> de cada una. Paga una
              pequeña parte del valor de mercado de la carta (un 6 %), pensada para que abrir
              sobres y desguazarlos no salga rentable.
            </p>
            {online && preview && <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
              {preview.lines.slice(0, 4).map((l) => (
                <span key={l.cardId} className="text-[12px] text-white/45">
                  <b className="text-white/75">{l.salvageable}×</b>{" "}
                  {getCard(l.cardId)?.id.split("__")[0] ?? l.cardId}{" "}
                  <span className="text-drl-gold"><CreditGlyph className="align-[-2px]" /> {formatCredits(l.subtotal)}</span>
                </span>
              ))}
              {preview.lines.length > 4 && (
                <span className="text-[12px] text-white/35">y {preview.lines.length - 4} más</span>
              )}
            </div>}
          </div>
        )}
        {/*
          F79.1 · CARTAS PROTEGIDAS. Una favorita o una copia de la vitrina NUNCA se desguaza sin que el jugador la marque
          aquí, una a una (la misma regla que NEXUS FORGE y el servidor la vuelve a exigir). Las de un equipo no se tocan.
        */}
        {online && preview && (protectedList.length > 0 || preview.inDeck > 0) && (
          <div className="nx-clip-sm mb-4 border border-white/15 bg-white/[0.03] px-4 py-3" data-testid="salvage-protected">
            {protectedList.length > 0 && (
              <>
                <p className="text-[13px] leading-snug text-white/70">
                  <b className="text-white">{protectedList.length} {protectedList.length === 1 ? "copia protegida" : "copias protegidas"}</b>{" "}
                  (favoritas o en tu vitrina) no se desguazan. Marca solo las que quieras desguazar igualmente:
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {protectedList.map((c) => {
                    const on = confirmed.includes(c.uid);
                    return (
                      <li key={c.uid}>
                        <label className={`nx-focus flex cursor-pointer items-center gap-2 border px-2.5 py-1.5 text-[12px] ${on ? "border-drl-gold/70 text-white" : "border-white/15 text-white/65"}`}>
                          <input type="checkbox" checked={on} data-testid="salvage-protected-copy" data-uid={c.uid}
                            onChange={() => setConfirmed((x) => (on ? x.filter((u) => u !== c.uid) : [...x, c.uid]))} />
                          {getCard(c.cardId)?.id.split("__")[0] ?? c.cardId}
                          <span className="text-white/40">· {c.protectedBy.map((p) => (p === "FAVORITE" ? "favorita" : "vitrina")).join(" + ")}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {preview.inDeck > 0 && (
              <p className="mt-2 text-[12px] text-white/45">{preview.inDeck} {preview.inDeck === 1 ? "copia repetida está" : "copias repetidas están"} en tus equipos y no se desguaza{preview.inDeck === 1 ? "" : "n"}.</p>
            )}
          </div>
        )}
        {dups.length === 0 ? (
          <p className="nx-clip-sm border border-white/10 bg-white/[0.02] px-5 py-4 text-[15px] text-white/60" data-testid="inventory-no-duplicates">
            Sin cartas repetidas: cada carta que abras suma a tu colección.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {dups.map((d) => {
              const def = getCard(d.cardId);
              if (!def) return null;
              /*
               * Aquí el ejemplar es EXACTO, no un representante: el inventario lista
               * instancias, una por una, con su `uid`. Es donde más se nota —una carta recién
               * salida de un sobre enseña el artwork de la versión con la que se acuñó, no el
               * de la versión que esté vigente hoy.
               */
              return (
                <CardVisual key={d.uid} uid={d.uid} alt={`Carta de ${def.id}`} chamfer="11px" className="w-[150px]">
                  <PlayerCard card={def} size="sm" interactive={false} serial={d.serial} />
                </CardVisual>
              );
            })}
          </div>
        )}
      </div>

      <Toast toast={toast} />
    </section>
  );
}

/**
 * Cifra de cabecera. Dos datos que se comprueban de un vistazo antes de bajar.
 *
 * Era una placa dibujada a mano con su propio radio y su propio tamaño de letra; ahora es la
 * placa del sistema con la cifra del sistema, y el color llega por variable de token.
 */
function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Plate className="px-4 py-2.5">
      <Readout size="sm" align="center" label={label} value={value} tone={tone} />
    </Plate>
  );
}
