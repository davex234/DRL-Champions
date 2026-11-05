"use client";

/**
 * F73 · PIEZAS DEL HUB DE MISIONES Y CRAFTEO. Solo presentación: todo lo que se pinta lo ha decidido el servidor.
 *
 * Arte REAL: sobres con `packArtwork(packId)` (si un sobre no tiene producto, su color de marca), cartas con la imagen
 * completa del catálogo (`CardDef.image`). Nada generado. Movimiento ligero; con movimiento reducido, cambio de estado.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { getCard, getPlayer } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { packArtwork } from "@/data/packArtwork";
import { PACK_CLASS_LABEL, type PackCardClass } from "@/domain/packs/packClass";
import { cn } from "@/lib/format";
import { CardArt } from "@/components/cards/CardArt";
import forge from "./forge.module.css";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("crafting");

export const classLabel = (c: string) => td(PACK_CLASS_LABEL[c as PackCardClass]) ?? c;
export const packName = (id: string) => td(getPack(id)?.name) ?? id;

/**
 * Las DOS ZONAS del hub: MISIONES · CRAFTING (enlaces reales, navegables con teclado). F74: dos placas grandes con
 * presencia propia; Crafting enseña sobres reales para que se entienda que es una parte principal del juego.
 */
export function HubNav({ active }: { active: "misiones" | "crafting" }) {
  useLocale();
  const item = (id: "misiones" | "crafting", href: string, label: string, art: React.ReactNode) => {
    const on = active === id;
    return (
      <Link
        href={href}
        aria-current={on ? "page" : undefined}
        data-testid={`hub-tab-${id}`}
        className={cn(
          "nx-focus group relative flex min-h-[64px] flex-1 items-center gap-3 overflow-hidden border px-4 py-2 transition sm:min-h-[74px] sm:px-6",
          forge.plate,
          on ? "border-drl/70 bg-[linear-gradient(120deg,rgba(255,46,99,0.32),rgba(255,46,99,0.06))] text-white shadow-[inset_0_-3px_0_#ff2e63]"
            : "border-white/10 bg-white/[0.035] text-white/60 hover:border-white/25 hover:text-white",
        )}
      >
        <span aria-hidden className="flex shrink-0 items-end">{art}</span>
        <span className="font-display text-[18px] font-extrabold uppercase tracking-[0.16em] sm:text-[22px]">{td(label)}</span>
        {on && <span aria-hidden className="ml-auto hidden h-2 w-2 rotate-45 bg-drl sm:block" />}
      </Link>
    );
  };
  return (
    // IA 2026-10-07 · dentro de la sección TEMPORADA: OBJETIVOS (`/misiones`) y CRAFTEO (`/misiones/crafting`).
    <nav aria-label={t("Objetivos y crafteo")} className="flex gap-2 sm:gap-3">
      {item("misiones", "/misiones", t("Objetivos"), <svg viewBox="0 0 24 24" className="h-8 w-8 text-drl-cyan" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" /></svg>)}
      {item("crafting", "/misiones/crafting", t("Crafteo"), <span className="flex items-end -space-x-3"><PackArt packId="estandar" width={24} className="-rotate-12" /><PackArt packId="oro" width={30} className="z-10" /></span>)}
    </nav>
  );
}

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  useLocale();
  return (
    <nav aria-label={t("Ruta")} className="text-[12px] uppercase tracking-[0.14em] text-white/45">
      {items.map((it, i) => (
        <span key={i}>{i > 0 && <span aria-hidden className="mx-2">/</span>}{it.href ? <Link className="nx-focus hover:text-white" href={it.href}>{td(it.label)}</Link> : <span className="text-white/80">{td(it.label)}</span>}</span>
      ))}
    </nav>
  );
}

/** Sobre con su arte real. */
export function PackArt({ packId, width = 96, dim = false, className }: { packId: string; width?: number; dim?: boolean; className?: string }) {
  const src = packArtwork(packId);
  const pack = getPack(packId);
  return (
    <span className={cn("relative block shrink-0", className)} style={{ width }} data-pack={packId}>
      {src ? (
        <img src={src} alt={td(pack?.name) ?? packId} className={cn("block h-auto w-full select-none drop-shadow-[0_10px_18px_rgba(0,0,0,0.6)]", dim && "opacity-50 grayscale")} draggable={false} loading="lazy" />
      ) : (
        <span className={cn("grid aspect-[3/4] w-full place-items-center rounded-[6px] border border-white/15 font-display text-[12px] font-bold uppercase", dim && "opacity-50")} style={{ background: pack?.accent ?? "#20222e" }}>{td(pack?.name) ?? packId}</span>
      )}
    </span>
  );
}

/** Carta con su imagen completa del catálogo. */
export function CardImage({ cardId, width = 120, dim = false, className }: { cardId: string; width?: number; dim?: boolean; className?: string }) {
  const card = getCard(cardId);
  const name = card ? getPlayer(card.playerId)?.nick ?? card.playerId : cardId;
  return (
    <span className={cn("relative block shrink-0", className)} style={{ width }}>
      {card?.image ? (
        <CardArt src={card.image} alt={`${name} · ${card.ovr}`} dim={dim} className="w-full" />
      ) : (
        <span className="grid aspect-[750/1048] w-full place-items-center rounded-[6px] border border-white/15 bg-white/5 p-2 text-center text-[12px] text-white/70">{name}</span>
      )}
    </span>
  );
}

export function cardName(cardId: string): string {
  const c = getCard(cardId);
  return c ? getPlayer(c.playerId)?.nick ?? c.playerId : cardId;
}

/** Progreso X / N: barra + números (nunca solo color). */
export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  useLocale();
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-white/55">{td(label)}</span>
        <b className="nx-readout tabular-nums text-white">{value} / {max}</b>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={td(label)} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-[#3ee08f]" : "bg-drl-cyan")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const STATE_TEXT = { LOCKED: "Bloqueada", ACTIVE: "En curso", COMPLETED: "Completada", CLAIMED: "Reclamada" } as const;
export function StatePill({ state }: { state: keyof typeof STATE_TEXT }) {
  const tone = state === "COMPLETED" ? "border-[#3ee08f]/60 text-[#3ee08f]" : state === "CLAIMED" ? "border-white/20 text-white/55" : state === "LOCKED" ? "border-white/15 text-white/40" : "border-drl-cyan/50 text-drl-cyan";
  const icon = state === "COMPLETED" || state === "CLAIMED" ? "✓" : state === "LOCKED" ? "🔒" : "●";
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-[3px] border px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em]", tone)} data-state={state}><span aria-hidden>{icon}</span>{td(STATE_TEXT[state])}</span>;
}

/** Estado «el sistema aún no está en esta base de datos» (0059 pendiente). Dicho claro, sin botones falsos. */
export function Unavailable({ what }: { what: string }) {
  useLocale();
  return (
    <div role="status" data-testid="f73-unavailable" className="rounded-[4px] border border-drl-gold/40 bg-drl-gold/[0.06] p-5">
      <p className="font-display text-[15px] font-bold uppercase tracking-[0.14em] text-drl-gold">{t("{sistema}: todavía no disponible", { sistema: td(what) })}</p>
      <p className="mt-1 text-[14px] text-white/70">{t("El servidor aún no tiene activado este sistema. En cuanto se active verás aquí tus recetas y misiones reales; nada de lo que ves se calcula en tu navegador.")}</p>
    </div>
  );
}

/** Revelación breve del resultado: entradas → destello → salida. Con movimiento reducido: fundido simple. */
export function CraftReveal({ children, label }: { children: React.ReactNode; label: string }) {
  useLocale();
  const reduced = useReducedMotion();
  return (
    <motion.div
      role="status"
      data-testid="craft-result"
      className="flex flex-col items-center gap-3 py-2 text-center"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "brightness(2)" }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "brightness(1)" }}
      transition={{ duration: reduced ? 0.15 : 0.45, ease: "easeOut" }}
    >
      <p className="font-display text-[20px] font-bold uppercase tracking-[0.18em] text-[#3ee08f]">{t("Craft completado")}</p>
      {children}
      <p className="font-display text-[16px] font-bold uppercase tracking-[0.12em] text-white">{td(label)}</p>
    </motion.div>
  );
}
