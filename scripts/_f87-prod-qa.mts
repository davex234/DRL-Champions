/**
 * F87 · QA EN PRODUCCIÓN DE PICK'EMS 2.0 (instrumento, fuera de CI). Sin publicar nada y sin tocar cuentas reales.
 *
 *   F87_ANON_FILE=<fichero con la clave anon pública> F87_CREDS=<json de cuentas QA> npx tsx scripts/_f87-prod-qa.mts
 *
 * Crea (o reutiliza) DOS cuentas QA `qa-f87-*@example.invalid` (excluidas del embudo alpha). Guardia: si un id
 * coincide con una cuenta real (davex 3befce61 · ValoRosters b7ccff02), se aborta. Comprueba:
 *   · lectura pública (lista, cache pública) y privada (no-store); un BORRADOR no se ve ni se puede predecir/reclamar;
 *   · lista blanca del cuerpo, revisión obligatoria, slugs/partidos inválidos;
 *   · admin API con cuenta normal → 401; REST directo a tablas/RPC de 0071 → denegado;
 *   · páginas (hub, ficha, admin, arnés oculto en producción).
 * Escribe docs/product/qa/pickems-2/prod-qa.json.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const ANON = readFileSync(process.env.F87_ANON_FILE!, "utf8").trim();
const CREDS = process.env.F87_CREDS!;
const REAL = ["3befce61", "b7ccff02"];
const DRAFT_SLUG = process.env.F87_DRAFT_SLUG ?? "champions-2026-playoffs";
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { rows.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` · ${detail}` : ""}`); };

interface Who { name: string; email: string; password: string; userId: string; token: string }
async function signupOrLogin(name: string, saved?: { email: string; password: string }): Promise<Who> {
  const email = saved?.email ?? `qa-f87-${name}-${randomBytes(4).toString("hex")}@example.invalid`;
  const password = saved?.password ?? randomBytes(18).toString("base64url");
  if (!saved) {
    const r = await fetch(`${BASE}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password, data: { username: `qa_f87_${name}` } }) });
    if (!r.ok) throw new Error(`signup ${name}: ${r.status}`);
  }
  const t = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const j = await t.json() as { access_token?: string; user?: { id: string } };
  if (!j.access_token || !j.user) throw new Error(`login ${name}: ${t.status}`);
  if (REAL.some((p) => j.user!.id.startsWith(p))) throw new Error("ES UNA CUENTA REAL: abortado");
  return { name, email, password, userId: j.user.id, token: j.access_token };
}

const api = (who: Who | null, path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who.token}` } : {}), ...(init.headers ?? {}) } });
const rest = (who: Who | null, path: string, init: RequestInit = {}) =>
  fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, authorization: `Bearer ${who?.token ?? ANON}`, "content-type": "application/json", ...(init.headers ?? {}) } });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function main() {
  const saved = existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, "utf8")) as Record<string, { email: string; password: string; userId: string }> : {};
  const A = await signupOrLogin("a", saved.a), B = await signupOrLogin("b", saved.b);
  writeFileSync(CREDS, JSON.stringify({ a: { email: A.email, password: A.password, userId: A.userId }, b: { email: B.email, password: B.password, userId: B.userId } }));
  check("cuentas QA (@example.invalid, no reales)", true, `${A.userId.slice(0, 8)} · ${B.userId.slice(0, 8)}`);

  // ── Lectura pública ──
  const pub = await api(null, "/api/game/pickem-brackets");
  const pubJ = await pub.json() as { brackets: { slug: string; status: string }[] };
  check("anónimo · lista 200", pub.status === 200, String(pub.status));
  check("anónimo · cache pública breve", /public/.test(pub.headers.get("cache-control") ?? ""), pub.headers.get("cache-control") ?? "");
  check("anónimo · ningún BORRADOR en la lista", !pubJ.brackets.some((b) => b.slug === DRAFT_SLUG || b.status === "DRAFT"), JSON.stringify(pubJ.brackets.map((b) => `${b.slug}:${b.status}`)));
  const draft = await api(null, `/api/game/pickem-brackets?slug=${DRAFT_SLUG}`);
  check("anónimo · ficha de un BORRADOR → 404", draft.status === 404, String(draft.status));
  check("anónimo · slug inválido → 400", (await api(null, "/api/game/pickem-brackets?slug=../../etc")).status === 400);
  check("anónimo · POST → 401", (await api(null, "/api/game/pickem-brackets", { method: "POST", body: JSON.stringify({ action: "pick", slug: DRAFT_SLUG, matchId: "754732", teamId: "vlr-t-14", revision: 0 }) })).status === 401);

  // ── Lectura privada ──
  const mine = await api(A, "/api/game/pickem-brackets");
  check("sesión · lista 200 privada (no-store)", mine.status === 200 && /no-store/.test(mine.headers.get("cache-control") ?? ""), `${mine.status} ${mine.headers.get("cache-control")}`);
  const body = await mine.text();
  check("sesión · sin UUID ni correos en la respuesta", !UUID.test(body) && !/@/.test(body));
  check("sesión · ficha de un BORRADOR → 404", (await api(A, `/api/game/pickem-brackets?slug=${DRAFT_SLUG}`)).status === 404);

  // ── Escrituras que DEBEN fallar ──
  const post = (who: Who, b: unknown) => api(who, "/api/game/pickem-brackets", { method: "POST", body: JSON.stringify(b) });
  const r1 = await post(A, { action: "pick", slug: DRAFT_SLUG, matchId: "754732", teamId: "vlr-t-14", revision: 0, userId: B.userId });
  check("campo extra (userId de otro) → 400", r1.status === 400, String(r1.status));
  const r2 = await post(A, { action: "pick", slug: DRAFT_SLUG, matchId: "754732", teamId: "vlr-t-14", revision: 0, points: 999 });
  check("campo extra (puntos) → 400", r2.status === 400, String(r2.status));
  const r3 = await post(A, { action: "pick", slug: DRAFT_SLUG, matchId: "754732", teamId: "vlr-t-14" });
  check("sin revisión → 400", r3.status === 400, String(r3.status));
  const r4 = await post(A, { action: "pick", slug: DRAFT_SLUG, matchId: "754732", teamId: "vlr-t-14", revision: 0 });
  check("predecir en un BORRADOR → 404 (no existe para jugadores)", r4.status === 404, String(r4.status));
  const r5 = await post(A, { action: "claim", slug: DRAFT_SLUG });
  check("reclamar en un BORRADOR → 404", r5.status === 404, String(r5.status));
  const r6 = await post(A, { action: "claim", slug: DRAFT_SLUG, teamId: "x" });
  check("reclamo con campos de pick → 400", r6.status === 400, String(r6.status));
  const r7 = await post(A, { action: "pick", slug: "no-existe-f87", matchId: "754732'; drop table x;--", teamId: "vlr-t-14", revision: 0 });
  check("partido con inyección → 400", r7.status === 400, String(r7.status));
  const r8 = await post(A, { action: "hack", slug: DRAFT_SLUG });
  check("acción desconocida → 400", r8.status === 400, String(r8.status));

  // ── Admin con cuenta normal ──
  check("admin GET con cuenta normal → 401", (await api(A, "/api/admin/pickems")).status === 401);
  check("admin POST (activar recompensas) con cuenta normal → 401", (await api(A, "/api/admin/pickems", { method: "POST", body: JSON.stringify({ action: "rewards", id: "00000000-0000-4000-8000-000000000000", rewardsVersion: 1, rewards: {}, rewardsStatus: "ACTIVE", ack: true }) })).status === 401);
  check("admin POST (liquidar) anónimo → 401", (await api(null, "/api/admin/pickems", { method: "POST", body: JSON.stringify({ action: "settle", id: "00000000-0000-4000-8000-000000000000", settlementVersion: 0 }) })).status === 401);

  // ── REST directo (0071 sin privilegios de cliente) ──
  for (const t of ["pickem_brackets", "pickem_bracket_picks", "pickem_bracket_entries", "pickem_bracket_claims", "pickem_bracket_matches"]) {
    const r = await rest(A, `${t}?select=*&limit=1`);
    check(`REST ${t} con sesión → denegado`, r.status === 401 || r.status === 403 || r.status === 404, String(r.status));
  }
  const ins = await rest(A, "pickem_bracket_picks", { method: "POST", body: JSON.stringify({ bracket_id: "00000000-0000-4000-8000-000000000000", user_id: B.userId, match_id: "754732", team_id: "vlr-t-14" }) });
  check("REST insert de pick para OTRO usuario → denegado", ins.status === 401 || ins.status === 403, String(ins.status));
  for (const fn of ["app_pickem_save_pick", "app_pickem_claim", "app_pickem_admin_settle", "app_pickem_admin_set_rewards", "pickem_match_locked"]) {
    const r = await rest(A, `rpc/${fn}`, { method: "POST", body: JSON.stringify({}) });
    check(`RPC ${fn} con sesión → denegada`, r.status === 401 || r.status === 403 || r.status === 404, String(r.status));
  }

  // ── Páginas ──
  for (const p of ["/pickems", `/pickems/cuadro/${DRAFT_SLUG}`, "/admin/pickems"]) check(`página ${p} → 200`, (await fetch(BASE + p)).status === 200);
  check("arnés /design-system/f87 oculto en producción (404)", (await fetch(`${BASE}/design-system/f87`)).status === 404);

  const failed = rows.filter((r) => !r.ok);
  writeFileSync("docs/product/qa/pickems-2/prod-qa.json", JSON.stringify({ base: BASE, at: new Date().toISOString(), total: rows.length, passed: rows.length - failed.length, rows }, null, 1));
  console.log(`\nF87 PROD QA: ${rows.length - failed.length}/${rows.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
