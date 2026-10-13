"use client";

/**
 * LAUNCHER — pantalla EXCLUSIVA de actualización (estilo Riot/Battle.net), a ventana
 * completa. Mientras hay una actualización pendiente, el usuario NO puede entrar al juego.
 * Refleja la máquina de estados del controlador con animaciones suaves: disponible →
 * descargando (barra MB/MB + velocidad + ETA) → verificando → instalando → finalizando →
 * reiniciando. Incluye estado de error con código, reintentar, ver registros y salir.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BrandMark } from "@/branding/Logo";
import { formatBytes, formatSpeed, formatEta, getLogs, type UpdateState, type LogEntry } from "@/platform";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

const STEPS: { phase: UpdateState["phase"]; label: string }[] = [
  { phase: "downloading", label: "Descargando" },
  { phase: "verifying", label: "Verificando" },
  { phase: "installing", label: "Instalando" },
  { phase: "finalizing", label: "Finalizando" },
  { phase: "restarting", label: "Reiniciando" },
];
const ORDER: UpdateState["phase"][] = [
  "available", "downloading", "verifying", "downloaded", "installing", "finalizing", "ready", "restarting",
];
const PHASE_TITLE: Partial<Record<UpdateState["phase"], string>> = {
  available: "Nueva versión disponible",
  downloading: "Descargando actualización",
  verifying: "Verificando archivos",
  downloaded: "Descarga completa",
  installing: "Instalando",
  finalizing: "Finalizando",
  ready: "Actualización lista",
  restarting: "Reiniciando launcher",
};

export function UpdateRequiredScreen({
  state,
  onUpdate,
  onInstall,
  onRestart,
  onRetry,
  onExit,
}: {
  state: UpdateState;
  onUpdate: () => void;
  onInstall: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  useLocale();
  const [showLogs, setShowLogs] = useState(false);
  const { phase } = state;

  if (phase === "error") {
    return <ErrorView state={state} onRetry={onRetry} onExit={onExit} showLogs={showLogs} setShowLogs={setShowLogs} />;
  }

  const inProgress = ORDER.indexOf(phase) >= ORDER.indexOf("downloading") && phase !== "ready" && phase !== "downloaded";
  const curIdx = ORDER.indexOf(phase);

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-base-900 text-white">
      <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-drl/20 blur-3xl" />
      <div className="absolute -bottom-48 right-0 h-[32rem] w-[32rem] rounded-full bg-drl-cyan/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-2xl px-6"
      >
        {/* Cabecera */}
        <div className="flex flex-col items-center text-center">
          <BrandMark size={96} />
          <p className="mt-5 font-display text-3xl font-black uppercase tracking-wide">
            {t("DRL")} <span className="text-drl">{t("CHAMPIONS")}</span>
          </p>
          <motion.h1
            key={phase}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 font-display text-xl font-bold uppercase tracking-wide text-drl-gold"
          >
            {td(PHASE_TITLE[phase]) ?? t("Actualización")}
          </motion.h1>
          <p className="mt-2 text-white/55">
            <span className="text-white/35">v{td(state.current)}</span>
            <span className="mx-2 text-drl-gold">→</span>
            <span className="font-bold text-drl-gold">v{td(state.available)}</span>
            {state.availableSize != null && (
              <span className="ml-3 text-white/40">· {formatBytes(state.availableSize)}</span>
            )}
          </p>
        </div>

        {/* Notas del parche (solo antes de empezar) */}
        {phase === "available" && state.notes && (
          <div className="mt-6 max-h-44 overflow-y-auto rounded-2xl border border-white/10 bg-base-800/50 p-4 text-[13px] leading-relaxed text-white/70 backdrop-blur">
            <p className="mb-1 text-[10px] uppercase tracking-widest text-white/40">{t("Notas del parche")}</p>
            <p className="whitespace-pre-line">{td(state.notes)}</p>
          </div>
        )}

        {/* Progreso */}
        {inProgress && (
          <div className="mt-7">
            <div className="h-4 w-full overflow-hidden rounded-full border border-white/10 bg-base-900">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-drl via-drl-gold to-drl-cyan"
                animate={{ width: `${phase === "downloading" ? state.percent : 100}%` }}
                transition={{ ease: "easeOut", duration: 0.3 }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[13px] text-white/65">
              {phase === "downloading" ? (
                <>
                  <span className="tabular-nums">
                    {state.percent.toFixed(0)}% · {formatBytes(state.bytesDownloaded)} / {formatBytes(state.bytesTotal)}
                  </span>
                  <span className="tabular-nums">
                    {formatSpeed(state.speedBps)} · {formatEta(state.etaSec)} {t("restante")}
                  </span>
                </>
              ) : (
                <span className="text-drl-gold">{td(PHASE_TITLE[phase])}…</span>
              )}
            </div>
          </div>
        )}

        {/* Stepper */}
        {(inProgress || phase === "downloaded" || phase === "ready") && (
          <div className="mt-6 flex gap-2">
            {STEPS.map((s) => {
              const reached = curIdx >= ORDER.indexOf(s.phase);
              const active = phase === s.phase;
              return (
                <div key={s.label} className="flex-1">
                  <div className={`h-1.5 rounded-full transition-colors ${reached ? "bg-drl-gold" : "bg-white/10"}`} />
                  <p className={`mt-1.5 text-center text-[10px] uppercase tracking-wider transition-colors ${active ? "text-drl-gold" : reached ? "text-white/70" : "text-white/30"}`}>
                    {td(s.label)}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Acciones */}
        <div className="mt-8 flex flex-col gap-2">
          <AnimatePresence mode="wait">
            {phase === "available" && (
              <Action key="upd" onClick={onUpdate} primary>{t("⤓ ACTUALIZAR")}</Action>
            )}
            {phase === "downloaded" && (
              <Action key="ins" onClick={onInstall} primary>{t("⚙ INSTALAR")}</Action>
            )}
            {phase === "ready" && (
              <Action key="res" onClick={onRestart} primary>{t("↻ REINICIAR Y APLICAR")}</Action>
            )}
          </AnimatePresence>

          <button
            onClick={onExit}
            disabled={inProgress}
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-6 py-3 font-display text-sm font-bold uppercase tracking-wider text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {t("Salir")}
          </button>
        </div>

        <p className="mt-5 text-center text-[11px] text-white/35">
          {t("DRL Champions se mantiene actualizado automáticamente. La firma de cada versión se verifica antes de instalar.")}
        </p>
      </motion.div>
    </div>
  );
}

function Action({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onClick={onClick}
      className={`w-full rounded-2xl px-8 py-5 font-display text-2xl font-black uppercase tracking-wider shadow-glow transition hover:-translate-y-0.5 hover:brightness-110 ${
        primary ? "bg-gradient-to-r from-drl-gold to-[#c9962a] text-base-900" : "bg-gradient-to-r from-drl to-[#7b1733] text-white"
      }`}
    >
      {children}
    </motion.button>
  );
}

function ErrorView({
  state,
  onRetry,
  onExit,
  showLogs,
  setShowLogs,
}: {
  state: UpdateState;
  onRetry: () => void;
  onExit: () => void;
  showLogs: boolean;
  setShowLogs: (v: boolean) => void;
}) {
  useLocale();
  const logs: LogEntry[] = showLogs ? getLogs().slice(-40).reverse() : [];
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-base-900 text-white">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-rose-500/15 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-lg rounded-3xl border border-rose-400/20 bg-base-800/60 p-8 text-center backdrop-blur"
      >
        <p className="text-4xl">⚠️</p>
        <h1 className="mt-3 font-display text-2xl font-black uppercase">{t("No se ha podido actualizar")}</h1>
        <div className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-left">
          <p className="text-[11px] uppercase tracking-widest text-rose-300/80">{t("Código de error")}</p>
          <p className="font-mono text-sm font-bold text-rose-200">{state.errorCode ?? t("UNKNOWN")}</p>
          <p className="mt-2 text-[11px] uppercase tracking-widest text-rose-300/80">{t("Descripción")}</p>
          <p className="text-[13px] text-white/80">{td(state.error) ?? t("Error desconocido.")}</p>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2">
          <button onClick={onRetry} className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-4 py-3 font-display text-sm font-bold uppercase text-white transition hover:brightness-110">
            {t("↻ Reintentar")}
          </button>
          <button onClick={() => setShowLogs(!showLogs)} className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-semibold text-white/80 transition hover:bg-white/10">
            {t("📜 Registros")}
          </button>
          <button onClick={onExit} className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-semibold text-white/80 transition hover:bg-white/10">
            {t("Salir")}
          </button>
        </div>

        {showLogs && (
          <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-white/10 bg-base-900/80 p-3 text-left font-mono text-[10px]">
            {logs.length === 0 ? (
              <p className="text-white/40">{t("Sin registros.")}</p>
            ) : (
              logs.map((l, i) => (
                <p key={i} className={l.level === "error" ? "text-rose-300" : l.level === "warn" ? "text-amber-300" : "text-white/55"}>
                  [{td(l.scope)}] {td(l.msg)}
                </p>
              ))
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
