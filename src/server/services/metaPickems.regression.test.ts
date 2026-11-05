/**
 * SANEAMIENTO POST F47 · REGRESIÓN DEL 500 DE `GET /api/game/meta`.
 *
 * Causa real: `pickem_answers` (0012) NO tiene columna `user_id` — la propiedad va por
 * `submission_id → pickem_submissions.user_id`. `loadFacts` y `windowCounts` filtraban por `user_id`:
 *
 *   · `loadFacts` se tragaba el error (`?? 0`) → la métrica `picks_made` valía SIEMPRE 0;
 *   · `windowCounts` lo convertía en excepción → `getMetaSnapshot` reventaba → 500, y solo para los
 *     jugadores cuya tanda diaria incluye la misión `picks_made` (`d-pickem-1`).
 *
 * Además, al ir con `head: true` la consulta viaja como HEAD: PostgREST responde SIN cuerpo y el
 * `message` llegaba VACÍO, así que el 500 no decía nada. Aquí se fija todo eso.
 *
 * `MemSupabase.declareColumns` reproduce el `42703` real: sin él, filtrar por una columna inexistente
 * devolvía «0 filas» en silencio y ningún test podía ver el fallo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemSupabase } from "./testing/memSupabase";
import { getMetaSnapshot } from "./meta";
import { peekProgression, getProgression } from "./progression";
import { batchFor } from "@/domain/progression/rotation";
import { periodWindow } from "@/domain/progression/periods";
import { CURRENT_SEASON } from "@/data/season";

const NOW = Date.UTC(2026, 9, 7, 15, 30);
const DAY = 86_400_000;

/** Columnas REALES de `pickem_answers` según 0012 — nótese que `user_id` NO está. */
const PICKEM_ANSWERS_COLS = ["id", "submission_id", "question_id", "option_key", "is_correct", "points_award", "created_at", "updated_at"] as const;
const PICKEM_SUBMISSIONS_COLS = ["id", "user_id", "pickem_event_id", "created_at", "updated_at"] as const;

const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const e = console.error; const w = console.warn;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; }
};
async function withClock<T>(at: number, fn: () => Promise<T>): Promise<T> {
  const real = Date.now; Date.now = () => at; try { return await fn(); } finally { Date.now = real; }
}

/**
 * CORE GAME LOOP (2026-10-07) · `picks_made` ya no se SORTEA (Pick'em legacy retirado en 0072: `missionAvailability`),
 * así que ninguna tanda nueva la incluye. `loadFacts` la sigue contando en CADA lectura (una diaria ya asignada caduca
 * con su tanda), y eso es lo que fija esta regresión: cualquier usuario sirve.
 */
function userWithPicksDaily(_now: number): string {
  return "cafecafe-0000-4000-8000-000000000001";
}

test("CORE GAME LOOP · ninguna tanda diaria sortea `picks_made` (Pick'em legacy retirado: sería imposible)", () => {
  const start = periodWindow("daily", NOW)!.startsAt;
  for (let i = 0; i < 2000; i++) {
    const u = `cafecafe-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const batch = batchFor(CURRENT_SEASON.missionPool, u, CURRENT_SEASON.id, "daily", start);
    assert.equal(batch.length, 3, u);
    assert.ok(!batch.some((d) => d.metric === "picks_made"), u);
  }
});

/** Base con el esquema REAL de pick'ems y `answers` respuestas del usuario. */
function db(u: string, answers: number): MemSupabase {
  const d = new MemSupabase();
  d.seedUser(u);
  d.table("profiles")[0].created_at = new Date(NOW - 10 * DAY).toISOString();
  d.declareColumns("pickem_answers", PICKEM_ANSWERS_COLS);
  d.declareColumns("pickem_submissions", PICKEM_SUBMISSIONS_COLS);
  d.table("pickem_submissions").push({ id: "sub-1", user_id: u, pickem_event_id: "ev-1", created_at: new Date(NOW - DAY).toISOString() });
  for (let i = 0; i < answers; i++) {
    d.table("pickem_answers").push({
      id: `ans-${i}`, submission_id: "sub-1", question_id: `q-${i}`, option_key: "A",
      is_correct: null, points_award: 0, created_at: new Date(NOW - 3600_000).toISOString(),
    });
  }
  return d;
}

test("meta/pickems · `getMetaSnapshot` no revienta con una tanda diaria de picks_made (regresión del 500)", async () => {
  const u = userWithPicksDaily(NOW);
  const d = db(u, 3);
  // Materializa la tanda de HOY y luego lee tras el reset: es cuando `windowCounts` pide `picks_made`.
  await withClock(NOW, () => getProgression(d.client, u));
  const after = periodWindow("daily", NOW)!.endsAt + 5_000;
  const r = await withClock(after, () => quiet(() => getMetaSnapshot(d.client, u)));
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.ok(r.data, "sin foto de meta");
});

test("meta/pickems · `picks_made` cuenta las respuestas por `submission_id` (antes era siempre 0)", async () => {
  const u = userWithPicksDaily(NOW);
  for (const n of [0, 1, 4]) {
    const d = db(u, n);
    const r = await withClock(NOW, () => quiet(() => peekProgression(d.client, u, NOW)));
    assert.equal(r.ok, true);
    assert.equal(r.data!.metrics.picks_made, n, `picks_made con ${n} respuestas`);
  }
});

test("meta/pickems · ninguna consulta filtra `pickem_answers` por `user_id` (columna inexistente)", async () => {
  const u = userWithPicksDaily(NOW);
  const d = db(u, 2);
  await withClock(NOW, () => getProgression(d.client, u));
  const after = periodWindow("daily", NOW)!.endsAt + 5_000;
  // Con `declareColumns` activo, cualquier filtro por `user_id` sobre `pickem_answers` daría 42703.
  await assert.doesNotReject(() => withClock(after, () => quiet(() => peekProgression(d.client, u, after))));
});

test("meta/pickems · un error de recuento con `message` vacío (HEAD sin cuerpo) conserva tabla y código SQL", async () => {
  const u = userWithPicksDaily(NOW);
  const d = db(u, 1);
  await withClock(NOW, () => getProgression(d.client, u));
  // `economy_ops` sin la columna `kind`: el recuento de sobres de la ventana falla como en producción.
  d.declareColumns("economy_ops", ["id", "ref", "user_id", "created_at", "result"]);
  const after = periodWindow("daily", NOW)!.endsAt + 5_000;
  await assert.rejects(
    () => withClock(after, () => quiet(() => peekProgression(d.client, u, after))),
    (e: Error) => {
      assert.notEqual(e.message, "", "el error no puede quedarse mudo");
      assert.match(e.message, /economy_ops/);
      assert.match(e.message, /42703/);
      return true;
    },
  );
});
