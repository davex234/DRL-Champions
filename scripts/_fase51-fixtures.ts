/** FASE 51 · genera `scripts/_fase51-fixtures.json` (respuestas reales capturadas 2026-09-22, cuenta demo, datos __QA_TRAINER51__). */
import { readFileSync, writeFileSync } from "node:fs";
import * as T from "../src/domain/tactics";
const t = T as any;
const rich = JSON.parse(readFileSync(process.argv[2], "utf8"));
const RICH = "71976a69-6b46-4099-a1a1-1c375f3d10d5";
const row = (id: string, plan: any, updatedAt: string) => ({ id, name: plan.name, mapId: plan.mapId, side: plan.side, updatedAt, steps: plan.steps.length, plan });
const v3 = t.emptyStrat("qa51b", "ascent", "attack", "__QA_TRAINER51__ SERVIDOR v3");
const copia = t.emptyStrat("qa51c", "ascent", "defense", "__QA_TRAINER51__ copia editada");
const strats = [
  row(RICH, { ...rich, name: "__QA_TRAINER51__ Ejecución A" }, "2026-09-22T11:24:44.553694+00:00"),
  row("63a8cd40-ee85-4c71-adb7-458d86a01dcd", v3, "2026-09-22T11:18:30.866432+00:00"),
  row("63018913-9045-4d64-84c8-1259a4d7d3bb", copia, "2026-09-22T11:18:06.040984+00:00"),
];
const comps = [
  { id: "e0df621d-62b5-4f02-9948-a5f10e1c4f67", mapId: "ascent", name: "__QA_TRAINER51__ Ascent A-exec", agentIds: ["jett", "omen", "sova", "killjoy", "kayo"], notes: "Humos de Omen + info de Sova", primary: false, updatedAt: "2026-09-22T11:24:44.563+00:00" },
  { id: "1778620a-2bcd-4148-b65c-2949bdcfbcd7", mapId: "ascent", name: "__QA_TRAINER51__ comp", agentIds: ["jett", "omen", "sova", "killjoy", "kayo"], notes: "", primary: false, updatedAt: "2026-09-22T11:17:10.5+00:00" },
];
const vacio = { matches: [], record: { jugados: 0, ganados: 0, perdidos: 0, diferencialRondas: 0, racha: 0 }, total: 0 };
const out = {
  userId: "2f86cbe8-f663-40fb-a87c-4896b9a45b62",
  richStratId: RICH,
  responses: {
    "GET /api/game/strats": { status: 200, body: { strats } },
    "GET /api/game/compositions": { status: 200, body: { compositions: comps } },
    "GET /api/game/coach-matches": { status: 200, body: vacio },
    "GET /api/game/coach-matches?id=00000000-0000-4000-8000-000000000000": { status: 404, body: { error: "Partida no encontrada" } },
    "POST /api/telemetry": { status: 200, body: { ok: true } },
    "POST /api/game/strats": { status: 409, body: { error: "Esta jugada ha cambiado en otra sesión.", code: "VERSION_CONFLICT", currentVersion: "2026-09-22T11:30:00.000000+00:00", currentName: "__QA_TRAINER51__ Ejecución A (otra sesión)" } },
  },
};
writeFileSync("scripts/_fase51-fixtures.json", JSON.stringify(out));
console.log("ok", strats.length, comps.length);
