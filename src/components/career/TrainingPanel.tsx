"use client";

/**
 * SESIONES DE ENTRENAMIENTO — el entrenador decide QUÉ entrenar, A QUIÉN e INTENSIDAD.
 * Cada sesión mejora unas cosas y empeora otras (lo resuelve el Development Engine).
 */
import { useState } from "react";
import type { TrainingSessionId, TrainingIntensity } from "@/development";
import { cn } from "@/lib/format";

const SESSIONS: { id: TrainingSessionId; label: string; hint: string }[] = [
  { id: "aim", label: "Aim", hint: "Puntería (cansa)" },
  { id: "utility", label: "Utilidad", hint: "Uso de utilidad" },
  { id: "retake", label: "Retake", hint: "Retakes + IQ" },
  { id: "execute", label: "Execute", hint: "Entradas/post-plant" },
  { id: "mental", label: "Mental", hint: "Sangre fría, baja estrés" },
  { id: "teamplay", label: "Teamplay", hint: "Trades + comunicación" },
  { id: "communication", label: "Comms", hint: "Liderazgo/IGL" },
  { id: "review", label: "Review", hint: "Lectura/economía" },
  { id: "rest", label: "Descanso", hint: "Recupera fatiga" },
];
const INTENSITIES: TrainingIntensity[] = ["light", "normal", "hard"];
const INT_LABEL: Record<TrainingIntensity, string> = { light: "Suave", normal: "Normal", hard: "Dura" };

export function TrainingPanel({ count, onTrain }: { count: number; onTrain: (id: TrainingSessionId, intensity: TrainingIntensity) => void }) {
  const [session, setSession] = useState<TrainingSessionId>("aim");
  const [intensity, setIntensity] = useState<TrainingIntensity>("normal");
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-[11px] uppercase tracking-widest text-white/45">Entrenamiento</p>
        <span className="text-[11px] text-white/45">{count} seleccionado{count === 1 ? "" : "s"}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SESSIONS.map((s) => (
          <button key={s.id} onClick={() => setSession(s.id)} title={s.hint}
            className={cn("rounded-lg border px-2.5 py-1.5 text-left transition",
              session === s.id ? "border-drl bg-drl/15 shadow-glow" : "border-white/10 bg-white/5 hover:bg-white/10")}>
            <p className="font-display text-[11px] font-bold uppercase tracking-wide text-white">{s.label}</p>
            <p className="text-[9px] text-white/40">{s.hint}</p>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-white/10 bg-base-900/50 p-0.5">
          {INTENSITIES.map((i) => (
            <button key={i} onClick={() => setIntensity(i)}
              className={cn("rounded-md px-3 py-1 font-display text-[11px] uppercase transition", intensity === i ? "bg-drl text-white" : "text-white/50 hover:text-white")}>
              {INT_LABEL[i]}
            </button>
          ))}
        </div>
        <button onClick={() => onTrain(session, intensity)} disabled={count === 0}
          className="ml-auto rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:opacity-30">
          Entrenar ▸
        </button>
      </div>
    </div>
  );
}
