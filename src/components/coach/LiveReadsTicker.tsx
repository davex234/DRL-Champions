"use client";

/**
 * LECTURAS EN VIVO — la IA analista AYUDA (no decide). Muestra el feed priorizado de
 * `liveCoachReads`; cada lectura puede sugerir una orden que el entrenador ejecuta con
 * un toque (gastando Voz). Es la voz del analista al oído del entrenador.
 */
import type { CoachRead } from "@/lib/match/coachLive";
import { COACH_COMMANDS, type CoachCommandId } from "@/coach";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coach");

const KIND_ICON: Record<CoachRead["kind"], string> = {
  enemy: "🎯", us: "🛡️", map: "🗺️", economy: "💰", mental: "🧠", utility: "⚡",
};

export function LiveReadsTicker({ reads, vozLeft, onCommand }: {
  reads: CoachRead[]; vozLeft: number; onCommand: (id: CoachCommandId) => void;
}) {
  useLocale();
  if (reads.length === 0) return null;
  const top = reads.slice(0, 3);
  return (
    <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-3">
      <p className="mb-1.5 font-display text-[10px] uppercase tracking-[0.3em] text-cyan-300">{t("Lecturas del analista")}</p>
      <ul className="space-y-1.5">
        {top.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="text-[12px]">{td(KIND_ICON[r.kind])}</span>
            <span className="flex-1 text-[12px] leading-snug text-white/75">{td(r.text)}</span>
            {r.suggests && vozLeft > 0 && (
              <button onClick={() => onCommand(r.suggests!)}
                className={cn("shrink-0 rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-400/20")}>
                {td(COACH_COMMANDS[r.suggests].label)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
