"use client";

/**
 * TIMEOUT REAL — el partido se PAUSA y el entrenador ve TODO en una foto: marcador,
 * momentum, economía, control del mapa, forma del quinteto, últimas rondas, patrones del
 * rival, lecturas en vivo y agregados (executes/retakes/post-plants/trades). Elige una
 * orden sugerida o solo charla. Consume `TimeoutDossier` (datos puros).
 */
import type { TimeoutDossier } from "@/lib/match/timeoutDossier";
import { COACH_COMMANDS, type CoachCommandId } from "@/coach";
import { cn } from "@/lib/format";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="font-display text-sm font-bold text-white">{value}</p>
      {sub && <p className="text-[9px] text-white/45">{sub}</p>}
    </div>
  );
}

const rate = (s: { attempts: number; success: number }) => s.attempts ? `${Math.round((s.success / s.attempts) * 100)}%` : "—";

export function TimeoutDossierPanel({ dossier, onRespond }: { dossier: TimeoutDossier; onRespond: (call?: CoachCommandId) => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm">
      <div className="max-h-full w-full max-w-2xl animate-rise overflow-y-auto rounded-2xl border border-cyan-400/40 bg-base-800/95 p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="font-display text-[11px] uppercase tracking-[0.3em] text-cyan-300">⏸ Tiempo muerto táctico</p>
          <p className="font-display text-sm font-bold text-white">{dossier.situation}</p>
        </div>

        {/* Cifras clave */}
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          <Stat label="Marcador" value={`${dossier.score.home}-${dossier.score.away}`} />
          <Stat label="Momentum" value={`${dossier.momentum > 0 ? "+" : ""}${Math.round(dossier.momentum)}`} sub={dossier.momentum >= 0 ? "a favor" : "en contra"} />
          {dossier.mapControl && <Stat label="Control mapa" value={`${dossier.mapControl.ours}`} sub={`rival ${dossier.mapControl.theirs}`} />}
          <Stat label="Racha perd." value={`${dossier.lossStreak}`} />
          <Stat label="Executes" value={rate(dossier.stats.executes)} sub={`${dossier.stats.executes.attempts} int.`} />
          <Stat label="Retakes" value={rate(dossier.stats.retakes)} sub={`${dossier.stats.retakes.attempts} int.`} />
          <Stat label="Post-plant" value={rate(dossier.stats.postplants)} sub={`${dossier.stats.postplants.attempts} int.`} />
          <Stat label="Trades" value={`${dossier.stats.trades}`} />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* Diagnóstico + propuesta */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] uppercase tracking-widest text-cyan-300/80">Análisis IA</p>
            <ul className="mt-1 space-y-1">
              {dossier.diagnosis.map((d, i) => <li key={i} className="flex gap-1.5 text-[12px] text-white/70"><span className="text-cyan-300">›</span>{d}</li>)}
            </ul>
            <p className="mt-2 border-t border-white/10 pt-2 text-[12px] text-white/80"><b className="text-cyan-300">Propuesta:</b> {dossier.proposal}</p>
          </div>
          {/* Patrones + lecturas */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] uppercase tracking-widest text-amber-300/80">Rival y lecturas</p>
            <ul className="mt-1 space-y-1">
              {[...dossier.patterns, ...dossier.reads].slice(0, 5).map((p, i) => <li key={i} className="flex gap-1.5 text-[12px] text-white/70"><span className="text-amber-300">›</span>{p}</li>)}
            </ul>
          </div>
        </div>

        {/* Forma del quinteto */}
        <div className="mt-3">
          <p className="mb-1 text-[10px] uppercase tracking-widest text-white/40">Forma del quinteto</p>
          <div className="grid grid-cols-5 gap-1.5">
            {dossier.form.map((f) => (
              <div key={f.name} className="rounded-lg border border-white/10 bg-base-900/50 p-1.5 text-center">
                <p className="truncate font-display text-[10px] font-bold text-white">{f.name}</p>
                <p className={cn("text-[10px]", f.tilt >= 50 ? "text-rose-300" : f.confidence >= 60 ? "text-emerald-300" : "text-white/50")}>
                  {f.tilt >= 50 ? `tilt ${f.tilt}` : `conf ${f.confidence}`}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Decisiones */}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {dossier.suggestedCommands.map((id) => (
            <button key={id} onClick={() => onRespond(id)}
              className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-2.5 text-left font-display text-sm font-bold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-500/20">
              {COACH_COMMANDS[id].label} <span className="ml-1 text-[10px] font-normal text-white/45">· {COACH_COMMANDS[id].desc}</span>
            </button>
          ))}
          <button onClick={() => onRespond(undefined)}
            className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white/80 transition hover:bg-white/15">
            Solo charla táctica
          </button>
        </div>
      </div>
    </div>
  );
}
