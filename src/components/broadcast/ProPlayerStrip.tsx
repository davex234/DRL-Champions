"use client";

/**
 * Fichas de jugador estilo retransmisión (una columna por bando). TONTO: lee el
 * RoundState en vivo (`snap.players`) + créditos del Economy Engine. Muestra foto,
 * nombre, rol, arma, escudo, utilidad, confianza/forma, economía y bajas — sin tocar
 * ningún motor. Vivo/muerto, flash y jugador observado con animación.
 */
import { motion } from "framer-motion";
import type { RoundState, SimPlayer, Side } from "@/sim";
import { getItem } from "@/buy";
import { formatCredits, cn } from "@/lib/format";
import { sideHex } from "./theme";

const ROLE: Record<string, string> = { entry: "ENT", igl: "IGL", lurk: "LRK", anchor: "ANC", support: "SUP" };

function weaponLabel(p: SimPlayer): string {
  const id = p.loadout?.primary ?? p.loadout?.sidearm;
  if (!id) return "—";
  return getItem(id)?.name ?? "—";
}
function shieldGlyph(p: SimPlayer): string {
  return p.loadout?.armor === "heavy" ? "🛡" : p.loadout?.armor === "light" ? "🛡" : "";
}

export function ProPlayerStrip({
  snap, side, align, creditsByName, focusId,
}: {
  snap: RoundState;
  side: Side;
  align: "left" | "right";
  creditsByName: Record<string, number>;
  focusId: string | null;
}) {
  const hex = sideHex(side);
  const right = align === "right";
  const players = snap.players.filter((p) => p.side === side);
  // bajas de la ronda por jugador (para "últimos eventos")
  const kills: Record<string, number> = {};
  for (const e of snap.events) {
    if (e.type !== "kill") continue;
    const n = String((e.data as { byName?: string }).byName ?? "");
    if (n) kills[n] = (kills[n] ?? 0) + 1;
  }

  return (
    <div className={cn("flex w-[148px] flex-col gap-1", right ? "items-end" : "items-start")}>
      {players.map((p, i) => {
        const dead = !p.alive;
        const focus = p.id === focusId;
        const conf = Math.round(p.mental?.confidence ?? 50);
        const armor = p.loadout?.armor ?? "none";
        const util = Math.max(0, Math.min(4, p.loadout?.utility ?? 0));
        const k = kills[p.name] ?? 0;
        const flashed = p.flashedUntil > snap.tick;
        return (
          <motion.div key={p.id}
            initial={{ x: right ? 20 : -20, opacity: 0 }} animate={{ x: 0, opacity: dead ? 0.45 : 1 }}
            transition={{ delay: 0.04 * i, type: "spring", stiffness: 200, damping: 24 }}
            className={cn("relative w-full overflow-hidden rounded-md border bg-gradient-to-r from-black/70 to-black/45 backdrop-blur-sm",
              right ? "flex-row-reverse" : "")}
            style={{
              borderColor: focus ? hex : "rgba(255,255,255,0.08)",
              boxShadow: focus ? `0 0 14px ${hex}77` : "none",
            }}>
            {/* franja de bando */}
            <div className="absolute inset-y-0 w-[3px]" style={{ [right ? "right" : "left"]: 0, background: hex }} />
            <div className={cn("flex items-stretch gap-1.5 px-1.5 py-1", right && "flex-row-reverse text-right")}>
              {/* avatar */}
              <div className="relative mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded bg-white/5">
                {p.meta?.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.meta.image} alt={p.name} className={cn("h-full w-full object-cover", dead && "grayscale")}
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                )}
                {dead && <span className="absolute inset-0 grid place-items-center text-rose-400">✕</span>}
              </div>
              {/* info */}
              <div className="min-w-0 flex-1">
                <div className={cn("flex items-center gap-1", right && "flex-row-reverse")}>
                  <span className={cn("truncate font-display text-[11px] font-bold uppercase tracking-wide",
                    dead ? "text-white/40 line-through" : "text-white")}>{p.name}</span>
                  <span className="font-display text-[8px] tracking-widest text-white/35">{ROLE[p.role] ?? ""}</span>
                  {flashed && p.alive && <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_6px_#fff]" />}
                </div>
                <div className={cn("flex items-center gap-1 text-[9px] text-white/55", right && "flex-row-reverse")}>
                  <span className="truncate">{weaponLabel(p)}</span>
                  {armor !== "none" && <span title={armor} className={armor === "heavy" ? "opacity-100" : "opacity-50"}>{shieldGlyph(p)}</span>}
                </div>
                {/* confianza + util + créditos */}
                <div className={cn("mt-0.5 flex items-center gap-1", right && "flex-row-reverse")}>
                  <div className="h-1 w-9 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full" style={{ width: `${conf}%`, background: conf >= 60 ? "#37e6a0" : conf >= 35 ? "#ffd35c" : "#ff4d6a" }} />
                  </div>
                  <div className={cn("flex gap-0.5", right && "flex-row-reverse")}>
                    {Array.from({ length: 4 }).map((_, u) => (
                      <span key={u} className="h-1 w-1 rounded-full" style={{ background: u < util ? hex : "rgba(255,255,255,0.15)" }} />
                    ))}
                  </div>
                </div>
              </div>
              {/* economía + bajas */}
              <div className={cn("flex flex-col items-end justify-center", right && "items-start")}>
                <span className="font-display text-[9px] tabular-nums text-amber-200/80">{formatCredits(creditsByName[p.name] ?? 0)}</span>
                {k > 0 && <span className="mt-0.5 rounded bg-white/10 px-1 text-[8px] font-bold text-white/70">{k}K</span>}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
