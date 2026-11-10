"use client";

/**
 * LAUNCHER — FICHA DE JUEGO.
 *
 * Todo lo que el usuario necesita antes de dedicarle 22 GB a algo: qué es, en qué estado
 * está, cuánto ocupa, qué pide la máquina, qué contenido trae y qué ha cambiado.
 *
 * Es dinámica: se dibuja a partir del juego seleccionado y de su entrada de biblioteca. No
 * hay una sola cifra escrita a mano en esta pantalla.
 */
import { motion } from "framer-motion";
import { formatBytes } from "@/platform";
import {
  formatDate, newsForGame, overallPercent, phaseLabel, primaryAction, stateLabel, stateTone,
  type DownloadJob, type Game, type GameAction, type LauncherNews, type LibraryEntry,
} from "@/launcher";
import { GameArtwork } from "./GameArtwork";
import { NewsCard } from "./NewsSection";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { NxButton } from "@/components/ui/NxButton";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Plate } from "@/components/ui/Surface";
import { CTA } from "./cta";
import { ns, td as i18nTd, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const i18nT = ns("launcher");

export function GameDetail({
  game, entry, job, motionScale, onAction, onUninstall, onOpenNews,
}: {
  game: Game;
  entry: LibraryEntry;
  job: DownloadJob | null;
  motionScale: number;
  onAction: (action: GameAction) => void;
  onUninstall: () => void;
  onOpenNews: (item: LauncherNews) => void;
}) {
  useLocale();
  const action = primaryAction(game, entry, job);
  const busy = job != null && job.status !== "done";
  const news = newsForGame(game.id);

  return (
    <motion.div
      key={game.id}
      initial={motionScale > 0 ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-6"
    >
      {/* Cabecera con artwork */}
      <div className="nx-clip relative isolate overflow-hidden border border-white/[0.07]">
        <GameArtwork game={game} variant="tile" parallax={false} />
        <div className="relative flex flex-wrap items-end justify-between gap-6 p-7">
          <div className="max-w-[560px] space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge dot tone={stateTone(entry.state)}>{stateLabel(entry.state, game, entry)}</Badge>
              <Badge>{i18nTd(game.genre)}</Badge>
              {game.tags.map((t) => (
                <Badge key={t}>{i18nTd(t)}</Badge>
              ))}
            </div>
            <h1
              className="font-display text-[clamp(2rem,3.6vw,3.2rem)] font-black uppercase leading-[0.9] tracking-tight text-white"
              style={{ textShadow: `0 0 50px ${game.palette.key}44` }}
            >
              {i18nTd(game.title)}
            </h1>
            <p className="font-display text-[13px] font-semibold uppercase tracking-[0.18em]" style={{ color: game.palette.accent }}>
              {i18nTd(game.tagline)}
            </p>
            <p className="text-[13.5px] leading-relaxed text-white/60">{i18nTd(game.description)}</p>
          </div>

          <div className="flex flex-col items-stretch gap-2">
            <NxButton size="lg" {...CTA[action.tone]} disabled={action.disabled} onClick={() => onAction(action)} className="min-w-[210px]">
              {tdIn("launcher", action.label)}
            </NxButton>
            {!game.bundled && entry.installedVersion && !busy && (
              <button
                type="button"
                onClick={onUninstall}
                className="font-display text-[10.5px] font-bold uppercase tracking-[0.2em] text-white/35 transition hover:text-bad"
              >
                {i18nT("Desinstalar")}
              </button>
            )}
          </div>
        </div>

        {busy && job && (
          <div className="relative border-t border-white/[0.07] bg-black/45 px-7 py-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="font-display text-caption font-bold uppercase tracking-[0.2em] text-white/70">
                {phaseLabel(job.status)} · {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}
              </span>
              <span className="nx-readout text-[14px] text-white">{overallPercent(job).toFixed(0)}%</span>
            </div>
            <Meter value={overallPercent(job)} tone={job.status === "paused" ? "warn" : "info"} striped={job.status === "downloading"} />
          </div>
        )}
      </div>

      {/* Ficha técnica */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Plate className="p-4">
          <Readout size="xs" label={i18nT("Versión publicada")} value={game.version} tone={game.palette.accent} />
          <p className="mt-1 text-caption text-white/35">
            {i18nT("Instalada:")} {entry.installedVersion ?? "—"}
          </p>
        </Plate>
        <Plate className="p-4">
          <Readout size="xs" label={i18nT("Tamaño en disco")} value={formatBytes(game.sizeBytes)} />
          <p className="mt-1 text-caption text-white/35">
            {game.patchBytes ? i18nT("Parche: {patchBytes}", { patchBytes: formatBytes(game.patchBytes) }) : i18nT("Sin parche pendiente")}
          </p>
        </Plate>
        <Plate className="p-4">
          <Readout size="xs" label={i18nT("Última actualización")} value={formatDate(game.updatedAt)} />
          <p className="mt-1 text-caption text-white/35">{i18nTd(game.developer)}</p>
        </Plate>
        <Plate className="p-4">
          <Readout size="xs" label={i18nT("Ruta")} value={entry.installPath ?? i18nT("No instalado")} />
          <p className="mt-1 text-caption text-white/35">
            {entry.lastPlayedAt ? i18nT("Última sesión: {lastPlayedAt}", { lastPlayedAt: formatDate(entry.lastPlayedAt) }) : i18nT("Sin sesiones registradas")}
          </p>
        </Plate>
      </div>

      {/* Contenido */}
      <section>
        <SectionTitle>{i18nT("Contenido")}</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {game.content.map((c) => (
            <Plate key={c.id} className="p-4 transition-colors duration-fast hover:border-white/20 hover:bg-white/[0.05]">
              <Badge>{i18nTd(c.kind)}</Badge>
              <h3 className="mt-2 font-display text-[14px] font-bold uppercase tracking-wide text-white">{i18nTd(c.title)}</h3>
              <p className="mt-1 text-[12px] leading-snug text-white/50">{i18nTd(c.summary)}</p>
            </Plate>
          ))}
        </div>
      </section>

      {/* Requisitos */}
      <section>
        <SectionTitle>{i18nT("Requisitos del sistema")}</SectionTitle>
        <Plate className="overflow-hidden">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-white/[0.07] bg-white/[0.02]">
                <th className="px-4 py-2.5 font-display text-[9.5px] font-bold uppercase tracking-[0.22em] text-white/35">{i18nT("Componente")}</th>
                <th className="px-4 py-2.5 font-display text-[9.5px] font-bold uppercase tracking-[0.22em] text-white/35">{i18nT("Mínimo")}</th>
                <th className="px-4 py-2.5 font-display text-[9.5px] font-bold uppercase tracking-[0.22em] text-white/35">{i18nT("Recomendado")}</th>
              </tr>
            </thead>
            <tbody>
              {game.requirements.map((r) => (
                <tr key={r.label} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-white/70">{i18nTd(r.label)}</td>
                  <td className="px-4 py-2.5 text-white/45">{i18nTd(r.minimum)}</td>
                  <td className="px-4 py-2.5" style={{ color: game.palette.accent }}>{i18nTd(r.recommended)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Plate>
      </section>

      {/* Novedades del título */}
      {news.length > 0 && (
        <section>
          <SectionTitle>{i18nT("Novedades de {juego}", { juego: game.name })}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {news.map((n, i) => (
              <NewsCard key={n.id} item={n} index={i} motionScale={motionScale} onOpen={() => onOpenNews(n)} />
            ))}
          </div>
        </section>
      )}
    </motion.div>
  );
}
