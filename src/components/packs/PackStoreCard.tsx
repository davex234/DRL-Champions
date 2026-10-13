"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { PackDef, RarityBucket } from "@/domain/packs/types";
import { BUCKET_LABEL } from "@/domain/packs/types";
import { useState } from "react";
import { useGameStore } from "@/store/useGameStore";
import { cn, formatCredits, plural } from "@/lib/format";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { buyPackOnline } from "@/lib/game/sync";
import { SealedPack } from "./SealedPack";
import { packStats } from "@/data/packStats";
import { guidanceFor } from "@/domain/packs/guidance";
import { classOddsFor, tablePct } from "@/domain/packs/odds";
import { PACK_CLASS_COLOR } from "@/domain/packs/packClass";
import { CreditGlyph } from "@/components/ui/game/GameGlyph";
import { useServerEconomy, SESSION_PENDING } from "@/lib/game/serverEconomy";

const BUCKET_COLOR: Record<RarityBucket, string> = {
  common: "#8b96a3",
  uncommon: "#ffce4f",
  rare: "#19e3ff",
  epic: "#ff2e63",
  legendary: "#ffd35c",
};

const BUCKET_ORDER: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];

export function PackStoreCard({
  pack,
  onNotify,
}: {
  pack: PackDef;
  onNotify: (msg: string, ok: boolean) => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  // Con sesión, la compra la valida y la cobra el SERVIDOR. Sin sesión se usa la
  // economía local, que es un modo de un solo jugador sin efectos competitivos.
  const online = isSupabaseConfigured() && !!user;
  const serverEconomy = useServerEconomy();
  const credits = useGameStore((s) => s.credits);
  const owned = useGameStore((s) => s.unopenedPacks[pack.id] ?? 0);
  const buyPack = useGameStore((s) => s.buyPack);
  const [busy, setBusy] = useState(false);

  const totalWeight = BUCKET_ORDER.reduce((s, b) => s + pack.weights[b], 0);

  /*
   * El reparto que se ENSEÑA es el MEDIDO (`data/packStats`), no el declarado en
   * `data/packs`. No son lo mismo: el Premium declara un 30 % de comunes y entrega un
   * 25,2 %, porque la garantía de «rara o mejor» ocupa una de las seis casillas. Enseñar
   * el peso declarado sería prometer una probabilidad que el sobre no cumple.
   *
   * El sobre gratuito no tiene estadística —no se compra, así que no entra en ninguna
   * comparación de precio— y en ese caso se cae a los pesos declarados.
   */
  const stats = packStats(pack.id);
  const guidance = guidanceFor(pack.id);
  const share = (b: RarityBucket): number =>
    stats ? stats.drawn[b] : (totalWeight > 0 ? pack.weights[b] / totalWeight : 0);
  const canAfford = credits >= pack.price;
  // Fase 57.3 · línea principal: se enseña la tabla por clase (la que decide), no el reparto por rareza.
  const classOdds = classOddsFor(pack);

  /** Compra un sobre. Devuelve true si se pudo. */
  async function purchase(): Promise<boolean> {
    if (online) {
      try {
        await buyPackOnline(pack.id);
        return true;
      } catch (e) {
        onNotify(e instanceof Error ? e.message : "No se pudo comprar", false);
        return false;
      }
    }
    if (serverEconomy) { onNotify(SESSION_PENDING, false); return false; } // F69 · sesión resolviéndose
    const res = buyPack(pack.id);
    if (!res.ok) { onNotify(res.error ?? "Error", false); return false; }
    return true;
  }

  async function handleBuy() {
    if (busy) return;
    setBusy(true);
    try {
      if (await purchase()) onNotify(`${pack.name} comprado`, true);
    } finally { setBusy(false); }
  }

  async function handleBuyAndOpen() {
    if (busy) return;
    if (owned > 0) { router.push(`/abrir/${pack.id}`); return; }
    setBusy(true);
    try {
      if (await purchase()) router.push(`/abrir/${pack.id}`);
    } finally { setBusy(false); }
  }

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="nx-panel group relative flex flex-col overflow-hidden p-5 transition duration-normal ease-out hover:-translate-y-1"
    >
      {/* Resplandor */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40"
        style={{ background: pack.accent }}
      />

      <div className="flex items-start justify-between">
        <div>
          {pack.tag && (
            <span
              className="rounded-full px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider"
              style={{ background: `${pack.accent}22`, color: pack.accent }}
            >
              {pack.tag}
            </span>
          )}
          <h3 className="mt-2 font-display text-xl font-bold uppercase tracking-wide text-white">
            {pack.name}
          </h3>
        </div>
        {owned > 0 && (
          <span className="rounded-full bg-drl-cyan/20 px-2 py-1 font-display text-xs font-bold text-drl-cyan">
            x{owned}
          </span>
        )}
      </div>

      <p className="mt-2 min-h-[40px] text-sm text-white/55">{pack.description}</p>

      {/*
        EL SOBRE ES EL PRODUCTO, y hasta ahora se enseñaba como una miniatura de 100×148 px
        dentro de una tarjeta de 450 de ancho. Ahora ocupa lo que le corresponde y se
        comporta como un objeto: flota, se inclina al pasar por encima y proyecta su luz.

        Se dibuja el MISMO `SealedPack` que se ve al abrirlo, a escala: la pieza que compras
        y la que abres son la misma, y eso es lo que hace que la compra se sienta como
        conseguir algo.

        Fase 9.6: se dibuja a 156 px con la prop `width` en vez de con `transform: scale()`.
        `scale` no encogía la caja del layout —el sobre seguía midiendo 260×380 aunque se
        pintara más pequeño— y obligaba a posicionarlo en absoluto para que no empujara la
        tarjeta. Con el ancho real, el texto del sobre escala con él en vez de deformarse.
      */}
      <div className="relative my-4 h-[288px] overflow-hidden rounded-card [perspective:900px]">
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-normal group-hover:opacity-100"
          style={{
            background: `radial-gradient(280px 200px at 50% 46%, ${pack.accent}30, transparent 72%)`,
            opacity: 0.75,
          }}
        />
        <div
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "transition-transform duration-normal ease-out",
            "group-hover:[transform:translate(-50%,-52%)_rotateY(-9deg)_rotateX(4deg)]",
          )}
          style={{ transformStyle: "preserve-3d" }}
        >
          <SealedPack pack={pack} cutProgress={0} width={156} />
        </div>
        {/* La cuenta de cartas, fuera del sobre: dentro se pisaba con su propio pie. */}
        <span className="nx-label absolute inset-x-0 bottom-0 text-center">{plural(pack.cardCount, "carta", "cartas")}</span>
      </div>

      {classOdds ? (
        <>
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40">
            <span>Probabilidad por carta</span>
            {classOdds.guarantee && <span className="text-drl-gold">{classOdds.guarantee}</span>}
          </div>
          <div className="flex h-2 overflow-hidden rounded-full">
            {classOdds.rows.map((r) => (
              <div key={r.cls} title={`${r.label}: ${tablePct(r.perCard)}`} style={{ width: `${r.perCard * 100}%`, background: PACK_CLASS_COLOR[r.cls] }} />
            ))}
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-white/50">
            {classOdds.rows.map((r) => `${r.label} ${tablePct(r.perCard)}`).join(" · ")}
          </p>
        </>
      ) : (<>
      {/* Reparto de rareza — el REAL, medido con el motor de sorteo */}
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40">
        <span>{stats ? "Reparto real" : "Probabilidades"}</span>
        {pack.guaranteedMin && (
          <span style={{ color: BUCKET_COLOR[pack.guaranteedMin] }}>
            {BUCKET_LABEL[pack.guaranteedMin]}+ garantizada
          </span>
        )}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full">
        {BUCKET_ORDER.map((b) =>
          share(b) > 0 ? (
            <div
              key={b}
              title={`${BUCKET_LABEL[b]}: ${(share(b) * 100).toFixed(1)} %`}
              style={{ width: `${share(b) * 100}%`, background: BUCKET_COLOR[b] }}
            />
          ) : null,
        )}
      </div>
      </>)}

      {/*
        PARA QUÉ SIRVE ESTE SOBRE.

        La simulación de la Fase 11 demostró que el sobre caro NO completa colección más
        rápido, y hasta hoy la tienda no lo decía. Esta frase y estas advertencias no están
        escritas a mano: las calcula `domain/packs/guidance` sobre lo medido, así que si el
        catálogo cambia, cambian solas y no pueden quedarse mintiendo.
      */}
      {guidance && (
        <div className="mt-3 border-t border-white/8 pt-2.5">
          <p className="text-[11.5px] leading-snug text-white/60">{guidance.headline}</p>
          {guidance.warnings.map((w) => (
            <p key={w} className="mt-1 text-[11px] leading-snug text-drl-gold/70">
              {w}
            </p>
          ))}
          {typeof guidance.costPerRarity.rare === "number" && (
            <p className="mt-1.5 font-display text-[10px] uppercase tracking-[0.1em] text-white/30">
              Rara ≈ <CreditGlyph className="align-[-2px]" /> {formatCredits(Math.round(guidance.costPerRarity.rare))} por carta
            </p>
          )}
        </div>
      )}

      {/* Acciones */}
      <div className="mt-5 flex items-center gap-2">
        <button
          onClick={handleBuyAndOpen}
          disabled={busy || (owned === 0 && !canAfford)}
          className="flex-1 rounded-control bg-gradient-to-r from-drl to-[#7b1733] px-4 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Procesando…" : owned > 0 ? "Abrir" : pack.price === 0 ? "Conseguir y abrir" : "Comprar y abrir"}
        </button>
        {pack.price > 0 && (
          <button
            onClick={handleBuy}
            disabled={busy || !canAfford}
            className="rounded-control border border-white/15 bg-white/5 px-4 py-3 font-display text-sm uppercase tracking-wide text-white transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        )}
      </div>
      <p className="mt-2 text-center font-display text-sm font-bold text-drl-gold">
        {pack.price === 0 ? "GRATIS" : <><CreditGlyph className="mr-1 align-[-2px]" />{formatCredits(pack.price)}</>}
      </p>
    </motion.div>
  );
}
