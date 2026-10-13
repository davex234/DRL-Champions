/**
 * F86.2 · CLOSED ALPHA READINESS — registro, puerta de la cuenta, #TAG social, feedback privado, embudo derivado,
 * resultado mínimo de la partida rápida en TODOS los caminos y migración 0070.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { signupNameError, signupPasswordError, signupName, SIGNUP_NAME_MAX } from "@/domain/account/signup";
import { parseFeedback, feedbackRow, FEEDBACK_KEYS, FUNNEL_STEPS, isEmptyFeedback } from "./alpha";
import { submitFeedback } from "@/server/services/alphaFeedback";
import { alphaHandlers, parseSince } from "@/server/admin/alpha";
import type { AdminDeps } from "@/server/admin/http";
import { MemorySupabase } from "@/server/services/testing/memorySupabase";
import { searchPlayers } from "@/server/services/social";
import { PackPurchaseCta } from "@/components/economy/PackPurchaseCta";
import { starterOffer } from "@/lib/economy/starterOffer";
import { ChampionMoment } from "@/components/cups/CupParts";
import { SocialHub } from "@/components/social/SocialHub";
import { FULL as SOCIAL_FULL } from "@/app/design-system/fase29/fixtures";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { NAV_SECTIONS } from "@/design/nav";
import { ADMIN_SECTIONS } from "@/domain/admin/nav";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const MIG = read("supabase", "migrations", "0070_alpha_feedback.sql");
const RB = read("docs", "operations", "rollback", "0070_alpha_feedback.ROLLBACK.sql");
const UUID1 = "6f1c2e4a-1b2c-4d3e-8f40-0a1b2c3d4e5f";

/* ───────────── registro ───────────── */

test("F862-A1 · registro: el nombre es OBLIGATORIO (si no, el alta usaría el correo como nombre público), nunca un correo; contraseña ≥ 8", () => {
  assert.match(signupNameError("") ?? "", /Elige un nombre/);
  assert.match(signupNameError("   ") ?? "", /Elige un nombre/);
  assert.match(signupNameError("david@gmail.com") ?? "", /no puede ser un correo/);
  assert.match(signupNameError("ab") ?? "", /al menos 3/);
  assert.match(signupNameError("x".repeat(SIGNUP_NAME_MAX + 1)) ?? "", /como mucho 16/);
  assert.match(signupNameError("dos palabras") ?? "", /sin espacios/);
  assert.equal(signupNameError("Kaelis_99"), null);
  assert.equal(signupNameError("Íñigo.R"), null, "letras con tilde valen");
  assert.equal(signupName("  Kaelis  "), "Kaelis");
  assert.match(signupPasswordError("1234567") ?? "", /al menos 8/);
  assert.equal(signupPasswordError("12345678"), null);
  // El formulario lo aplica ANTES de llamar a GoTrue y abre «Registro» con ?registro=1.
  const form = read("src", "components", "auth", "AuthForms.tsx");
  assert.ok(/signupNameError\(username\) \?\? signupPasswordError\(password\)/.test(form));
  assert.ok(form.includes('get("registro") === "1"'));
  assert.ok(form.includes("signUp(email, password, signupName(username))"));
});

test("F862-A2 · portada sin sesión: «Crear cuenta» y «Ya tengo cuenta · Entrar» A LA VISTA (antes solo al fondo de «Más»)", () => {
  const menu = read("src", "components", "home", "MainMenu.tsx");
  assert.ok(menu.includes('href="/cuenta?registro=1" data-testid="home-signup"'));
  assert.ok(menu.includes('href="/cuenta" data-testid="home-login"'));
  assert.ok(/: !signedIn \? \(\s*<div data-testid="home-guest"/.test(menu), "solo sin sesión");
  const more = read("src", "components", "home", "MoreMenu.tsx");
  // IA 2026-10-07 · perfil y feedback viven en MI CUENTA (una entrada en el «Más»; el feedback, botón dentro).
  for (const href of ['"/competitivo"', '"/copas"', '"/cuenta"']) assert.ok(more.includes(`href: ${href}`), href);
});

test("F862-A3 · Sobre Inicial sin sesión: «Inicia sesión» es un ENLACE a la cuenta, no un botón muerto", () => {
  const offer = starterOffer({ owned: 0, online: false, status: null });
  const html = renderToStaticMarkup(<PackPurchaseCta pack={{ price: 0 }} cta="buy" credits={0} owned={0} offer={offer} busy={false} onAction={() => {}} />);
  assert.ok(/<a[^>]*href="\/cuenta"[^>]*data-testid="pack-cta-login"/.test(html) || /<a[^>]*data-testid="pack-cta-login"[^>]*href="\/cuenta"/.test(html), html.slice(0, 300));
  assert.ok(!/<button[^>]*disabled[^>]*>Inicia sesión/.test(html));
  // Con sesión, el botón de siempre.
  const online = renderToStaticMarkup(<PackPurchaseCta pack={{ price: 0 }} cta="buy" credits={0} owned={1} offer={starterOffer({ owned: 1, online: true, status: undefined })} busy={false} onAction={() => {}} />);
  assert.ok(/<button[^>]*>Abrir sobre/.test(online));
});

/* ───────────── #TAG ───────────── */

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = uid(1), OTHER = uid(2), BANNED = uid(4), PREFIXED = uid(5);
function world() {
  const db = new MemorySupabase();
  db.tables.profiles = [
    { id: ME, username: "yo", avatar: "🎮", last_seen_at: iso(NOW), public_tag: "MEMEME2" },
    { id: OTHER, username: "kaelis", avatar: "🦊", last_seen_at: iso(NOW), public_tag: "K7M2QXA" },
    { id: BANNED, username: "sancion", avatar: "🦂", last_seen_at: iso(NOW), public_tag: "BNN9DDD" },
    { id: PREFIXED, username: "k7m2qxa_fan", avatar: "🐺", last_seen_at: iso(NOW), public_tag: "ZZZZ222" },
  ];
  db.tables.duel_friendships = []; db.tables.duel_challenges = []; db.tables.duel_matches = []; db.tables.duel_pvp_queue = []; db.tables.duel_pvp_ratings = [];
  db.tables.social_blocks = [];
  db.tables.user_sanctions = [{ user_id: BANNED, type: "ban", expires_at: null, revoked_at: null }];
  db.tables.competitive_seasons = []; db.tables.competitive_season_players = []; db.tables.player_profile_customization = [];
  return db;
}

test("F862-T1 · un tag pegado SIN «#» encuentra a su dueño (exacto, primero) y sigue buscando por nombre; sancionado y uno mismo no salen", async () => {
  const r = (await searchPlayers(world().client, ME, "k7m2qxa", { now: NOW })).data!;
  assert.deepEqual(r.players.map((p) => p.username), ["kaelis", "k7m2qxa_fan"], "el dueño del tag primero, luego quien empieza así");
  assert.deepEqual((await searchPlayers(world().client, ME, "BNN9DDD", { now: NOW })).data!.players, [], "sancionado: no");
  assert.deepEqual((await searchPlayers(world().client, ME, "MEMEME2", { now: NOW })).data!.players, [], "uno mismo: no");
  // Con «#» sigue siendo EXACTO (F85/0068 intactos) y un texto que no es un tag sigue siendo solo nombre.
  assert.deepEqual((await searchPlayers(world().client, ME, "#K7M2QXA", { now: NOW })).data!.players.map((p) => p.username), ["kaelis"]);
  assert.deepEqual((await searchPlayers(world().client, ME, "kae", { now: NOW })).data!.players.map((p) => p.username), ["kaelis"]);
});

test("F862-T2 · Social: MI #TAG en la cabecera, copiable y con su para qué; sin tag no se pinta", () => {
  const noop = () => {};
  const handlers = new Proxy({}, { get: () => noop }) as never;
  const search = { query: "", results: null, searching: false, error: null, onQuery: noop, hasMore: false, onMore: noop } as never;
  const html = renderToStaticMarkup(<SocialHub snap={{ ...SOCIAL_FULL, selfTag: "7K4M92X" }} now={NOW} tab="amigos" onTab={noop} handlers={handlers} search={search} />);
  assert.ok(html.includes('data-testid="social-self-tag"') && html.includes('data-tag="7K4M92X"') && html.includes("#7K4M92X"));
  assert.ok(/Pásaselo a un amigo/.test(html));
  const none = renderToStaticMarkup(<SocialHub snap={{ ...SOCIAL_FULL, selfTag: null }} now={NOW} tab="amigos" onTab={noop} handlers={handlers} search={search} />);
  assert.ok(!none.includes("social-self-tag"));
  // El servidor lo saca de SU fila (columna pública 0068), nunca del cliente.
  assert.ok(read("src", "server", "services", "social.ts").includes('selfTag: ("tag" in me ? me.tag : null) ?? null'));
});

/* ───────────── torneo ───────────── */

test("F862-C1 · campeón: «Sala de Trofeos» es un ENLACE; quien no ganó no lo ve; invitación al feedback al acabar tu torneo", () => {
  const champ = { userId: "u", username: "kaelis", avatar: "🦊", tag: "K7M2QXA" } as never;
  const won = renderToStaticMarkup(<ChampionMoment champion={champ} cupName="Copa" completedAt={null} youWon />);
  assert.ok(/<a[^>]*data-testid="cup-champion-trophies"[^>]*href="\/coleccion\/trofeos"/.test(won), won.slice(-400));
  const lost = renderToStaticMarkup(<ChampionMoment champion={champ} cupName="Copa" completedAt={null} youWon={false} />);
  assert.ok(!lost.includes("cup-champion-trophies") && lost.includes("permanente y único"));
  const screen = read("src", "components", "cups", "CupDetailScreen.tsx");
  assert.ok(screen.includes('href="/cuenta?seccion=feedback&desde=cup"') && screen.includes("!me.withdrawn && me.status !== null"));
});

/* ───────────── feedback ───────────── */

test("F862-F1 · validación: clave de envío obligatoria, lista blanca (userId/fecha/adjunto = 400), vacío = 400, límites", () => {
  assert.equal(parseFeedback({ comment: "hola" }).ok, false, "sin id");
  const extra = parseFeedback({ id: UUID1, comment: "x", userId: "otro" });
  assert.ok(!extra.ok && extra.code === "FIELD_NOT_ALLOWED");
  for (const k of ["createdAt", "user_id", "attachment", "email"]) assert.equal(FEEDBACK_KEYS.has(k), false, k);
  const empty = parseFeedback({ id: UUID1, comment: "   " });
  assert.ok(!empty.ok && empty.code === "EMPTY");
  assert.equal(parseFeedback({ id: UUID1, wouldReturn: 11 }).ok, false);
  assert.equal(parseFeedback({ id: UUID1, wouldReturn: 0 }).ok, false);
  assert.equal(parseFeedback({ id: UUID1, wouldReturn: 7.5 }).ok, false);
  assert.equal(parseFeedback({ id: UUID1, comment: "x".repeat(2001) }).ok, false);
  assert.equal(parseFeedback({ id: UUID1, source: "admin", comment: "x" }).ok, false);
  const ok = parseFeedback({ action: "submit", id: UUID1.toUpperCase(), source: "cup", likedMost: "  el torneo  ", hadError: false, wouldReturn: 8 });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.id, UUID1, "la clave se normaliza");
    assert.equal(ok.value.likedMost, "el torneo");
    assert.equal(ok.value.comment, null);
    const row = feedbackRow("user-1", ok.value, "0.1.1");
    assert.deepEqual(Object.keys(row).sort(), ["app_version", "comment", "error_detail", "had_error", "hard_to_understand", "id", "liked_least", "liked_most", "lost_moment", "source", "user_id", "would_return"].sort());
    assert.equal(row.user_id, "user-1", "el usuario lo pone el servidor");
  }
  assert.equal(isEmptyFeedback({ hardToUnderstand: null, lostMoment: null, likedMost: null, likedLeast: null, errorDetail: null, comment: null, hadError: false, wouldReturn: null }), false, "«No hubo errores» ya es una respuesta");
});

/** Tabla `alpha_feedback` mínima con la clave única de la BD (23505) y el tope por cuenta (FEEDBACK_LIMIT). */
function feedbackDb(limit = 30) {
  const rows: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      insert: async (r: Record<string, unknown>) => {
        if (rows.some((x) => x.id === r.id)) return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        if (rows.filter((x) => x.user_id === r.user_id).length >= limit) return { error: { code: "P0001", message: "FEEDBACK_LIMIT" } };
        rows.push(r); return { error: null };
      },
      select: () => ({ eq: (_k: string, v: unknown) => ({ maybeSingle: async () => ({ data: rows.find((x) => x.id === v) ?? null, error: null }) }) }),
    }),
  };
  return { rows, client: client as never };
}

test("F862-F2 · idempotente: el mismo envío 20× (doble clic, dos pestañas, reintento) → UNA fila; clave ajena → 409 neutro; tope → 409 humano", async () => {
  const db = feedbackDb();
  const v = parseFeedback({ id: UUID1, comment: "me perdí en el cuadro" });
  assert.ok(v.ok);
  if (!v.ok) return;
  const rs = await Promise.all(Array.from({ length: 20 }, () => submitFeedback(db.client, "user-1", v.value, "0.1.1")));
  assert.equal(db.rows.length, 1);
  assert.equal(rs.filter((r) => r.ok && r.data.code === "SAVED").length, 1);
  assert.ok(rs.every((r) => r.ok), "los demás son ALREADY, nunca un error");
  const other = await submitFeedback(db.client, "user-2", v.value, null);
  assert.ok(!other.ok && other.status === 409 && !/user-1|me perdí/.test(other.error), "no revela nada de la fila ajena");
  const capped = feedbackDb(0);
  const lim = await submitFeedback(capped.client, "user-1", v.value, null);
  assert.ok(!lim.ok && lim.status === 409 && lim.code === "LIMIT");
});

test("F862-F3 · la ruta: sesión obligatoria, acción única, lista blanca, cubeta propia; sin GET (un jugador no lee feedback)", () => {
  const route = read("src", "app", "api", "game", "feedback", "route.ts");
  assert.ok(route.includes('if (!session) return bad("No autenticado", 401)'));
  assert.ok(route.includes('"feedback_write"'));
  assert.ok(!/export (async )?function GET|export const GET/.test(route), "sin lectura para jugadores");
  assert.ok(read("src", "server", "services", "rateLimit.ts").includes("feedback_write: {"));
});

test("F862-F4 · formulario: siete preguntas, todas opcionales, envío con clave fija, borrador por CUENTA, sin modal", () => {
  const html = renderToStaticMarkup(<FeedbackForm userId="u1" source="menu" />);
  for (const q of ["¿Qué parte te costó entender?", "¿En algún momento no sabías qué hacer?", "¿Qué fue lo que más te gustó?", "¿Qué fue lo que menos te gustó?", "¿Hubo algún error?", "Del 1 al 10, ¿volverías a jugar?", "Comentario libre"]) {
    assert.ok(html.includes(q), q);
  }
  assert.ok(html.includes('data-testid="feedback-submit"') && !/role="dialog"/.test(html));
  assert.ok(!/type="email"|type="file"/.test(html), "ni correo ni adjuntos");
  const src = read("src", "components", "feedback", "FeedbackForm.tsx");
  assert.ok(src.includes("nexus:alpha-feedback:${userId}"), "borrador atado a la cuenta");
  assert.ok(src.includes("inFlight.current") && src.includes("setId(d.id ?? newSubmissionId())"));
});

test("F862-F5 · acceso discreto: «Dar feedback» en el menú (armazón y portada) y en /admin una sección de solo lectura", () => {
  // IA 2026-10-07 · «Dar feedback» es el botón de MI CUENTA (icono de usuario en armazón y portada); `/feedback` redirige.
  assert.ok(!NAV_SECTIONS.some((s) => s.items.some((i) => i.href === "/feedback")));
  assert.ok(readFileSync(join(process.cwd(), "src/components/account/AccountHub.tsx"), "utf8").includes('data-testid="account-feedback"'));
  assert.ok(ADMIN_SECTIONS.some((s) => s.href === "/admin/alpha" && s.group === "Jugadores"));
});

/* ───────────── admin ───────────── */

test("F862-AD1 · /api/admin/alpha: anónimo y usuario normal → 401; parámetros extra → 400; fecha inválida → 400", async () => {
  const deps: AdminDeps = { verify: async (req) => (req.headers.get("authorization") === "Bearer admin" ? { userId: "a" } : null), db: () => ({}) as never };
  const h = alphaHandlers(deps);
  assert.equal((await h.GET(new Request("http://t/api/admin/alpha"))).status, 401);
  assert.equal((await h.GET(new Request("http://t/api/admin/alpha", { headers: { authorization: "Bearer user" } }))).status, 401);
  assert.equal((await h.GET(new Request("http://t/api/admin/alpha?view=feedback&userId=x", { headers: { authorization: "Bearer admin" } }))).status, 400);
  assert.equal((await h.GET(new Request("http://t/api/admin/alpha?view=funnel&since=mañana", { headers: { authorization: "Bearer admin" } }))).status, 400);
  const now = Date.parse("2026-10-05T12:00:00Z");
  assert.equal(parseSince(null, now), "2026-09-21T12:00:00.000Z", "por defecto, 14 días");
  assert.equal(parseSince("2026-10-01T09:00:00Z", now), "2026-10-01T09:00:00.000Z");
  assert.equal(parseSince("2027-01-01T00:00:00Z", now), null, "futuro: no");
  assert.equal(parseSince("2024-01-01T00:00:00Z", now), null, "más de 400 días: no");
});

test("F862-AD2 · el panel muestra nombre + #TAG, nunca el correo; el embudo lista los 13 pasos derivados", () => {
  const adm = read("src", "server", "admin", "alpha.ts");
  // El correo solo se usa para FILTRAR cuentas de prueba (como el embudo); ninguna fila de la respuesta lo lleva.
  const rowsOut = adm.slice(adm.indexOf("items: shown.map"), adm.indexOf("count: shown.length"));
  assert.ok(rowsOut.length > 0 && !/email/i.test(rowsOut), "la respuesta no lleva correos");
  assert.ok(adm.includes('endsWith("@example.invalid")') && adm.includes("listFeedback(sb, q.get(\"test\") === \"1\")"), "QA oculto por defecto, como el embudo");
  assert.ok(adm.includes('select("id, username, public_tag")'));
  assert.equal(FUNNEL_STEPS.length, 13);
  const page = read("src", "app", "admin", "alpha", "page.tsx");
  assert.ok(!/email|correo:/i.test(page.replace(/nunca se muestran correos/i, "")));
});

/* ───────────── 0070 ───────────── */

test("F862-M1 · 0070: tabla privada (RLS sin políticas, sin privilegios de cliente), append-only, tope por cuenta, sin correo ni IP", () => {
  assert.ok(MIG.includes("alter table public.alpha_feedback enable row level security;"));
  assert.ok(MIG.includes("revoke all on table public.alpha_feedback from public, anon, authenticated;"));
  assert.ok(MIG.includes("grant select, insert on table public.alpha_feedback to service_role;"));
  assert.ok(!/create policy/i.test(MIG), "sin políticas: nadie lee por REST");
  assert.ok(MIG.includes("FEEDBACK_IMMUTABLE") && MIG.includes("FEEDBACK_LIMIT") && MIG.includes(">= 30"));
  assert.ok(MIG.includes("id                uuid primary key"), "la clave de envío es la clave primaria");
  const cols = MIG.slice(MIG.indexOf("create table if not exists public.alpha_feedback"), MIG.indexOf("create index"));
  assert.ok(!/\bemail\b|\bip\b|user_agent|attachment/i.test(cols), "ni correo, ni IP, ni agente, ni adjuntos");
  assert.ok(MIG.includes("on delete cascade"), "borrar la cuenta borra su feedback");
});

test("F862-M2 · 0070: el embudo es LECTURA (stable), solo service_role, excluye admins y cuentas de prueba, nunca devuelve el correo", () => {
  assert.ok(MIG.includes("returns jsonb language sql stable security definer"));
  assert.ok(MIG.includes("revoke all on function public.app_alpha_funnel(timestamptz, boolean) from public, anon, authenticated;"));
  assert.ok(MIG.includes("not coalesce(p.is_admin, false)") && MIG.includes("u.email ilike '%@example.invalid'"));
  const out = MIG.slice(MIG.indexOf("'players', coalesce("));
  assert.ok(!/email/.test(out.slice(0, out.indexOf("order by created_at"))), "la salida no lleva el correo");
  for (const s of FUNNEL_STEPS) assert.ok(MIG.includes(`'${s.key}'`), s.key);
  assert.ok(!/\b(insert|update|delete)\b/i.test(MIG.slice(MIG.indexOf("create or replace function public.app_alpha_funnel"), MIG.indexOf("revoke all on function public.app_alpha_funnel"))), "sin escrituras");
  assert.ok(RB.includes("drop table if exists public.alpha_feedback") && RB.includes("drop function if exists public.app_alpha_funnel"));
});

/* ───────────── partida rápida ───────────── */

test("F862-Q1 · resultado mínimo en TODOS los caminos: 409 (jugada vencida / estado viejo) y retomar con F5 llevan el contexto", () => {
  const duels = read("src", "server", "services", "duels.ts");
  assert.ok(!/data: \{ view: viewOf\(/.test(duels), "ninguna respuesta 409 sale sin contexto");
  // DUEL GAMEPLAY UX 2.0 · contra un bot no hay jugada vencida (sin reloj): quedan getMatch + el 409 de la carrera.
  assert.equal((duels.match(/view: await withContext\(sb, current, viewOf\(current\)\)/g) ?? []).length, 2, "getMatch + el 409 de la carrera");
  assert.ok(!duels.includes('code: "TURN_EXPIRED"'), "en PvE ninguna jugada se rechaza por tiempo");
  assert.ok(duels.includes("view: await withContext(sb, row, viewOf(row))"), "409 STALE_STATE");
  assert.ok(duels.includes("return done({ view: await withContext(sb, row, withVersion(toPublicView(row.state"), "getActiveMatch (F5 / reconexión)");
  const page = read("src", "app", "duelos", "jugar", "page.tsx");
  assert.ok(page.includes('setError(playerMessage(e instanceof Error ? e.message : "No se pudo empezar el duelo"))'), "nunca texto técnico al empezar");
  assert.ok(page.includes('setError(playerMessage(e.message || "No se pudo jugar el turno"))'));
});
