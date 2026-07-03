"use client";

/**
 * Superposiciones del entrenador en directo:
 *  - MicroDecisionPrompt: pregunta puntual en un momento clave (consume Voz).
 *  - TimeoutModal: el partido se pausa, la IA analiza y propone; el entrenador elige.
 *  - RoundEndBriefing: análisis post-ronda (por qué se ganó/perdió) antes de seguir.
 * Ninguna controla jugadores: todas emiten CONCEPTOS/órdenes que el sim ya entiende.
 */
import type { CoachCallId } from "@/sim";
import type { MicroPrompt, MicroOption } from "@/lib/match/microDecisions";
import type { TimeoutAnalysis } from "@/lib/match/coachIntel";
import type { RoundEndView } from "@/components/sim/useCoachMatch";
import { cn } from "@/lib/format";

const TONE: Record<string, string> = {
  danger: "border-rose-400/50 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25",
  go: "border-emerald-400/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25",
  calm: "border-white/20 bg-white/5 text-white/80 hover:bg-white/15",
};

function Shell({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md animate-rise rounded-2xl border bg-base-800/95 p-5 shadow-2xl" style={{ borderColor: accent }}>
        {children}
      </div>
    </div>
  );
}

export function MicroDecisionPrompt({ prompt, onRespond }: { prompt: MicroPrompt; onRespond: (call?: CoachCallId) => void }) {
  return (
    <Shell accent="rgba(255,46,99,0.5)">
      <p className="font-display text-[11px] uppercase tracking-[0.3em] text-drl">Decisión del entrenador</p>
      <h3 className="mt-1 font-display text-2xl font-bold uppercase text-white">{prompt.title}</h3>
      <p className="mt-1.5 text-sm text-white/60">{prompt.situation}</p>
      <div className="mt-4 grid gap-2">
        {prompt.options.map((o: MicroOption, i) => (
          <button key={i} onClick={() => onRespond(o.call)}
            className={cn("rounded-xl border px-4 py-3 text-left font-display text-sm font-bold uppercase tracking-wide transition", TONE[o.tone ?? "calm"])}>
            {o.label}
          </button>
        ))}
      </div>
    </Shell>
  );
}

const TIMEOUT_OPTIONS: { label: string; call?: CoachCallId; tone: keyof typeof TONE }[] = [
  { label: "Reagrupar y resetear", call: "regroup", tone: "calm" },
  { label: "Jugar por picks", call: "play-picks", tone: "calm" },
  { label: "Forzar / ejecutar", call: "execute", tone: "go" },
  { label: "Solo charla táctica", call: undefined, tone: "calm" },
];

export function TimeoutModal({ analysis, onRespond }: { analysis: TimeoutAnalysis; onRespond: (call?: CoachCallId) => void }) {
  return (
    <Shell accent="rgba(25,227,255,0.5)">
      <p className="font-display text-[11px] uppercase tracking-[0.3em] text-cyan-300">⏸ Timeout táctico</p>
      <h3 className="mt-1 font-display text-lg font-bold uppercase text-white">{analysis.situation}</h3>
      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="text-[10px] uppercase tracking-widest text-white/40">Análisis IA</p>
        <ul className="mt-1.5 space-y-1">
          {analysis.diagnosis.map((d, i) => (
            <li key={i} className="flex gap-1.5 text-[12px] text-white/70"><span className="text-cyan-300">›</span>{d}</li>
          ))}
        </ul>
        <p className="mt-2 border-t border-white/10 pt-2 text-[12px] text-white/80"><b className="text-cyan-300">Propuesta:</b> {analysis.proposal}</p>
      </div>
      <div className="mt-4 grid gap-2">
        {TIMEOUT_OPTIONS.map((o, i) => (
          <button key={i} onClick={() => onRespond(o.call)}
            className={cn("rounded-xl border px-4 py-2.5 text-left font-display text-sm font-bold uppercase tracking-wide transition", TONE[o.tone])}>
            {o.label}
          </button>
        ))}
      </div>
    </Shell>
  );
}

export function RoundEndBriefing({ view, onContinue, isLast }: { view: RoundEndView; onContinue: () => void; isLast: boolean }) {
  const a = view.causes;
  return (
    <div className="animate-rise mx-auto max-w-xl space-y-4">
      <div className={cn("rounded-2xl border p-5 text-center", view.won ? "border-emerald-400/40 bg-emerald-500/10" : "border-rose-400/40 bg-rose-500/10")}>
        <p className="font-display text-[11px] uppercase tracking-[0.3em] text-white/50">Ronda {view.roundNumber} · {view.reason ?? ""}</p>
        <h2 className={cn("font-display text-3xl font-bold uppercase", view.won ? "text-emerald-300" : "text-rose-300")}>{a.headline}</h2>
        <p className="mt-1 font-display text-2xl font-bold tabular-nums text-white">{view.score.home} - {view.score.away}</p>
        {view.topFragger && <p className="mt-1 text-sm text-white/50">⭐ Destacado: <b className="text-white/80">{view.topFragger.name}</b> ({view.topFragger.kills}K)</p>}
        {view.moments.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {view.moments.map((m, i) => (
              <span key={i}
                className={cn("rounded-md border px-2.5 py-1 font-display text-[11px] font-black uppercase tracking-widest", i === 0 && "animate-pulse")}
                style={{ borderColor: `${m.hex}88`, color: m.hex, background: `${m.hex}14`, boxShadow: i === 0 ? `0 0 16px ${m.hex}44` : "none" }}>
                {m.label}{m.sub ? ` · ${m.sub}` : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
        <p className="mb-2 font-display text-[11px] uppercase tracking-widest text-white/45">Por qué pasó</p>
        <ul className="space-y-1.5">
          {a.causes.map((c, i) => (
            <li key={i} className={cn("flex gap-2 rounded-lg border px-3 py-2 text-[13px]",
              c.tone === "good" ? "border-emerald-400/30 text-emerald-200" : c.tone === "bad" ? "border-rose-400/30 text-rose-200" : "border-white/15 text-white/70")}>
              <span>{c.tone === "good" ? "✓" : c.tone === "bad" ? "✕" : "•"}</span>{c.text}
            </li>
          ))}
        </ul>
      </div>

      <button onClick={onContinue}
        className="w-full rounded-2xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-4 font-display text-base font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
        {isLast ? "Ver resultado del partido ▸" : "Siguiente ronda → Sala táctica ▸"}
      </button>
    </div>
  );
}
