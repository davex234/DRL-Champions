"use client";

/**
 * LAUNCHER — panel central del ciclo de actualización (AAA).
 *
 * Refleja la máquina de estados del controlador: comprobando → al día / disponible →
 * descargando (barra MB/MB + velocidad + ETA) → instalando → verificando → listo. El botón
 * grande conmuta entre JUGAR (al día) y ACTUALIZAR (disponible). Todo el dato viene del
 * estado observable; este componente solo pinta.
 */
import { formatBytes, formatSpeed, formatEta, type UpdateState } from "@/platform";

const PHASE_LABEL: Record<UpdateState["phase"], string> = {
  idle: "Inicializando…",
  checking: "Buscando actualizaciones…",
  "up-to-date": "El juego está al día",
  available: "Nueva versión disponible",
  downloading: "Descargando actualización…",
  verifying: "Verificando firma…",
  downloaded: "Descarga completa",
  installing: "Instalando…",
  finalizing: "Finalizando…",
  ready: "Listo para reiniciar",
  restarting: "Reiniciando…",
  error: "Se produjo un error",
};

// Mini-pasos visibles durante una actualización en curso.
const STEPS: { key: UpdateState["phase"][]; label: string }[] = [
  { key: ["downloading"], label: "Descargar" },
  { key: ["installing"], label: "Instalar" },
  { key: ["verifying"], label: "Verificar" },
  { key: ["ready"], label: "Finalizar" },
];
const ORDER: UpdateState["phase"][] = ["downloading", "installing", "verifying", "ready"];

export function UpdatePanel({
  state,
  busy,
  onPlay,
  onUpdate,
  onRetry,
}: {
  state: UpdateState;
  busy: boolean;
  onPlay: () => void;
  onUpdate: () => void;
  onRetry: () => void;
}) {
  const { phase } = state;
  const inProgress =
    phase === "downloading" || phase === "verifying" || phase === "downloaded" ||
    phase === "installing" || phase === "finalizing" || phase === "ready" || phase === "restarting";
  const hasUpdate = phase === "available";

  return (
    <div className="flex flex-col justify-end">
      <h1 className="font-display text-5xl font-black uppercase leading-[0.9] md:text-7xl">
        No disparas.
        <br />
        <span className="text-drl text-glow">Piensas.</span>
      </h1>
      <p className="mt-3 max-w-md text-white/55">
        El simulador-manager de esports de Valorant. Dirige, lee al rival y gana.
      </p>

      {/* Estado de actualización */}
      <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-base-800/50 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-white/70">
            <Dot phase={phase} />
            {PHASE_LABEL[phase]}
          </p>
          {hasUpdate && state.available && (
            <p className="text-[12px] text-white/45">
              <span className="text-white/35">v{state.current}</span>
              <span className="mx-1 text-drl-gold">→</span>
              <span className="font-bold text-drl-gold">v{state.available}</span>
            </p>
          )}
        </div>

        {/* Notas de parche cuando hay update */}
        {hasUpdate && state.notes && (
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-[12px] text-white/55">{state.notes}</p>
        )}

        {/* Barra de progreso durante la actualización */}
        {inProgress && (
          <div className="mt-3">
            <div className="h-3 w-full overflow-hidden rounded-full border border-white/10 bg-base-900">
              <div
                className="h-full rounded-full bg-gradient-to-r from-drl to-drl-gold transition-[width] duration-200"
                style={{ width: `${phase === "downloading" ? state.percent : 100}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/55">
              {phase === "downloading" ? (
                <>
                  <span>
                    {formatBytes(state.bytesDownloaded)} / {formatBytes(state.bytesTotal)} ({state.percent.toFixed(0)}%)
                  </span>
                  <span className="tabular-nums">
                    {formatSpeed(state.speedBps)} · {formatEta(state.etaSec)} restante
                  </span>
                </>
              ) : (
                <span className="text-drl-gold">{PHASE_LABEL[phase]}</span>
              )}
            </div>
            {/* Mini-pasos */}
            <div className="mt-3 flex gap-1.5">
              {STEPS.map((s) => {
                const reached = ORDER.indexOf(phase) >= ORDER.indexOf(s.key[0]);
                return (
                  <div key={s.label} className="flex-1">
                    <div className={`h-1 rounded-full ${reached ? "bg-drl-gold" : "bg-white/10"}`} />
                    <p className={`mt-1 text-center text-[9px] uppercase tracking-wider ${reached ? "text-white/70" : "text-white/30"}`}>
                      {s.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
            {state.error || "Error desconocido"}.{" "}
            <button onClick={onRetry} className="underline hover:text-white">
              Reintentar
            </button>
          </div>
        )}
      </div>

      {/* Botón principal */}
      {hasUpdate ? (
        <button
          onClick={onUpdate}
          disabled={busy}
          className="mt-4 w-full max-w-xl rounded-2xl bg-gradient-to-r from-drl-gold to-[#c9962a] px-8 py-5 font-display text-2xl font-black uppercase tracking-wider text-base-900 shadow-glow transition hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:opacity-60"
        >
          ⤓ ACTUALIZAR · v{state.available}
        </button>
      ) : (
        <button
          onClick={onPlay}
          disabled={busy}
          className="mt-4 w-full max-w-xl rounded-2xl bg-gradient-to-r from-drl to-[#7b1733] px-8 py-5 font-display text-2xl font-black uppercase tracking-wider text-white shadow-glow transition hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:opacity-60"
        >
          {busy ? "ESPERA…" : "▸ JUGAR"}
        </button>
      )}
    </div>
  );
}

function Dot({ phase }: { phase: UpdateState["phase"] }) {
  const color =
    phase === "error"
      ? "#ff7a7a"
      : phase === "available"
        ? "#ffd35c"
        : phase === "up-to-date" || phase === "ready"
          ? "#37e6a0"
          : "#7cc0ff";
  const pulse = phase === "checking" || phase === "downloading" || phase === "installing" || phase === "verifying";
  return <span className={`h-2 w-2 rounded-full ${pulse ? "animate-pulse" : ""}`} style={{ background: color }} />;
}
