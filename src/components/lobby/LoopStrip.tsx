"use client";

/**
 * LA TIRA DEL BUCLE (Fase 25) — la home dice cuál es el siguiente paso del juego.
 *
 *   TIENES 3 SOBRES → Abrir · NUEVA CARTA → Ver colección · TU EQUIPO 8/10 → Completar ·
 *   PRÓXIMO OBJETIVO → el equipo más cerca de completarse
 *
 * Todo sale de datos reales: sobres del inventario, `obtainedAt` de las instancias, el mazo
 * más avanzado del servidor y el progreso por equipo del catálogo. Sin un dato, sin su tarjeta.
 * Un jugador nuevo con sus sobres de bienvenida ve «Abrir» antes que nada.
 */
import Link from "next/link";
import { useMemo } from "react";
import type { OwnedCard } from "@/domain/cards/types";
import { DUEL_DECK_SIZE } from "@/domain/cardgame/types";
import { recentlyAcquired, totalOwnedPacks } from "@/domain/collection/showcase";
import { buildTeamCollection } from "@/domain/collections/teamCollection";
import { getCard, getPlayer } from "@/data/catalog";

/**
 * FASE 27 · EL META EN LA HOME. Datos REALES ya leídos por la página (nivel de `useGameStore.xp`,
 * pasos del bucle y objetivos del servidor). La tira puede decir «Nivel 8 · 620/800 XP», «2
 * objetivos activos», «1 Pick'em pendiente» y proponer UNA acción para continuar. Sin ellos,
 * la tira es la de la Fase 25.
 */
export interface LoopMeta {
  level: { level: number; xpIntoLevel: number; xpForNext: number };
  /** Objetivos sin reclamar (del servidor). */
  activeObjectives: number;
  /** Recompensas reclamables (niveles + misiones + logros), del servidor. */
  claimable: number;
  pendingPicks: number;
  /** La recomendación única («CONTINUAR»), ya decidida por la prioridad pura. */
  continueTo: { label: string; href: string } | null;
  /** Fase 28 · frase competitiva derivable («Estás #124 · te faltan 9 puntos…»), o `null`. */
  competitive?: string | null;
}

export interface LoopStripProps {
  unopened: Record<string, number>;
  owned: OwnedCard[];
  /** El mazo con el que se jugaría: tamaño y validez. `null` sin mazos; `undefined` sin sesión. */
  deck?: { name: string; size: number; valid: boolean } | null;
  now?: number;
  meta?: LoopMeta | null;
}

export interface LoopCard { id: string; kicker: string; title: string; body: string; href: string; tone: "gold" | "cyan" | "key" | "muted" }

/** Puro: qué tarjetas hay y en qué orden. Probado sin React. */
export function loopCards(p: LoopStripProps): LoopCard[] {
  const now = p.now ?? Date.now();
  const out: LoopCard[] = [];
  const packs = totalOwnedPacks(p.unopened);
  if (p.meta) {
    if (p.meta.continueTo) {
      out.push({ id: "continue", kicker: "Continuar", title: p.meta.continueTo.label, body: "Lo siguiente que merece la pena ahora mismo.", href: p.meta.continueTo.href, tone: "key" });
    }
    const l = p.meta.level;
    const parts: string[] = [];
    if (p.meta.claimable > 0) parts.push(`${p.meta.claimable} ${p.meta.claimable === 1 ? "recompensa por recoger" : "recompensas por recoger"}`);
    if (p.meta.activeObjectives > 0) parts.push(`${p.meta.activeObjectives} ${p.meta.activeObjectives === 1 ? "objetivo activo" : "objetivos activos"}`);
    if (p.meta.pendingPicks > 0) parts.push(`${p.meta.pendingPicks} Pick'em ${p.meta.pendingPicks === 1 ? "pendiente" : "pendientes"}`);
    out.push({ id: "level", kicker: `Nivel ${l.level}`, title: `${l.xpIntoLevel} / ${l.xpForNext} XP`, body: parts.join(" · ") || "Juega, abre sobres y completa objetivos para subir.", href: "/cuenta?seccion=progresion", tone: "cyan" });
    if (p.meta.competitive) {
      out.push({ id: "ranked", kicker: "Competitivo", title: "Sube en ranked", body: p.meta.competitive, href: "/duelos/competitivo", tone: "muted" });
    }
  }
  if (packs > 0) {
    out.push({ id: "packs", kicker: "Sobres", title: `Tienes ${packs} ${packs === 1 ? "sobre" : "sobres"}`, body: "Cada uno llena huecos del álbum.", href: "/packs", tone: "gold" });
  }
  const recent = recentlyAcquired(p.owned, now, 24 * 3600_000, 3);
  if (recent.length > 0) {
    const first = getCard(recent[0].cardId);
    const nick = first ? getPlayer(first.playerId)?.nick ?? first.playerId : recent[0].cardId;
    out.push({
      id: "recent", kicker: recent.length === 1 ? "Nueva carta" : `${recent.length} cartas nuevas`,
      title: nick + (first ? ` · ${first.ovr}` : ""), body: "Conseguidas en las últimas 24 h.", href: "/coleccion#recientes", tone: "cyan",
    });
  }
  if (p.deck !== undefined) {
    if (p.deck === null) {
      if (p.owned.length > 0) out.push({ id: "deck", kicker: "Tu equipo", title: "Sin equipo todavía", body: `Elige ${DUEL_DECK_SIZE} cartas y juega.`, href: "/duelos/mazos", tone: "key" });
    } else if (!p.deck.valid || p.deck.size < DUEL_DECK_SIZE) {
      out.push({ id: "deck", kicker: "Tu equipo", title: `${p.deck.size}/${DUEL_DECK_SIZE} cartas`, body: `«${p.deck.name}» aún no está listo para jugar.`, href: "/duelos/mazos", tone: "key" });
    }
  }
  if (p.owned.length > 0) {
    const teams = buildTeamCollection(p.owned).filter((t) => t.total > 0 && t.ownedDistinct > 0 && t.ownedDistinct < t.total);
    const next = teams.sort((a, b) => (b.ownedDistinct / b.total) - (a.ownedDistinct / a.total) || a.total - b.total)[0];
    if (next) {
      out.push({ id: "goal", kicker: "Próximo objetivo", title: `${next.displayName} ${next.ownedDistinct}/${next.total}`, body: `Te faltan ${next.total - next.ownedDistinct} para completar el equipo.`, href: "/coleccion/equipos", tone: "muted" });
    }
  }
  if (packs === 0 && p.owned.length === 0) {
    out.push({ id: "start", kicker: "Empieza", title: "Consigue tu primer sobre", body: "La colección empieza abriendo uno.", href: "/packs", tone: "gold" });
  }
  return out.slice(0, 4);
}

const TONE: Record<LoopCard["tone"], string> = {
  gold: "border-drl-gold/40 bg-drl-gold/[0.07] text-drl-gold",
  cyan: "border-drl-cyan/40 bg-drl-cyan/[0.07] text-drl-cyan",
  key: "border-drl/50 bg-drl/[0.10] text-white",
  muted: "border-white/15 bg-white/[0.04] text-ink-secondary",
};

export function LoopStrip(props: LoopStripProps) {
  const cards = useMemo(() => loopCards(props), [props]);
  if (cards.length === 0) return null;
  return (
    <section aria-label="Siguiente paso" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.id} href={c.href} className={`nx-focus nx-clip-sm flex min-h-[44px] flex-col gap-0.5 border px-4 py-3 transition hover:brightness-110 ${TONE[c.tone]}`}>
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] opacity-80">{c.kicker}</span>
          <span className="font-display text-base font-bold uppercase leading-tight text-white">{c.title}</span>
          <span className="text-caption text-ink-muted">{c.body}</span>
        </Link>
      ))}
    </section>
  );
}
