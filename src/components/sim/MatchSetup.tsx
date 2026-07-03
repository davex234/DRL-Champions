"use client";

/**
 * Pantalla previa al partido: elegir LADO inicial y RIVAL (dificultad). Ampliable a
 * rosters de prueba o equipos guardados. No decide nada de la simulación: solo recoge
 * la configuración y lanza el partido.
 */
import { useState } from "react";
import type { Side } from "@/sim";
import type { RivalDifficulty } from "@/lib/match/roster";
import { cn } from "@/lib/format";

const RIVALS: { id: RivalDifficulty; label: string; desc: string }[] = [
  { id: "easy", label: "Fácil", desc: "Rival de menor nivel" },
  { id: "normal", label: "Normal", desc: "Rival equilibrado" },
  { id: "hard", label: "Difícil", desc: "Los mejores jugadores" },
];

export function MatchSetup({ onPlay, initial }: {
  onPlay: (side: Side, difficulty: RivalDifficulty) => void;
  initial?: { side: Side; difficulty: RivalDifficulty } | null;
}) {
  const [side, setSide] = useState<Side>(initial?.side ?? "ATK");
  const [difficulty, setDifficulty] = useState<RivalDifficulty>(initial?.difficulty ?? "normal");

  return (
    <div className="mx-auto max-w-xl space-y-5 rounded-2xl border border-white/10 bg-base-700/40 p-6">
      <div>
        <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">Preparar partido</h2>
        <p className="text-sm text-white/50">Elige lado y rival. El partido es a 13 con cambio de lado.</p>
      </div>

      <Group label="Lado inicial">
        {(["ATK", "DEF"] as Side[]).map((sd) => (
          <Pill key={sd} active={side === sd} onClick={() => setSide(sd)}>{sd === "ATK" ? "Ataque" : "Defensa"}</Pill>
        ))}
      </Group>

      <Group label="Rival">
        {RIVALS.map((r) => (
          <button key={r.id} onClick={() => setDifficulty(r.id)}
            className={cn("flex-1 rounded-xl border px-3 py-2.5 text-left transition",
              difficulty === r.id ? "border-drl/50 bg-drl/10" : "border-white/10 bg-white/5 hover:bg-white/10")}>
            <p className="font-display text-sm font-bold uppercase tracking-wide text-white">{r.label}</p>
            <p className="text-[11px] text-white/45">{r.desc}</p>
          </button>
        ))}
      </Group>

      <button onClick={() => onPlay(side, difficulty)}
        className="w-full rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
        Jugar partido ▸
      </button>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("rounded-lg px-4 py-2 font-display text-xs uppercase tracking-wide transition",
        active ? "bg-drl text-white shadow-glow" : "border border-white/10 bg-white/5 text-white/60 hover:text-white")}>
      {children}
    </button>
  );
}
