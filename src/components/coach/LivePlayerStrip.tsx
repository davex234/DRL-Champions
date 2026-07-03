"use client";

/**
 * FICHA VIVA DEL JUGADOR (en ronda) — lo que el entrenador ve de cada jugador EN VIVO:
 * HP, escudo, arma, utilidad disponible, información conocida, objetivo/rol e intención,
 * más un pulso del estado mental. Todo sale del `SimPlayer` real (no inventa nada).
 */
import type { RoundState, SimPlayer, Intent } from "@/sim";
import { cn } from "@/lib/format";

const INTENT_LABEL: Record<Intent, string> = {
  move: "Avanza", hold: "Aguanta", push: "Empuja", rotate: "Rota", fight: "Duelo",
  trade: "Trade", plant: "Planta", defuse: "Desactiva", fallback: "Repliega",
};

function abilityLeft(s: RoundState, p: SimPlayer): { left: number; total: number } {
  const total = p.agent?.agent.utility.charges ?? 0;
  const used = s.map?.used[p.id] ?? 0;
  return { left: Math.max(0, total - used), total };
}

function Ficha({ s, p }: { s: RoundState; p: SimPlayer }) {
  const hp = Math.max(0, Math.round(p.hp));
  const shield = Math.max(0, Math.round(p.shield ?? 0));
  const weapon = p.loadout?.primary ?? p.loadout?.sidearm ?? "—";
  const util = abilityLeft(s, p);
  const known = Object.keys(p.lastSeen ?? {}).length;
  const conf = Math.round(p.mental.confidence);
  const tilt = Math.round(p.mental.tilt);
  const hpColor = hp > 60 ? "#37e6a0" : hp > 30 ? "#ffd35c" : "#ff4d6a";

  return (
    <div className={cn("flex flex-col gap-1 rounded-xl border p-2", p.alive ? "border-white/10 bg-base-800/70" : "border-white/5 bg-base-900/60 opacity-50")}>
      <div className="flex items-center justify-between">
        <span className="truncate font-display text-[11px] font-bold uppercase tracking-wide text-white">{p.name}</span>
        <span className="text-[9px] uppercase tracking-wide text-white/40">{p.role}</span>
      </div>
      {/* HP + escudo */}
      <div className="flex items-center gap-1">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full transition-all" style={{ width: `${hp}%`, background: hpColor }} />
        </div>
        <span className="w-6 text-right text-[9px] tabular-nums text-white/60">{hp}</span>
        {shield > 0 && <span className="text-[9px] text-cyan-300" title="escudo">🛡{shield}</span>}
      </div>
      {/* Arma + utilidad + info */}
      <div className="flex items-center justify-between text-[9px] text-white/50">
        <span className="truncate" title="arma">🔫 {weapon}</span>
        <span title="utilidad disponible">⚡{util.left}/{util.total}</span>
        {known > 0 && <span title="enemigos con info">👁{known}</span>}
      </div>
      {/* Objetivo + pulso mental */}
      <div className="flex items-center justify-between border-t border-white/5 pt-1 text-[9px]">
        <span className="text-white/55">{p.alive ? `${INTENT_LABEL[p.intent]} · ${p.targetZone}` : "Eliminado"}</span>
        <span className={cn(tilt >= 55 ? "text-rose-300" : conf >= 65 ? "text-emerald-300" : "text-white/40")}>
          {tilt >= 55 ? `tilt ${tilt}` : `conf ${conf}`}
        </span>
      </div>
    </div>
  );
}

export function LivePlayerStrip({ snap }: { snap: RoundState }) {
  const ours = snap.players.filter((p) => p.side === snap.coachSide);
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
      {ours.map((p) => <Ficha key={p.id} s={snap} p={p} />)}
    </div>
  );
}
