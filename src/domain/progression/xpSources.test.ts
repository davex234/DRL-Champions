import test from "node:test";
import assert from "node:assert/strict";
import { xpSources, packXpRange, duelWinXp } from "./xpSources";
import { xpForCardRank, levelFromXp, totalXpForLevel } from "./levels";
import { duelPayoutTable } from "./duelRewards";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 1 · Las fuentes de XP salen del código real, no de valores escritos a mano.
test("las fuentes de XP DERIVAN de las funciones reales (no se inventan)", () => {
  const win = duelWinXp();
  const t = duelPayoutTable().win;
  assert.deepEqual(win, { easy: t.EASY.xp, normal: t.NORMAL.xp, hard: t.HARD.xp });

  const range = packXpRange();
  assert.equal(range.min, xpForCardRank(1), "mínimo = XP de la variante de menor rank (bronce)");
  assert.ok(range.max > range.min, "hay un máximo mayor por rarezas altas");
  // El máximo es exactamente un xpForCardRank(rank) para algún rank entero (fórmula 10+8·rank).
  assert.equal(range.max, xpForCardRank((range.max - 10) / 8), "el máximo es un xpForCardRank real");
  assert.ok(Number.isInteger((range.max - 10) / 8), "corresponde a un rank entero");

  const sources = xpSources();
  assert.ok(sources.length >= 3);
  assert.ok(sources.some((s) => s.id === "pack") && sources.some((s) => s.id === "duel-win"));
  // El texto de duelo contiene los valores reales.
  const duelSrc = sources.find((s) => s.id === "duel-win")!;
  assert.ok(duelSrc.amount.includes(String(win.hard)), "muestra la XP real de ganar en HARD");
});

// 4 · El nivel se calcula bien; 5 · subir de nivel funciona (monotonía de la curva).
test("levelFromXp: nivel, progreso y umbrales coherentes y monótonos", () => {
  assert.equal(levelFromXp(0).level, 1);
  assert.equal(levelFromXp(0).xpIntoLevel, 0);
  // Justo al umbral del nivel 2, se es nivel 2.
  const l2 = totalXpForLevel(2);
  assert.equal(levelFromXp(l2).level, 2);
  assert.equal(levelFromXp(l2 - 1).level, 1, "un XP menos, aún nivel 1");
  // El progreso está en [0,1] y la XP restante nunca es negativa.
  for (const xp of [0, 50, l2, l2 + 5, totalXpForLevel(5) + 3]) {
    const i = levelFromXp(xp);
    assert.ok(i.progress >= 0 && i.progress <= 1);
    assert.ok(i.xpForNext >= i.xpIntoLevel);
    assert.ok(totalXpForLevel(i.level) <= xp && xp < totalXpForLevel(i.level + 1));
  }
  // La curva es creciente: cada nivel cuesta al menos tanto como el anterior.
  for (let l = 2; l < 20; l++) {
    assert.ok(totalXpForLevel(l + 1) - totalXpForLevel(l) >= totalXpForLevel(l) - totalXpForLevel(l - 1));
  }
});

// 3 · La pantalla no concede XP. FASE 62: SÍ deja reclamar, pero SOLO por los reclamos del servidor que ya existían.
/*
 * Hasta F61 esta pantalla no podía reclamar (el reclamo vivía solo en /logros). La auditoría F62 midió la consecuencia:
 * una cuenta activa en nivel 0 de temporada con 4 objetivos completos sin recoger. El contrato nuevo NO relaja la
 * autoridad: la página sigue sin conceder XP ni llamar a nada por su cuenta; el hub reclama con `useClaims`, que solo
 * transporta los TRES reclamos existentes (`claimMission`/`claimPassLevel`/`claimAchievement` → POST de progresión,
 * idempotentes por clave en el servidor) y nunca manda cantidades.
 */
test("F62 · /progresion no concede XP y reclama SOLO por los reclamos existentes del servidor", () => {
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const SRC = readFileSync(join(process.cwd(), "src", "components", "progression", "ProgressionScreen.tsx"), "utf8");
  assert.match(SRC, /useGameStore\(\(s\) => s\.xp\)/, "lee la XP del store");
  assert.ok(!/addXp\(/.test(SRC), "no concede XP");
  assert.ok(!/\bs\.xp\s*\+/.test(SRC), "no muta la XP");
  assert.ok(!/claim[A-Za-z]*\(|fetch\(/.test(code(SRC)), "la página no reclama ni llama a la red por su cuenta");
  assert.match(SRC, /<ProgressionHub snap=\{snap\}/, "el hub recibe la foto del servidor");
  const HUB = readFileSync(join(process.cwd(), "src", "components", "progression", "hub", "ProgressionHub.tsx"), "utf8");
  assert.ok(HUB.includes("useClaims(reload)"), "reclama con el transporte común y relee al terminar");
  const CLAIMS = code(readFileSync(join(process.cwd(), "src", "lib", "progression", "claims.ts"), "utf8"));
  assert.ok(CLAIMS.includes("claimMission(c.id)") && CLAIMS.includes('claimPassLevel(c.level!, c.track ?? "free")') && CLAIMS.includes("claimAchievement(c.id)"), "solo los tres reclamos existentes");
  assert.ok(!/credits|xp\s*:|amount/.test(CLAIMS), "nunca manda cantidades");
  assert.match(SRC, /href="\/logros"/, "Logros y pase sigue enlazado");
});

// 13 · Consistencia perfil/progresión: el mismo levelFromXp que usa la cabecera.
test("consistencia · /progresion usa el mismo cálculo de nivel que la cabecera (GameShell)", () => {
  const shell = readFileSync(join(process.cwd(), "src", "components", "layout", "GameShell.tsx"), "utf8");
  assert.match(shell, /levelFromXp\(/, "la cabecera usa levelFromXp");
  const prog = readFileSync(join(process.cwd(), "src", "components", "progression", "ProgressionScreen.tsx"), "utf8");
  assert.match(prog, /levelFromXp\(/, "y /progresion también: una sola fuente de nivel");
});
