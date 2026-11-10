"use client";

/**
 * FASE 51.1 · EL EDITOR DE PLANTILLA CON CARTAS REALES.
 *
 * Lo usan «Plantilla» (`/entrenador/equipos`) y el asistente JUGAR (`/entrenador/jugar`): el mismo
 * editor, el mismo store (`useTeamStore`, en este dispositivo) y las mismas reglas
 * (`validateTeam`). Nada nuevo que persistir.
 *
 * ────────────────────────── LA CARTA EXACTA ──────────────────────────
 *
 * Un titular es el `uid` de una carta POSEÍDA (`OwnedCard.uid`), y cada carta poseída tiene su
 * `cardId` (jugador + edición concretos). Así que el equipo ya sabe QUÉ carta usa, no solo qué
 * jugador: aquí se pinta ese `cardId`, con su WebP del catálogo, mediante `CardArt`. Si un titular
 * ya no está en la colección, el hueco lo dice («carta que ya no tienes»); no se elige otra.
 *
 * ────────────────────────── LA CARTA ES EL ASSET ──────────────────────────
 *
 * Ni marcos, ni fondos de rareza, ni cajas: `CardArt` limpio. Hover = sube y escala (transform);
 * seleccionada = halo sobre la silueta (`glow` → drop-shadow), nunca un rectángulo.
 */
import { useMemo, useState } from "react";
import { useGameStore } from "@/store/useGameStore";
import { useTeamStore, resolveCardRef } from "@/store/useTeamStore";
import { validateTeam, MAX_STARTERS } from "@/domain/teams/types";
import { cardViews, type CardView } from "@/lib/match/cardView";
import { CardArt } from "@/components/cards/CardArt";
import type { RoleId } from "@/domain/cards/types";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("coach");

const CYAN = "rgba(47,224,255,0.95)";

export function TeamRosterEditor({ teamId, compact = false }: { teamId: string; compact?: boolean }) {
  useLocale();
  const ownedCards = useGameStore((s) => s.ownedCards);
  const team = useTeamStore((s) => s.teams.find((t) => t.id === teamId) ?? null);
  const setStarters = useTeamStore((s) => s.setStarters);
  const renameTeam = useTeamStore((s) => s.renameTeam);

  const cards = useMemo(() => cardViews(ownedCards), [ownedCards]);
  const byUid = useMemo(() => new Map(cards.map((c) => [c.uid, c])), [cards]);
  /** El puesto elegido (0..4). Pulsar una carta de la colección la pone AHÍ. */
  const [slot, setSlot] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [rol, setRol] = useState<RoleId | "todos">("todos");
  const [aviso, setAviso] = useState<string | null>(null);

  if (!team) return null;
  const starters = team.starters;
  const errors = validateTeam(team, resolveCardRef);

  /** Jugadores ya titulares, sin contar el puesto que se está cambiando. */
  const jugadoresOcupados = new Set(
    starters.filter((_, i) => i !== slot).map((u) => byUid.get(u)?.playerId).filter(Boolean) as string[],
  );

  const poner = (c: CardView) => {
    const actual = starters.indexOf(c.uid);
    if (actual >= 0) { setSlot(actual); return; }                       // ya es titular: se selecciona
    if (jugadoresOcupados.has(c.playerId)) return;                       // mismo jugador dos veces: la regla lo prohíbe
    const next = [...starters];
    if (slot !== null && slot < next.length) next[slot] = c.uid;         // reemplazar
    else if (next.length < MAX_STARTERS) next.push(c.uid);               // añadir al primer hueco
    else { setAviso(tr("Quinteto completo: pulsa primero el titular que quieres cambiar.")); return; }
    setStarters(team.id, next);
    setSlot(null);
    setAviso(null);
  };
  const quitar = (i: number) => { setStarters(team.id, starters.filter((_, k) => k !== i)); setSlot(null); };

  const q = query.trim().toLowerCase();
  const visibles = cards.filter((c) =>
    (rol === "todos" || c.role === rol) &&
    (!q || c.nick.toLowerCase().includes(q) || c.team.toLowerCase().includes(q) || c.teamTag.toLowerCase().includes(q)));
  const roles = Array.from(new Set(cards.map((c) => c.role))) as RoleId[];

  return (
    <div className="space-y-5" data-testid="team-roster-editor">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={team.name}
          onChange={(e) => renameTeam(team.id, e.target.value)}
          aria-label={tr("Nombre del equipo")}
          className="min-h-[44px] min-w-[12rem] flex-1 bg-black/40 px-3 font-display text-[15px] font-bold uppercase tracking-wide text-white outline-none shadow-[inset_0_0_0_1px_rgba(47,224,255,0.2)] focus:shadow-[inset_0_0_0_1px_rgba(47,224,255,0.8)]"
        />
        <span className={cn("nx-label", errors.length === 0 ? "!text-[rgb(63,214,150)]" : "!text-[#ffd35c]")} data-testid="team-status">
          {errors.length === 0 ? tr("✓ Equipo listo") : tr("{length}/{MAX_STARTERS} titulares", { length: starters.length, MAX_STARTERS })}
        </span>
      </div>

      {/* ═══ TITULARES: cinco cartas ═══ */}
      <section aria-label={tr("Titulares")}>
        <p className="nx-coach-kicker mb-2">{tr("Titulares ·")} {starters.length}/{MAX_STARTERS}</p>
        <ol className={cn("grid grid-cols-5 gap-2 sm:gap-4", compact ? "max-w-[620px]" : "max-w-[860px]")} data-testid="team-starters">
          {Array.from({ length: MAX_STARTERS }, (_, i) => {
            const uid = starters[i];
            const c = uid ? byUid.get(uid) : undefined;
            const on = slot === i;
            return (
              <li key={i} className="flex flex-col items-center gap-1.5">
                {uid ? (
                  <button
                    type="button"
                    className="nx-roster-card"
                    onClick={() => { setSlot(on ? null : i); setAviso(null); }}
                    aria-pressed={on}
                    aria-label={c ? `${c.nick} · ${c.variantLabel}${on ? " (seleccionada)" : ""}` : tr("Carta que ya no tienes")}
                    data-card-id={c?.cardId}
                    data-testid={`starter-${i}`}
                  >
                    {c ? (
                      <CardArt src={c.art} alt={`${c.nick} · ${c.variantLabel}`} shadow={on ? "lifted" : "rest"} glow={on ? CYAN : null} glowSize={16} sizes="(max-width: 640px) 18vw, 160px" />
                    ) : (
                      <span className="nx-roster-slot-empty text-[11px]">{tr("Carta que ya no tienes")}</span>
                    )}
                  </button>
                ) : (
                  <button type="button" onClick={() => setSlot(on ? null : i)} aria-pressed={on} className="w-full" data-testid={`starter-${i}`} aria-label={tr("Puesto {v} vacío", { v: i + 1 })}>
                    <span className="nx-roster-slot-empty font-display text-[13px]" data-active={on}>
                      <span className="text-center leading-tight">{String(i + 1).padStart(2, "0")}<br /><span className="text-[9px] tracking-[0.2em]">{tr("VACÍO")}</span></span>
                    </span>
                  </button>
                )}
                <span className="w-full truncate text-center font-display text-[10.5px] font-bold uppercase tracking-[0.08em] text-white/85 sm:text-[12px]">
                  {c ? c.nick : uid ? "—" : " "}
                </span>
                {c && on && (
                  <button type="button" onClick={() => quitar(i)} className="nx-coach-btn !min-h-[32px] !px-2.5" data-variant="mag" data-size="sm" data-testid={`remove-${i}`}>
                    {tr("Quitar")}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <p className={cn("mt-2 text-[12.5px]", aviso ? "text-[#ffd35c]" : "nx-coach-muted")} data-testid="team-hint" aria-live="polite">
          {td(aviso) ?? (slot !== null
            ? tr("Puesto {v} seleccionado: pulsa una carta de tu colección para {v2}.", { v: slot + 1, v2: starters[slot] ? tr("cambiarla") : tr("ponerla ahí") })
            : starters.length < MAX_STARTERS
              ? tr("Pulsa una carta de tu colección para añadirla al primer hueco libre.")
              : tr("Pulsa un titular para cambiarlo o quitarlo."))}
        </p>
      </section>

      {errors.length > 0 && starters.length > 0 && (
        <ul className="space-y-1" data-testid="team-errors">
          {errors.map((e, i) => <li key={i} className="nx-coach-conflict px-3 py-1.5 text-xs text-white/90">✕ {td(e.message)}</li>)}
        </ul>
      )}

      {/* ═══ TU COLECCIÓN: cartas ═══ */}
      <section aria-label={tr("Tu colección")}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="nx-coach-kicker mr-auto">{tr("Tu colección ·")} {cards.length}</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("Buscar jugador o equipo…")}
            aria-label={tr("Buscar jugador o equipo")}
            className="min-h-[40px] w-52 bg-black/40 px-3 text-xs text-white outline-none shadow-[inset_0_0_0_1px_rgba(47,224,255,0.2)] focus:shadow-[inset_0_0_0_1px_rgba(47,224,255,0.8)]"
          />
          <div role="group" aria-label={tr("Filtrar por rol")} className="flex flex-wrap gap-1">
            {(["todos", ...roles] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRol(r)} aria-pressed={rol === r} className="nx-coach-tool !min-h-[40px] !px-3">
                {r === "todos" ? tr("Todos") : td(r)}
              </button>
            ))}
          </div>
        </div>
        {cards.length === 0 ? (
          <p className="nx-coach-panel-flat p-6 text-center text-sm text-white/55">
            {fill(tr("No tienes cartas todavía. Abre sobres en la {enlace}.", slots("enlace")), { enlace: <a href="/tienda" className="text-[#2fe0ff] underline">{tr("tienda")}</a> })}
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8" data-testid="collection-grid">
            {visibles.map((c) => {
              const titular = starters.includes(c.uid);
              const mismoJugador = !titular && jugadoresOcupados.has(c.playerId);
              const lleno = !titular && slot === null && starters.length >= MAX_STARTERS;
              /* Solo se apaga lo que la REGLA prohíbe (mismo jugador). Quinteto completo no apaga la colección: se elige un titular y se cambia. */
              const bloqueada = mismoJugador;
              return (
                <li key={c.uid} className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    className="nx-roster-card"
                    onClick={() => poner(c)}
                    disabled={bloqueada}
                    aria-pressed={titular}
                    aria-label={`${c.nick} · ${c.variantLabel} · ${c.role} · ${c.ovr}${titular ? tr(" (titular)") : mismoJugador ? tr(" (ese jugador ya es titular)") : ""}`}
                    title={mismoJugador ? tr("Ese jugador ya es titular") : lleno ? tr("Quinteto completo: elige un titular para cambiarlo") : undefined}
                    data-card-id={c.cardId}
                    data-testid="collection-card"
                  >
                    <CardArt src={c.art} alt={`${c.nick} · ${c.variantLabel}`} dim={bloqueada} glow={titular ? CYAN : null} glowSize={10} sizes="(max-width: 640px) 30vw, 140px" />
                  </button>
                  <span className="w-full truncate text-center text-[10.5px] leading-tight text-white/70">
                    <b className="font-display uppercase tracking-wide text-white">{c.nick}</b> · {c.ovr}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Los cinco titulares de un equipo en miniatura (listas, selector de JUGAR, pre-partido). */
export function TeamCardStrip({ starters, size = 44, className }: { starters: string[]; size?: number; className?: string }) {
  const ownedCards = useGameStore((s) => s.ownedCards);
  const byUid = useMemo(() => new Map(cardViews(ownedCards).map((c) => [c.uid, c])), [ownedCards]);
  return (
    <span className={cn("flex items-end gap-1.5", className)} data-testid="team-card-strip">
      {Array.from({ length: MAX_STARTERS }, (_, i) => {
        const c = starters[i] ? byUid.get(starters[i]) : undefined;
        return (
          <span key={i} style={{ width: size }} className="shrink-0" data-card-id={c?.cardId}>
            {c ? <CardArt src={c.art} alt={c.nick} shadow="none" /> : <span className="nx-roster-slot-empty" />}
          </span>
        );
      })}
    </span>
  );
}
