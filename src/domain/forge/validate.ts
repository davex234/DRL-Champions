/**
 * F79 · VALIDACIÓN DEL DOCUMENTO DE CONFIGURACIÓN DE LA FORJA (panel). PURO.
 *
 * Se valida TODO antes de guardar. Lo que más importa:
 *   · Contenido REAL: ediciones, cartas, jugadores, equipos, proyectos y misiones que existen (nada inventado).
 *   · Economía: una receta avanzada ACTIVA no puede estar por debajo de su suelo seguro (misma regla que F73:
 *     X = max(2, ⌈1,25·salida/entrada⌉), entrada valorada en la clase MÁS BARATA que consume; con salida de carta
 *     CONCRETA, el lado de salida usa el valor real de esa carta si es mayor que la media de su clase). Recompensas de
 *     objetivos y logros acotadas por el mismo tope que las misiones F73.
 *   · Coherencia: nada ACTIVO puede depender de algo en borrador (se quedaría bloqueado para siempre) y no hay ciclos
 *     de desbloqueo entre recetas.
 */
import type { CardDef } from "@/domain/cards/types";
import { MISSION_REWARD_CAP, MISSION_TARGET_MAX } from "@/domain/missionEngine/validate";
import { PACK_CLASS_ORDER, packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { classEconomy, MIN_OUTPUT_POOL } from "@/domain/crafting/floors";
import { analyzeRatio, type RatioAnalysis } from "@/domain/crafting/economy";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import type { MissionReward as MissionRewardLike } from "@/domain/missionEngine/types";
import { CONTENT_STATUSES, FORGE_BRANCHES, FORGE_ID_RE, FORGE_RECIPE_PREFIX, type AdvancedRecipe, type ForgeConfig } from "./types";
import { totalConsumed } from "./requirements";

export interface ForgeLookup {
  card: (id: string) => CardDef | undefined;
  playerExists: (id: string) => boolean;
  teamExists: (key: string) => boolean;
  variantExists: (id: string) => boolean;
  projectExists: (id: string) => boolean;
  missionExists: (id: string) => boolean;
  packExists: (id: string) => boolean;
  /** Cartas PUBLICADAS de una clase (pool de salida aleatoria). */
  classPool: (cls: PackCardClass) => number;
}

export interface ForgeProblem { code: string; message: string; path: string }

const isInt = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const classIdx = (c: unknown) => PACK_CLASS_ORDER.indexOf(c as PackCardClass);

/** Clase de la salida (la de la carta concreta, o la pedida). */
export function outputClassOf(r: Pick<AdvancedRecipe, "output">, card: (id: string) => CardDef | undefined): PackCardClass | null {
  return r.output.type === "CLASS" ? r.output.class : (() => { const d = card(r.output.cardId); return d ? packCardClass(d) : null; })();
}
/** Clase MÁS BARATA que consume (es la que valora la entrada, en el peor caso). */
export const lowestInputClass = (r: Pick<AdvancedRecipe, "consume">): PackCardClass | null =>
  r.consume.length ? r.consume.map((s) => s.class).sort((a, b) => classIdx(a) - classIdx(b))[0] : null;

/** Suelo seguro de una receta avanzada (o null si no se puede analizar). */
export function advancedFloor(r: Pick<AdvancedRecipe, "consume" | "output">, card: (id: string) => CardDef | undefined): RatioAnalysis | null {
  const inCls = lowestInputClass(r); const outCls = outputClassOf(r, card);
  if (!inCls || !outCls) return null;
  const e = classEconomy(); const I = e[inCls], O = e[outCls];
  if (!I || !O || I.directCostPerCard === null || O.directCostPerCard === null) return null;
  let outValue = O.marketMean, outSalvage = O.salvageMean;
  if (r.output.type === "CARD") { const d = card(r.output.cardId); if (d) { outValue = Math.max(outValue, marketValue(d)); outSalvage = Math.max(outSalvage, salvageValue(d)); } }
  return analyzeRatio({ cost: I.directCostPerCard, value: I.marketMin, salvage: I.salvageMin }, { cost: O.directCostPerCard, value: outValue, salvage: outSalvage });
}

function rewardProblems(rw: MissionRewardLike | undefined, path: string, lk: ForgeLookup, bad: (code: string, message: string, path: string) => void) {
  const r = rw ?? {};
  if (r.credits !== undefined && !isInt(r.credits, 0, MISSION_REWARD_CAP.credits)) bad("BAD_REWARD", `Créditos de 0 a ${MISSION_REWARD_CAP.credits}`, path);
  if (r.xp !== undefined && !isInt(r.xp, 0, MISSION_REWARD_CAP.xp)) bad("BAD_REWARD", `XP de 0 a ${MISSION_REWARD_CAP.xp}`, path);
  if (r.packCount !== undefined && !isInt(r.packCount, 0, MISSION_REWARD_CAP.packCount)) bad("BAD_REWARD", `Sobres de 0 a ${MISSION_REWARD_CAP.packCount}`, path);
  if (r.packId && !lk.packExists(r.packId)) bad("UNKNOWN_PACK", `El sobre ${r.packId} no existe`, path);
  if (r.packId === "inicial") bad("BAD_REWARD", "El Sobre Inicial no es una recompensa", path);
}

export function validateForgeConfig(cfg: ForgeConfig, lk: ForgeLookup): ForgeProblem[] {
  const out: ForgeProblem[] = [];
  const bad = (code: string, message: string, path: string) => out.push({ code, message, path });

  // ── números de progresión
  for (const [k, v] of Object.entries(cfg.xp)) if (!isInt(v, 0, 10_000)) bad("BAD_XP", `XP «${k}» debe ser un entero de 0 a 10.000`, `xp.${k}`);
  if (!(typeof cfg.curve.base === "number" && cfg.curve.base >= 1 && cfg.curve.base <= 100_000)) bad("BAD_CURVE", "Base de la curva de 1 a 100.000", "curve.base");
  if (!(typeof cfg.curve.growth === "number" && cfg.curve.growth >= 1 && cfg.curve.growth <= 3)) bad("BAD_CURVE", "Crecimiento de la curva de 1 a 3", "curve.growth");
  if (!isInt(cfg.curve.maxLevel, 2, 200)) bad("BAD_CURVE", "Nivel máximo de 2 a 200", "curve.maxLevel");
  const branches = new Set<string>();
  cfg.mastery.forEach((m, i) => {
    if (!FORGE_BRANCHES.includes(m.branch) || branches.has(m.branch)) bad("BAD_MASTERY", "Rama de maestría inválida o repetida", `mastery[${i}]`);
    branches.add(m.branch);
    if (!Array.isArray(m.thresholds) || m.thresholds.length < 1 || m.thresholds.length > 10 || m.thresholds.some((t, j) => !isInt(t, 1, 100_000) || (j > 0 && t <= m.thresholds[j - 1]))) bad("BAD_MASTERY", "Umbrales de maestría: 1–10 enteros positivos y crecientes", `mastery[${i}].thresholds`);
  });

  // ── ids únicos
  const uniq = (kind: string, ids: string[]) => { const s = new Set<string>(); ids.forEach((id, i) => { if (!FORGE_ID_RE.test(id)) bad("BAD_ID", `Id inválido: ${id}`, `${kind}[${i}]`); if (s.has(id)) bad("DUP_ID", `Id repetido: ${id}`, `${kind}[${i}]`); s.add(id); }); return s; };
  const recipeIds = uniq("recipes", cfg.recipes.map((r) => r.id));
  const blueprintIds = uniq("blueprints", cfg.blueprints.map((b) => b.id));
  uniq("chains", cfg.chains.map((c) => c.id));
  uniq("objectives", cfg.objectives.map((o) => o.id));
  const achievementIds = uniq("achievements", cfg.achievements.map((a) => a.id));
  const status = (id: string, list: { id: string; status: string }[]) => list.find((x) => x.id === id)?.status;
  const statusOk = (s: unknown) => CONTENT_STATUSES.includes(s as never);

  // ── recetas avanzadas
  cfg.recipes.forEach((r, i) => {
    const p = `recipes[${i}]`;
    if (!r.id.startsWith(FORGE_RECIPE_PREFIX)) bad("BAD_ID", `Las recetas avanzadas empiezan por «${FORGE_RECIPE_PREFIX}»`, p);
    if (!r.name || r.name.trim().length < 3 || r.name.length > 60) bad("BAD_NAME", "Nombre de 3 a 60 caracteres", p);
    if (typeof r.hint !== "string" || r.hint.length > 160) bad("BAD_HINT", "Pista de hasta 160 caracteres", p);
    if (!statusOk(r.status)) bad("BAD_STATUS", "Estado inválido", p);
    if (!Array.isArray(r.consume) || r.consume.length < 1 || r.consume.length > 4) bad("BAD_CONSUME", "De 1 a 4 huecos de consumo", p);
    else {
      const total = totalConsumed(r.consume);
      if (!isInt(total, 2, 100)) bad("BAD_QTY", "En total se consumen de 2 a 100 copias", p);
      r.consume.forEach((s, j) => {
        const sp = `${p}.consume[${j}]`;
        if (!isInt(s.qty, 1, 40)) bad("BAD_QTY", "Cada hueco consume de 1 a 40 copias", sp);
        if (classIdx(s.class) < 0) bad("UNKNOWN_CLASS", "Clase inválida", sp);
        if (s.variantId) {
          if (!lk.variantExists(s.variantId)) bad("UNKNOWN_VARIANT", `La edición ${s.variantId} no existe`, sp);
          else if (s.variantId !== "base" && packCardClass({ variantId: s.variantId as CardDef["variantId"], ovr: 80 }) !== s.class) bad("CLASS_VARIANT", "Esa edición no pertenece a esa clase", sp);
        }
        if (s.team && !lk.teamExists(s.team)) bad("UNKNOWN_TEAM", `El equipo ${s.team} no existe`, sp);
        if (s.playerId && !lk.playerExists(s.playerId)) bad("UNKNOWN_PLAYER", `El jugador ${s.playerId} no existe`, sp);
      });
    }
    const outCls = outputClassOf(r, lk.card);
    if (r.output?.type === "CARD" && !lk.card(r.output.cardId)) bad("UNKNOWN_CARD", `La carta ${r.output.cardId} no existe`, `${p}.output`);
    else if (!outCls) bad("BAD_OUTPUT", "Salida inválida (la carta no pertenece a ninguna clase)", `${p}.output`);
    const inCls = lowestInputClass(r);
    if (outCls && inCls && classIdx(outCls) <= classIdx(inCls)) bad("DOWNGRADE", "La salida debe ser de una clase superior a lo que consume", `${p}.output`);
    r.own?.forEach((o, j) => {
      const op = `${p}.own[${j}]`;
      if (o.type === "OWN_EDITION" && (!lk.variantExists(o.variantId) || !isInt(o.min, 1, 400))) bad("BAD_OWN", "Edición real y mínimo de 1 a 400", op);
      else if (o.type === "OWN_DISTINCT_PLAYERS" && !isInt(o.min, 1, 400)) bad("BAD_OWN", "Mínimo de jugadores de 1 a 400", op);
      else if (o.type === "OWN_CARD" && !lk.card(o.cardId)) bad("UNKNOWN_CARD", `La carta ${o.cardId} no existe`, op);
    });
    r.unlock?.forEach((u, j) => {
      const up = `${p}.unlock[${j}]`;
      if (u.type === "FORGE_LEVEL" && !isInt(u.min, 1, cfg.curve.maxLevel)) bad("BAD_UNLOCK", "Nivel de Forja fuera de la curva", up);
      if (u.type === "RECIPE_DONE" && (!recipeIds.has(u.recipeId) || u.recipeId === r.id)) bad("BAD_UNLOCK", `Receta previa inexistente: ${u.recipeId}`, up);
      if (u.type === "BLUEPRINT" && !blueprintIds.has(u.blueprintId)) bad("BAD_UNLOCK", `Plano inexistente: ${u.blueprintId}`, up);
      if (u.type === "MASTERY" && (!FORGE_BRANCHES.includes(u.branch) || !isInt(u.min, 1, 10))) bad("BAD_UNLOCK", "Maestría inválida", up);
      if (r.status === "ACTIVE") {
        if (u.type === "RECIPE_DONE" && status(u.recipeId, cfg.recipes) === "DRAFT") bad("DRAFT_DEPENDENCY", `Depende de una receta en borrador: ${u.recipeId}`, up);
        if (u.type === "BLUEPRINT" && status(u.blueprintId, cfg.blueprints) === "DRAFT") bad("DRAFT_DEPENDENCY", `Depende de un plano en borrador: ${u.blueprintId}`, up);
      }
    });
    if (r.status === "ACTIVE" && out.every((x) => !x.path.startsWith(p))) {
      if (r.output.type === "CLASS" && lk.classPool(r.output.class) < MIN_OUTPUT_POOL) bad("SCARCE_OUTPUT", `La clase de salida tiene menos de ${MIN_OUTPUT_POOL} cartas: sería una garantía`, p);
      const f = advancedFloor(r, lk.card);
      const qty = totalConsumed(r.consume);
      if (!f) bad("NO_ANALYSIS", "No hay estadística para analizar esta receta: no se puede activar", p);
      else if (!f.viable) bad("NOT_VIABLE", `El suelo seguro (${f.ratio}) supera lo jugable`, p);
      else if (qty < f.ratio) bad("BELOW_FLOOR", `Por debajo del suelo seguro: mínimo ${f.ratio} copias (crearía valor)`, p);
    }
  });
  // Ciclos de desbloqueo entre recetas (RECIPE_DONE).
  const deps = new Map(cfg.recipes.map((r) => [r.id, (r.unlock ?? []).filter((u) => u.type === "RECIPE_DONE").map((u) => (u as { recipeId: string }).recipeId)]));
  const seen = new Set<string>(), stack = new Set<string>();
  const cyc = (id: string): boolean => { if (stack.has(id)) return true; if (seen.has(id)) return false; seen.add(id); stack.add(id); const c = (deps.get(id) ?? []).some(cyc); stack.delete(id); return c; };
  for (const r of cfg.recipes) if (cyc(r.id)) { bad("CYCLE", `Desbloqueo circular en ${r.id}`, "recipes"); break; }

  // ── cadenas
  cfg.chains.forEach((c, i) => {
    const p = `chains[${i}]`;
    if (!statusOk(c.status)) bad("BAD_STATUS", "Estado inválido", p);
    if (!c.name || c.name.length < 3 || c.name.length > 60) bad("BAD_NAME", "Nombre de 3 a 60 caracteres", p);
    if (!Array.isArray(c.steps) || c.steps.length < 2 || c.steps.length > 8 || new Set(c.steps).size !== c.steps.length) bad("BAD_CHAIN", "De 2 a 8 pasos distintos", p);
    c.steps?.forEach((s) => { if (!recipeIds.has(s)) bad("BAD_CHAIN", `Paso inexistente: ${s}`, p); else if (c.status === "ACTIVE" && status(s, cfg.recipes) !== "ACTIVE") bad("DRAFT_DEPENDENCY", `Paso no activo: ${s}`, p); });
  });

  // ── planos
  cfg.blueprints.forEach((b, i) => {
    const p = `blueprints[${i}]`; const s = b.source;
    if (!statusOk(b.status)) bad("BAD_STATUS", "Estado inválido", p);
    if (!b.name || b.name.length < 3 || b.name.length > 60) bad("BAD_NAME", "Nombre de 3 a 60 caracteres", p);
    if (s?.type === "FORGE_LEVEL" && !isInt(s.min, 1, cfg.curve.maxLevel)) bad("BAD_SOURCE", "Nivel fuera de la curva", p);
    else if (s?.type === "PROJECT_CLAIMED" && !lk.projectExists(s.projectId)) bad("BAD_SOURCE", `Proyecto inexistente: ${s.projectId}`, p);
    else if (s?.type === "MISSION_COMPLETED" && !lk.missionExists(s.missionId)) bad("BAD_SOURCE", `Misión inexistente: ${s.missionId}`, p);
    else if (s?.type === "ACHIEVEMENT" && !achievementIds.has(s.achievementId)) bad("BAD_SOURCE", `Logro inexistente: ${s.achievementId}`, p);
    else if (!s || !["FORGE_LEVEL", "PROJECT_CLAIMED", "MISSION_COMPLETED", "ACHIEVEMENT"].includes(s.type)) bad("BAD_SOURCE", "Fuente de plano inválida", p);
    if (b.status === "ACTIVE" && s?.type === "ACHIEVEMENT" && status(s.achievementId, cfg.achievements) === "DRAFT") bad("DRAFT_DEPENDENCY", "Su logro está en borrador", p);
  });

  // ── extras de proyectos
  const projSeen = new Set<string>();
  cfg.projects.forEach((x, i) => {
    const p = `projects[${i}]`;
    if (!lk.projectExists(x.projectId)) bad("UNKNOWN_PROJECT", `Proyecto inexistente: ${x.projectId}`, p);
    if (projSeen.has(x.projectId)) bad("DUP_ID", "Proyecto repetido", p);
    projSeen.add(x.projectId);
    if (x.fabricateRecipeId && !recipeIds.has(x.fabricateRecipeId)) bad("UNKNOWN_RECIPE", `Receta de fabricación inexistente: ${x.fabricateRecipeId}`, p);
    x.own?.forEach((o, j) => { if (o.type === "OWN_CARD" && !lk.card(o.cardId)) bad("UNKNOWN_CARD", `La carta ${o.cardId} no existe`, `${p}.own[${j}]`); if (o.type === "OWN_EDITION" && !lk.variantExists(o.variantId)) bad("UNKNOWN_VARIANT", `La edición ${o.variantId} no existe`, `${p}.own[${j}]`); });
  });

  // ── objetivos y logros
  cfg.objectives.forEach((o, i) => {
    const p = `objectives[${i}]`;
    if (!statusOk(o.status)) bad("BAD_STATUS", "Estado inválido", p);
    if (!["DAILY", "WEEKLY"].includes(o.period)) bad("BAD_PERIOD", "Periodo DAILY o WEEKLY", p);
    if (!["CRAFT_PACK", "CRAFT_CARD", "CRAFT_ADVANCED", "CRAFT_ANY"].includes(o.metric)) bad("BAD_METRIC", "Métrica inválida", p);
    if (!isInt(o.target, 1, MISSION_TARGET_MAX)) bad("BAD_TARGET", `Objetivo de 1 a ${MISSION_TARGET_MAX}`, p);
    if (o.activeWindows !== undefined && !(Array.isArray(o.activeWindows) && o.activeWindows.every((w) => w && Number.isFinite(w.from) && (w.to === null || (Number.isFinite(w.to) && w.to >= w.from)))))
      bad("BAD_ACTIVE_WINDOWS", "activeWindows las sella el servidor ({from, to|null} en ms)", p);
    rewardProblems(o.reward, `${p}.reward`, lk, bad);
  });
  cfg.achievements.forEach((a, i) => {
    const p = `achievements[${i}]`;
    if (!statusOk(a.status)) bad("BAD_STATUS", "Estado inválido", p);
    if (!["CRAFTS_TOTAL", "ADVANCED_CRAFTS", "CHAINS_DONE", "PROJECTS_CLAIMED", "FORGE_LEVEL"].includes(a.metric)) bad("BAD_METRIC", "Métrica inválida", p);
    if (!isInt(a.target, 1, 100_000)) bad("BAD_TARGET", "Objetivo de 1 a 100.000", p);
    rewardProblems(a.reward, `${p}.reward`, lk, bad);
  });
  if (typeof cfg.pity?.enabled !== "boolean" || typeof cfg.pity?.preferUnowned !== "boolean") bad("BAD_PITY", "Pity: enabled y preferUnowned booleanos", "pity");
  return out;
}
