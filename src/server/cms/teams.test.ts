/**
 * COLECCIONES POR EQUIPO · ALTA DE EQUIPOS NUEVOS DESDE EL PANEL (0076) y LOGOS DEL CMS.
 *
 * `app_team_identity_save` se emula con el MISMO contrato que el SQL de 0076 (actor admin, revisión optimista, clave
 * inmutable, clave única, auditoría en la misma operación). Las restricciones reales, la atomicidad y los permisos se
 * prueban contra Postgres en el stack de QA (`scripts/ops/i18n-qa-stack/team-collections-0076.sh`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemorySupabase, type Row } from "@/server/services/testing/memorySupabase";
import { resetServerCatalog } from "@/server/catalog";
import { toCardRow, toPlayerRow } from "@/server/catalog/rows";
import { CARDS, getPlayer } from "@/data/catalog";
import { teamsCmsHandlers } from "./handlers";
import { listTeamIdentities, saveTeamIdentity, validateTeamIdentity } from "./teams";
import { cmsTeamLogoAssets, getTeamCollections, settleTeamCollections } from "@/server/services/teamCollections";
import { buildTeamCollections } from "@/domain/teamCollections/model";
import type { AdminDeps } from "@/server/admin/http";
import type { SupabaseClient } from "@supabase/supabase-js";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ADMIN = "00000000-0000-4000-8000-0000000a0076";
const USER = "00000000-0000-4000-8000-0000000b0076";
const PRINTED = "Equipo Del Panel";

/** Catálogo servido desde la base, con dos cartas publicadas de un equipo impreso que el código no conoce. */
function world(opts: { migrated?: boolean } = {}) {
  resetServerCatalog();
  const db = new MemorySupabase();
  const rows: Row[] = CARDS.map((c, i) => ({ ...toCardRow(c, i), presentation: null }));
  const model = CARDS[0];
  for (const id of ["panel-a", "panel-b"]) rows.push({ ...toCardRow({ ...model, id }, rows.length + 1), card_id: id, lifecycle: "PUBLISHED", presentation: { role: "Duelista", printed: { ovr: 80, stats: {} }, team: PRINTED } });
  db.tables.content_catalog_version = [{ id: true, version: 7 }];
  db.tables.content_cards = rows;
  db.tables.content_players = [...new Set(CARDS.map((c) => c.playerId))].map((id) => toPlayerRow(getPlayer(id)!)) as unknown as Row[];
  db.tables.content_card_versions = [];
  db.tables.profiles = [{ id: ADMIN, is_admin: true }, { id: USER, is_admin: false }];
  db.tables.content_audit_log = [];
  db.tables.user_cards = [];
  if (opts.migrated === false) db.missing.add("content_team_identities");
  else {
    db.tables.content_team_identities = [];
    db.rpcHandlers.app_team_identity_save = (a) => {
      const t = db.tables.content_team_identities;
      if (!db.tables.profiles.some((p) => p.id === a.p_actor && p.is_admin)) return { data: { code: "NOT_ADMIN" }, error: null };
      const cur = t.find((r) => r.printed_team === a.p_printed);
      if (cur) {
        if (a.p_expected_rev !== cur.rev) return { data: { code: "CONFLICT", rev: cur.rev }, error: null };
        if (a.p_team_id !== cur.team_id) return { data: { code: "TEAM_ID_LOCKED" }, error: null };
        const before = { ...cur };
        Object.assign(cur, { name: a.p_name, tag: a.p_tag, region: a.p_region, rev: (cur.rev as number) + 1, updated_by: a.p_actor });
        db.tables.content_audit_log.push({ actor: a.p_actor, action: "team_identity_update", entity_type: "team_identity", entity_id: a.p_team_id, detail: { before, after: { ...cur } } });
        return { data: { code: "OK", rev: cur.rev, teamId: cur.team_id }, error: null };
      }
      if ((a.p_expected_rev ?? 0) !== 0) return { data: { code: "CONFLICT", rev: 0 }, error: null };
      if (t.some((r) => r.team_id === a.p_team_id)) return { data: { code: "TEAM_ID_TAKEN" }, error: null };
      const row = { printed_team: a.p_printed, team_id: a.p_team_id, name: a.p_name, tag: a.p_tag, region: a.p_region, rev: 1, created_by: a.p_actor, updated_by: a.p_actor };
      t.push(row);
      db.tables.content_audit_log.push({ actor: a.p_actor, action: "team_identity_create", entity_type: "team_identity", entity_id: a.p_team_id, detail: { before: null, after: row } });
      return { data: { code: "OK", rev: 1, teamId: a.p_team_id }, error: null };
    };
  }
  const deps: AdminDeps = {
    verify: async (req) => (req.headers.get("authorization") === "Bearer admin" ? { userId: ADMIN } : null),
    db: () => db as unknown as SupabaseClient,
    rate: async () => ({ allowed: true, retryAfter: 0 }),
  };
  return { db, sb: db as unknown as SupabaseClient, deps };
}
const VALID = { printedTeam: PRINTED, teamId: "equipo-del-panel", name: "Equipo Del Panel", tag: "EDP", region: "Pacific", expectedRev: 0 };
const post = (who: "admin" | "user" | "anon", body: unknown) => new Request("http://t/api/admin/cms/teams", {
  method: "POST", headers: { "content-type": "application/json", ...(who === "anon" ? {} : { authorization: `Bearer ${who}` }) }, body: JSON.stringify(body),
});

test("ALTA · validación del servidor: clave, nombre, etiqueta y región; nunca una clave del registro de código", () => {
  assert.equal(validateTeamIdentity(VALID).ok, true);
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ ...VALID, printedTeam: "" }, /impreso/], [{ ...VALID, printedTeam: "a\u0007b" }, /impreso/], [{ ...VALID, printedTeam: "?" }, /impreso/],
    [{ ...VALID, teamId: "Mayúsculas" }, /Clave/], [{ ...VALID, teamId: "raw-x" }, /Clave/], [{ ...VALID, teamId: "team-g2-v1" }, /Clave/], [{ ...VALID, teamId: "x" }, /Clave/],
    [{ ...VALID, teamId: "g2" }, /registro/], [{ ...VALID, teamId: "team-heretics" }, /registro/],
    [{ ...VALID, name: "X" }, /nombre/], [{ ...VALID, tag: "DEMASIADO" }, /etiqueta/], [{ ...VALID, tag: "E D" }, /etiqueta/],
    [{ ...VALID, region: "" }, /región/], [{ ...VALID, region: "Marte" }, /región/], [{ ...VALID, expectedRev: -1 }, /Revisión/], [{ ...VALID, expectedRev: "x" }, /Revisión/],
  ];
  for (const [b, re] of bad) { const v = validateTeamIdentity(b); assert.equal(v.ok, false, JSON.stringify(b)); assert.match((v as { error: string }).error, re); }
});

test("ALTA · el equipo pendiente se lista, se da de alta una vez, con auditoría, y aparece en Colecciones con su región", async () => {
  const { db, sb } = world();
  const before = (await listTeamIdentities(sb));
  assert.ok(before.ok);
  assert.deepEqual(before.ok && before.data.pending, [{ printedTeam: PRINTED, cards: 2 }]);
  assert.equal((await getTeamCollections(sb, USER)).data!.teams.some((t) => t.title === PRINTED), false, "sin identidad no es una colección");
  const r = await saveTeamIdentity(sb, ADMIN, VALID);
  assert.deepEqual(r, { ok: true, data: { teamId: "equipo-del-panel", rev: 1 } });
  assert.deepEqual(db.tables.content_audit_log.map((l) => l.action), ["team_identity_create"]);
  const after = await listTeamIdentities(sb);
  assert.ok(after.ok && after.data.pending.length === 0 && after.data.managed.length === 1 && after.data.managed[0].cards === 2);
  const v = (await getTeamCollections(sb, USER)).data!;
  resetServerCatalog();
  const t = v.teams.find((x) => x.id === "equipo-del-panel")!;
  assert.deepEqual([t.title, t.tag, t.region, t.total, t.logo], [PRINTED, "EDP", "Pacific", 2, null]);
});

test("ALTA · la clave no cambia nunca, dos admins no se pisan y una clave no se reutiliza", async () => {
  const { db, sb } = world();
  assert.ok((await saveTeamIdentity(sb, ADMIN, VALID)).ok);
  // Mismo formulario enviado dos veces (revisión vieja): conflicto, nada cambia.
  const twice = await saveTeamIdentity(sb, ADMIN, VALID);
  assert.deepEqual([twice.ok, !twice.ok && twice.status], [false, 409]);
  // Cambiar la clave: rechazado aunque la revisión sea la buena.
  const locked = await saveTeamIdentity(sb, ADMIN, { ...VALID, teamId: "otra-clave", expectedRev: 1 });
  assert.deepEqual([locked.ok, !locked.ok && locked.status, !locked.ok && locked.error], [false, 409, "La clave de un equipo no se puede cambiar una vez creada"]);
  // Corregir región y nombre con la revisión buena: sí, y sube la revisión.
  const fix = await saveTeamIdentity(sb, ADMIN, { ...VALID, name: "Equipo Corregido", region: "EMEA", expectedRev: 1 });
  assert.deepEqual(fix, { ok: true, data: { teamId: "equipo-del-panel", rev: 2 } });
  assert.deepEqual(db.tables.content_team_identities.map((r) => [r.team_id, r.name, r.region, r.rev]), [["equipo-del-panel", "Equipo Corregido", "EMEA", 2]]);
  assert.deepEqual(db.tables.content_audit_log.map((l) => l.action), ["team_identity_create", "team_identity_update"]);
});

test("ALTA · solo textos impresos reales y sin identidad de código; sin 0076, 503 claro y nada escrito", async () => {
  const { sb } = world();
  for (const printedTeam of ["No Existe", "NAVI", "G2"]) {
    const r = await saveTeamIdentity(sb, ADMIN, { ...VALID, printedTeam });
    assert.deepEqual([r.ok, !r.ok && r.status], [false, 404], printedTeam);
  }
  const off = world({ migrated: false });
  const r = await saveTeamIdentity(off.sb, ADMIN, VALID);
  assert.deepEqual([r.ok, !r.ok && r.status], [false, 503]);
  assert.ok(!off.db.rpcCalls.some((c) => c.name === "app_team_identity_save"), "no se intenta escribir");
  const l = await listTeamIdentities(off.sb);
  assert.ok(l.ok && l.data.available === false && l.data.pending.length === 1, "el panel dice que falta la migración y sigue listando lo pendiente");
});

test("RUTA · /api/admin/cms/teams: anónimo y usuario 401, campos fuera de lista 400, acción desconocida 400, admin 200", async () => {
  const { db, deps } = world();
  const h = teamsCmsHandlers(deps);
  for (const who of ["anon", "user"] as const) {
    assert.equal((await h.POST(post(who, { action: "save", ...VALID }))).status, 401);
    assert.equal((await h.GET(new Request("http://t/api/admin/cms/teams", { headers: who === "anon" ? {} : { authorization: "Bearer user" } }))).status, 401);
  }
  assert.equal(db.tables.content_team_identities.length, 0);
  assert.equal((await h.POST(post("admin", { action: "save", ...VALID, actor: USER }))).status, 400, "mass assignment");
  assert.equal((await h.POST(post("admin", { action: "delete", printedTeam: PRINTED }))).status, 400);
  const ok = await h.POST(post("admin", { action: "save", ...VALID }));
  assert.equal(ok.status, 200);
  assert.deepEqual(db.tables.content_team_identities.map((r) => r.created_by), [ADMIN], "el actor sale de la sesión, nunca del cuerpo");
  assert.equal((await h.GET(new Request("http://t/api/admin/cms/teams", { headers: { authorization: "Bearer admin" } }))).status, 200);
});

test("ALTA · un equipo nuevo en una región no quita una insignia ya desbloqueada; quien no la tiene necesita también el nuevo", async () => {
  const { db, sb } = world();
  db.tables.user_team_completions = []; db.tables.user_region_badges = []; db.tables.user_cosmetics = []; db.tables.game_seasons = [];
  // Settle emulado: lo justo para la insignia (el contrato completo está en teamCollectionsRewards.service.test).
  db.rpcHandlers.app_team_collections_settle = (a) => {
    const mine = new Set(db.tables.user_cards.filter((c) => c.user_id === a.p_user).map((c) => c.card_id as string));
    const regions = (a.p_regions as { region: string; cards: string[] }[]).map((g) => {
      if (db.tables.user_region_badges.some((r) => r.user_id === a.p_user && r.region === g.region)) return { region: g.region, code: "ALREADY" };
      if (!g.cards.every((id) => mine.has(id))) return { region: g.region, code: "INCOMPLETE" };
      db.tables.user_region_badges.push({ user_id: a.p_user, region: g.region, unlocked_at: "2026-10-14T00:00:00Z" });
      return { region: g.region, code: "UNLOCKED" };
    });
    return { data: { code: "OK", teams: [], regions, xpGained: 0 }, error: null };
  };
  const pacific = (await getTeamCollections(sb, USER)).data!.teams.filter((t) => t.region === "Pacific");
  const code = buildTeamCollections({ cards: CARDS, player: getPlayer });
  const ids = pacific.flatMap((t) => code.teams.find((x) => x.id === t.id)!.cards.map((c) => c.id));
  assert.ok(ids.length > 0);
  for (const [i, card_id] of ids.entries()) db.tables.user_cards.push({ uid: `p${i}`, user_id: USER, card_id, serial: null, minted_version: 1, obtained_at: "2026-10-01T00:00:00Z", origin: "pack", locked: false });
  const s1 = await settleTeamCollections(sb, USER);
  assert.ok(s1.ok);
  assert.deepEqual(s1.data!.regions, ["Pacific"]);
  // Se da de alta un equipo nuevo en Pacific: la insignia sigue desbloqueada y permanente; no se vuelve a pedir.
  assert.ok((await saveTeamIdentity(sb, ADMIN, VALID)).ok);
  const v = (await getTeamCollections(sb, USER)).data!;
  const p = v.regions.find((r) => r.region === "Pacific")!;
  assert.deepEqual([p.unlocked, p.permanent, p.completeNow, p.teams], [true, true, false, pacific.length + 1]);
  resetServerCatalog();
});

test("LOGOS · el logo vigente del CMS se pinta en Colecciones (256 px), gana el último subido y cuenta como «en uso»", async () => {
  const { db, sb } = world();
  const storage = { from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `http://mem/${bucket}/${path}` } }) }) };
  Object.defineProperty(db, "storage", { value: storage });
  db.tables.assets = [
    { id: "a-old", kind: "team_logo", subject_id: "g2", is_current: true, status: "approved", storage_path: "cms/team_logo/a-old/original.png", meta: { derived: {} }, created_at: "2026-10-01T00:00:00Z" },
    { id: "a-new", kind: "team_logo", subject_id: "g2", is_current: true, status: "approved", storage_path: "cms/team_logo/a-new/original.png", meta: { derived: { w256: "cms/team_logo/a-new/w256.webp" } }, created_at: "2026-10-02T00:00:00Z" },
    { id: "a-rej", kind: "team_logo", subject_id: "paper-rex", is_current: true, status: "rejected", storage_path: "cms/team_logo/a-rej/original.png", meta: {}, created_at: "2026-10-03T00:00:00Z" },
  ];
  const logos = await cmsTeamLogoAssets(sb);
  assert.deepEqual([...logos], [["g2", { id: "a-new", url: "http://mem/assets/cms/team_logo/a-new/w256.webp" }]]);
  const v = (await getTeamCollections(sb, USER)).data!;
  resetServerCatalog();
  assert.equal(v.teams.find((t) => t.id === "g2")!.logo, "http://mem/assets/cms/team_logo/a-new/w256.webp");
  assert.equal(v.teams.find((t) => t.id === "paper-rex")?.logo ?? null, null, "un logo rechazado no se pinta: etiqueta");
  // La limpieza de huérfanos del CMS no puede borrar el logo que se está pintando.
  const src = read("src/server/cms/assets.ts");
  assert.match(src, /eq\("kind", "team_logo"\)\.eq\("is_current", true\)\.eq\("status", "approved"\)/);
  assert.match(src, /add\(id, "team", team\)/);
  assert.match(src, /team_logo: \[\{ key: "w256", width: 256 \}\]/);
});

test("0076 · migración aditiva, solo servidor, auditada, con rollback que no pierde datos", () => {
  const sql = read("supabase/migrations/0076_team_identities_admin.sql");
  assert.match(sql, /create table if not exists public\.content_team_identities/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.content_team_identities from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i, "sin políticas: solo service_role");
  assert.match(sql, /security definer set search_path = public/);
  assert.match(sql, /revoke all on function public\.app_team_identity_save\([^)]*\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.app_team_identity_save\([^)]*\) to service_role/);
  assert.match(sql, /is_admin/);
  assert.match(sql, /TEAM_ID_LOCKED/);
  assert.match(sql, /app_admin_audit/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(drop|truncate|delete from)\b|alter table public\.(profiles|user_cards|user_packs|credit_transactions|content_cards)/i);
  const rb = read("docs/operations/rollback/0076_team_identities_admin.ROLLBACK.sql");
  assert.match(rb, /create table public\.ops_rollback_0076_content_team_identities as select/);
  assert.match(rb, /raise exception/);
});
