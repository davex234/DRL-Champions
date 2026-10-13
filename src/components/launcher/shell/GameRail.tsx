"use client";

/**
 * LAUNCHER — CARRIL DE JUEGOS.
 *
 * La biblioteca, a la izquierda y siempre visible. Cada fila lleva su miniatura procedural, su
 * estado y —si se está moviendo— su propio hilo de progreso, para que el usuario no tenga que
 * seleccionar un juego para saber cómo va su descarga.
 *
 * El orden no es alfabético: manda el estado (`sortLibrary`). Lo jugable arriba, lo que aún no
 * está en disco al final. Es lo que uno quiere de un launcher a las once de la noche.
 */
import { motion } from "framer-motion";
import {
  effectiveState, overallPercent, sortLibrary, stateLabel, stateTone,
  type DownloadJob, type Game, type LibraryEntry,
} from "@/launcher";
import { cn } from "@/lib/format";
import { GameArtwork } from "./GameArtwork";
import { StatusDot } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { SectionTitle } from "@/components/ui/SectionTitle";

export function GameRail({
  games, entries, jobs, selectedId, onSelect, motionScale,
}: {
  games: Game[];
  entries: Record<string, LibraryEntry>;
  jobs: Record<string, DownloadJob>;
  selectedId: string;
  onSelect: (gameId: string) => void;
  motionScale: number;
}) {
  const stateOf = (id: string) => effectiveState(entries[id], jobs[id]);
  const ordered = sortLibrary(games, stateOf);
  const installed = games.filter((g) => {
    const s = stateOf(g.id);
    return s === "ready" || s === "installed";
  }).length;

  return (
    <aside className="flex h-full min-h-0 w-[248px] shrink-0 flex-col border-r border-white/[0.06] bg-black/25 px-3 py-4">
      <SectionTitle className="px-1">
        Biblioteca
      </SectionTitle>
      <p className="mb-3 px-1 text-caption text-white/35">
        <span className="nx-readout text-white/70">{installed}</span> de {games.length} instalados
      </p>

      <nav className="nx-scroll -mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
        {ordered.map((game, i) => {
          const entry = entries[game.id];
          const job = jobs[game.id] ?? null;
          const state = stateOf(game.id);
          const tone = stateTone(state);
          const active = game.id === selectedId;
          const busy = state === "installing" || state === "updating";

          return (
            <button
              key={game.id}
              type="button"
              onClick={() => onSelect(game.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "nx-enter nx-clip-sm group relative flex w-full items-center gap-3 p-2 text-left transition-colors duration-fast",
                active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
              )}
              style={{ ["--enter-delay" as string]: `${60 + i * 45}ms` }}
            >
              {/* Filo de selección: la única marca de "estás aquí". */}
              <span
                aria-hidden
                className="absolute inset-y-1 left-0 w-[3px] origin-center rounded-full transition-transform duration-fast"
                style={{
                  background: `linear-gradient(180deg, ${game.palette.key}, ${game.palette.accent})`,
                  transform: `scaleY(${active ? 1 : 0})`,
                  boxShadow: active ? `0 0 12px ${game.palette.key}` : "none",
                }}
              />

              <span className="nx-clip-sm relative h-[46px] w-[46px] shrink-0 overflow-hidden">
                <GameArtwork game={game} variant="thumb" parallax={false} />
                <span
                  className="absolute inset-0 grid place-items-center font-display text-[13px] font-black tracking-tight text-white"
                  style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
                >
                  {game.monogram}
                </span>
                <span
                  aria-hidden
                  className="absolute inset-0 transition-opacity duration-fast"
                  style={{ boxShadow: `inset 0 0 0 1px ${active ? `${game.palette.key}99` : "rgba(255,255,255,0.10)"}` }}
                />
              </span>

              <span className="min-w-0 flex-1">
                <span className={cn("block truncate font-display text-[13px] font-bold tracking-wide transition-colors", active ? "text-white" : "text-white/75 group-hover:text-white")}>
                  {game.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <StatusDot tone={tone} pulse={busy} size={5} />
                  <span className="truncate text-[10.5px] uppercase tracking-wider text-white/40">
                    {busy && job ? `${overallPercent(job).toFixed(0)}%` : stateLabel(state, game, entry)}
                  </span>
                </span>
                {busy && job && (
                  <motion.span
                    className="mt-1.5 block"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={{ duration: motionScale > 0 ? 0.25 : 0 }}
                  >
                    <Meter value={overallPercent(job)} tone="info" height={3} />
                  </motion.span>
                )}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
