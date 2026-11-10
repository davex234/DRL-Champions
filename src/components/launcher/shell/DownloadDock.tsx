"use client";

/**
 * LAUNCHER — DÁRSENA DE DESCARGAS.
 *
 * La franja inferior. Solo existe cuando hay algo que bajar, y entonces está SIEMPRE: cambies
 * de pantalla, abras el perfil o entres en la configuración, la descarga se sigue viendo y se
 * sigue controlando. Es la diferencia entre un gestor de descargas y una barra de progreso.
 *
 * Con varias descargas se muestra la primera y se pliega el resto en un panel desplegable.
 */
import { AnimatePresence, motion } from "framer-motion";
import { formatBytes, formatEta, formatSpeed } from "@/platform";
import {
  canCancel, canPause, canResume, getGame, overallPercent, phaseLabel, type DownloadJob,
} from "@/launcher";
import { cn } from "@/lib/format";
import { StatusDot } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { TONE } from "@/components/ui/tone";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

export function DownloadDock({
  jobs, expanded, onToggleExpanded, onPause, onResume, onCancel, onSelect, motionScale,
}: {
  jobs: DownloadJob[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onPause: (gameId: string) => void;
  onResume: (gameId: string) => void;
  onCancel: (gameId: string) => void;
  onSelect: (gameId: string) => void;
  motionScale: number;
}) {
  useLocale();
  const [head, ...rest] = jobs;

  return (
    <AnimatePresence>
      {head && (
        <motion.footer
          initial={{ y: 70, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 70, opacity: 0 }}
          transition={{ duration: motionScale > 0 ? 0.35 : 0, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-chrome shrink-0 border-t border-white/[0.08] bg-black/55 backdrop-blur-xl"
        >
          <AnimatePresence initial={false}>
            {expanded && rest.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: motionScale > 0 ? 0.25 : 0 }}
                className="overflow-hidden border-b border-white/[0.06]"
              >
                {rest.map((job) => (
                  <DockRow
                    key={job.gameId}
                    job={job}
                    compact
                    onPause={onPause}
                    onResume={onResume}
                    onCancel={onCancel}
                    onSelect={onSelect}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <DockRow
            job={head}
            onPause={onPause}
            onResume={onResume}
            onCancel={onCancel}
            onSelect={onSelect}
            extra={
              rest.length > 0 && (
                <button
                  type="button"
                  onClick={onToggleExpanded}
                  className="nx-clip-sm shrink-0 bg-white/[0.06] px-3 py-2 font-display text-label font-bold uppercase tracking-[0.16em] text-white/60 transition hover:bg-white/[0.12] hover:text-white"
                >
                  +{rest.length} {t("en cola")} {expanded ? "▾" : "▴"}
                </button>
              )
            }
          />
        </motion.footer>
      )}
    </AnimatePresence>
  );
}

function DockRow({
  job, compact, onPause, onResume, onCancel, onSelect, extra,
}: {
  job: DownloadJob;
  compact?: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onSelect: (id: string) => void;
  extra?: React.ReactNode;
}) {
  useLocale();
  const game = getGame(job.gameId);
  const pct = overallPercent(job);
  const active = job.status === "downloading";
  const tone = job.status === "error" ? "bad" : job.status === "paused" ? "warn" : "info";

  return (
    <div className={cn("flex items-center gap-4 px-4", compact ? "py-2" : "py-3")}>
      <button
        type="button"
        onClick={() => onSelect(job.gameId)}
        className="flex min-w-0 shrink-0 items-center gap-2.5 text-left"
        style={{ width: 190 }}
      >
        <StatusDot tone={tone} pulse={active} size={7} />
        <span className="min-w-0">
          <span className="block truncate font-display text-[12.5px] font-bold tracking-wide text-white/90">
            {game?.name ?? job.gameId}
          </span>
          <span className="block truncate text-[10.5px] uppercase tracking-wider" style={{ color: `${TONE[tone]}cc` }}>
            {job.kind === "update" ? t("Actualización") : t("Instalación")} · {phaseLabel(job.status)}
          </span>
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-4">
          <span className="truncate text-caption text-white/45">
            {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}
            {active && <span className="ml-3 text-white/30">{formatSpeed(job.speedBps)}</span>}
            {active && <span className="ml-3 text-white/30">{formatEta(job.etaSec)} {t("restantes")}</span>}
            {job.error && <span className="ml-3 text-bad">{td(job.error)}</span>}
          </span>
          <span className="nx-readout shrink-0 text-[13px] text-white">{pct.toFixed(0)}%</span>
        </div>
        <Meter value={pct} tone={tone} height={compact ? 4 : 6} striped={active} />
      </div>

      {extra}

      <div className="flex shrink-0 items-center gap-1.5">
        {canPause(job.status) && <DockButton onClick={() => onPause(job.gameId)} label={t("Pausar")} glyph="❚❚" />}
        {canResume(job.status) && <DockButton onClick={() => onResume(job.gameId)} label={t("Reanudar")} glyph="▶" primary />}
        {canCancel(job.status) && <DockButton onClick={() => onCancel(job.gameId)} label={t("Cancelar")} glyph="✕" danger />}
      </div>
    </div>
  );
}

function DockButton({
  onClick, label, glyph, primary, danger,
}: { onClick: () => void; label: string; glyph: string; primary?: boolean; danger?: boolean }) {
  useLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      title={td(label)}
      aria-label={td(label)}
      className={cn(
        "nx-clip-sm grid h-9 w-9 place-items-center text-caption transition",
        primary
          ? "bg-drl/20 text-drl hover:bg-drl/35"
          : danger
            ? "bg-white/[0.05] text-white/45 hover:bg-bad/20 hover:text-bad"
            : "bg-white/[0.05] text-white/60 hover:bg-white/[0.12] hover:text-white",
      )}
      style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
    >
      {glyph}
    </button>
  );
}
