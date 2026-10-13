/**
 * FASE 37 · SERVICIO DE COLECCIÓN contra un Supabase EN MEMORIA (aplica escrituras, simula tablas ausentes y fallos).
 * Lectura personal aislada y sin escrituras; favoritos validados, idempotentes, con tope y solo del propio usuario.
 * RLS, PostgREST y `app_rate_take` reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "@/data/catalog";
import { MemorySupabase } from "./testing/memorySupabase";
import { getCollectionPersonal, setFavorite, FAVORITES_MAX } from "./collection";

const U = "aaaaaaaa-0000-4000-8000-000000000037";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000037";
const A = CARDS[0].id; const B = CARDS[1].id; const C = CARDS[2].id;

function world() {
  const db = new MemorySupabase();
  db.unique.user_card_favorites = [{ cols: ["user_id", "card_id"] }];
  db.tables = {
    user_cards: [
      { uid: "u1", user_id: U, card_id: A, serial: null, minted_version: 1, origin: "pack", obtained_at: "2026-09-15T00:00:00Z" },
      { uid: "u2", user_id: U, card_id: A, serial: 7, minted_version: 1, origin: "pack", obtained_at: "2026-09-15T00:00:00Z" },
      { uid: "u3", user_id: U, card_id: B, serial: null, minted_version: 2, origin: "starter", obtained_at: "2026-09-15T00:00:00Z" },
      { uid: "x1", user_id: OTHER, card_id: C, serial: 1, minted_version: 1, origin: "pack", obtained_at: "2026-09-15T00:00:00Z" },
    ],
    user_card_favorites: [
      { user_id: U, card_id: A, created_at: "2026-09-15T10:00:00Z" },
      { user_id: OTHER, card_id: C, created_at: "2026-09-15T10:00:00Z" },
    ],
    player_profile_customization: [{ user_id: U, showcase_card_uids: ["u2"], featured_achievement_ids: [], version: 4 }],
    duel_decks: [
      { id: "d1", user_id: U, name: "Equipo 2", card_uids: ["u1", "u3"], updated_at: "2026-09-15T10:00:00Z" },
      { id: "dX", user_id: OTHER, name: "Ajeno", card_uids: ["x1"], updated_at: "2026-09-15T10:00:00Z" },
    ],
    duel_active_deck: [{ user_id: U, deck_id: "d1" }],
    profiles: [{ id: U, email: "secret@example.com", is_admin: true, credits: 999 }],
  };
  return db;
}

const favRows = (db: MemorySupabase, user = U) => db.rows("user_card_favorites").filter((r) => r.user_id === user).map((r) => r.card_id).sort();

/* ───────────── lectura ───────────── */

test("LECTURA · solo instancias propias con uid, carta, serial y versión (sin dueño, origen ni fecha)", async () => {
  const r = await getCollectionPersonal(world().client, U, { now: 1 });
  assert.ok(r.ok && r.data);
  assert.deepEqual(r.data.instances.map((i) => i.uid).sort(), ["u1", "u2", "u3"]);
  assert.deepEqual(Object.keys(r.data.instances[0]).sort(), ["cardId", "mintedVersion", "serial", "uid"]);
  const json = JSON.stringify(r.data);
  for (const k of ["x1", OTHER, "secret@example.com", "is_admin", "origin", "obtained_at", "credits"]) assert.ok(!json.includes(k), k);
});

test("LECTURA · favoritos, vitrina (uids + versión) y equipos con el activo marcado", async () => {
  const r = await getCollectionPersonal(world().client, U);
  assert.deepEqual(r.data!.favorites, [A]);
  assert.deepEqual(r.data!.showcase, { uids: ["u2"], version: 4 });
  assert.deepEqual(r.data!.decks, [{ id: "d1", name: "Equipo 2", active: true, cardUids: ["u1", "u3"] }]);
  // COLECCIONES ILIMITADAS · ya no hay techo ni marca de truncado: recuentos exactos por carta y total.
  assert.equal(r.data!.total, 3);
  assert.equal(Object.values(r.data!.holdings).reduce((n, h) => n + h.count, 0), 3);
});

test("LECTURA · no escribe nada (ni favoritos, ni vitrina, ni equipo activo, ni nada)", async () => {
  const db = world();
  await getCollectionPersonal(db.client, U);
  assert.deepEqual(db.writes(), []);
});

test("LECTURA · otro usuario no ve lo tuyo y tú no ves lo suyo", async () => {
  const r = await getCollectionPersonal(world().client, OTHER);
  assert.deepEqual(r.data!.instances.map((i) => i.uid), ["x1"]);
  assert.deepEqual(r.data!.favorites, [C]);
  assert.deepEqual(r.data!.showcase, { uids: [], version: null });
});

test("AISLAMIENTO · sin 0052 (tabla ausente) los favoritos son null y el resto llega", async () => {
  const db = world(); db.missing.add("user_card_favorites");
  const r = await getCollectionPersonal(db.client, U);
  assert.ok(r.ok);
  assert.equal(r.data!.favorites, null);
  assert.equal(r.data!.instances.length, 3);
});

test("AISLAMIENTO · equipos o vitrina caídos → null, sin tumbar la colección", async () => {
  const db = world(); db.failing.add("duel_decks"); db.failing.add("player_profile_customization");
  const r = await getCollectionPersonal(db.client, U);
  assert.ok(r.ok);
  assert.equal(r.data!.decks, null);
  assert.equal(r.data!.showcase, null);
});

test("AISLAMIENTO · si fallan las instancias (lo esencial) → error genérico, sin detalles internos", async () => {
  const db = world(); db.failing.add("user_cards");
  const r = await getCollectionPersonal(db.client, U);
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.equal(r.error, "No se pudo leer tu colección");
});

/* ───────────── favoritos ───────────── */

test("FAVORITO · id mal formado o con rutas → 400, sin tocar la base de datos", async () => {
  const db = world();
  for (const bad of ["../../etc", "Benjy__silver", "", 42, null, { id: A }, `${A}; drop table`]) {
    const r = await setFavorite(db.client, U, bad, true);
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.code, "INVALID_CARD");
  }
  assert.deepEqual(db.writes(), []);
});

test("FAVORITO · carta con formato válido que no existe en el catálogo → 404", async () => {
  const r = await setFavorite(world().client, U, "nadie__gold", true);
  assert.equal(r.status, 404);
  assert.equal(r.code, "UNKNOWN_CARD");
});

test("FAVORITO · el valor tiene que ser booleano", async () => {
  const r = await setFavorite(world().client, U, B, "true");
  assert.equal(r.status, 400);
  assert.equal(r.code, "BAD_BODY");
});

test("FAVORITO · marcar es idempotente: dos veces = una fila", async () => {
  const db = world();
  assert.ok((await setFavorite(db.client, U, B, true)).ok);
  assert.ok((await setFavorite(db.client, U, B, true)).ok);
  assert.deepEqual(favRows(db), [A, B].sort());
});

test("FAVORITO · desmarcar borra solo la tuya (la de otro usuario sigue)", async () => {
  const db = world();
  assert.ok((await setFavorite(db.client, U, A, false)).ok);
  assert.deepEqual(favRows(db), []);
  assert.deepEqual(favRows(db, OTHER), [C]);
});

test("FAVORITO · no puedes tocar los favoritos de otro: el usuario sale del token (quitar C no afecta al ajeno)", async () => {
  const db = world();
  await setFavorite(db.client, U, C, false);
  assert.deepEqual(favRows(db, OTHER), [C]);
});

test("FAVORITO · favorito de una carta que no posees está permitido (es «me gusta esta carta»)", async () => {
  const db = world();
  assert.ok((await setFavorite(db.client, U, C, true)).ok);
  assert.ok(favRows(db).includes(C));
});

test("FAVORITO · tope de 200 por usuario → 409", async () => {
  const db = world();
  db.tables.user_card_favorites = CARDS.slice(10, 10 + FAVORITES_MAX).map((c) => ({ user_id: U, card_id: c.id, created_at: "2026-09-15T00:00:00Z" }));
  const r = await setFavorite(db.client, U, A, true);
  assert.equal(r.status, 409);
  assert.equal(r.code, "FAVORITES_LIMIT");
});

test("FAVORITO · sin 0052 → 503 honesto (no se guarda en ningún otro sitio)", async () => {
  const db = world(); db.missing.add("user_card_favorites");
  const r = await setFavorite(db.client, U, B, true);
  assert.equal(r.status, 503);
  assert.equal(r.code, "FAVORITES_UNAVAILABLE");
});

/* ───────────── Fase 37.1 · huecos cubiertos tras activar 0052 ───────────── */

test("FAVORITO 37.1 · persistencia: marcar → la lectura lo devuelve; desmarcar → desaparece", async () => {
  const db = world();
  assert.ok((await setFavorite(db.client, U, B, true)).ok);
  assert.ok((await getCollectionPersonal(db.client, U)).data!.favorites!.includes(B));
  assert.ok((await setFavorite(db.client, U, B, false)).ok);
  assert.ok(!(await getCollectionPersonal(db.client, U)).data!.favorites!.includes(B));
});

test("FAVORITO 37.1 · quitar dos veces es idempotente: ambas 200 y estado final sin fila", async () => {
  const db = world();
  const first = await setFavorite(db.client, U, A, false);
  const second = await setFavorite(db.client, U, A, false);
  assert.ok(first.ok && second.ok);
  assert.equal(second.data!.favorite, false);
  assert.deepEqual(favRows(db), []);
});

test("FAVORITO 37.1 · la segunda puerta de BD (disparador, carrera a 201) se traduce a 409 FAVORITES_LIMIT, no a 500", async () => {
  const db = world();
  // El disparador de 0052 lanza `FAVORITES_LIMIT` (P0001) aunque la API contara < 200 (dos altas a la vez).
  const client = new Proxy(db, {
    get(target, prop) {
      if (prop === "from") return (name: string) => {
        const q = target.from(name);
        if (name !== "user_card_favorites") return q;
        return new Proxy(q, { get: (t, p) => (p === "insert" ? () => ({ then: (ok: (v: unknown) => unknown) => ok({ data: null, error: { code: "P0001", message: "FAVORITES_LIMIT" } }) }) : (t as never)[p]) });
      };
      const v = (target as never)[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const r = await setFavorite(client as unknown as MemorySupabase["client"], U, B, true);
  assert.equal(r.status, 409);
  assert.equal(r.code, "FAVORITES_LIMIT");
});

test("FAVORITO 37.1 · favorita de una carta NO poseída: no crea copia, serial ni propiedad", async () => {
  const db = world();
  const before = db.rows("user_cards").map((r) => ({ ...r }));
  assert.ok((await setFavorite(db.client, U, C, true)).ok);
  const view = (await getCollectionPersonal(db.client, U)).data!;
  assert.ok(view.favorites!.includes(C));
  assert.ok(!view.instances.some((i) => i.cardId === C), "sigue sin copias de esa carta");
  assert.deepEqual(db.rows("user_cards"), before, "user_cards intacta (ni filas nuevas ni seriales)");
});

test("FAVORITO · la única escritura es sobre user_card_favorites: ni créditos, ni sobres, ni cartas, ni XP", async () => {
  const db = world();
  await setFavorite(db.client, U, B, true);
  await setFavorite(db.client, U, B, false);
  // `app_content_distribution_snapshot` es la lectura del catálogo del servidor (validar que la carta existe), no una escritura.
  const writes = db.writes().filter((w) => w !== "rpc:app_content_distribution_snapshot");
  assert.ok(writes.length > 0);
  assert.ok(writes.every((w) => w.includes("user_card_favorites")), writes.join(","));
  assert.equal(db.rows("user_cards").length, 4);
});
