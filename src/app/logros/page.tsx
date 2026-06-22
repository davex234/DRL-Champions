"use client";

import { useMemo } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { useGameStore, buildAchievementContext } from "@/store/useGameStore";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/format";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";

export default function LogrosPage() {
  return (
    <HydrationGate>
      <Achievements />
    </HydrationGate>
  );
}

function Achievements() {
  const { toast, notify } = useToast();
  const state = useGameStore((s) => s);
  const claim = useGameStore((s) => s.claimAchievement);
  const ctx = useMemo(() => buildAchievementContext(state), [state]);

  const completedCount = ACHIEVEMENTS.filter((a) => a.progress(ctx) >= a.goal).length;

  return (
    <section className="animate-rise">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Logros
        </h1>
        <p className="mt-1 text-white/50">
          {completedCount} de {ACHIEVEMENTS.length} completados · reclama tus recompensas.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ACHIEVEMENTS.map((a) => {
          const current = Math.min(a.progress(ctx), a.goal);
          const done = current >= a.goal;
          const claimed = state.claimedAchievements.includes(a.id);
          const pct = Math.round((current / a.goal) * 100);
          return (
            <div
              key={a.id}
              className={cn(
                "relative overflow-hidden rounded-2xl border bg-base-700/50 p-5",
                done ? "border-drl-cyan/40" : "border-white/10",
              )}
            >
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    "grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl",
                    done ? "bg-drl-cyan/20" : "bg-white/5 grayscale",
                  )}
                >
                  {a.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-lg font-bold uppercase text-white">{a.name}</h3>
                  <p className="text-sm text-white/50">{a.description}</p>

                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          done ? "bg-gradient-to-r from-drl-cyan to-drl" : "bg-white/30",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-display text-xs tabular-nums text-white/50">
                      {current}/{a.goal}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="font-display text-sm font-bold text-drl-gold">
                  🪙 {formatCredits(a.reward)}
                </span>
                {claimed ? (
                  <span className="rounded-lg bg-drl-cyan/15 px-3 py-1.5 font-display text-xs uppercase text-drl-cyan">
                    ✓ Reclamado
                  </span>
                ) : (
                  <button
                    disabled={!done}
                    onClick={() => {
                      claim(a.id);
                      notify(`¡Logro reclamado! +🪙 ${formatCredits(a.reward)}`, true);
                    }}
                    className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Reclamar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Toast toast={toast} />
    </section>
  );
}
