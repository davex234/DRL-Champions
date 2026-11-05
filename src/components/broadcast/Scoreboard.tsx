"use client";

/**
 * Marcador superior estilo VCT — el ancla visual de la retransmisión. TONTO: solo
 * muestra `match` + `teams` + nombres + compra. Nombre del mapa arriba; bloques de
 * equipo a los lados (nombre, marcador grande, vivos, economía, compra); cronómetro
 * y fase al centro con pulso en momentos urgentes.
 */
import { motion } from "framer-motion";
import type { MatchInfo, TeamInfo, LoadoutInfo } from "@/broadcast";
import { ATK, DEF } from "./theme";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("broadcast");

export function Scoreboard({ match, atk, def, names, loadout }: {
  match: MatchInfo;
  atk: TeamInfo;
  def: TeamInfo;
  names: { atk: string; def: string };
  loadout: LoadoutInfo | null;
}) {
  useLocale();
  const urgent = match.timeLeft <= 10 && match.phase !== "ENDED";
  const spike = match.spike === "planted" || match.spike === "defusing";
  const timerHex = spike ? "#ff8a3d" : urgent ? "#ff3b5c" : "#ffffff";

  return (
    <motion.div
      initial={{ y: -34, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 170, damping: 22 }}
      className="pointer-events-none flex flex-col items-center">
      {/* Nombre del mapa */}
      <div className="mb-1 rounded-b-md bg-black/55 px-3 py-0.5 font-display text-[9px] uppercase tracking-[0.35em] text-white/55 backdrop-blur-sm">
        {td(match.map)}
      </div>

      <div className="flex items-stretch overflow-hidden rounded-lg border border-white/10 bg-black/60 shadow-[0_6px_30px_rgba(0,0,0,0.5)] backdrop-blur-md">
        <TeamBlock name={names.atk} side="ATK" hex={ATK} team={atk} me={match.coachSide === "ATK"} buy={loadout?.atk.buy} align="right" />

        {/* Centro: marcador grande + cronómetro */}
        <div className="flex min-w-[150px] flex-col items-center justify-center bg-white/5 px-4">
          <div className="flex items-center gap-2 font-display text-3xl font-black leading-none tabular-nums">
            <span style={{ color: ATK }}>{match.score.atk}</span>
            <span className="text-white/20">:</span>
            <span style={{ color: DEF }}>{match.score.def}</span>
          </div>
          <motion.div key={spike ? "s" : urgent ? "u" : "n"} animate={urgent || spike ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={{ repeat: urgent || spike ? Infinity : 0, duration: 0.9 }}
            className="mt-0.5 font-display text-lg font-bold tabular-nums leading-none" style={{ color: timerHex }}>
            {td(match.timeLabel)}
          </motion.div>
          <div className="mt-0.5 font-display text-[9px] uppercase tracking-[0.18em] text-white/45">
            {match.spike === "planted" ? t("● SPIKE") : match.spike === "defusing" ? t("✂ DEFUSE") : `R${match.round} · ${match.phaseLabel}`}
          </div>
        </div>

        <TeamBlock name={names.def} side="DEF" hex={DEF} team={def} me={match.coachSide === "DEF"} buy={loadout?.def.buy} align="left" />
      </div>
    </motion.div>
  );
}

function TeamBlock({ name, side, hex, team, me, buy, align }: {
  name: string; side: "ATK" | "DEF"; hex: string; team: TeamInfo; me: boolean; buy?: string; align: "left" | "right";
}) {
  useLocale();
  const right = align === "right";
  return (
    <div className="relative flex min-w-[150px] flex-col justify-center px-3 py-1.5"
      style={{ background: `linear-gradient(${right ? "90deg" : "270deg"}, ${hex}22, transparent)` }}>
      <div className="absolute inset-y-0 w-1" style={{ [right ? "left" : "right"]: 0, background: hex }} />
      <div className={`flex items-center gap-1.5 ${right ? "flex-row-reverse" : ""}`}>
        <span className="truncate font-display text-sm font-bold uppercase tracking-wide text-white" style={{ maxWidth: 110 }}>{name}</span>
        {me && <span className="rounded-sm px-1 text-[8px] font-bold uppercase tracking-widest text-black" style={{ background: hex }}>{t("tú")}</span>}
      </div>
      <div className={`mt-1 flex items-center gap-2 ${right ? "flex-row-reverse" : ""}`}>
        <span className="font-display text-[9px] font-bold uppercase tracking-wider" style={{ color: hex }}>{side}</span>
        <div className={`flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
          {team.players.map((p) => (
            <motion.span key={p.id} animate={{ opacity: p.alive ? 1 : 0.2, scale: p.alive ? 1 : 0.65 }} transition={{ duration: 0.35 }}
              className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hex }} />
          ))}
        </div>
      </div>
      <div className={`mt-0.5 flex items-center gap-2 text-[9px] text-white/45 ${right ? "flex-row-reverse" : ""}`}>
        <span className="tabular-nums">~{(team.economyEstimate / 1000).toFixed(1)}k</span>
        {buy && <span className="rounded-sm bg-white/10 px-1 uppercase tracking-wider text-white/55">{td(buy)}</span>}
      </div>
    </div>
  );
}
