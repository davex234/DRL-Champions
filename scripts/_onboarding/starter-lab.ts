/**
 * LABORATORIO DEL STARTER (investigación 2026-10-11) — `npx tsx scripts/_onboarding/starter-lab.ts [catalogo|causa|soluciones|all] [N]`
 *
 * NO toca src ni el verificador: importa el motor real (`PackEngine`, `deckReadiness`, `starterAssistFor`, `getPack`) y
 * reimplementa DENTRO de este fichero las variantes (resolutor de rol, orden, huecos asistidos, tope, rescate).
 * Semillas: la MISMA fórmula que `scripts/economy41-verify.ts` (acc·7919 + k·104729 + 99), y una segunda pasada con +4242.
 * Salida: consola + `logs/onboarding/<seccion>.json`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CardRegistry } from "../../src/collection/registry";
import { PackEngine } from "../../src/pack/engine";
import { getPack } from "../../src/data/packs";
import { freshPity } from "../../src/domain/packs/pity";
import { buildPool, BUCKETS } from "../../src/domain/packs/pool";
import { classPool } from "../../src/domain/packs/openPack";
import { packPlan, PACK_CLASS_ORDER, packCardClass } from "../../src/domain/packs/packClass";
import { deckReadiness, type ReadinessCard } from "../../src/domain/journey";
import { STARTER_POLICY, starterAssistFor } from "../../src/domain/economy/starter";
import { DUEL_ROLES } from "../../src/domain/cardgame/types";
import { marketValue } from "../../src/domain/economy/pricing";
import { salvageValue } from "../../src/domain/economy/salvage";
import type { StarterAssist } from "../../src/domain/packs/openPack";

const section = process.argv[2] ?? "all";
const N = Number(process.argv[3] ?? 20_000);
const want = (s: string) => section === "all" || section === s;
const OUT = "logs/onboarding";
mkdirSync(OUT, { recursive: true });
const save = (name: string, data: unknown) => { writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 1) + "\n"); console.log(`→ ${OUT}/${name}.json`); };

const REG = new CardRegistry();
const ENGINE = new PackEngine(REG);
type Res = (id: string) => ReadinessCard | null;
/** Resolutor del VERIFICADOR (economy41-verify.ts:48): rol del JUGADOR. */
const resolvePlayer: Res = (id) => { const c = REG.card(id); const p = c ? REG.player(c.playerId) : undefined; return c && p ? { playerId: c.playerId, role: p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null; };
/** Resolutor del SERVICIO (server/services/starter.ts:34): rol de la CARTA (`c.role ?? p.role`). */
const resolveCard: Res = (id) => { const c = REG.card(id); const p = c ? REG.player(c.playerId) : undefined; return c && p ? { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null; };

const INICIAL_FIRST = ["inicial", "inicial", "inicial", "estandar"];
const GUIDE = ["estandar", "inicial", "inicial", "inicial"];
const seedA = (acc: number, k: number) => ((acc * 7919 + k * 104729 + 99) >>> 0) % 2147483647;
const seedB = (acc: number, k: number) => ((acc * 7919 + k * 104729 + 99 + 4242) >>> 0) % 2147483647;

interface Cfg {
  id: string; label: string;
  resolver: "player" | "card";
  order: string[];
  assistSlots: number;
  cap: number;
  /** Rescate determinista: tras `rescueAfter` gratis extra sin equipo, se conceden EXACTAMENTE las cartas de rol que faltan (base de menor valor, jugador no poseído). */
  rescueAfter?: number;
  /** Sobre de alta alternativo: el Bronce de bienvenida recibe también asistencia (no simulable sin tocar el motor por clase) → no usado. */
}
interface Out {
  id: string; label: string; n: number; seeds: string;
  trapped: number; trappedPct: number; readyAfterWelcomePct: number;
  p50: number; p90: number; p99: number; max: number; mean: number;
  meets: boolean;
  histogram: Record<number, number>;
  freeExtraMean: number; cardsMean: number; marketMean: number; salvageMean: number; rescueAccounts: number; rescueCardsMean: number;
  shortagesAfterWelcome: Record<string, number>; shortagesTrapped: Record<string, number>; missingSlotsTrapped: Record<number, number>;
  uselessAssisted: { assistedCards: number; uselessForVerifier: number };
}

const cardRoleOf = (id: string) => { const c = REG.card(id)!; return c.role ?? REG.player(c.playerId)!.role; };

function run(cfg: Cfg, seed: (acc: number, k: number) => number, seedName: string, n = N): Out {
  const resolve = cfg.resolver === "player" ? resolvePlayer : resolveCard;
  const totals: number[] = []; let trapped = 0; let readyWelcome = 0;
  let freeExtraSum = 0; let cardsSum = 0; let mvSum = 0; let svSum = 0; let rescueAccounts = 0; let rescueCards = 0;
  const shW: Record<string, number> = {}; const shT: Record<string, number> = {}; const missT: Record<number, number> = {};
  let assistedCards = 0; let useless = 0;
  const hist: Record<number, number> = {};
  for (let acc = 0; acc < n; acc++) {
    const ids: string[] = []; let pity = freshPity(); let k = 0; let opened = 0;
    const open = (id: string) => {
      let a: StarterAssist | null = id === "inicial" ? starterAssistFor("inicial", ids, resolve) : null;
      if (a && cfg.assistSlots !== STARTER_POLICY.assistSlots) a = { ...a, slots: cfg.assistSlots };
      if (a && cfg.assistSlots === 0) a = null;
      const before = a ? deckReadiness(ids, resolve) : null;
      const r = ENGINE.draw(getPack(id)!, { seed: seed(acc, k++), owned: [], mintCounts: {}, pity, now: 0, assist: a } as never);
      pity = r.pityAfter;
      for (const i of r.instances) ids.push(i.cardId);
      if (a && before) {
        // ¿cuántas cartas del sobre asistido NO acercaron a la cuenta al equipo según ESTE resolutor? (cobertura total de huecos)
        const tot = (x: ReturnType<typeof deckReadiness>) => x.roles.reduce((s, y) => s + y.have, 0);
        const gained = tot(deckReadiness(ids, resolve)) - tot(before);
        const expected = Math.min(a.slots, Object.values(a.needByRole).reduce((s, v) => s + (v ?? 0), 0));
        assistedCards += expected; useless += Math.max(0, expected - gained);
      }
      opened++;
    };
    for (const id of cfg.order) open(id);
    let rd = deckReadiness(ids, resolve);
    if (rd.ready) readyWelcome++; else for (const s of rd.shortages) shW[s.role] = (shW[s.role] ?? 0) + (s.need - s.have);
    let extra = 0; let rescued = 0;
    while (!rd.ready && extra < cfg.cap) {
      if (cfg.rescueAfter !== undefined && extra >= cfg.rescueAfter) {
        // RESCATE DETERMINISTA: por cada hueco que falta, la carta base de MENOR valor de ese rol (rol de carta) de un jugador no poseído.
        const ownedPlayers = new Set(ids.map((i) => REG.card(i)!.playerId));
        for (const s of rd.shortages) for (let m = 0; m < s.need - s.have; m++) {
          const cand = REG.cards.filter((c) => !!c.combat && c.variantId === "base" && cardRoleOf(c.id) === s.role && resolve(c.id)!.role === s.role && !ownedPlayers.has(c.playerId))
            .sort((x, y) => marketValue(x) - marketValue(y) || (x.id < y.id ? -1 : 1))[0];
          if (cand) { ids.push(cand.id); ownedPlayers.add(cand.playerId); rescued++; }
        }
        opened++; // cuenta como una «apertura» (un gesto)
        rd = deckReadiness(ids, resolve);
        break;
      }
      open("inicial"); extra++;
      rd = deckReadiness(ids, resolve);
    }
    if (!rd.ready) {
      trapped++;
      let miss = 0;
      for (const s of rd.shortages) { shT[s.role] = (shT[s.role] ?? 0) + (s.need - s.have); miss += s.need - s.have; }
      missT[miss] = (missT[miss] ?? 0) + 1;
    }
    totals.push(opened); hist[opened] = (hist[opened] ?? 0) + 1;
    freeExtraSum += extra; cardsSum += ids.length; if (rescued) { rescueAccounts++; rescueCards += rescued; }
    for (const id of ids) { const c = REG.card(id)!; mvSum += marketValue(c); svSum += salvageValue(c); }
  }
  totals.sort((a, b) => a - b);
  const q = (p: number) => totals[Math.floor(p * (n - 1))];
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    id: cfg.id, label: cfg.label, n, seeds: seedName,
    trapped, trappedPct: r2((100 * trapped) / n), readyAfterWelcomePct: r2((100 * readyWelcome) / n),
    p50: q(0.5), p90: q(0.9), p99: q(0.99), max: totals[n - 1], mean: r2(totals.reduce((a, b) => a + b, 0) / n),
    meets: trapped === 0 && q(0.5) <= 4 && q(0.9) <= 6 && q(0.99) <= 8,
    histogram: hist,
    freeExtraMean: r2(freeExtraSum / n), cardsMean: r2(cardsSum / n), marketMean: Math.round(mvSum / n), salvageMean: Math.round(svSum / n),
    rescueAccounts, rescueCardsMean: rescueAccounts ? r2(rescueCards / rescueAccounts) : 0,
    shortagesAfterWelcome: shW, shortagesTrapped: shT, missingSlotsTrapped: missT,
    uselessAssisted: { assistedCards, uselessForVerifier: useless },
  };
}
const line = (o: Out) => console.log(`  ${o.id.padEnd(26)} [${o.seeds}] atrapadas ${String(o.trapped).padStart(5)} (${o.trappedPct} %) · P50 ${o.p50} P90 ${o.p90} P99 ${o.p99} máx ${o.max} media ${o.mean} · listo tras bienvenida ${o.readyAfterWelcomePct} % · gratis extra ${o.freeExtraMean} · cartas ${o.cardsMean} · valor ${o.marketMean} · desguace ${o.salvageMean} · objetivo ${o.meets ? "SÍ" : "no"}`);
const both = (cfg: Cfg) => { const a = run(cfg, seedA, "verificador"); line(a); const b = run(cfg, seedB, "segunda"); line(b); return [a, b]; };

/* ═══════════════════════ CATÁLOGO Y POOLS ═══════════════════════ */
if (want("catalogo")) {
  console.log("\n· CATÁLOGO Y POOLS (medido)");
  const cards = REG.cards; const combat = cards.filter((c) => !!c.combat);
  const players = new Set(cards.map((c) => c.playerId));
  const versions: Record<string, number> = {}; for (const c of cards) versions[c.dataVersion ?? ""] = (versions[c.dataVersion ?? ""] ?? 0) + 1;
  const mismatch = cards.filter((c) => c.role !== undefined && c.role !== REG.player(c.playerId)?.role);
  const noPlayer = cards.filter((c) => !REG.player(c.playerId));
  const count = <T,>(xs: T[], f: (x: T) => string) => { const o: Record<string, number> = {}; for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1; return o; };
  const playerRoleOf = (id: string) => REG.player(REG.card(id)!.playerId)!.role;
  const transitions = count(mismatch, (c) => `${REG.player(c.playerId)!.role} → ${c.role}`);
  // Jugadores con cartas de varios roles
  const rolesByPlayer = new Map<string, Set<string>>(); for (const c of cards) { const s = rolesByPlayer.get(c.playerId) ?? new Set(); s.add(cardRoleOf(c.id)); rolesByPlayer.set(c.playerId, s); }
  const multi = [...rolesByPlayer.values()].filter((s) => s.size > 1).length;
  const distinctPlayers = (xs: typeof cards, role: string, by: "card" | "player") => new Set(xs.filter((c) => (by === "card" ? cardRoleOf(c.id) : playerRoleOf(c.id)) === role).map((c) => c.playerId)).size;

  const poolInfo = (packId: string) => {
    const pack = getPack(packId)!; const built = buildPool(REG, pack, null);
    const perBucket = Object.fromEntries(BUCKETS.map((b) => [b, {
      cards: built.pool[b].length, weight: pack.weights[b],
      byCardRole: count(built.pool[b], (c) => cardRoleOf(c.id)), byPlayerRole: count(built.pool[b], (c) => playerRoleOf(c.id)),
      mismatched: built.pool[b].filter((c) => cardRoleOf(c.id) !== playerRoleOf(c.id)).length,
      variants: count(built.pool[b], (c) => c.variantId),
    }]));
    const plan = packPlan(packId);
    const cls = plan ? classPool(REG, pack, null) : null;
    const perClass = cls ? Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, { cards: cls[k].length, regular: plan!.regular[k], featured: plan!.featured[k], byCardRole: count(cls[k], (c) => cardRoleOf(c.id)), byPlayerRole: count(cls[k], (c) => playerRoleOf(c.id)) }])) : null;
    return { packId, name: pack.name, price: pack.price, cardCount: pack.cardCount, drawMode: plan ? "class-distribution (plan por ranuras)" : "rarity-weights", weights: pack.weights, antiDuplicate: pack.antiDuplicate ?? "allow", repeatable: pack.repeatable !== false, guaranteedMin: pack.guaranteedMin ?? null, pity: pack.pity ?? null, poolSize: built.size, plan, perBucket: plan ? undefined : perBucket, perClass };
  };
  // Probabilidad de rol por carta de un Sobre Inicial NO asistido (peso de cubo × reparto uniforme en el cubo), por rol de carta y de jugador.
  const ini = getPack("inicial")!; const built = buildPool(REG, ini, null);
  const usable = BUCKETS.filter((b) => built.pool[b].length > 0); const tw = usable.reduce((s, b) => s + ini.weights[b], 0);
  const roleProb = (by: "card" | "player") => Object.fromEntries(DUEL_ROLES.map((r) => [r, Math.round(10000 * usable.reduce((s, b) => s + (ini.weights[b] / tw) * built.pool[b].filter((c) => (by === "card" ? cardRoleOf(c.id) : playerRoleOf(c.id)) === r).length / built.pool[b].length, 0)) / 100]));
  // P(una carta asistida —elegida por rol de CARTA— cuente para ese rol según el rol de JUGADOR)
  const assistHit = Object.fromEntries(DUEL_ROLES.map((r) => {
    let p = 0; let wsum = 0;
    for (const b of usable) { const cand = built.pool[b].filter((c) => cardRoleOf(c.id) === r); if (!cand.length) continue; wsum += ini.weights[b]; p += ini.weights[b] * cand.filter((c) => playerRoleOf(c.id) === r).length / cand.length; }
    return [r, Math.round(10000 * p / wsum) / 100];
  }));
  const data = {
    cards: cards.length, combatCards: combat.length, players: players.size, dataVersions: versions, cardsWithoutPlayer: noPlayer.length,
    cardsWithPrintedRole: cards.filter((c) => c.role !== undefined).length,
    cardRoleDiffersFromPlayerRole: mismatch.length, transitions, playersWithCardsOfSeveralRoles: multi,
    cardsByCardRole: count(cards, (c) => cardRoleOf(c.id)), cardsByPlayerRole: count(cards, (c) => playerRoleOf(c.id)),
    distinctPlayersByCardRole: Object.fromEntries(DUEL_ROLES.map((r) => [r, distinctPlayers(cards, r, "card")])),
    distinctPlayersByPlayerRole: Object.fromEntries(DUEL_ROLES.map((r) => [r, distinctPlayers(cards, r, "player")])),
    cardsByVariant: count(cards, (c) => c.variantId), cardsByPackClass: count(cards, (c) => packCardClass(c) ?? "(sin clase)"),
    inicial: poolInfo("inicial"), estandar: poolInfo("estandar"),
    inicialRoleProbPerCardPct: { byCardRole: roleProb("card"), byPlayerRole: roleProb("player") },
    assistedCardCountsForVerifierPct: assistHit,
    starterPolicy: STARTER_POLICY,
  };
  console.log(JSON.stringify({ ...data, inicial: { ...data.inicial, plan: undefined }, estandar: { ...data.estandar } }, null, 1));
  save("catalogo", data);
}

/* ═══════════════════════ CAUSA ═══════════════════════ */
const base = (over: Partial<Cfg> & { id: string; label: string }): Cfg => ({ resolver: "player", order: INICIAL_FIRST, assistSlots: STARTER_POLICY.assistSlots, cap: STARTER_POLICY.maxFreeClaims, ...over });

if (want("causa")) {
  console.log(`\n· CAUSA (N = ${N} por pasada)`);
  const res: Out[] = [];
  console.log(" 1) réplica exacta del verificador (rol de JUGADOR, Iniciales primero)");
  res.push(...both(base({ id: "V-verificador", label: "Réplica del verificador: resolutor por rol de JUGADOR, Iniciales primero" })));
  console.log(" 2) misma simulación, UNA pieza cambiada: resolutor del servicio real (rol de CARTA)");
  res.push(...both(base({ id: "R-servicio-inicial1º", label: "Resolutor real (rol de CARTA), Iniciales primero", resolver: "card" })));
  console.log(" 3) flujo real de la guía F63: Bronce primero + rol de CARTA");
  res.push(...both(base({ id: "R-servicio-guia", label: "Resolutor real (rol de CARTA), Bronce primero (guía F63)", resolver: "card", order: GUIDE })));
  console.log(" 4) verificador con Bronce primero (solo cambia el orden)");
  res.push(...both(base({ id: "V-verificador-guia", label: "Resolutor del verificador, Bronce primero", order: GUIDE })));
  console.log(" 5) sin asistencia (línea base), con cada resolutor");
  res.push(...both(base({ id: "V-sin-asistencia", label: "Verificador sin asistencia", assistSlots: 0 })));
  res.push(...both(base({ id: "R-sin-asistencia", label: "Real sin asistencia", resolver: "card", assistSlots: 0 })));
  save("causa", res);
}

/* ═══════════════════════ SOLUCIONES ═══════════════════════ */
if (want("soluciones")) {
  console.log(`\n· SOLUCIONES (N = ${N} por pasada) — bloque REAL (rol de carta) y bloque VERIFICADOR (rol de jugador)`);
  const res: Out[] = [];
  const R = (o: Partial<Cfg> & { id: string; label: string }) => base({ resolver: "card", ...o });
  console.log(" REAL · Iniciales primero (peor orden que puede elegir el jugador)");
  res.push(...both(R({ id: "R0-hoy", label: "Hoy (2 huecos, tope 8)" })));
  res.push(...both(R({ id: "R1-tope-12", label: "maxFreeClaims 12", cap: 12 })));
  res.push(...both(R({ id: "R2-asist-3", label: "assistSlots 3", assistSlots: 3 })));
  res.push(...both(R({ id: "R3-asist-5", label: "assistSlots 5 (sobre de rol)", assistSlots: 5 })));
  res.push(...both(R({ id: "R4-rescate-tras-2", label: "Rescate determinista tras 2 gratis", rescueAfter: 2 })));
  console.log(" REAL · Bronce primero (guía)");
  res.push(...both(R({ id: "G0-hoy", label: "Hoy, guía", order: GUIDE })));
  res.push(...both(R({ id: "G2-asist-3", label: "assistSlots 3, guía", order: GUIDE, assistSlots: 3 })));
  console.log(" VERIFICADOR (rol de jugador) — lo que haría falta para ponerlo en verde SIN corregir su resolutor");
  res.push(...both(base({ id: "V0-hoy", label: "Hoy" })));
  res.push(...both(base({ id: "V1-tope-12", label: "maxFreeClaims 12", cap: 12 })));
  res.push(...both(base({ id: "V1-tope-16", label: "maxFreeClaims 16", cap: 16 })));
  res.push(...both(base({ id: "V1-tope-24", label: "maxFreeClaims 24", cap: 24 })));
  res.push(...both(base({ id: "V2-asist-3", label: "assistSlots 3", assistSlots: 3 })));
  res.push(...both(base({ id: "V3-asist-5", label: "assistSlots 5", assistSlots: 5 })));
  res.push(...both(base({ id: "V4-rescate-en-tope", label: "Rescate determinista al llegar al tope (8)", cap: 9, rescueAfter: 8 })));
  res.push(...both(base({ id: "V4-rescate-tras-2", label: "Rescate determinista tras 2 gratis", rescueAfter: 2 })));
  save("soluciones", res);
}
