"use client";

/**
 * LAUNCHER — TIENDA.
 *
 * El escaparate del sello: todo el catálogo con su estado real de biblioteca. No es una
 * galería muerta — cada ficha sabe si ya lo tienes, y el botón cambia en consecuencia.
 */
import { motion } from "framer-motion";
import { formatBytes } from "@/platform";
import {
  effectiveState, getGames, stateLabel, stateTone,
  type DownloadJob, type Game, type LibraryEntry,
} from "@/launcher";
import { GameArtwork } from "./GameArtwork";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Plate } from "@/components/ui/Surface";

export function StoreView({
  entries, jobs, motionScale, onOpen, onInstall,
}: {
  entries: Record<string, LibraryEntry>;
  jobs: Record<string, DownloadJob>;
  motionScale: number;
  onOpen: (gameId: string) => void;
  onInstall: (game: Game) => void;
}) {
  const games = getGames();
  const [featured, ...rest] = games;

  return (
    <motion.div
      initial={motionScale > 0 ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-6"
    >
      <header>
        <h1 className="font-display text-[34px] font-black uppercase leading-none tracking-tight text-white">
          Tien<span className="text-drl">da</span>
        </h1>
        <p className="mt-1.5 text-[13px] text-white/45">Catálogo completo del sello. Todos los títulos, sin coste de entrada.</p>
      </header>

      {/* Destacado */}
      <div className="nx-clip relative isolate overflow-hidden border border-white/[0.07]">
        <GameArtwork game={featured} variant="tile" parallax={false} />
        <div className="relative flex flex-wrap items-end justify-between gap-6 p-7">
          <div className="max-w-[520px] space-y-2.5">
            <Badge>Destacado</Badge>
            <h2 className="font-display text-[36px] font-black uppercase leading-none tracking-tight text-white">
              {featured.title}
            </h2>
            <p className="text-[13px] leading-relaxed text-white/60">{featured.description}</p>
          </div>
          <NxButton size="lg" variant="primary" onClick={() => onOpen(featured.id)}>
            Ver título
          </NxButton>
        </div>
      </div>

      <section>
        <SectionTitle>Catálogo</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rest.map((game, i) => {
            const entry = entries[game.id];
            const state = effectiveState(entry, jobs[game.id]);
            const owned = state !== "not-installed";
            return (
              <motion.div
                key={game.id}
                initial={motionScale > 0 ? { opacity: 0, y: 16 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] }}
                whileHover={motionScale > 0 ? { y: -4 } : undefined}
              >
                <Plate className="transition-colors duration-fast hover:border-white/20 hover:bg-white/[0.05] overflow-hidden">
                  <button type="button" onClick={() => onOpen(game.id)} className="relative block h-[150px] w-full overflow-hidden">
                    <GameArtwork game={game} variant="tile" parallax={false} />
                    <span
                      className="absolute inset-x-0 bottom-0 p-3 text-left font-display text-[18px] font-black uppercase leading-none tracking-wide text-white"
                      style={{ textShadow: "0 4px 20px rgba(0,0,0,0.9)" }}
                    >
                      {game.name}
                    </span>
                  </button>
                  <div className="space-y-2.5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge dot tone={stateTone(state)}>{stateLabel(state, game, entry)}</Badge>
                      <Badge>{game.genre}</Badge>
                    </div>
                    <p className="line-clamp-2 text-[12px] leading-snug text-white/50">{game.tagline}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-caption text-white/35">{formatBytes(game.sizeBytes)}</span>
                      <NxButton
                        size="md"
                        variant={owned ? "secondary" : "primary"}
                        onClick={() => (owned ? onOpen(game.id) : onInstall(game))}
                      >
                        {owned ? "Ver" : "Instalar"}
                      </NxButton>
                    </div>
                  </div>
                </Plate>
              </motion.div>
            );
          })}
        </div>
      </section>
    </motion.div>
  );
}
