/**
 * FASE 41 · SIMULADOR DETERMINISTA DE LA ECONOMÍA (núcleo puro).
 *
 * Una trayectoria = una cuenta nueva que juega N días con un arquetipo (CASUAL/REGULAR/ENGAGED/HARDCORE) y un día de
 * entrada en la Temporada 1 (1, 14, mitad o últimas 2 semanas). Cada día: partidas PvE (tope diario real), misiones
 * (asignación diaria/semanal real, reclamos según el conjunto de reglas), pase (XP de misiones, carriles libre y
 * competitivo reales), logros reales, campaña (primera victoria), Pick'ems y desafíos de evento (cada 21 días),
 * compras y aperturas de sobres, reciclaje de duplicadas.
 *
 * LAS CARTAS SON REALES: cada sobre se sortea con el pool real del sobre (`buildPool`, catálogo de 772 cartas) y sus
 * pesos por rareza reales, con la misma regla de bucket que `openPack` (incluido `guaranteedMin` del último hueco) y
 * elección uniforme dentro del bucket (sin pool persistido, `pickWeighted` ≡ `rng.pick`). La equivalencia con
 * `openPack` se comprueba en `economy-simulation:verify`. La asistencia de primer equipo reproduce `assist`.
 *
 * Dos conjuntos de reglas:
 *   · `baseline` — el código ANTES de la Fase 41: Sobre Inicial gratis sin límite (el arquetipo HARDCORE lo explota),
 *     misiones repetibles re-reclamables dentro de la tanda, sin asistencia de rol.
 *   · `fase41`   — las reglas vigentes: asistencia de primer equipo (gratis solo sin plantilla, 2 huecos de rol), misiones
 *     una vez por tanda. Ningún importe cambia.
 * La tienda de créditos de prueba (fuente sin límite en `baseline`) no se mete en los arquetipos: su efecto es
 * «infinito por llamada» y se mide aparte (trazas de una acción y fuzzer).
 */
import type { CardRegistry } from "@/collection";
import { buildPool, BUCKETS, BUCKET_INDEX } from "@/domain/packs/pool";
import { getPack } from "@/data/packs";
import type { PackDef, RarityBucket } from "@/domain/packs/types";
import { bucketForRank } from "@/domain/packs/types";
import { makeRng, type Rng } from "@/sim/rng";
import { duelReward, duelPoints, DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import { CURRENT_SEASON, SEASON_MAX_LEVEL, SEASON_XP_PER_LEVEL } from "@/data/season";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { salvageValue } from "@/domain/economy/salvage";
import { xpForCardRank } from "@/domain/progression/levels";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import { ROAD_TO_CHAMPIONS } from "@/data/roadToChampions";
import { STARTER_POLICY } from "@/domain/economy/starter";
import type { Reward } from "@/domain/events/types";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { classPool } from "@/domain/packs/openPack";
import { effectiveFeatured, mainPackPlan, ovrTiltWeight, PACK_CLASS_ORDER, EmptyPackClassError } from "@/domain/packs/packClass";

export type Archetype = "CASUAL" | "REGULAR" | "ENGAGED" | "HARDCORE";
export type RuleSet = "baseline" | "fase41";
export const ARCHETYPES: Archetype[] = ["CASUAL", "REGULAR", "ENGAGED", "HARDCORE"];
export const HORIZONS = [1, 7, 30, 90, 180] as const;
/** Día de la temporada en que entra la cuenta (0 = día 1, 13 = día 14, 42 = mitad, 70 = últimas 2 semanas). */
export const SEASON_STARTS = [0, 13, 42, 70] as const;
export const SEASON_DAYS = 84; // 2026-09-07 → 2026-11-30
export const EVENT_EVERY_DAYS = 21;
export const EVENT_LENGTH_DAYS = 7;

export interface ArchetypeParams {
  playProb: number;
  matches: [number, number];
  difficulty: "EASY" | "NORMAL" | "HARD";
  /** Visitas a «reclamar» por día (en `baseline`, cuántas veces puede re-reclamar una misión repetible). */
  claimVisits: number;
  claimProb: number;
  /** Compra: sobre preferido y saldo mínimo que conserva. */
  buyPremiumAt: number;
  buyStandardAt: number;
  /** Reciclar duplicadas cada N días (0 = nunca). */
  salvageEvery: number;
  pickemProb: number;
  campaignNodesPerDay: number;
  /** `baseline`: Sobres Iniciales gratis que farmea al día (explotación del grifo). */
  freeFarmPerDay: number;
}

export const ARCHETYPE_PARAMS: Record<Archetype, ArchetypeParams> = {
  CASUAL:   { playProb: 0.35, matches: [1, 3],   difficulty: "EASY",   claimVisits: 1, claimProb: 0.6, buyPremiumAt: Infinity, buyStandardAt: 750,  salvageEvery: 0,  pickemProb: 0.2, campaignNodesPerDay: 0.3, freeFarmPerDay: 0 },
  REGULAR:  { playProb: 0.7,  matches: [3, 6],   difficulty: "NORMAL", claimVisits: 2, claimProb: 0.9, buyPremiumAt: 8000,     buyStandardAt: 1500, salvageEvery: 30, pickemProb: 0.5, campaignNodesPerDay: 0.6, freeFarmPerDay: 0 },
  ENGAGED:  { playProb: 0.9,  matches: [8, 15],  difficulty: "NORMAL", claimVisits: 4, claimProb: 1,   buyPremiumAt: 4500,     buyStandardAt: 2000, salvageEvery: 7,  pickemProb: 0.8, campaignNodesPerDay: 1,   freeFarmPerDay: 0 },
  HARDCORE: { playProb: 1,    matches: [20, 35], difficulty: "HARD",   claimVisits: 40, claimProb: 1,  buyPremiumAt: 2500,     buyStandardAt: 750,  salvageEvery: 1,  pickemProb: 1,   campaignNodesPerDay: 3,   freeFarmPerDay: 30 },
};

const WIN_RATE = { EASY: { win: 0.72, draw: 0.06 }, NORMAL: { win: 0.52, draw: 0.07 }, HARD: { win: 0.38, draw: 0.07 } } as const;

/** Fuentes y sumideros medidos (índices estables). */
export const SOURCES = ["starter", "pve", "campaign", "mission_daily", "mission_weekly", "mission_season", "pass_free", "pass_competitive", "achievement", "pickem", "event", "salvage"] as const;
export const SINKS = ["pack_standard", "pack_premium"] as const;
export type SourceId = typeof SOURCES[number];

export const METRICS = [
  "credits", "earned", "spent", "packsOpened", "freeStarterPacks", "cards", "distinct", "duplicates", "collectionPct",
  "legendaryDistinct", "epicDistinct", "passLevel", "accountLevel", "points", "decksPossible", "salvageCredits", "missionClaims",
  "deckReadyDay",
] as const;
export type MetricId = typeof METRICS[number];

/* ───────────────────────────── catálogo precomputado ───────────────────────────── */

interface PackModel {
  id: string; cardCount: number; weights: Record<RarityBucket, number>; lastMin: number; pool: Int32Array[];
  /**
   * Fase 57.3 · línea principal: tabla por clase (`packClass`, en el orden de `PACK_CLASS_ORDER`) y cartas por clase.
   * Pack Opening 3.0 · tabla de los huecos normales (`classTable`) y de la ranura destacada, el último (`classTableFeatured`),
   * y pesos ACUMULADOS por clase con la inclinación por OVR del sobre (`classCum`; uniforme si λ = 0).
   */
  classTable?: number[]; classTableFeatured?: number[]; classPool?: Int32Array[]; classCum?: Float64Array[];
}

export interface SimCatalog {
  n: number;
  bucketOf: Uint8Array;
  /** Créditos por desguazar una copia (F57.5: fracción de `marketValue`, no tabla por rareza). */
  salvageOf: Uint32Array;
  xpOf: Uint16Array;
  playerOf: Int32Array;
  roleOfPlayer: Uint8Array;
  nPlayers: number;
  isMvp: Uint8Array;
  isIcon: Uint8Array;
  isHeretics: Uint8Array;
  isEmea: Uint8Array;
  hereticsTotal: number;
  emeaTotal: number;
  packs: Record<string, PackModel>;
}

export function buildSimCatalog(reg: CardRegistry): SimCatalog {
  const cards = reg.cards;
  const index = new Map<string, number>();
  cards.forEach((c, i) => index.set(c.id, i));
  const players = new Map<string, number>();
  const roleOfPlayer: number[] = [];
  const n = cards.length;
  const cat: SimCatalog = {
    n, bucketOf: new Uint8Array(n), salvageOf: new Uint32Array(n), xpOf: new Uint16Array(n), playerOf: new Int32Array(n), roleOfPlayer: new Uint8Array(0), nPlayers: 0,
    isMvp: new Uint8Array(n), isIcon: new Uint8Array(n), isHeretics: new Uint8Array(n), isEmea: new Uint8Array(n), hereticsTotal: 0, emeaTotal: 0, packs: {},
  };
  cards.forEach((c, i) => {
    const v = reg.variant(c.variantId);
    cat.bucketOf[i] = BUCKET_INDEX[bucketForRank(v.rank)];
    cat.salvageOf[i] = salvageValue(c);
    cat.xpOf[i] = xpForCardRank(v.rank);
    const p = reg.player(c.playerId);
    let pi = players.get(c.playerId);
    if (pi === undefined) { pi = players.size; players.set(c.playerId, pi); roleOfPlayer.push(Math.max(0, DUEL_ROLES.indexOf((c.role ?? p?.role ?? "Flex") as never))); } // rol de la carta (el impreso)
    cat.playerOf[i] = pi;
    // Mismas condiciones que `progression/achievements` (catálogo diseñado): «primer-mvp» = una Champions S,
    // «primer-icon» = una legendaria, «completa-heretics» = el equipo canónico de la carta.
    cat.isMvp[i] = c.variantId === "champions-s" ? 1 : 0;
    cat.isIcon[i] = bucketForRank(v.rank) === "legendary" ? 1 : 0;
    if (canonicalCardTeam(c, p).key === "team-heretics") { cat.isHeretics[i] = 1; cat.hereticsTotal++; }
    if (p?.region === "EMEA") { cat.isEmea[i] = 1; cat.emeaTotal++; }
  });
  cat.roleOfPlayer = Uint8Array.from(roleOfPlayer);
  cat.nPlayers = players.size;
  for (const id of ["inicial", "estandar", "premium", "champions"]) {
    const pack = getPack(id)!;
    const { pool } = buildPool(reg, pack);
    const plan = mainPackPlan(id);
    const byClass = plan ? classPool(reg, pack, null) : null;
    cat.packs[id] = {
      id, cardCount: pack.cardCount, weights: pack.weights,
      lastMin: pack.guaranteedMin ? BUCKET_INDEX[pack.guaranteedMin] : 0,
      pool: BUCKETS.map((b) => Int32Array.from(pool[b].map((c) => index.get(c.id)!))),
      ...(plan && byClass ? {
        classTable: PACK_CLASS_ORDER.map((c) => plan.regular[c]),
        classTableFeatured: PACK_CLASS_ORDER.map((c) => effectiveFeatured(plan)[c]),
        classPool: PACK_CLASS_ORDER.map((c) => Int32Array.from(byClass[c].map((card) => index.get(card.id)!))),
        classCum: PACK_CLASS_ORDER.map((c) => { let acc = 0; return Float64Array.from(byClass[c].map((card) => (acc += ovrTiltWeight(plan.ovrTilt, card.ovr)))); }),
      } : {}),
    };
  }
  return cat;
}

/** Bucket como `openPack.rollBucket` (buckets con stock e índice ≥ minIdx, ponderado; fallback al más alto). */
function rollBucket(p: PackModel, minIdx: number, rng: Rng, allowed?: (b: number) => boolean): number {
  let total = 0;
  for (let b = 0; b < 5; b++) if (b >= minIdx && p.pool[b].length > 0 && (!allowed || allowed(b))) total += p.weights[BUCKETS[b]] || 0;
  if (total <= 0) { for (let b = 4; b >= 0; b--) if (b >= minIdx && p.pool[b].length > 0 && (!allowed || allowed(b))) return b; return -1; }
  let roll = rng.next() * total;
  for (let b = 0; b < 5; b++) {
    if (b < minIdx || p.pool[b].length === 0 || (allowed && !allowed(b))) continue;
    roll -= p.weights[BUCKETS[b]] || 0;
    if (roll <= 0) return b;
  }
  for (let b = 4; b >= 0; b--) if (b >= minIdx && p.pool[b].length > 0 && (!allowed || allowed(b))) return b;
  return -1;
}

/** Sortea las cartas de un sobre (índices de carta). Exportado para comprobar la equivalencia con `openPack`. */
export function drawPackIndices(cat: SimCatalog, packId: string, rng: Rng, out: number[], assist?: AssistState | null): void {
  const p = cat.packs[packId];
  if (p.classTable && p.classPool) {
    // Fase 57.3 · como `openPack` en la línea principal: una tirada para la clase (tabla entera, sin renormalizar) y una
    // para la carta. Sin asistencia (solo la recibe el Sobre Inicial). Una clase > 0 vacía es fallo cerrado.
    const cp = p.classPool, cum = p.classCum;
    for (let slot = 0; slot < p.cardCount; slot++) {
      // Pack Opening 3.0 · el último hueco es la ranura destacada (su propia tabla), como `openByClass`.
      const t = slot === p.cardCount - 1 && p.classTableFeatured ? p.classTableFeatured : p.classTable;
      let total = 0; for (let k = 0; k < t.length; k++) total += Math.max(0, t[k]);
      let roll = rng.next() * total; let k = -1; let last = -1;
      for (let j = 0; j < t.length; j++) { if (t[j] <= 0) continue; last = j; roll -= t[j]; if (roll < 0) { k = j; break; } }
      if (k < 0) k = last;
      const arr = cp[k];
      if (!arr || arr.length === 0) throw new EmptyPackClassError(packId, PACK_CLASS_ORDER[k]);
      // Como `pickWeighted`: con una sola candidata la tirada se consume igual; con pesos, el primer acumulado > tirada.
      let pick: number;
      const c = cum?.[k];
      if (arr.length === 1) { rng.next(); pick = arr[0]; }
      else if (c) { const roll = rng.next() * c[c.length - 1]; let j = 0; while (j < c.length - 1 && !(roll < c[j])) j++; pick = arr[j]; }
      else pick = arr[Math.floor(rng.next() * arr.length)];
      out.push(pick);
      if (assist) assistTake(cat, assist, pick);
    }
    return;
  }
  for (let slot = 0; slot < p.cardCount; slot++) {
    const minIdx = slot === p.cardCount - 1 ? p.lastMin : 0;
    if (assist && slot < assist.slots && assist.needTotal > 0) {
      const ok = (ci: number) => assist.need[cat.roleOfPlayer[cat.playerOf[ci]]] > 0 && !assist.players[cat.playerOf[ci]];
      const filteredLen = (b: number) => { let k = 0; const arr = p.pool[b]; for (let i = 0; i < arr.length; i++) if (ok(arr[i])) k++; return k; };
      const b = rollBucket(p, 0, rng, (bb) => filteredLen(bb) > 0);
      if (b >= 0) {
        const arr = p.pool[b]; const k = Math.floor(rng.next() * filteredLen(b));
        let seen = 0; let pick = arr[0];
        for (let i = 0; i < arr.length; i++) if (ok(arr[i])) { if (seen === k) { pick = arr[i]; break; } seen++; }
        out.push(pick); assistTake(cat, assist, pick);
        continue;
      }
    }
    const b = rollBucket(p, minIdx, rng);
    if (b < 0) continue;
    const arr = p.pool[b];
    const pick = arr[Math.floor(rng.next() * arr.length)];
    out.push(pick);
    if (assist) assistTake(cat, assist, pick);
  }
}

export interface AssistState { slots: number; need: Int8Array; needTotal: number; players: Uint8Array }
function assistTake(cat: SimCatalog, a: AssistState, ci: number) {
  const pl = cat.playerOf[ci]; const role = cat.roleOfPlayer[pl];
  if (!a.players[pl] && a.need[role] > 0) { a.need[role]--; a.needTotal--; }
  a.players[pl] = 1;
}

/* ───────────────────────────── una trayectoria ───────────────────────────── */

const MISSIONS = CURRENT_SEASON.missionPool;
const DAILY = MISSIONS.filter((m) => m.kind === "daily");
const WEEKLY = MISSIONS.filter((m) => m.kind === "weekly");
const byId = (id: string) => MISSIONS.find((m) => m.id === id)!;
const CAMPAIGN_NODE_CREDITS = ROAD_TO_CHAMPIONS.chapters.flatMap((c) => c.nodes.map((n) => n.rewards.firstClear.credits));

interface MissionSlot { id: string; metric: string; goal: number; credits: number; xp: number; baseline: number; claims: number }

function rollKind(pool: typeof DAILY, count: number, rng: Rng): typeof DAILY {
  const rem = [...pool]; const out: typeof DAILY = [];
  while (out.length < count && rem.length) {
    const total = rem.reduce((s, m) => s + (m.weight ?? 1), 0);
    let roll = rng.next() * total; let idx = 0;
    for (let i = 0; i < rem.length; i++) { roll -= rem[i].weight ?? 1; if (roll <= 0) { idx = i; break; } }
    out.push(rem[idx]); rem.splice(idx, 1);
  }
  return out;
}

export interface TrajectoryResult {
  /** [horizonte][métrica] */
  snapshots: Float64Array[];
  /** [horizonte][fuente] créditos acumulados */
  sources: Float64Array[];
  /** [horizonte][sumidero] */
  sinks: Float64Array[];
  /** Máximo de créditos RECURRENTES ganados en un día (PvE + diarias + semanales). */
  maxRecurringDay: number;
  /** Mayor ganancia de créditos en un día (todas las fuentes). */
  maxDay: number;
}

export class Simulator {
  readonly cat: SimCatalog;
  private owned: Uint16Array;
  private playersOwned: Uint8Array;
  private roleDistinct: Int32Array;
  private buf: number[] = [];

  constructor(cat: SimCatalog) {
    this.cat = cat;
    this.owned = new Uint16Array(cat.n);
    this.playersOwned = new Uint8Array(cat.nPlayers);
    this.roleDistinct = new Int32Array(DUEL_ROLES.length);
  }

  run(arch: Archetype, rules: RuleSet, seed: number, seasonStart: number, days = 180): TrajectoryResult {
    const P = ARCHETYPE_PARAMS[arch];
    const cat = this.cat;
    const rng = makeRng(seed);
    const owned = this.owned; owned.fill(0);
    const playersOwned = this.playersOwned; playersOwned.fill(0);
    const roleDistinct = this.roleDistinct; roleDistinct.fill(0);
    const H = HORIZONS.length;
    const res: TrajectoryResult = {
      snapshots: Array.from({ length: H }, () => new Float64Array(METRICS.length)),
      sources: Array.from({ length: H }, () => new Float64Array(SOURCES.length)),
      sinks: Array.from({ length: H }, () => new Float64Array(SINKS.length)),
      maxRecurringDay: 0, maxDay: 0,
    };
    const src = new Float64Array(SOURCES.length); const snk = new Float64Array(SINKS.length);
    let credits = 0; let packsOpened = 0; let freeStarter = 0; let cards = 0; let distinct = 0; let legendary = 0; let epic = 0;
    let accountXp = 0; let passXp = 0; let points = 0; let salvageCredits = 0; let missionClaims = 0; let deckReadyDay = -1;
    let distinctHeretics = 0; let distinctEmea = 0; let hasMvp = false; let hasIcon = false;
    let duelsPlayed = 0; let duelsWon = 0; let picks = 0;
    const achieved = new Set<string>(); const seasonal = new Set<string>();
    let freeClaimed = 0; let compClaimed = 0; let competitiveUnlocked = false;
    let campaignNode = 0;
    const packInv: Record<string, number> = { inicial: 0, estandar: 0, premium: 0, champions: 0 };
    const earn = (s: SourceId, c: number) => { if (c <= 0) return; credits += c; src[SOURCES.indexOf(s)] += c; };
    const ready = () => { for (let r = 0; r < roleDistinct.length; r++) if (roleDistinct[r] < 2) return false; return true; };
    const decksPossible = () => { let m = Infinity; for (let r = 0; r < roleDistinct.length; r++) m = Math.min(m, Math.floor(roleDistinct[r] / 2)); return m; };

    let newDistinctToday = 0; let packsToday = 0;
    const addCard = (ci: number) => {
      cards++;
      accountXp += cat.xpOf[ci];
      if (owned[ci]++ === 0) {
        distinct++; newDistinctToday++;
        if (cat.bucketOf[ci] === 4) legendary++;
        if (cat.bucketOf[ci] === 3) epic++;
        if (cat.isMvp[ci]) hasMvp = true;
        if (cat.isIcon[ci]) hasIcon = true;
        if (cat.isHeretics[ci]) distinctHeretics++;
        if (cat.isEmea[ci]) distinctEmea++;
        const pl = cat.playerOf[ci];
        if (!playersOwned[pl]) { playersOwned[pl] = 1; roleDistinct[cat.roleOfPlayer[pl]]++; }
      }
    };
    const assistFor = (packId: string): AssistState | null => {
      if (rules !== "fase41" || packId !== STARTER_POLICY.packId || ready()) return null;
      const need = new Int8Array(DUEL_ROLES.length); let needTotal = 0;
      for (let r = 0; r < need.length; r++) { need[r] = Math.max(0, 2 - roleDistinct[r]); needTotal += need[r]; }
      return { slots: STARTER_POLICY.assistSlots, need, needTotal, players: Uint8Array.from(playersOwned) };
    };
    const openPack = (packId: string) => {
      this.buf.length = 0;
      drawPackIndices(cat, packId, rng, this.buf, assistFor(packId));
      for (const ci of this.buf) addCard(ci);
      packsOpened++; packsToday++;
    };
    const openInventory = () => { for (const id of Object.keys(packInv)) while (packInv[id] > 0) { packInv[id]--; openPack(id); } };
    const grant = (r: Reward, s: SourceId) => {
      earn(s, r.credits ?? 0);
      accountXp += r.xp ?? 0;
      if (r.packId) packInv[r.packId] = (packInv[r.packId] ?? 0) + (r.packCount ?? 1);
    };

    // Día 0: alta real (6.000 + 3 Iniciales + 1 Estándar).
    earn("starter", 6000); packInv.inicial = 3; packInv.estandar = 1;

    let daily: MissionSlot[] = []; let weekly: MissionSlot[] = [];
    const metric = (m: string) => m === "packs_opened" ? packsOpened : m === "duels_played" ? duelsPlayed : m === "duels_won" ? duelsWon : m === "picks_made" ? picks : m === "distinct_cards" ? distinct : 0;
    const assign = (defs: typeof DAILY): MissionSlot[] => defs.map((d) => ({ id: d.id, metric: d.metric, goal: d.goal, credits: d.reward.credits ?? 0, xp: d.xp ?? 0, baseline: metric(d.metric), claims: 0 }));

    let h = 0;
    let recurringToday = 0; let earnedBefore = 0;
    for (let day = 0; day < days; day++) {
      const seasonDay = seasonStart + day;
      const seasonOn = seasonDay < SEASON_DAYS;
      newDistinctToday = 0; packsToday = 0; recurringToday = 0; earnedBefore = src.reduce((a, b) => a + b, 0);
      if (seasonOn) {
        daily = assign(rollKind(DAILY, 3, rng));
        if (day === 0 || seasonDay % 7 === 0) weekly = assign(rollKind(WEEKLY, 2, rng));
      } else { daily = []; weekly = []; }

      // Sobres pendientes (bienvenida, recompensas) y primer equipo.
      openInventory();
      while (!ready()) {
        if (rules === "fase41" && freeStarter >= STARTER_POLICY.maxFreeClaims) break;
        if (freeStarter > 500) break;
        freeStarter++; openPack("inicial");
      }
      if (deckReadyDay < 0 && ready()) deckReadyDay = day + 1;
      // Explotación del grifo (solo `baseline`: con la Fase 41 el servidor rechaza la compra).
      if (rules === "baseline") for (let i = 0; i < P.freeFarmPerDay; i++) { freeStarter++; openPack("inicial"); }

      const plays = rng.next() < P.playProb;
      if (plays) {
        const m = P.matches[0] + Math.floor(rng.next() * (P.matches[1] - P.matches[0] + 1));
        const wr = WIN_RATE[P.difficulty];
        for (let i = 0; i < m; i++) {
          const x = rng.next();
          const outcome = x < wr.win ? "win" : x < wr.win + wr.draw ? "draw" : "loss";
          duelsPlayed++; if (outcome === "win") duelsWon++;
          if (i < DAILY_DUEL_AWARD_CAP) {
            const c = duelReward(outcome, P.difficulty).credits ?? 0;
            earn("pve", c); recurringToday += c;
            accountXp += duelReward(outcome, P.difficulty).xp ?? 0;
            points += duelPoints(outcome, P.difficulty);
          }
        }
        // Campaña: primera victoria por nodo.
        let nodes = P.campaignNodesPerDay >= 1 ? Math.floor(P.campaignNodesPerDay) : rng.next() < P.campaignNodesPerDay ? 1 : 0;
        while (nodes-- > 0 && campaignNode < CAMPAIGN_NODE_CREDITS.length) earn("campaign", CAMPAIGN_NODE_CREDITS[campaignNode++]);
      }

      // Evento en directo (Pick'em + desafíos) cada 21 días, 7 días.
      const eventDay = day % EVENT_EVERY_DAYS;
      const inEvent = eventDay < EVENT_LENGTH_DAYS;
      const joinsEvent = inEvent && rng.next() < P.pickemProb;
      if (joinsEvent) picks++;
      if (inEvent && eventDay === EVENT_LENGTH_DAYS - 1 && joinsEvent) {
        // Escalón por puntos (0–100) y recorrección acumulativa (sin cambios en Fase 41; P2 documentado).
        const pts = Math.floor(rng.next() * (arch === "HARDCORE" ? 100 : arch === "ENGAGED" ? 80 : 55));
        for (const t of REWARD_TIERS) if (pts >= t.minPoints) grant(t.reward, "pickem");
        grant({ credits: 500, xp: 50 }, "event");
        if (pts >= 20) grant({ credits: 1000, xp: 100 }, "event");
        if (plays) { grant({ credits: 800, xp: 120 }, "event"); if (duelsWon > 3) grant({ credits: 1200, xp: 180, packId: "estandar", packCount: 1 }, "event"); }
      }

      // Compras de sobres con créditos (y apertura inmediata).
      // F80 · el umbral de comportamiento nunca deja comprar por debajo del PRECIO real (antes el umbral > precio lo garantizaba).
      const can = (id: string, at: number) => credits >= Math.max(at, getPack(id)!.price);
      const reserve = () => (can("premium", P.buyPremiumAt) ? "premium" : can("estandar", P.buyStandardAt) ? "estandar" : null);
      let buys = 0;
      for (let k = reserve(); k && buys < 60; k = reserve(), buys++) {
        const price = getPack(k)!.price;
        credits -= price; snk[k === "premium" ? 1 : 0] += price;
        openPack(k);
      }

      // Reclamos de misiones.
      if (seasonOn) {
        for (const slots of [daily, weekly]) {
          for (const s of slots) {
            const cls: SourceId = slots === daily ? "mission_daily" : "mission_weekly";
            // `baseline`: cada reclamo re-baselinea y la misión vuelve a salir (se reclama entre partidas: cada `goal` de
            // progreso es un pago, hasta `claimVisits` al día). `fase41`: una vez por tanda.
            let visits = rules === "baseline" ? P.claimVisits : 1;
            while (visits-- > 0) {
              const progress = metric(s.metric) - s.baseline;
              if (progress < s.goal || rng.next() > P.claimProb) break;
              if (rules === "fase41" && s.claims >= 1) break;
              s.claims++; missionClaims++; passXp += s.xp; earn(cls, s.credits); recurringToday += s.credits;
              s.baseline += s.goal;
            }
          }
        }
        // Temporada e hitos (una vez).
        const once = (id: string, cond: boolean) => { if (!cond || seasonal.has(id)) return; seasonal.add(id); const d = byId(id); passXp += d.xp ?? 0; grant(d.reward, "mission_season"); missionClaims++; };
        once("s-duelos-25", duelsPlayed >= 25); once("s-mazo", ready() && plays); once("s-region", arch !== "CASUAL");
        once("p-coleccion-50", distinct >= 50); once("p-coleccion-150", distinct >= 150); once("p-puntos-400", points >= 400);
        // Pase: niveles alcanzados y reclamados.
        const level = Math.min(SEASON_MAX_LEVEL, Math.floor(passXp / SEASON_XP_PER_LEVEL));
        if (!competitiveUnlocked && points >= (CURRENT_SEASON.competitiveMinPoints ?? Infinity)) competitiveUnlocked = true;
        while (freeClaimed < level) { freeClaimed++; const r = CURRENT_SEASON.free[freeClaimed]; if (r) grant(r, "pass_free"); }
        while (competitiveUnlocked && compClaimed < level) { compClaimed++; const r = CURRENT_SEASON.competitive?.[compClaimed]; if (r) grant(r, "pass_competitive"); }
      }

      // Logros.
      const ach = (id: string, cond: boolean, reward: number) => { if (cond && !achieved.has(id)) { achieved.add(id); earn("achievement", reward); } };
      ach("sobres-100", packsOpened >= 100, 2500); ach("sobres-1000", packsOpened >= 1000, 25000); ach("primer-mvp", hasMvp, 3000);
      ach("primer-icon", hasIcon, 10000); ach("coleccionista", distinct >= 40, 4000);
      ach("completa-heretics", cat.hereticsTotal > 0 && distinctHeretics >= cat.hereticsTotal, 8000);
      ach("completa-emea", cat.emeaTotal > 0 && distinctEmea >= cat.emeaTotal, 15000);

      openInventory();

      // Reciclaje de duplicadas (se conserva una copia).
      if (P.salvageEvery > 0 && (day + 1) % P.salvageEvery === 0) {
        for (let ci = 0; ci < cat.n; ci++) {
          if (owned[ci] > 1) { const c = (owned[ci] - 1) * cat.salvageOf[ci]; salvageCredits += c; earn("salvage", c); cards -= owned[ci] - 1; owned[ci] = 1; }
        }
      }

      const earnedToday = src.reduce((a, b) => a + b, 0) - earnedBefore;
      if (day > 0) { res.maxRecurringDay = Math.max(res.maxRecurringDay, recurringToday); res.maxDay = Math.max(res.maxDay, earnedToday); }

      if (day + 1 === HORIZONS[h]) {
        const snap = res.snapshots[h];
        const vals: Record<MetricId, number> = {
          credits, earned: src.reduce((a, b) => a + b, 0), spent: snk.reduce((a, b) => a + b, 0), packsOpened, freeStarterPacks: freeStarter,
          cards, distinct, duplicates: cards - distinct, collectionPct: (100 * distinct) / cat.n, legendaryDistinct: legendary, epicDistinct: epic,
          passLevel: Math.min(SEASON_MAX_LEVEL, Math.floor(passXp / SEASON_XP_PER_LEVEL)), accountLevel: accountLevelOf(accountXp), points,
          decksPossible: decksPossible(), salvageCredits, missionClaims, deckReadyDay,
        };
        METRICS.forEach((m, i) => { snap[i] = vals[m]; });
        res.sources[h].set(src); res.sinks[h].set(snk);
        h++;
        if (h >= H) break;
      }
    }
    return res;
  }
}

/** Nivel de cuenta: inversa de `totalXpForLevel(L) = round(100·(L−1)^1.6)`. */
export function accountLevelOf(xp: number): number {
  let level = 1;
  while (Math.round(100 * Math.pow(level, 1.6)) <= xp) level++;
  return level;
}

/* ───────────────────────────── agregación ───────────────────────────── */

export const PERCENTILES = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99] as const;
export const pLabel = (p: number) => `P${Math.round(p * 100)}`;

export function percentilesOf(values: Float64Array | Float32Array): Record<string, number> & { mean: number; min: number; max: number } {
  const sorted = Float64Array.from(values).sort();
  const out: Record<string, number> = {};
  for (const p of PERCENTILES) out[pLabel(p)] = round2(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
  let sum = 0; for (let i = 0; i < sorted.length; i++) sum += sorted[i];
  return Object.assign(out, { mean: round2(sum / Math.max(1, sorted.length)), min: round2(sorted[0] ?? 0), max: round2(sorted[sorted.length - 1] ?? 0) });
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function seedOf(archIdx: number, i: number, rules: RuleSet): number {
  let x = (Math.imul(archIdx + 1, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b) ^ (rules === "baseline" ? 0x27d4eb2f : 0x165667b1)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15;
  return (x % 2147483646) + 1;
}
