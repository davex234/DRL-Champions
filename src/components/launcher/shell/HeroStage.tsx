"use client";

/**
 * LAUNCHER — HERO CINEMATOGRÁFICO.
 *
 * El plano principal del cliente: artwork a sangre, caída a negro por la izquierda, ceniza
 * en suspensión, haz de luz y un CTA que es función del estado del juego (nunca al revés).
 *
 * Tres decisiones que sostienen la sensación de producto:
 *
 *  1. El artwork REACCIONA al ratón, pero por variables CSS (`useParallax`), no por estado.
 *  2. Al cambiar de juego hay CRUCE, no corte: la escena saliente se desenfoca y se va
 *     mientras la entrante llega desde una escala levemente mayor.
 *  3. Cuando hay descarga, el progreso vive DENTRO del hero: no se manda al usuario a otra
 *     pantalla a mirar una barra.
 */
import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatBytes, formatEta, formatSpeed } from "@/platform";
import {
  overallPercent, phaseLabel, primaryAction, stateLabel, stateTone,
  type DownloadJob, type Game, type GameAction, type LibraryEntry,
} from "@/launcher";
import { GameArtwork } from "./GameArtwork";
import { Particles } from "./Particles";
import { useParallax } from "@/components/visual/useParallax";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { NxButton } from "@/components/ui/NxButton";
import { CTA } from "./cta";

export function HeroStage({
  game, entry, job, motionScale, heavyEffects, onAction, onDetails, onCancel,
}: {
  game: Game;
  entry: LibraryEntry;
  job: DownloadJob | null;
  motionScale: number;
  heavyEffects: boolean;
  onAction: (action: GameAction) => void;
  onDetails: () => void;
  onCancel: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  useParallax(stageRef, motionScale * 0.6);

  const action = primaryAction(game, entry, job);
  const state = job && job.status !== "done" ? (job.kind === "update" ? "updating" : "installing") : entry.state;
  const busy = job != null && job.status !== "done" && job.status !== "cancelled";
  const tone = stateTone(job?.status === "paused" ? "paused" : state);

  return (
    <div
      ref={stageRef}
      /*
       * Altura del plano. Fija por viewport (no `flex-1`): un hero que se estira hasta llenar
       * la columna deja un agujero negro entre el titular y el borde inferior en pantallas
       * altas, que es exactamente lo que separa un launcher de un maquetado.
       */
      className="nx-clip relative isolate h-[clamp(400px,48vh,600px)] shrink-0 overflow-hidden border border-white/[0.07]"
      style={{ ["--nx-chamfer" as string]: "26px" }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={game.id}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.06, filter: "blur(14px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 1.02, filter: "blur(10px)" }}
          transition={{ duration: motionScale > 0 ? 0.55 : 0, ease: [0.16, 1, 0.3, 1] }}
        >
          <GameArtwork game={game} variant="hero" parallax={motionScale > 0} />
          {heavyEffects && (
            <Particles
              seed={game.artSeed}
              color={game.palette.accent}
              count={Math.round(18 * motionScale)}
              className="absolute inset-0 overflow-hidden"
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Contenido. Ancho contenido a propósito: el texto no debe cruzar el punto de luz. */}
      <div className="absolute inset-0 flex flex-col justify-end gap-5 p-7 lg:p-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={game.id}
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: motionScale > 0 ? 0.42 : 0, ease: [0.16, 1, 0.3, 1], delay: motionScale > 0 ? 0.08 : 0 }}
            className="max-w-[640px] space-y-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge dot tone={job?.status === "paused" ? "warn" : tone}>
                {job && busy ? phaseLabel(job.status) : stateLabel(entry.state, game, entry)}
              </Badge>
              <Badge>{game.genre}</Badge>
              <Badge>{game.developer}</Badge>
            </div>

            <h1
              className="font-display text-[clamp(2.6rem,5.2vw,4.6rem)] font-black uppercase leading-[0.88] tracking-[-0.01em] text-white"
              style={{ textShadow: `0 0 60px ${game.palette.key}55, 0 8px 40px rgba(0,0,0,0.9)` }}
            >
              {game.title}
            </h1>

            <p className="font-display text-[15px] font-semibold uppercase tracking-[0.2em]" style={{ color: game.palette.accent }}>
              {game.tagline}
            </p>

            <p className="max-w-[560px] text-[13.5px] leading-relaxed text-white/60">{game.description}</p>
          </motion.div>
        </AnimatePresence>

        {/* Progreso dentro del plano: la descarga es parte del hero, no una pantalla aparte. */}
        {busy && job && (
          <div className="max-w-[640px] space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-display text-[12px] font-bold uppercase tracking-[0.22em] text-white/80">
                {phaseLabel(job.status)}
                <span className="ml-2 text-white/40">
                  {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}
                </span>
              </p>
              <p className="nx-readout text-[15px] text-white">{overallPercent(job).toFixed(0)}%</p>
            </div>
            <Meter
              value={overallPercent(job)}
              tone={job.status === "paused" ? "warn" : "key"}
              striped={job.status === "downloading"}
              height={9}
            />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-caption text-white/45">
              <span>{job.status === "downloading" ? formatSpeed(job.speedBps) : "—"}</span>
              <span>{job.status === "downloading" ? `${formatEta(job.etaSec)} restantes` : phaseLabel(job.status)}</span>
              <span className="truncate">{job.installPath}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <NxButton size="lg"
            {...CTA[action.tone]}
            disabled={action.disabled}
            onClick={() => onAction(action)}
            className="min-w-[220px]"
          >
            {action.label}
          </NxButton>
          <NxButton variant="secondary" size="md" onClick={onDetails}>
            Más información
          </NxButton>
          {busy && job && job.status !== "installing" && (
            <button
              type="button"
              onClick={onCancel}
              className="font-display text-caption font-bold uppercase tracking-[0.2em] text-white/40 transition hover:text-bad"
            >
              Cancelar
            </button>
          )}
          <div className="ml-auto hidden items-center gap-6 lg:flex">
            <HeroFact label="Versión" value={game.version} />
            <HeroFact label="Tamaño" value={formatBytes(game.sizeBytes)} />
            <HeroFact label="Actualizado" value={game.updatedAt.replace(/-/g, ".")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="font-display text-[9px] font-bold uppercase tracking-[0.26em] text-white/30">{label}</p>
      <p className="nx-readout text-[15px] text-white/85">{value}</p>
    </div>
  );
}
