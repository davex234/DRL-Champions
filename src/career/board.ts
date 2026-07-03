/**
 * MANAGER CAREER ENGINE · Fase 2 — relación con el entorno (directiva/afición/jugadores).
 *
 * Cada partido y cada temporada mueven CONFIANZA y PRESIÓN. El riesgo de DESPIDO nunca es
 * aleatorio: se calcula con resultados, objetivos, presión, economía, racha, prestigio,
 * proyecto, tiempo de contrato, fanbase y confianza. Determinista. Puro.
 */
import type { BoardRelation, ClubView, ClubObjective, ManagerCareer, MatchOutcome, SeasonOutcome } from "./types";
import { yearsLeft } from "./contracts";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function initBoard(): BoardRelation {
  return { confidence: 60, pressure: 30, boardTrust: 60, fanSupport: 55, playerRespect: 55 };
}

/** Un partido mueve poco la aguja (confianza/presión/afición/jugadores). */
export function boardAfterMatch(b: BoardRelation, o: MatchOutcome): BoardRelation {
  const d = o.won ? 1 : -1;
  return {
    confidence: clamp(b.confidence + d * 2),
    pressure: clamp(b.pressure - d * 2.5),
    boardTrust: clamp(b.boardTrust + d * 1),
    fanSupport: clamp(b.fanSupport + d * 1.5),
    playerRespect: clamp(b.playerRespect + (o.won ? 1 : -0.5)),
  };
}

/** Evalúa los objetivos del contrato contra el resultado de la temporada. */
export function evaluateBoardObjectives(objectives: ClubObjective[], o: SeasonOutcome, club: ClubView): ClubObjective[] {
  return objectives.map((obj) => {
    let met = false;
    switch (obj.kind) {
      case "win_league": met = o.placement === 1; break;
      case "top4": met = o.placement <= 4; break;
      case "reach_playoffs": met = o.placement <= Math.ceil((o.fieldSize ?? club.totalTeams) * 0.6); break;
      case "win_major": case "win_worlds": met = o.champion; break;
      case "qualify_international": met = o.placement <= Math.ceil((o.fieldSize ?? club.totalTeams) * 0.34); break;
      case "keep_dynasty": met = o.champion; break;
      case "develop_rookies": case "raise_prestige": case "grow_fanbase": case "cut_costs":
        // Objetivos "blandos": se consideran cumplidos si no se hundió (mitad de tabla o mejor).
        met = o.placement <= Math.ceil((o.fieldSize ?? club.totalTeams) * 0.55); break;
    }
    return { ...obj, status: met ? "met" : "failed" } as ClubObjective;
  });
}

/** Una temporada mueve mucho: cumplir objetivos da confianza, fallarlos dispara la presión. */
export function boardAfterSeason(b: BoardRelation, objectives: ClubObjective[], o: SeasonOutcome, club: ClubView): BoardRelation {
  const mandatory = objectives.filter((x) => x.mandatory);
  const failedMand = mandatory.filter((x) => x.status === "failed").length;
  const metAll = objectives.every((x) => x.status === "met");
  const overPerformed = o.placement < Math.max(1, club.totalTeams - 1); // mejoró expectativa base

  let confidence = b.confidence;
  let pressure = b.pressure;
  if (o.champion) { confidence += 22; pressure -= 25; }
  if (metAll) { confidence += 12; pressure -= 10; }
  confidence -= failedMand * 16;
  pressure += failedMand * 18;
  if (!overPerformed && !o.champion) pressure += 6;

  return {
    confidence: clamp(confidence),
    pressure: clamp(pressure),
    boardTrust: clamp(b.boardTrust + (failedMand ? -14 : metAll ? 10 : 2)),
    fanSupport: clamp(b.fanSupport + (o.champion ? 18 : o.finalist ? 8 : failedMand ? -12 : 0)),
    playerRespect: clamp(b.playerRespect + (o.champion ? 8 : failedMand ? -6 : 2)),
  };
}

/**
 * Riesgo de despido 0..1 (determinista). Combina TODOS los factores pedidos:
 * presión, confianza, objetivos fallados, resultado vs expectativa, racha, economía,
 * prestigio, proyecto (filosofía/años de contrato) y fanbase.
 */
export function dismissalRisk(career: ManagerCareer, club: ClubView, failedMandatory: number, o: SeasonOutcome): number {
  const b = career.board;
  let risk = 0;
  risk += (b.pressure / 100) * 0.34;             // presión
  risk += ((100 - b.confidence) / 100) * 0.26;   // falta de confianza
  risk += Math.min(0.24, failedMandatory * 0.16);// objetivos obligatorios fallados
  risk += Math.min(0.12, Math.max(0, o.placement - club.totalTeams * 0.7) / club.totalTeams * 0.4); // hundirse
  if (career.stats.currentWinStreak === 0 && !o.champion) risk += 0.05; // sin racha
  if (club.budget < 6000) risk += 0.05;          // apuro económico
  // Mitigantes: prestigio bajo perdona, fanbase a favor protege, proyecto largo da margen.
  risk -= (b.fanSupport / 100) * 0.12;
  const margin = career.contract ? yearsLeft(career.contract, career.season) : 0;
  risk -= Math.min(0.12, margin * 0.05);         // años de contrato = paciencia
  if (club.philosophy === "long_project") risk -= 0.08;
  if (o.champion) risk = 0;                       // un campeón no se despide
  return Math.max(0, Math.min(1, risk));
}
