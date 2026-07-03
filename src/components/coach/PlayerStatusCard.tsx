"use client";

/**
 * Tarjeta psicológica de jugador para la sala táctica: barras, colores e iconos
 * (NO texto plano) del estado mental REAL (Identity/Mental Engine) + economía +
 * obediencia + racha. Lo que un entrenador mira de un vistazo antes de decidir.
 */
import type { PlayerCardModel } from "@/lib/match/coachIntel";
import { roleLabel } from "@/lib/match/coachIntel";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/format";

/** Barra 0..100. `invert` = más alto es PEOR (tilt/fatiga/presión). */
function Bar({ label, value, invert = false, icon }: { label: string; value: number; invert?: boolean; icon: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const good = invert ? 100 - v : v;
  const color = good >= 66 ? "#37e6a0" : good >= 33 ? "#ffd35c" : "#ff4d6a";
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-4 text-center text-[11px]" title={label}>{icon}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: color }} />
      </div>
      <span className="w-6 text-right text-[10px] tabular-nums text-white/45">{v}</span>
    </div>
  );
}

export function PlayerStatusCard({ card }: { card: PlayerCardModel }) {
  // Momentum -100..100 → 0..100 para mostrarlo como "forma".
  const form = (card.mental.momentum + 100) / 2;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-base-800/70 p-3">
      <div className="flex items-center gap-2.5">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/5">
          {card.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.image} alt={card.name} className="h-full w-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : null}
          <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[9px] font-bold text-drl">{card.ovr}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold uppercase tracking-wide text-white">{card.name}</p>
          <p className="truncate text-[10px] text-white/45">
            <span className="text-white/70">{roleLabel(card.role)}</span> · {card.style}
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <Bar label="Confianza" value={card.mental.confidence} icon="💪" />
        <Bar label="Moral" value={card.mental.morale} icon="🔥" />
        <Bar label="Forma" value={form} icon="📈" />
        <Bar label="Tilt" value={card.mental.tilt} invert icon="😤" />
        <Bar label="Cansancio" value={card.mental.fatigue} invert icon="🥵" />
        <Bar label="Presión" value={card.mental.pressure} invert icon="🎯" />
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-1.5 text-[10px]">
        <span className="text-white/45">Obed. <span className="text-white/75">{Math.round(card.obedience * 100)}%</span></span>
        <span className="font-semibold text-drl-cyan">{formatCredits(card.credits)}</span>
      </div>

      {card.recent.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] uppercase tracking-widest text-white/30">Racha</span>
          {card.recent.map((w, i) => (
            <span key={i} className={cn("h-2 w-2 rounded-full", w ? "bg-emerald-400" : "bg-rose-500/70")} />
          ))}
          {card.killsLastRound > 0 && <span className="ml-auto text-[10px] text-white/40">{card.killsLastRound}K última</span>}
        </div>
      )}
    </div>
  );
}
