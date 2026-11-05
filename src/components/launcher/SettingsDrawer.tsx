"use client";

/** LAUNCHER — cajón de Configuración: comportamiento de actualización + canal (rama). */
import { motion } from "framer-motion";
import { ChannelSwitcher } from "./ChannelSwitcher";
import { clampPollMinutes, type Channel, type UpdatePrefs } from "@/platform";

const TOGGLES: { key: keyof UpdatePrefs; label: string; desc: string }[] = [
  { key: "checkOnStart", label: "Buscar actualizaciones al iniciar", desc: "Comprueba versión nada más abrir." },
  { key: "autoDownload", label: "Descargar automáticamente", desc: "Empieza la descarga sin preguntar." },
  { key: "autoInstall", label: "Instalar automáticamente", desc: "Instala en cuanto termina la descarga." },
  { key: "autoRestart", label: "Reiniciar automáticamente", desc: "Reabre el juego al terminar." },
  { key: "periodicCheck", label: "Comprobar mientras juegas", desc: "Revisa periódicamente si hay versión nueva." },
];

export function SettingsDrawer({
  prefs,
  setPrefs,
  channel,
  changeChannel,
  busy,
  onClose,
}: {
  prefs: UpdatePrefs;
  setPrefs: (patch: Partial<UpdatePrefs>) => void;
  channel: Channel;
  changeChannel: (c: Channel) => void;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.aside
        initial={{ x: 420 }}
        animate={{ x: 0 }}
        exit={{ x: 420 }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-base-900/95 p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-black uppercase tracking-wide">Configuración</h2>
          <button onClick={onClose} className="rounded-lg border border-white/10 px-3 py-1 text-sm text-white/60 hover:text-white">
            ✕
          </button>
        </div>

        <p className="mt-6 text-[10px] uppercase tracking-widest text-white/40">Actualizaciones</p>
        <div className="mt-2 space-y-2">
          {TOGGLES.map((t) => (
            <button
              key={t.key}
              onClick={() => setPrefs({ [t.key]: !prefs[t.key] })}
              className="flex w-full items-start gap-3 rounded-xl border border-white/10 bg-base-800/60 p-3 text-left transition hover:border-white/25"
            >
              <span
                className={`mt-0.5 grid h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${prefs[t.key] ? "bg-drl" : "bg-white/15"}`}
              >
                <span className={`h-4 w-4 rounded-full bg-white transition-transform ${prefs[t.key] ? "translate-x-4" : ""}`} />
              </span>
              <span>
                <span className="block text-[13px] font-semibold">{t.label}</span>
                <span className="block text-[11px] text-white/45">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {prefs.periodicCheck && (
          <div className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-base-800/60 p-3">
            <span>
              <span className="block text-[13px] font-semibold">Intervalo de comprobación</span>
              <span className="block text-[11px] text-white/45">Cada cuánto consultar el servidor.</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPrefs({ pollMinutes: clampPollMinutes(prefs.pollMinutes - 5) })}
                className="grid h-7 w-7 place-items-center rounded-lg border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
              >
                −
              </button>
              <span className="w-14 text-center font-display text-sm font-bold tabular-nums text-white">
                {prefs.pollMinutes} min
              </span>
              <button
                onClick={() => setPrefs({ pollMinutes: clampPollMinutes(prefs.pollMinutes + 5) })}
                className="grid h-7 w-7 place-items-center rounded-lg border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
              >
                +
              </button>
            </div>
          </div>
        )}

        <p className="mt-6 text-[10px] uppercase tracking-widest text-white/40">Canal (rama)</p>
        <div className="mt-2">
          <ChannelSwitcher channel={channel} onChange={changeChannel} disabled={busy} />
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-white/40">
          Las actualizaciones usan el sistema oficial de Tauri con firma verificada. Con todo
          activado, el juego se mantiene solo: abres, se actualiza, se reinicia y juegas.
        </p>
      </motion.aside>
    </div>
  );
}
