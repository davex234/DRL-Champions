/**
 * CORE GAME LOOP (2026-10-07) · objetivos que eran imposibles o engañosos.
 *
 *   · «Declara tu región» (`region_set`, 0/1) con baseline 1 era imposible para una cuenta anterior a la temporada;
 *   · el número del Centro de eventos local anunciaba, con cuenta, recompensas que no se pueden reclamar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assignMission, isMissionComplete, missionProgress, STATE_METRICS } from "@/battlepass/missions";
import { CURRENT_SEASON } from "@/data/season";

const region = CURRENT_SEASON.missionPool.find((d) => d.id === "s-region")!;
const duelos = CURRENT_SEASON.missionPool.find((d) => d.metric === "duels_played" && d.kind === "seasonal")!;

test("CL-R1 · «Declara tu región»: con la región ya puesta al asignar, está COMPLETA (antes: imposible para siempre)", () => {
  const m = assignMission(region, { region_set: 1 }, 0);
  assert.equal(m.baseline, 1, "la baseline se sigue guardando (el reclamo la usa en su clave)");
  assert.equal(missionProgress(m, { region_set: 1 }), 1);
  assert.ok(isMissionComplete(m, { region_set: 1 }));
});

test("CL-R2 · «Declara tu región»: sin región no regala nada; al declararla, completa", () => {
  const m = assignMission(region, { region_set: 0 }, 0);
  assert.equal(missionProgress(m, { region_set: 0 }), 0);
  assert.equal(missionProgress(m, { region_set: 1 }), 1);
});

test("CL-R3 · solo las métricas de ESTADO ignoran la baseline: los contadores siguen midiendo «desde la asignación»", () => {
  assert.deepEqual([...STATE_METRICS], ["region_set"]);
  const m = assignMission(duelos, { duels_played: 40 }, 0);
  assert.equal(missionProgress(m, { duels_played: 40 }), 0, "40 partidas de antes no regalan «Juega 25 duelos»");
  assert.equal(missionProgress(m, { duels_played: 45 }), 5);
});

test("CL-E1 · con cuenta, la insignia del Centro de eventos local es 0 (allí no se puede reclamar con sesión)", () => {
  const src = readFileSync(join(process.cwd(), "src/components/layout/GameShell.tsx"), "utf8");
  assert.match(src, /events: user \? 0 : events/);
});
