/**
 * FASE 41 · CATÁLOGO CANÓNICO DE LA ECONOMÍA — «qué entra, qué sale, por dónde y cuántas veces».
 *
 * NO define ni un solo valor: cada importe se LEE de su constante real (`duelRewards`, `data/season`, `achievements`,
 * `pickems/rewards`, `events/challenges`, `campaign/rewards`, `data/packs`, `salvage`, `prestige`, `drlCredits`). Este
 * módulo es el mapa: clasifica cada flujo (SOURCE / SINK / TRANSFER / NON_ECONOMIC), dice su tope, su clave de
 * idempotencia, su ruta de servidor y su estado. Los verificadores (`economy:verify`) y el simulador lo usan para que
 * «la economía» sea una sola cosa y no veinte constantes sueltas.
 */
import { duelReward, DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import { CURRENT_SEASON, SEASON_MAX_LEVEL } from "@/data/season";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { CHALLENGE_SETS } from "@/domain/events/challenges";
import { FIRST_CLEAR_CREDITS, CAMPAIGN_FIRST_CLEAR_CAP, campaignRewardTotal } from "@/domain/campaign/rewards";
import { ROAD_TO_CHAMPIONS } from "@/data/roadToChampions";
import { PACKS } from "@/data/packs";
import { packLifecycle } from "@/domain/packs/lifecycle";
import { salvageValue } from "@/domain/economy/salvage";
import { CARDS } from "@/data/catalog";
import { PRESTIGE_TIERS } from "@/domain/collection/prestige";
import { CREDIT_PRODUCTS } from "@/domain/economy/drlCredits";
import { ECONOMY_VERSION, STARTER_POLICY } from "@/domain/economy/starter";
import type { Reward } from "@/domain/events/types";
import { DRAFT_ENTRY_FEE, DRAFT_JACKPOT, DRAFT_REWARD_CREDITS } from "@/domain/draft/economy";

export { ECONOMY_VERSION };

export type FlowClass = "SOURCE" | "SINK" | "TRANSFER" | "NON_ECONOMIC";
export type FlowStatus = "LIVE" | "CLOSED" | "DISABLED" | "LOCAL_ONLY";
export type Repeat = "ONCE" | "ONCE_PER_WINDOW" | "PER_ACTION_CAPPED" | "PER_ACTION" | "PER_EVENT";

export interface EconomyFlow {
  id: string;
  cls: FlowClass;
  label: string;
  /** Créditos por unidad (negativo = sale). Rango si varía. */
  credits: { min: number; max: number };
  /** Otros recursos que mueve (texto). */
  also: string[];
  repeat: Repeat;
  /** Tope DURO (texto) o `null` si el flujo está acotado por construcción (una vez, por ventana…). */
  cap: string | null;
  /** Forma de la clave de idempotencia. */
  idempotency: string;
  /** Único camino de servidor. */
  path: string;
  status: FlowStatus;
  /** Cómo lo trata la Fase 41. */
  fase41: string;
}

const credits = (r: Reward) => r.credits ?? 0;
const range = (xs: number[]) => ({ min: Math.min(...xs), max: Math.max(...xs) });
const missionsOf = (kind: string) => CURRENT_SEASON.missionPool.filter((m) => m.kind === kind);
const trackCredits = (t: Record<number, Reward> | undefined) => Object.values(t ?? {}).reduce((s, r) => s + credits(r), 0);
const trackPacks = (t: Record<number, Reward> | undefined) => Object.values(t ?? {}).reduce((s, r) => s + (r.packId ? (r.packCount ?? 1) : 0), 0);

export const DUEL_TABLE = (["EASY", "NORMAL", "HARD"] as const).flatMap((d) =>
  (["win", "draw", "loss"] as const).map((o) => ({ difficulty: d, outcome: o, credits: duelReward(o, d).credits ?? 0, xp: duelReward(o, d).xp ?? 0 })));

export function economyFlows(): EconomyFlow[] {
  const base = CHALLENGE_SETS.flatMap((s) => s.challenges);
  const activePacks = PACKS.filter((p) => packLifecycle(p) === "ACTIVE" && p.price > 0);
  return [
    { id: "starter-grant", cls: "SOURCE", label: "Alta: créditos iniciales + 3 Sobres Iniciales + 1 Estándar", credits: { min: 6000, max: 6000 }, also: ["inicial×3", "estandar×1"], repeat: "ONCE", cap: null, idempotency: "starter:<uid>", path: "trigger handle_new_user (0011)", status: "LIVE", fase41: "sin cambios" },
    { id: "starter-assist", cls: "SOURCE", label: "Sobre Inicial gratis (asistencia de primer equipo)", credits: { min: 0, max: 0 }, also: ["inicial×1 por concesión", `${STARTER_POLICY.assistSlots} huecos de rol que falta`], repeat: "ONCE_PER_WINDOW", cap: `solo sin plantilla posible · 0 sin abrir · ≤ ${STARTER_POLICY.maxFreeClaims} concesiones en la vida`, idempotency: "pack:buy:<uid>:starter-assist-<n>", path: "POST /api/game/packs → buyPack → app_buy_pack", status: "LIVE", fase41: "P0 cerrado: antes precio 0 sin límite" },
    { id: "pve-duel", cls: "SOURCE", label: "Duelo PvE (tabla resultado × dificultad)", credits: range(DUEL_TABLE.map((r) => r.credits)), also: ["XP de cuenta", "puntos de rango (victoria/empate)"], repeat: "PER_ACTION_CAPPED", cap: `${DAILY_DUEL_AWARD_CAP} partidas pagadas por día UTC`, idempotency: "duel:<matchId>", path: "duels.ts → award → app_grant_reward", status: "LIVE", fase41: "sin cambios (carrera del tope: acotada, una partida activa por jugador)" },
    { id: "campaign-first-clear", cls: "SOURCE", label: "Road to Champions · primera victoria por nodo", credits: range(Object.values(FIRST_CLEAR_CREDITS)), also: [], repeat: "ONCE", cap: `total ${campaignRewardTotal(ROAD_TO_CHAMPIONS)} ≤ ${CAMPAIGN_FIRST_CLEAR_CAP}`, idempotency: "campaign:<campaignId>:<nodeId>", path: "campaign.ts → award", status: "LIVE", fase41: "sin cambios" },
    { id: "mission-daily", cls: "SOURCE", label: "Misiones diarias (3 por día)", credits: range(missionsOf("daily").map((m) => credits(m.reward))), also: ["XP del pase"], repeat: "ONCE_PER_WINDOW", cap: "una vez por misión y tanda diaria", idempotency: "mission:<season>:<id>:<assignedAt>:<baseline>", path: "progression.ts claimMission", status: "LIVE", fase41: "P0 cerrado: antes repetible dentro de la tanda (sin límite)" },
    { id: "mission-weekly", cls: "SOURCE", label: "Misiones semanales (2 por semana)", credits: range(missionsOf("weekly").map((m) => credits(m.reward))), also: ["XP del pase"], repeat: "ONCE_PER_WINDOW", cap: "una vez por misión y tanda semanal", idempotency: "mission:<season>:<id>:<assignedAt>:<baseline>", path: "progression.ts claimMission", status: "LIVE", fase41: "P0 cerrado (igual que diarias)" },
    { id: "mission-season", cls: "SOURCE", label: "Misiones de temporada e hitos", credits: range([...missionsOf("seasonal"), ...missionsOf("progressive")].map((m) => credits(m.reward))), also: ["sobres", "XP del pase"], repeat: "ONCE", cap: null, idempotency: "mission:<season>:<id>:…", path: "progression.ts claimMission", status: "LIVE", fase41: "sin cambios" },
    { id: "pass-free", cls: "SOURCE", label: `Pase · carril libre (${SEASON_MAX_LEVEL} niveles)`, credits: { min: 0, max: trackCredits(CURRENT_SEASON.free) }, also: [`${trackPacks(CURRENT_SEASON.free)} sobres`], repeat: "ONCE", cap: "una vez por nivel y temporada", idempotency: "pass:<season>:free:<level>", path: "progression.ts claimPassLevel", status: "LIVE", fase41: "concurrencia optimista del pase (XP no se duplica)" },
    { id: "pass-competitive", cls: "SOURCE", label: "Pase · carril competitivo (se abre en Oro)", credits: { min: 0, max: trackCredits(CURRENT_SEASON.competitive) }, also: [`${trackPacks(CURRENT_SEASON.competitive)} sobres`], repeat: "ONCE", cap: "una vez por nivel y temporada", idempotency: "pass:<season>:competitive:<level>", path: "progression.ts claimPassLevel", status: "LIVE", fase41: "sin cambios" },
    { id: "pass-premium", cls: "NON_ECONOMIC", label: "Pase · carril de pago (solo cosméticos)", credits: { min: 0, max: 0 }, also: ["cosméticos"], repeat: "ONCE", cap: null, idempotency: "pass:<season>:premium:<level>", path: "sin ruta online (unlockPremium solo local)", status: "DISABLED", fase41: "sin cambios" },
    { id: "achievements", cls: "SOURCE", label: "Logros", credits: range(ACHIEVEMENTS.map((a) => a.reward)), also: [], repeat: "ONCE", cap: `total ${ACHIEVEMENTS.reduce((s, a) => s + a.reward, 0)}`, idempotency: "achievement:<id>", path: "progression.ts claimAchievement", status: "LIVE", fase41: "sin cambios (sobres-100/1000 ya no se alimentan con sobres gratis)" },
    { id: "pickem-tier", cls: "SOURCE", label: "Pick'em · escalón alcanzado", credits: range(REWARD_TIERS.map((t) => credits(t.reward))), also: ["XP", "sobres"], repeat: "PER_EVENT", cap: `≤ ${REWARD_TIERS.reduce((s, t) => s + credits(t.reward), 0)} por evento si se recorrige subiendo (contrato: ${Math.max(...REWARD_TIERS.map((t) => credits(t.reward)))})`, idempotency: "pickem:<event>:<tier>", path: "pickems.ts scorePickemEvent (worker)", status: "LIVE", fase41: "P2 documentado: escalones acumulables al recorregir (acotado por evento real)" },
    { id: "event-challenges", cls: "SOURCE", label: "Desafíos de evento en directo", credits: range(base.map((c) => credits(c.reward))), also: ["XP", "sobre Estándar"], repeat: "PER_EVENT", cap: "una vez por desafío y evento", idempotency: "event:<event>:<challenge>", path: "events.ts claim", status: "LIVE", fase41: "sin cambios" },
    { id: "salvage", cls: "SOURCE", label: "Reciclar duplicadas", credits: range(CARDS.map(salvageValue)), also: ["−carta duplicada"], repeat: "PER_ACTION", cap: "≤ copias − 1 · 500 por llamada · EV < precio de cualquier sobre de pago", idempotency: "salvage:<uid>:<gesture>", path: "POST /api/game/economy → app_salvage_cards", status: "LIVE", fase41: "sin cambios: con el Sobre Inicial acotado deja de ser fuente infinita; F57.5: 6 % de marketValue (antes tabla por rareza)" },
    { id: "sandbox-credits", cls: "SOURCE", label: "Tienda de créditos de prueba", credits: range(CREDIT_PRODUCTS.map((p) => p.credits)), also: [], repeat: "PER_ACTION", cap: "CERRADA salvo NEXUS_SANDBOX_CREDITS=1", idempotency: "drlc:<uid>:<ref>", path: "POST /api/game/credits → app_sandbox_purchase", status: "CLOSED", fase41: "P0 cerrado: antes concedía sin límite" },
    { id: "pack-purchase", cls: "SINK", label: "Comprar sobre", credits: range(activePacks.map((p) => -p.price)), also: ["+sobre"], repeat: "PER_ACTION", cap: null, idempotency: "pack:buy:<uid>:<gesture>", path: "POST /api/game/packs → app_buy_pack", status: "LIVE", fase41: "sin cambios de precio" },
    { id: "prestige", cls: "SINK", label: "Prestigio de insignias", credits: range(PRESTIGE_TIERS.map((t) => -t.price)), also: ["+cosmético"], repeat: "ONCE", cap: null, idempotency: "prestige:<uid>:<base>:<tier>", path: "POST /api/game/prestige → app_buy_cosmetic", status: "LIVE", fase41: "P0 cerrado: la clave no llevaba usuario (colisión entre jugadores)" },
    { id: "sandbox-refund", cls: "SINK", label: "Devolver compra de prueba", credits: range(CREDIT_PRODUCTS.map((p) => -p.credits)), also: [], repeat: "ONCE", cap: "saldo ≥ 0", idempotency: "drlc:<uid>:refund:<ref>", path: "POST /api/game/credits → app_sandbox_refund", status: "LIVE", fase41: "sin cambios" },
    { id: "market", cls: "TRANSFER", label: "Mercado entre jugadores (5 % de comisión = sumidero)", credits: { min: 0, max: 0 }, also: ["carta ↔ créditos"], repeat: "PER_ACTION", cap: "rate limit + banda de precio", idempotency: "market:buy:<uid>:<gesture>", path: "POST /api/game/market (503)", status: "DISABLED", fase41: "GLOBAL_MARKET_ENABLED=false intacto" },
    { id: "pack-open", cls: "NON_ECONOMIC", label: "Abrir sobre (0 créditos, XP de cuenta)", credits: { min: 0, max: 0 }, also: ["cartas", "XP 18–138 por carta"], repeat: "PER_ACTION", cap: "1 sobre poseído por apertura", idempotency: "pack:open:<uid>:<gesture>", path: "POST /api/game/packs → app_apply_pack_open", status: "LIVE", fase41: "asistencia de rol solo en Sobre Inicial sin plantilla" },
    { id: "draft-entry", cls: "SINK", label: "Draft Gauntlet · entrada", credits: { min: -DRAFT_ENTRY_FEE, max: -DRAFT_ENTRY_FEE }, also: ["+run de draft"], repeat: "PER_ACTION", cap: "una run activa por jugador (0053)", idempotency: "draft:entry:<runId>", path: "POST /api/game/draft-gauntlet start → app_adjust_credits", status: "LIVE", fase41: "F72: sumidero aislado; EV de la tabla < 0 incluso para la cota ORACLE" },
    { id: "draft-reward", cls: "SOURCE", label: "Draft Gauntlet · recompensa por victorias", credits: { min: Math.min(...DRAFT_REWARD_CREDITS), max: Math.max(...DRAFT_REWARD_CREDITS) }, also: [`${DRAFT_JACKPOT.packName} (1.ª completada de la semana ISO)`, "título Campeón del Gauntlet (una vez)"], repeat: "PER_ACTION_CAPPED", cap: "una por run; sobre: uno por semana (clave del libro mayor)", idempotency: "draft:reward:<runId> · draft:jackpot:<uid>:<semana>", path: "draft-gauntlet (cierre de run) → award → app_grant_reward", status: "LIVE", fase41: "F72: fuente aislada; sin XP, puntos, cartas ni rating" },
    { id: "pvp", cls: "NON_ECONOMIC", label: "PvP (rating, sin créditos)", credits: { min: 0, max: 0 }, also: ["rating"], repeat: "PER_ACTION", cap: null, idempotency: "rating por partida", path: "duel_pvp_settle_match", status: "LIVE", fase41: "sin economía: no hay incentivo a dejarse ganar" },
    { id: "local-economies", cls: "NON_ECONOMIC", label: "Economías locales (entrenador, carrera, pick'em local)", credits: { min: 0, max: 0 }, also: [], repeat: "PER_ACTION", cap: null, idempotency: "—", path: "localStorage; el servidor las sobrescribe", status: "LOCAL_ONLY", fase41: "no llegan al servidor" },
  ];
}

/** Resumen numérico de fuentes acotadas por temporada (para el simulador y el informe). */
export function seasonBudget() {
  const daily = missionsOf("daily"); const weekly = missionsOf("weekly");
  return {
    passFreeCredits: trackCredits(CURRENT_SEASON.free),
    passCompetitiveCredits: trackCredits(CURRENT_SEASON.competitive),
    passFreePacks: trackPacks(CURRENT_SEASON.free),
    passCompetitivePacks: trackPacks(CURRENT_SEASON.competitive),
    achievementsCredits: ACHIEVEMENTS.reduce((s, a) => s + a.reward, 0),
    campaignCredits: campaignRewardTotal(ROAD_TO_CHAMPIONS),
    dailyMissionMaxPerDay: [...daily].map((m) => credits(m.reward)).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0),
    weeklyMissionMaxPerWeek: [...weekly].map((m) => credits(m.reward)).sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0),
    pveMaxPerDay: DAILY_DUEL_AWARD_CAP * Math.max(...DUEL_TABLE.map((r) => r.credits)),
  };
}

/**
 * Techo TEÓRICO de créditos que una cuenta puede ganar en un día sin fuentes de una sola vez (PvE al tope en Difícil
 * ganando todo + las 3 diarias mejor pagadas + las 2 semanales mejor pagadas el mismo día). Toda trayectoria simulada
 * con las reglas vigentes debe quedar por debajo en sus días «sin hitos».
 */
export function dailyRecurringCeiling(): number {
  const b = seasonBudget();
  return b.pveMaxPerDay + b.dailyMissionMaxPerDay + b.weeklyMissionMaxPerWeek;
}
