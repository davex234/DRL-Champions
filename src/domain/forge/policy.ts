/**
 * F79.1 · POLÍTICA DE CAMBIOS DE PROGRESIÓN — que una edición normal del panel NO baje a nadie de nivel. PURO.
 *
 * La progresión de la Forja se DERIVA del libro mayor con las reglas vigentes (eso evita duplicados y carreras). La
 * contrapartida: cambiar las reglas recalcula a todos. Esta política separa los cambios en dos:
 *
 *   · MONÓTONOS (seguros): solo pueden mantener o SUBIR la XP, el nivel, los rangos y los desbloqueos de cualquier
 *     jugador (más XP por acción, curva más suave, más niveles, umbrales más bajos, contenido nuevo…). Se guardan sin más.
 *   · REGRESIVOS (peligrosos): alguno puede BAJAR la progresión ya ganada (menos XP por acción, curva más dura, menos
 *     niveles, umbrales más altos, una cadena u objetivo vivo que vuelve a borrador o cambia, una condición de
 *     desbloqueo/plano vivo que cambia…). El servidor los RECHAZA salvo acción explícita (`confirmRegression: true` +
 *     motivo), y el panel enseña antes cuántos jugadores bajarían (`forgeImpact`, sobre el libro mayor real).
 *
 * Determinista: depende solo de los dos documentos. Conservadora: ante la duda, marca como regresivo.
 */
import { xpToNext } from "./progression";
import type { ForgeConfig } from "./types";

export interface RegressionRisk { code: string; path: string; message: string }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const cumulative = (curve: ForgeConfig["curve"], level: number) => { let t = 0; for (let l = 1; l < level; l++) t += xpToNext(l, curve); return t; };

export function progressionRegressions(prev: ForgeConfig, next: ForgeConfig): RegressionRisk[] {
  const out: RegressionRisk[] = [];
  const risk = (code: string, path: string, message: string) => out.push({ code, path, message });

  // XP por acción: bajar cualquiera reduce la XP de quien ya la hizo.
  for (const k of Object.keys(prev.xp) as (keyof ForgeConfig["xp"])[]) {
    if ((next.xp[k] ?? 0) < prev.xp[k]) risk("XP_LOWERED", `xp.${k}`, `La XP de «${k}» baja de ${prev.xp[k]} a ${next.xp[k] ?? 0}`);
  }
  // Curva: ningún nivel alcanzable hoy puede pasar a costar más XP acumulada; el tope no puede bajar.
  if (next.curve.maxLevel < prev.curve.maxLevel) risk("MAX_LEVEL_LOWERED", "curve.maxLevel", `El nivel máximo baja de ${prev.curve.maxLevel} a ${next.curve.maxLevel}`);
  const top = Math.min(prev.curve.maxLevel, next.curve.maxLevel);
  for (let l = 2; l <= top; l++) {
    if (cumulative(next.curve, l) > cumulative(prev.curve, l)) { risk("CURVE_HARDER", "curve", `Llegar al nivel ${l} costaría ${cumulative(next.curve, l)} XP en vez de ${cumulative(prev.curve, l)}`); break; }
  }
  // Maestría: una rama viva no desaparece, no cambia de métrica y sus umbrales no suben ni se quitan.
  for (const m of prev.mastery) {
    const n = next.mastery.find((x) => x.branch === m.branch);
    if (!n) { risk("MASTERY_REMOVED", `mastery.${m.branch}`, `Desaparece la rama de maestría ${m.label}`); continue; }
    if (n.metric !== m.metric) risk("MASTERY_METRIC_CHANGED", `mastery.${m.branch}`, `La rama ${m.label} cambia de métrica`);
    const a = [...m.thresholds].sort((x, y) => x - y), b = [...n.thresholds].sort((x, y) => x - y);
    if (b.length < a.length) risk("MASTERY_RANKS_REMOVED", `mastery.${m.branch}`, `La rama ${m.label} pierde rangos (${a.length} → ${b.length})`);
    else if (a.some((t, i) => b[i] > t)) risk("MASTERY_HARDER", `mastery.${m.branch}`, `Algún umbral de ${m.label} sube`);
  }
  // Cadenas que ya dan XP (no DRAFT): no pueden volver a borrador, desaparecer ni cambiar de pasos.
  for (const c of prev.chains.filter((x) => x.status !== "DRAFT")) {
    const n = next.chains.find((x) => x.id === c.id);
    if (!n || n.status === "DRAFT") risk("CHAIN_REMOVED", `chains.${c.id}`, `La cadena «${c.name}» deja de contar (borrador o eliminada)`);
    else if (!same(n.steps, c.steps)) risk("CHAIN_CHANGED", `chains.${c.id}`, `La cadena «${c.name}» cambia de pasos`);
  }
  // Objetivos que ya dan XP: no pueden volver a borrador, desaparecer, endurecerse ni cambiar qué cuentan.
  for (const o of prev.objectives.filter((x) => x.status !== "DRAFT" && (x.activeWindows ?? []).length > 0)) {
    const n = next.objectives.find((x) => x.id === o.id);
    if (!n || n.status === "DRAFT") risk("OBJECTIVE_REMOVED", `objectives.${o.id}`, `El objetivo «${o.name}» deja de contar (borrador o eliminado)`);
    else if (n.target > o.target || n.metric !== o.metric || n.period !== o.period) risk("OBJECTIVE_CHANGED", `objectives.${o.id}`, `El objetivo «${o.name}» se endurece o cambia qué cuenta`);
  }
  // Desbloqueos vivos: cambiar las condiciones de una receta o la fuente de un plano puede volver a bloquearlos.
  for (const r of prev.recipes.filter((x) => x.status === "ACTIVE")) {
    const n = next.recipes.find((x) => x.id === r.id);
    if (n && n.status === "ACTIVE" && !same(n.unlock, r.unlock)) risk("UNLOCK_CHANGED", `recipes.${r.id}`, `Cambian las condiciones de desbloqueo de «${r.name}»`);
  }
  for (const b of prev.blueprints.filter((x) => x.status !== "DRAFT")) {
    const n = next.blueprints.find((x) => x.id === b.id);
    if (!n || n.status === "DRAFT") risk("BLUEPRINT_REMOVED", `blueprints.${b.id}`, `El plano «${b.name}» deja de existir para quien lo tiene`);
    else if (!same(n.source, b.source)) risk("BLUEPRINT_CHANGED", `blueprints.${b.id}`, `Cambia cómo se obtiene el plano «${b.name}»`);
  }
  return out;
}

/** Impacto REAL de pasar de `prev` a `next` sobre jugadores concretos (lo calcula el servidor con el libro mayor). */
export interface ForgeImpact { players: number; levelDrops: number; maxDrop: number; levelGains: number }

/**
 * F79.1 · Ventanas de actividad de cada objetivo: las sella el SERVIDOR (lo que mande el panel se ignora). Pasar a ACTIVE
 * abre una ventana; salir de ACTIVE la cierra. Así retirar congela y reactivar no regala el pasado.
 */
export function stampWindows(prev: ForgeConfig, next: ForgeConfig, now: number): ForgeConfig {
  return { ...next, objectives: next.objectives.map((o) => {
    const p = prev.objectives.find((x) => x.id === o.id);
    const w = (p?.activeWindows ?? []).map((x) => ({ ...x }));
    const was = p?.status === "ACTIVE", is = o.status === "ACTIVE";
    if (is && !was) w.push({ from: now, to: null });
    if (!is && was && w.length && w[w.length - 1].to === null) w[w.length - 1].to = now;
    return { ...o, activeWindows: w };
  }) };
}
