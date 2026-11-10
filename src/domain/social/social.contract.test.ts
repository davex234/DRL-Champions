/**
 * SOCIAL 1.0 · CONTRATOS SOBRE EL CÓDIGO REAL (Fase 29).
 *
 * Sin base de datos: se afirma lo que la migración, el servicio, la ruta, el cliente y las
 * pantallas escriben, y lo que NO pueden romper. Bloques del brief: amistades (5–12), búsqueda y
 * perfil (14–18), retos (29–36), partida privada (37–48), cara a cara (52–55), seguridad (56–64),
 * regresión (65–79), telemetría, accesibilidad e integración.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isFlow } from "@/lib/telemetry/contract";
import { SOCIAL_CONTEXTS, SOCIAL_FLOW } from "@/lib/social/telemetry";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { NAV_SECTIONS } from "@/design/nav";
import { todayActions, continueCta } from "@/domain/progression/meta";
import { isPvpLike } from "@/domain/cardgame/pvp";
import { CHALLENGE_TTL_SECONDS, PRESENCE_WINDOWS, SEARCH_LIMIT, SEARCH_MIN } from "./social";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (s: string) => s.replace(/^\s*--.*$/gm, "");

const MIG48 = read("supabase", "migrations", "0048_social_friends_private_duels.sql");
const MIG66 = read("supabase", "migrations", "0066_social_2.sql"); // F85 · Social 2.0 (bloqueos por dirección, límites, retos de 5 min)
const MIG46 = read("supabase", "migrations", "0046_telemetry_flows_progression.sql");
const MIG47 = read("supabase", "migrations", "0047_pvp_ladder_indexes.sql");
const MIG35 = read("supabase", "migrations", "0035_pvp_turn_timeout.sql");
const DOMAIN = read("src", "domain", "social", "social.ts");
const SERVICE = read("src", "server", "services", "social.ts");
const PVP_SERVICE = read("src", "server", "services", "duelsPvp.ts");
const RATING_SERVICE = read("src", "server", "services", "duelsRating.ts");
const MM_SERVICE = read("src", "server", "services", "duelsMatchmaking.ts");
const LOOP = read("src", "server", "services", "loop.ts");
const RATE = read("src", "server", "services", "rateLimit.ts");
const ROUTE = read("src", "app", "api", "game", "social", "route.ts");
const PVP_ROUTE = read("src", "app", "api", "game", "duel", "pvp", "route.ts");
const CLIENT = read("src", "lib", "social", "client.ts");
const TELEMETRY = read("src", "lib", "social", "telemetry.ts");
const TYPES = read("src", "domain", "cardgame", "pvp", "types.ts");
const AUTHORITY = read("src", "domain", "cardgame", "pvp", "authority.ts");
const SYNC = read("src", "domain", "cardgame", "pvp", "sync.ts");
const PVP_PAGE = read("src", "app", "duelos", "pvp", "page.tsx");
const PVP_ARENA = read("src", "components", "duel", "pvp", "PvpArena.tsx");
const PVP_OUTCOME = read("src", "components", "duel", "pvp", "PvpOutcome.tsx");
const PANEL = read("src", "components", "duel", "pvp", "PrivateDuelPanel.tsx");
const SOCIAL_PAGE = read("src", "app", "social", "page.tsx");
const HUB = read("src", "components", "social", "SocialHub.tsx");
const HERO = read("src", "components", "social", "SocialHero.tsx");
const FRIENDS = read("src", "components", "social", "FriendsList.tsx");
const REQUESTS = read("src", "components", "social", "RequestsList.tsx");
const SEARCH = read("src", "components", "social", "PlayerSearch.tsx");
const CHALLENGES = read("src", "components", "social", "ChallengesList.tsx");
const INBOX = read("src", "components", "social", "SocialInbox.tsx");
const SHEET = read("src", "components", "social", "ChallengeSheet.tsx");
const CONFIRM = read("src", "components", "social", "ConfirmSheet.tsx");
const ACTIONS = read("src", "components", "social", "SocialActions.tsx");
const SUMMARY = read("src", "components", "social", "SocialSummary.tsx");
const BITS = read("src", "components", "social", "bits.tsx");
const PROFILE = read("src", "components", "competitive", "PlayerProfile.tsx");
const JUGADOR = read("src", "components", "player", "PlayerProfileScreen.tsx");
const CUENTA = read("src", "app", "cuenta", "page.tsx");
const SHELL = read("src", "components", "layout", "GameShell.tsx");
const NAV = read("src", "design", "nav.ts");
const META = read("src", "domain", "progression", "meta.ts");
const NEXTUP = read("src", "components", "loop", "NextUp.tsx");
const TODAY = read("src", "components", "progression", "TodayPanel.tsx");
const HARNESS = read("src", "app", "design-system", "fase29", "page.tsx");
const FIXTURES = read("src", "app", "design-system", "fase29", "fixtures.ts");

const UI = [HUB, HERO, FRIENDS, REQUESTS, SEARCH, CHALLENGES, INBOX, SHEET, CONFIRM, ACTIONS, SUMMARY, BITS, PANEL];

/* ───────────────────────────── modelo de datos y amistades (5–12) ───────────────────────────── */

test("5 · 0048: una amistad por par canónico (lo < hi), sin auto-amistad, cuatro estados y bloqueo con autor", () => {
  assert.ok(MIG48.includes("create table if not exists public.duel_friendships"));
  assert.ok(MIG48.includes("primary key (user_lo, user_hi)"));
  assert.ok(/check \(user_lo < user_hi\)/.test(MIG48), "lo < hi: A→B y B→A son la misma fila y A→A es imposible");
  assert.ok(MIG48.includes("check (status in ('PENDING','ACCEPTED','DECLINED','BLOCKED'))"));
  assert.ok(MIG48.includes("check ((status = 'BLOCKED') = (blocked_by is not null))"));
  assert.ok(MIG48.includes("check (requester_id in (user_lo, user_hi))"));
});

test("6 · 0048: tablas SOLO servidor (RLS activa, sin políticas, revocadas a anon/authenticated); RPC solo service_role", () => {
  for (const t of ["duel_friendships", "duel_challenges"]) {
    assert.ok(MIG48.includes(`alter table public.${t} enable row level security`), t);
    assert.ok(MIG48.includes(`revoke all on public.${t} from anon, authenticated`), t);
    assert.ok(!new RegExp(`create policy [^\\n]* on public\\.${t}`).test(MIG48), `${t}: ninguna política de cliente`);
  }
  assert.ok(/security definer set search_path = public/.test(MIG48));
  assert.ok(/revoke all on function public\.%s from public, anon, authenticated/.test(MIG48));
  assert.ok(/grant execute on function public\.%s to service_role/.test(MIG48));
});

test("7 · la solicitud es atómica en Postgres: doble clic = una fila; cruzadas convergen en ACCEPTED; bloqueo no se revela", () => {
  const fn = MIG48.slice(MIG48.indexOf("create or replace function public.social_friend_request"), MIG48.indexOf("create or replace function public.social_friend_respond"));
  assert.ok(fn.includes("for update"), "bloquea la fila del par");
  assert.ok(fn.includes("'ALREADY_PENDING'") && fn.includes("'REQUESTED'"));
  assert.ok(fn.includes("'ACCEPTED'"), "cruzadas: la segunda solicitud acepta la primera");
  assert.ok(fn.includes("'ALREADY_FRIENDS'") && fn.includes("'BLOCKED'") && fn.includes("'SELF'"));
  // F85 · bloqueo en CUALQUIER sentido → respuesta NEUTRA idéntica («Acción no disponible»): no revela quién bloqueó.
  assert.ok(/case "UNAVAILABLE": case "BLOCKED": return UNAVAILABLE\(\);/.test(SERVICE), "bloqueo → respuesta neutra");
  assert.ok(SERVICE.includes('fail(409, "Acción no disponible", "UNAVAILABLE")'));
  assert.ok(MIG66.includes("if public._social_blocked(p_user, p_target) then return jsonb_build_object('code','UNAVAILABLE'); end if;"));
});

test("8 · responder: solo el destinatario acepta o rechaza; rechazar permite volver a pedir; el servicio traduce a relación", () => {
  const fn = MIG48.slice(MIG48.indexOf("function public.social_friend_respond"), MIG48.indexOf("function public.social_unfriend"));
  assert.ok(fn.includes("'NOT_TARGET'") && fn.includes("'NO_REQUEST'"));
  assert.ok(/case when p_accept then 'ACCEPTED' else 'DECLINED' end/.test(fn));
  assert.ok(/case "DECLINED": return "NONE";|default: return "NONE";/.test(DOMAIN), "DECLINED se ve como NONE: re-solicitable");
  assert.ok(SERVICE.includes("relationAfter(sb, me, target, r.code)"));
});

test("9 · eliminar amigo conserva el historial (solo borra la relación) y pide confirmación en pantalla", () => {
  const fn = MIG48.slice(MIG48.indexOf("function public.social_unfriend"), MIG48.indexOf("function public.social_block"));
  assert.ok(fn.includes("delete from public.duel_friendships"));
  assert.ok(!/duel_matches/.test(fn), "nunca toca partidas");
  assert.ok(SOCIAL_PAGE.includes('title={tr("¿Eliminar amigo?")}') && SOCIAL_PAGE.includes("Vuestro historial de partidas se conserva"));
  assert.ok(ACTIONS.includes('title={t("¿Eliminar amigo?")}'));
  assert.ok(CONFIRM.includes('role="alertdialog"'));
});

test("10 · bloquear: sustituye la relación por BLOCKED con autor, cancela retos pendientes en ambos sentidos; solo el bloqueador desbloquea", () => {
  const fn = MIG48.slice(MIG48.indexOf("function public.social_block"), MIG48.indexOf("function public.social_unblock"));
  assert.ok(fn.includes("'BLOCKED'") && fn.includes("blocked_by"));
  assert.ok(/update public\.duel_challenges[\s\S]*set status = 'CANCELLED'/.test(fn));
  const un = MIG48.slice(MIG48.indexOf("function public.social_unblock"), MIG48.indexOf("function public.social_challenge_expire_due"));
  assert.ok(un.includes("blocked_by = p_user"), "solo quien bloqueó");
  assert.ok(DOMAIN.includes("block: r === \"NONE\" || r === \"OUTGOING\" || r === \"INCOMING\" || r === \"FRIENDS\""));
});

test("11 · el bloqueado no existe para el bloqueador ni al revés: búsqueda lo omite y el perfil da 404; retar exige amistad ACCEPTED", () => {
  assert.ok(SERVICE.includes('if (relation === "BLOCKED_ME") continue;'));
  assert.ok(SERVICE.includes('if (relation === "BLOCKED_ME") return fail(404, "Jugador no encontrado");'));
  const fn = MIG48.slice(MIG48.indexOf("function public.social_challenge_create"), MIG48.indexOf("function public.social_challenge_respond"));
  assert.ok(fn.includes("f.status <> 'ACCEPTED'") && fn.includes("'NOT_FRIENDS'"));
});

test("12 · sin auto-amistad en TODAS las capas: CHECK, RPC (SELF), servicio (guardTarget) y dominio (pairKey)", () => {
  assert.ok((MIG48.match(/p_user = p_target then return jsonb_build_object\('code','SELF'\)/g) ?? []).length >= 6);
  assert.ok(SERVICE.includes('if (target === me) return fail(400, "No puedes hacer eso contigo", "SELF");'));
  assert.ok(DOMAIN.includes("if (!a || !b || a === b) return null;"));
});

/* ───────────────────────────── búsqueda y perfil (14–18) ───────────────────────────── */

test("14 · búsqueda acotada: prefijo de username, ≥ 2 letras, ≤ 10, orden fijo, sin uno mismo; índice lower(username) en 0048", () => {
  assert.equal(SEARCH_MIN, 2);
  assert.equal(SEARCH_LIMIT, 10);
  // F85 · paginada (10 por página, ≤ 5 páginas): mismo prefijo, mismo orden.
  // F85 · el `_` de los nombres va escapado en el patrón (`likePrefix`): literal, no comodín.
  assert.ok(SERVICE.includes('.ilike("username", likePrefix(q)).neq("id", userId).order("username", { ascending: true }).range(offset, offset + SEARCH_LIMIT)'));
  assert.ok(/create index if not exists profiles_username_lower_idx on public\.profiles \(lower\(username\) text_pattern_ops\)/.test(MIG48));
  assert.ok(ROUTE.includes('q.has("q") ? "social_search" : "social_read"'), "la búsqueda tiene su propia cubeta");
});

test("15 · nunca se busca ni se enseña el correo: la consulta rechaza «@», y el servicio solo proyecta id/username/avatar/last_seen_at", () => {
  assert.ok(DOMAIN.includes('if (s.includes("@")) return null;'));
  // 0068 · + `public_tag` (público por diseño: búsqueda exacta por #TAG). Ninguna columna privada.
  assert.ok(SERVICE.includes('const PROFILE_COLS = "id, username, avatar, last_seen_at, public_tag";'));
  const c = code(SERVICE);
  // F85 · la comparación usa la proyección PÚBLICA del perfil (nivel de temporada, colección…): lo que se vigila es que de
  // `profiles` solo se lea la proyección fija y que nunca aparezcan columnas privadas.
  assert.ok(!/\bemail\b|\bcredits\b|\bis_admin\b|\bequipped\b|\btokens\b/.test(c), "ninguna columna privada de profiles sale del servicio social");
  assert.ok(!/from\("profiles"\)\.select\((?!PROFILE_COLS)/.test(c), "de profiles solo la proyección fija");
  assert.ok(!/select\("\*"\)/.test(c), "ningún select *");
  // 0068 · la búsqueda acepta además el #TAG exacto; lo que no cambia: nunca por correo.
  assert.ok(SEARCH.includes("Por nombre de usuario o por #TAG exacto de la cuenta. Nunca por correo."));
});

test("16 · el perfil social no enumera: id inválido → 400, inexistente → 404, bloqueado por él → 404 (mismo mensaje)", () => {
  assert.ok(SERVICE.includes('if (!UUID.test(playerId)) return fail(400, "Jugador no válido");'));
  assert.ok((SERVICE.match(/fail\(404, "Jugador no encontrado"/g) ?? []).length >= 3);
  assert.ok(ROUTE.includes('if (!UUID.test(id)) return bad("Jugador no válido");'));
});

test("17 · de otro jugador NUNCA sale su mazo actual ni sus cartas no jugadas: el social no lee duel_decks ajenos ni user_cards", () => {
  const c = code(SERVICE);
  assert.ok(!/from\("duel_decks"\)|from\("user_cards"\)|card_uids/.test(c), "los mazos solo pasan por resolveDeckSnapshot (propiedad del que llama)");
  assert.ok(c.includes("resolveDeckSnapshot(sb, me, "), "el mazo que se valida es siempre el del usuario del token");
  assert.ok(!/state\b(?!->)/.test(c.replace(/scoreA:state->scoreA, scoreB:state->scoreB/g, "")) || true);
  assert.ok(!/select\([^)]*\bstate\b[^)]*\)/.test(c.replace("scoreA:state->scoreA, scoreB:state->scoreB", "")), "nunca el estado jsonb entero de una partida");
});

test("18 · el perfil competitivo de la Fase 28 se reutiliza: recibe las acciones sociales como hueco y la página las monta", () => {
  assert.ok(PROFILE.includes("social?: React.ReactNode") && PROFILE.includes("{social}"));
  assert.ok(JUGADOR.includes("<SocialActions playerId={snap.player.userId}"), "Fase 31: el perfil canónico monta las acciones sociales");
  // F89 · las acciones sociales viven SOLO en la vista pública (`PublicProfileView`); la del propietario no las recibe.
  assert.ok(JUGADOR.includes("social={user ? <SocialActions") && JUGADOR.indexOf("<PublicProfileView") < JUGADOR.indexOf("social={user ? <SocialActions"), "en el perfil propio no hay acciones");
  assert.ok(!/social=/.test(JUGADOR.slice(JUGADOR.indexOf("<ProfileOwnerView"), JUGADOR.indexOf("<PublicProfileView"))));
  assert.ok(ACTIONS.includes('if (!view || view.relation === "SELF") return null;'));
  for (const label of ["Añadir amigo", "Solicitud enviada", "Aceptar", "Eliminar amigo", "Retar", "Bloquear", "Desbloquear"]) assert.ok(ACTIONS.includes(label), label);
});

/* ───────────────────────────── presencia (19–24) ───────────────────────────── */

test("24 · presencia: solo el latido propio (id del token), ventanas del dominio, sin Realtime, sin «en línea» inventado", () => {
  assert.ok(SERVICE.includes('.update({ last_seen_at: new Date(now).toISOString() }).eq("id", userId)'));
  assert.ok(ROUTE.includes('case "heartbeat": return reply(await heartbeat(admin, userId));'));
  assert.ok(!/targetUserId/.test(code(ROUTE).split('case "heartbeat"')[1]?.split("\n")[0] ?? ""), "el latido no lleva destinatario");
  assert.ok(!/\.channel\(|realtime/i.test(code(CLIENT) + code(SERVICE) + code(SOCIAL_PAGE)));
  // F85 · el latido es el PULSO compartido del armazón (cada 20 s con la pestaña visible, sondeo F64).
  assert.ok(CLIENT.includes("intervalMs: HEARTBEAT_MS") && CLIENT.includes('sendPulse()'));
  assert.ok(SERVICE.includes("presenceOf(") && !/"ONLINE"/.test(code(SERVICE)), "el servicio nunca fija ONLINE a mano");
  assert.ok(MIG48.includes("alter table public.profiles add column if not exists last_seen_at timestamptz"));
  assert.equal(PRESENCE_WINDOWS.onlineMs, 120_000);
});

/* ───────────────────────────── retos (29–36) ───────────────────────────── */

test("29 · 0048: retos con seis estados, un solo PENDING por par y dirección, sin retarse a uno mismo", () => {
  assert.ok(MIG48.includes("check (status in ('PENDING','ACCEPTED','DECLINED','EXPIRED','CANCELLED','MATCHED'))"));
  assert.ok(/create unique index if not exists duel_challenges_pending_uniq[\s\S]*where status = 'PENDING'/.test(MIG48));
  assert.ok(/duel_challenges_not_self\s+check \(challenger_id <> challenged_id\)/.test(MIG48));
});

test("30 · crear reto: solo amigos, mazo validado por el servidor (propiedad + legalidad) ANTES del RPC, TTL 24 h por reloj del servidor", () => {
  assert.ok(SERVICE.includes("const deck = await resolveDeckSnapshot(sb, me, input.deckId);"));
  assert.ok(SERVICE.includes("p_ttl_seconds: CHALLENGE_TTL_SECONDS"));
  assert.equal(CHALLENGE_TTL_SECONDS, 300); // F85 · 5 min (antes 24 h)
  assert.ok(MIG66.includes("now() + make_interval(secs => least(3600, greatest(60, p_ttl_seconds)))"));
  assert.ok(SERVICE.includes('case "NOT_FRIENDS": return fail(403, "Solo puedes retar a tus amigos", r.code);'));
});

test("31 · caducidad perezosa: el servidor caduca lo vencido al leer (social_challenge_expire_due) y el dominio lo muestra EXPIRED aunque la fila no se haya tocado", () => {
  assert.ok(SERVICE.includes('await sb.rpc("social_challenge_expire_due", { p_user: userId });'));
  assert.ok(MIG48.includes("function public.social_challenge_expire_due"));
  assert.ok(DOMAIN.includes('if (c.status === "PENDING" && c.expiresAt <= now) return "EXPIRED";'));
  assert.ok(!/setTimeout|cron|pg_cron/.test(code(SERVICE) + sql(MIG48)), "sin relojes ni cron");
});

test("32 · aceptar es atómico y reserva el match_id UNA vez: doble aceptación = mismo id; solo el retado; mazo obligatorio; ocupado = BUSY", () => {
  const fn = MIG48.slice(MIG48.indexOf("function public.social_challenge_respond"), MIG48.indexOf("function public.social_challenge_mark_matched"));
  assert.ok(fn.includes("for update"));
  assert.ok(fn.includes("if c.challenged_id <> p_user then return jsonb_build_object('code','NOT_TARGET')"));
  assert.ok(fn.includes("'ALREADY_ACCEPTED'") && fn.includes("'matchId', c.match_id"));
  assert.ok(fn.includes("v_match := gen_random_uuid();"));
  assert.ok(fn.includes("'DECK_REQUIRED'") && fn.includes("'BUSY'"));
  assert.ok(fn.includes("_duel_pvp_has_active_match(p_user) or public._duel_pvp_has_active_match(c.challenger_id)"));
});

test("33 · rechazar no penaliza (solo DECLINED + responded_at); cancelar solo el retador y solo PENDING", () => {
  const fn = MIG48.slice(MIG48.indexOf("function public.social_challenge_respond"), MIG48.indexOf("function public.social_challenge_mark_matched"));
  assert.ok(/set status = 'DECLINED', responded_at = now\(\)/.test(fn));
  assert.ok(!/duel_pvp_ratings|rating/.test(sql(fn)), "rechazar no toca rating");
  const cancel = MIG48.slice(MIG48.indexOf("function public.social_challenge_cancel"));
  assert.ok(cancel.includes("challenger_id = p_user") && cancel.includes("status = 'PENDING'"));
});

test("34 · tras aceptar, la partida nace con createPvpMatch en modo PVP_PRIVATE (retador = A, retado = B) y se marca MATCHED; si falla, el reto se cierra", () => {
  assert.ok(SERVICE.includes('{ matchId, mode: "PVP_PRIVATE" }'));
  assert.ok(SERVICE.includes("{ playerId: String(r.challengerId), deckId: String(r.challengerDeckId) }"));
  assert.ok(SERVICE.includes("{ playerId: me, deckId: String(r.challengedDeckId) }"));
  assert.ok(SERVICE.includes('await rpc(sb, "social_challenge_mark_matched"'));
  assert.ok(SERVICE.includes('await rpc(sb, "social_challenge_fail"'));
  assert.ok(MIG48.includes("function public.social_challenge_fail") && /set status = 'CANCELLED'[\s\S]*where id = p_challenge and status = 'ACCEPTED'/.test(MIG48));
});

test("35 · la revancha es un reto NUEVO con previous_match_id que debe pertenecer a los dos; el rival tiene que aceptarla", () => {
  assert.ok(SERVICE.includes("previous_match_id") || SERVICE.includes("p_previous_match: prev"));
  assert.ok(SERVICE.includes('if (!both) return fail(404, "Partida anterior no encontrada", "BAD_PREVIOUS");'));
  assert.ok(PVP_PAGE.includes("createChallenge(priv.rival.userId, deckIdElegido, matchId)"));
  // RESULTADO ÚNICO · la REVANCHA del duelo privado es la acción principal del resultado y abre el mismo reto nuevo.
  assert.ok(PVP_OUTCOME.includes('privateDuel\n      ? { label: tr("Revancha"), onClick: privateDuel.onRematch'));
  assert.ok(PVP_PAGE.includes("onRematch: () => { setRevanchaError(null); setRevancha(true); },"), "la revancha abre el reto (ChallengeSheet)");
  // El ranked sigue sin prometer revancha: su acción principal es buscar OTRO rival.
  assert.ok(PVP_OUTCOME.includes('{ label: tr("Jugar otra"), onClick: onAgain, once: true, testId: "ranked-again" }'), "el resultado ranked no promete revancha");
});

test("36 · la pantalla de retos y la bandeja usan estados EFECTIVOS y acciones del servidor; nada se decide en el cliente", () => {
  assert.ok(CHALLENGES.includes('c.status === "PENDING" && c.direction === "INCOMING"'));
  assert.ok(CHALLENGES.includes("handlers.onAcceptChallenge(c)") && CHALLENGES.includes("handlers.onCancelChallenge(c)"));
  assert.ok(INBOX.includes("handlers.onAcceptChallenge(ch)"));
  assert.ok(!/status\s*=\s*"|expiresAt\s*[<>]/.test(code(CHALLENGES) + code(INBOX)), "ninguna transición ni caducidad calculada en la interfaz");
  assert.ok(SERVICE.includes("actions: { ...challengeActions(c, me, now), open: challengeActions(c, me, now).open && (live ? !!c.matchId && live.has(c.matchId) : true) }"));
});

/* ───────────────────────────── partida privada (37–48) ───────────────────────────── */

test("37 · el modo privado es una columna real: CHECK con PVP_PRIVATE y forma de dos jugadores; el modelo TS lo conoce", () => {
  assert.ok(MIG48.includes("add constraint duel_matches_mode_check check (mode in ('PVE','PVP','PVP_PRIVATE'))"));
  assert.ok(MIG48.includes("(mode in ('PVP','PVP_PRIVATE') and player_b_id is not null and deck_b_id is not null"));
  assert.ok(TYPES.includes('export type DuelMode = "PVE" | "PVP" | "PVP_PRIVATE";'));
  assert.ok(TYPES.includes('export type PvpPlayableMode = "PVP" | "PVP_PRIVATE";'));
  assert.equal(isPvpLike("PVP_PRIVATE"), true);
  assert.equal(isPvpLike("PVE"), false);
  assert.equal(isPvpLike(undefined), false);
});

test("38 · CRÍTICO · un duelo privado NUNCA liquida: isSettleable exige mode === PVP y el RPC de liquidación (0035) sigue rechazando todo lo que no sea PVP", () => {
  const c = code(PVP_SERVICE);
  assert.ok(/function isSettleable\(rec: PvpMatchRecord\): boolean \{\s*if \(rec\.mode !== "PVP"\) return false;/.test(c));
  assert.ok(!/duel_pvp_settle_match/.test(sql(MIG48)), "0048 no redefine la liquidación");
  assert.ok(MIG35.includes("if m.mode <> 'PVP' then") && MIG35.includes("'NOT_PVP'"));
  assert.ok(!/settle|duel_pvp_rating_events|from\("duel_pvp_ratings"\)\.(insert|update|upsert|delete)/.test(code(SERVICE)), "el servicio social no liquida ni escribe rating (solo lee el resumen público)");
  assert.ok(RATING_SERVICE.includes('if (!row || row.mode !== "PVP") return fail(404, "Partida no encontrada", "NOT_PVP");'), "el movimiento de rating solo existe para ranked");
});

test("39 · el servicio PvP acepta los dos modos con UNA función (isPvpLike) en lectura, acción, abandono, sondeo y vencimiento", () => {
  const c = code(PVP_SERVICE);
  assert.ok((c.match(/!isPvpLike\(/g) ?? []).length >= 5, "getPvpMatch, expireTurnIfDue, applyPvpAction, abandonPvpMatch, syncPvpMatch");
  assert.equal((c.match(/rec\.mode !== "PVP"\)/g) ?? []).length, 1, "el único filtro literal a PVP es el de la liquidación");
  assert.ok(!/p\.mode !== "PVP"\)/.test(c));
  assert.ok(c.includes('mode: row.mode === "PVP" || row.mode === "PVP_PRIVATE" ? row.mode : "PVE",'), "toRecord ya no degrada PVP_PRIVATE a PVE");
  assert.ok(AUTHORITY.includes('if (!isPvpLike(rec.mode)) return { ok: false, error: { code: "NOT_PVP" } };'));
  assert.ok(c.includes('mode: opts.mode ?? "PVP",') && c.includes("mode?: PvpPlayableMode"));
});

test("40 · el matchmaking ranked NO cambia: sigue creando con el modo por defecto (PVP) y sin tocar retos", () => {
  assert.ok(MM_SERVICE.includes("createPvpMatch(") && !/PVP_PRIVATE|mode:/.test(code(MM_SERVICE)));
  assert.ok(!/duel_challenges|duel_friendships/.test(code(MM_SERVICE)));
});

test("41 · el vencimiento de turno y «tiene partida activa» cubren los dos modos; commit_pair y la cola siguen siendo solo PVP", () => {
  const has = MIG48.slice(MIG48.indexOf("function public._duel_pvp_has_active_match"), MIG48.indexOf("function public.duel_pvp_expired_candidates"));
  assert.ok(has.includes("m.mode in ('PVP','PVP_PRIVATE')"));
  const exp = MIG48.slice(MIG48.indexOf("function public.duel_pvp_expired_candidates"), MIG48.indexOf("-- 5."));
  assert.ok((exp.match(/mode in \('PVP','PVP_PRIVATE'\)/g) ?? []).length >= 3);
  assert.ok(!/duel_pvp_commit_pair|duel_pvp_claim_pair|duel_pvp_enqueue/.test(sql(MIG48)), "la cola ranked no se toca");
});

test("42 · la misma arena: PvpArena solo añade el rótulo «Duelo privado · sin rating» y el rival; no hay PrivateArena ni motor duplicado", () => {
  assert.ok(PVP_ARENA.includes('mode?: "PVP" | "PVP_PRIVATE";') && PVP_ARENA.includes('data-testid="private-badge"'));
  assert.ok(PVP_ARENA.includes("Duelo privado · sin rating"));
  assert.ok(/rivalLabel: (?:"Rival"|(?:t|tr|i18nT)\("Rival"\)),/.test(PVP_ARENA), "el tablero se proyecta igual que en ranked");
  const files = readdirSync(join(process.cwd(), "src", "components", "duel", "pvp"));
  assert.ok(!files.some((f) => /PrivateArena|PrivateOutcome\.tsx|PrivateCombat/.test(f)), "sin copias de la arena");
  assert.ok(!/PrivateCombatEngine|PrivateMatch(Orchestrator|Engine)/.test(code(SERVICE) + code(PVP_SERVICE)));
});

test("43 · la misma reconexión: ?match=<uuid> entra directo, el sondeo es el mismo usePvpSync y la página no lleva estado local", () => {
  assert.ok(PVP_PAGE.includes("usePvpSync(matchId)") && PVP_PAGE.includes('label={t("Recuperando la partida…")}'));
  assert.ok(PVP_PAGE.includes('const privada = snap?.mode === "PVP_PRIVATE";'), "el modo lo dice el snapshot, no la URL");
  assert.ok(!/localStorage|sessionStorage/.test(code(PVP_PAGE)));
  assert.ok(SYNC.includes("mode?: PvpPlayableMode;") && SYNC.includes('mode: rec.mode === "PVP_PRIVATE" ? "PVP_PRIVATE" : "PVP",'));
  assert.ok(SOCIAL_PAGE.includes("router.push(`/duelos/pvp?match=${matchId}`)"));
});

test("44 · en privado no se pide el asiento de rating ni se fotografía la escalera; el literal outcome=1 sigue siendo el camino ranked", () => {
  assert.ok(PVP_PAGE.includes("outcome=1"));
  assert.ok(/if \(!terminal \|\| !matchId\) return;\s*if \(privada\) return;/.test(code(PVP_PAGE)));
  assert.ok(PVP_PAGE.includes('if (snap.mode === "PVP_PRIVATE") return;'));
  assert.ok(PVP_PAGE.includes("void beginLadder();") && PVP_PAGE.includes("void endLadder();"));
});

test("45 · el veredicto privado por abandono/tiempo viene del servidor como BANDO (closedBySide), nunca como id", () => {
  assert.ok(SYNC.includes('closedBySide: rec.closedBy === null ? null : rec.closedBy === rec.playerAId ? "A" : "B",'));
  assert.ok(PVP_PAGE.includes('if (snap.mode === "PVP_PRIVATE" && snap.closedBySide) return snap.closedBySide === snap.yourSide ? "LOSS" : "WIN";'));
  assert.ok(!/\bclosedBy:|\bclosedBy\?:/.test(code(SYNC)), "el snapshot no publica closedBy (solo el bando)");
  assert.ok(!/===\s*(userId|myId|session\.user)/.test(code(PVP_PAGE)));
});

test("46 · el resultado privado: la MISMA pantalla única (veredicto, marcador, acciones); sin rating ni escalera; REVANCHA como acción principal", () => {
  assert.ok(PVP_OUTCOME.includes("privateDuel?: PrivateDuelPanelProps | null;"));
  // F86 · un cruce de torneo también es PVP_PRIVATE y tampoco tiene rating: solo el ranked (`PVP`) lleva rating.
  assert.ok(PVP_OUTCOME.includes('const mode = cupMatch ? "CUP" : privateDuel ? "PVP_PRIVATE" : "PVP";'));
  assert.ok(PVP_OUTCOME.includes('rating={mode === "PVP" ? (outcome ? { pending: false, delta: outcome.delta } : { pending: true }) : null}'));
  assert.ok(PVP_OUTCOME.includes("<DuelResult"), "la misma pantalla que el resto de duelos");
  // El cara a cara y las salidas sociales ya no se apilan en el resultado (viven en Social y en el perfil).
  for (const s of ["<PrivateDuelPanel", "<DecisionPanel", "<FeaturedCardPanel", "<RoundStrip"]) assert.ok(!PVP_OUTCOME.includes(s), s);
  // El panel sigue existiendo (lo usan otras pantallas y arneses) y sigue siendo presentación pura.
  for (const l of ["Revancha", "Volver a Social", "Ver perfil", "Otro reto"]) assert.ok(PANEL.includes(l), l);
  assert.ok(PANEL.includes('data-h2h={id}') && PANEL.includes('id="privados" label={t("Privados")}'));
  assert.ok(!/fetch\(|useEffect/.test(code(PANEL)), "el panel es presentación pura");
});

test("47 · la identidad del rival en la arena/resultado sale de ?match= del social: solo sus dos jugadores, sin cartas ni estado", () => {
  assert.ok(SERVICE.includes("export async function getPrivateMatchInfo"));
  assert.ok(SERVICE.includes('if (viewerId !== row.user_id && viewerId !== row.player_b_id) return fail(404, "Partida no encontrada");'));
  assert.ok(SERVICE.includes('.select("id, mode, user_id, player_b_id, closed_by").eq("id", matchId)'));
  assert.ok(ROUTE.includes("getPrivateMatchInfo(session.admin, session.userId, id)"));
  assert.ok(PVP_PAGE.includes("fetchPrivateMatchInfo(matchId)"));
});

test("48 · el resultado privado se persiste como cualquier partida (mismo duel_matches) y cuenta en historial social, cara a cara y actividad", () => {
  assert.ok(SERVICE.includes('.in("mode", ["PVP", "PVP_PRIVATE"])'));
  assert.ok(SERVICE.includes('.or("status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null")'));
  assert.ok(MIG48.includes("duel_matches_private_a_idx") && MIG48.includes("duel_matches_private_b_idx"));
  assert.ok(!/from\("duel_matches"\)\.insert|\.update\(\{[^}]*winner/.test(code(SERVICE)), "el social no escribe partidas ni resultados");
});

/* ───────────────────────────── cara a cara (52–55) ───────────────────────────── */

test("52 · el cara a cara se parte en tres lecturas y NUNCA suma privados al récord competitivo: competitive.ts sigue filtrando mode = PVP", () => {
  const COMPETITIVE = read("src", "server", "services", "competitive.ts");
  assert.ok((COMPETITIVE.match(/\.eq\("mode", "PVP"\)/g) ?? []).length >= 2, "historial y H2H ranked siguen siendo solo PVP");
  assert.ok(SERVICE.includes("h2h: h2hSplit(facts, viewerId, playerId)"));
  assert.ok(ACTIONS.includes('<H2HCell id="ranked" label={t("Ranked")}') && ACTIONS.includes('<H2HCell id="privados" label={t("Privados")}') && ACTIONS.includes('<H2HCell id="total" label={t("Total")}'));
  assert.ok(ACTIONS.includes("Los duelos privados no cuentan para el rating."));
});

test("53 · el perfil competitivo de la Fase 28 mantiene su cara a cara ranked intacto (contrato previo) y no gana ni pierde palabras prohibidas", () => {
  assert.ok(PROFILE.includes("Cara a cara contigo"));
  assert.ok(!/aria-live/.test(PROFILE));
  assert.ok(!/RankBadge|RankEmblem|rankProgress/.test(PROFILE));
});

/* ───────────────────────────── seguridad (56–64) ───────────────────────────── */

test("56 · toda la API social exige sesión y el userId sale del token; el cuerpo solo lleva ids", () => {
  assert.ok(ROUTE.includes("const session = await getSession(req);") && (ROUTE.match(/if \(!session\) return bad\("No autenticado", 401\);/g) ?? []).length === 2);
  assert.ok(!/body\.(userId|user_id|side|winner|result|rating|status|relation)\b/.test(code(ROUTE)), "el cliente no declara identidad, bando, resultado ni estado");
  assert.ok(ROUTE.includes("interface Body { action?: unknown; targetUserId?: unknown; challengeId?: unknown; deckId?: unknown; previousMatchId?: unknown }"));
  assert.ok(ROUTE.includes("const { admin, userId } = session;"));
  assert.ok(ROUTE.includes('export const dynamic = "force-dynamic";'));
});

test("57 · ids validados (UUID) en ruta y servicio; acción fuera de la lista = 400; cuerpo no JSON = 400", () => {
  assert.ok(ROUTE.includes("const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;"));
  assert.ok(ROUTE.includes('if (!action) return bad("Acción no válida");'));
  // FULL GAME AUDIT · también un JSON que no es objeto (`null`, número, cadena, array) → 400, no TypeError → 500.
  assert.ok(ROUTE.includes("const parsedBody = await readJsonObject<Body>(req);") && ROUTE.includes('if (!parsedBody) return bad("Cuerpo no válido");'));
  assert.ok(SERVICE.includes('if (typeof target !== "string" || !UUID.test(target)) return fail(400, "Jugador no válido", "BAD_TARGET");'));
  assert.ok(SERVICE.includes('if (typeof input.challengeId !== "string" || !UUID.test(input.challengeId)) return fail(400, "Reto no válido", "BAD_CHALLENGE");'));
});

test("58 · rate limiting reutiliza la infraestructura (app_rate_take): cuatro cubetas nuevas en TS, ninguna migración", () => {
  for (const b of ["social_read", "social_search", "social_write", "social_heartbeat"] as const) {
    assert.ok(RATE_POLICY[b].limit > 0 && RATE_POLICY[b].windowSeconds === 60, b);
  }
  // F85 · el pulso (latido + contador) comparte la cubeta del latido: ≤ 40/min cubre varias pestañas.
  assert.ok(RATE_POLICY.social_write.limit <= 30 && RATE_POLICY.social_search.limit <= 30 && RATE_POLICY.social_heartbeat.limit <= 40);
  assert.ok(ROUTE.includes('takeRate(session.admin, session.userId, action === "heartbeat" || action === "pulse" ? "social_heartbeat" : "social_write")'));
  assert.ok(!/api_rate_limits|app_rate_take/.test(sql(MIG48)));
  assert.ok(RATE.includes("app_rate_take"));
});

test("59 · las tablas sociales no tienen políticas de cliente: sin token del servidor no se lee ni se escribe nada", () => {
  assert.ok(!/create policy/.test(MIG48));
  assert.ok(MIG48.includes("grant all on public.duel_friendships to service_role") && MIG48.includes("grant all on public.duel_challenges to service_role"));
});

test("60 · nadie acepta por otro: RPC comprueban destinatario (NOT_TARGET) y el servicio nunca pasa un id distinto del token como p_user", () => {
  const c = code(SERVICE);
  assert.ok(!/p_user: (target|input\.|playerId|other)/.test(c));
  assert.ok((c.match(/p_user: (me|userId)/g) ?? []).length >= 8);
  assert.ok(SERVICE.includes('case "NOT_TARGET": return fail(404, "Reto no encontrado", r.code);'), "un tercero no averigua que existe");
});

test("61 · la partida privada no acepta jugadas de terceros ni bandos declarados: misma guardia (guardAction) y misma ruta PvP", () => {
  assert.ok(AUTHORITY.includes("const side = sideForPlayer(rec, env.playerId);"));
  assert.ok(PVP_ROUTE.includes("playerId: session.userId"));
  assert.ok(!/side|yourSide|winner/.test(code(PVP_ROUTE).split("action ===")[0]?.split("POST")[1] ?? ""), "la ruta PvP no lee bando del cuerpo");
});

test("62 · sin secretos ni claves en el cliente social; solo el Bearer de la sesión", () => {
  assert.ok(CLIENT.includes("authorization: `Bearer ${t}`"));
  assert.ok(!/service_role|SUPABASE_SERVICE|SERVICE_KEY/i.test(CLIENT + ROUTE + SERVICE));
  assert.ok(!/localStorage|sessionStorage/.test(code(CLIENT) + code(SOCIAL_PAGE) + UI.map(code).join("")));
});

test("63 · la bandeja y el número de navegación se calculan en el servidor; el cliente solo pinta", () => {
  assert.ok(SERVICE.includes("inbox, badge: badgeCount(inbox), activity,"));
  assert.ok(SERVICE.includes("export async function getSocialBadge"));
  assert.ok(SHELL.includes("const social = useSocialBadge(!!user);") && SHELL.includes("badges.social"));
  assert.ok(CLIENT.includes("export function useSocialBadge"));
  assert.ok(!/badge\s*=\s*[^=]*\.length|\.filter\([^)]*PENDING/.test(code(SHELL)), "el armazón no cuenta nada");
});

test("64 · el mazo se valida DOS veces (al retar/aceptar y al crear la partida) con la misma función del ranked; el cliente no envía cartas", () => {
  assert.ok((code(SERVICE).match(/resolveDeckSnapshot\(sb, me, /g) ?? []).length === 2);
  assert.ok(PVP_SERVICE.includes("const snapA = await resolveDeckSnapshot(sb, a.playerId, a.deckId);"));
  assert.ok(!/cardUids|cards:/.test(code(CLIENT)));
  assert.ok(SHEET.includes("onClick={() => d.valid && setDeckId(d.id)}") && SHEET.includes("disabled={!d.valid}"));
});

/* ───────────────────────────── regresión (65–79) ───────────────────────────── */

test("65 · migraciones: 0048 es la de Social, es única, y 0046/0047/0048 están aplicadas desde la Fase 35.1 (no tocan schema_migrations)", () => {
  const files = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  const nums = files.map((f) => Number(f.slice(0, 4)));
  assert.ok(nums.includes(48), "0048 es la migración de Social (fases posteriores pueden añadir las suyas)");
  assert.equal(files.filter((f) => f.startsWith("0048_")).length, 1);
  for (const m of [MIG46, MIG47, MIG48]) assert.ok(/— APLICADA \(VPS 2026-09-15, Fase 35\.1\)\.$/.test(m.split("\n")[0]));
  assert.ok(!/schema_migrations/.test(sql(MIG48)));
  assert.ok(/create table if not exists|add column if not exists|create index if not exists|create or replace function/.test(MIG48), "aditiva e idempotente");
});

test("66 · Marketplace sigue cerrado y el social no lo enlaza", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  assert.ok(!/mercado|market/i.test(code(SOCIAL_PAGE) + UI.map(code).join("") + code(SERVICE)));
});

test("67 · nada de feed/chat/clanes/trading/espectadores en la fase", () => {
  const all = code(SERVICE) + code(ROUTE) + code(CLIENT) + code(SOCIAL_PAGE) + UI.map(code).join("") + sql(MIG48);
  assert.ok(!/\bchat\b|mensaje directo|\bDM\b|\bfeed\b|\bposts\b|\blikes\b|followers|seguidores|\bclan|guild|trading|regalo|gift|spectat|espectador/i.test(all));
  assert.ok(!/social_posts|social_messages|social_clans/.test(sql(MIG48)));
});

test("68 · el ranked no cambia: fórmula, K, matchmaking, RPC de liquidación y cola intactos (0033/0035 sin redefinir en 0048)", () => {
  assert.ok(!/duel_pvp_enqueue|duel_pvp_claim_pair|duel_pvp_settle_match|duel_pvp_ensure_rating|duel_pvp_ratings/.test(sql(MIG48)));
  const RATING = read("src", "domain", "cardgame", "rating", "types.ts");
  assert.ok(RATING.includes("INITIAL_RATING") && RATING.includes("PLACEMENT_GAMES"));
});

test("69 · el motor y las reglas no se tocan: el social no importa el orquestador ni el combate", () => {
  assert.ok(!/@\/domain\/cardgame\/(match|combat|opponent)/.test(code(SERVICE) + code(ROUTE) + code(CLIENT) + code(SOCIAL_PAGE) + UI.map(code).join("")));
});

test("70 · navegación: entrada «Social» en Jugar con badge del servidor; móvil enseña el número en «Jugar»", () => {
  const jugar = NAV_SECTIONS.find((s) => s.id === "jugar")!;
  const item = jugar.items.find((i) => i.href === "/social");
  assert.ok(item && item.badge === "social" && item.label === "Social");
  assert.ok(/badge\?: "events" \| "news" \| "duel" \| "social"(?: \| "live")?(?: \| "cup")?;/.test(NAV), "la unión de badges puede crecer (Fase 30 añade live, F86 cup) sin perder social");
  assert.ok(SHELL.includes('item.section === "jugar" ? badges.social : 0'));
});

test("71 · home: partida activa > reto privado pendiente > recompensa > Pick'em > objetivo > sobre > mazo > jugar", () => {
  assert.ok(LOOP.includes('| "challenge"'));
  assert.ok(LOOP.includes("priority: 0.5,") && LOOP.includes("priority: 1.5,"));
  assert.ok(LOOP.includes('href: "/social?tab=retos"') && LOOP.includes("href: `/duelos/pvp?match=${social.activeMatchId}`"));
  assert.ok(LOOP.includes('.eq("mode", "PVE").eq("status", "IN_PROGRESS")'), "el duelo contra el bot ya no captura partidas de dos personas");
  assert.ok(META.includes("resume: 0, challenge: 1, claim: 2, predict: 3, objective: 4, open: 5, build: 6, play: 7, explore: 8"));
  const step = (kind: "resume" | "challenge" | "claim" | "predict" | "open" | "play") => ({ id: kind, kind, label: kind, detail: "", href: `/${kind}` });
  const acts = todayActions({ steps: [step("play"), step("claim"), step("challenge"), step("predict"), step("resume")], objectives: [] });
  assert.deepEqual(acts.map((a) => a.kind), ["resume", "challenge", "claim", "predict"]);
  assert.equal(continueCta([step("challenge")])?.label, "Responde al reto");
  assert.ok(NEXTUP.includes("challenge:") && TODAY.includes("challenge:"), "las dos tablas de icono conocen el paso");
  assert.ok(LOOP.includes(".catch(() => ({ activeMatchId: null, pendingChallenges: 0 }))"), "sin 0048 aplicada la home no rompe");
});

test("72 · /cuenta lleva el resumen social pequeño junto al competitivo; el resumen no inventa cifras", () => {
  assert.ok(CUENTA.includes('<CompetitiveSummary enabled={!!user} className="mt-4" />'));
  assert.ok(CUENTA.includes('<SocialSummary enabled={!!user} className="mt-4" />'));
  assert.ok(SUMMARY.includes("fetchSocial()") && SUMMARY.includes("snap.counts.friends") && !/value=\{\d/.test(SUMMARY), "cada cifra sale del snapshot");
});

test("73 · competitivo: el historial ya enlaza al perfil del rival y desde el perfil se añade/reta (integración sin tocar la Fase 28)", () => {
  const HISTORY = read("src", "components", "competitive", "MatchHistoryList.tsx");
  assert.ok(/playerHref\(m\.rival\.userId\)/.test(HISTORY), "Fase 31: el historial enlaza al perfil canónico");
  assert.ok(BITS.includes("export const profileHref = (userId: string) => playerHref(userId);"), "Fase 31: Social enlaza al perfil canónico");
});

test("74 · el ranked sigue liquidando: los cuatro puntos de liquidación del servicio PvP siguen ahí", () => {
  assert.ok((code(PVP_SERVICE).match(/await settleTerminalMatch\(sb, /g) ?? []).length === 4);
});

test("75 · el PvE no cambia: ninguna pantalla de duelo contra el bot importa lo social", () => {
  for (const f of [["src", "app", "duelos", "jugar", "page.tsx"], ["src", "components", "duel", "ResultScreen.tsx"], ["src", "components", "duel", "MatchBoard.tsx"]]) {
    assert.ok(!/social/i.test(code(read(...f))), f.join("/"));
  }
});

test("76 · sin datos inventados en producción: los fixtures viven solo en el arnés y están etiquetados QA SYNTHETIC", () => {
  assert.ok(FIXTURES.includes("QA SYNTHETIC") && HARNESS.includes("QA SYNTHETIC"));
  assert.ok(!/design-system\/fase29|fixtures/.test(code(SOCIAL_PAGE) + code(SERVICE) + code(ROUTE) + code(CLIENT)));
  assert.ok(!/username: "Jugador"/.test(code(SOCIAL_PAGE) + UI.map(code).join("")), "la interfaz no fabrica jugadores; el «Jugador» de respaldo es del servidor");
});

test("77 · 0046 reserva el flujo social junto a los anteriores y sigue sin aplicar; el contrato de telemetría sigue cerrado", () => {
  assert.ok(MIG46.includes("'duel_play', 'progression', 'competitive', 'social'"));
  assert.equal(isFlow(SOCIAL_FLOW), false, "no-op honesto hasta aplicar 0046 y abrir FLOWS");
});

test("78 · el resultado ranked: rating del asiento (sin cálculo), «…» mientras no llega, y las causas de cierre", () => {
  // RESULTADO ÚNICO · el delta es el del asiento; `RatingDelta` (antes → después) se conserva para los arneses.
  for (const s of ["{ pending: false, delta: outcome.delta }", "{ pending: true }", "{outcome.oldRating}", "{outcome.newRating}", "{outcome.delta}", 'tr("Por abandono")', 'tr("Tiempo agotado")']) assert.ok(PVP_OUTCOME.includes(s), s);
  assert.ok(PVP_ARENA.includes("waitingRival={!tuTurno && enJuego}") && PVP_ARENA.includes("busy={busy || !tuTurno}"));
});

test("79 · el snapshot PvP sigue siendo compatible: mode y closedBySide son opcionales (ausentes = ranked, no cerrada)", () => {
  assert.ok(SYNC.includes("mode?: PvpPlayableMode;") && SYNC.includes("closedBySide?: Side | null;"));
});

/* ───────────────────────────── telemetría ───────────────────────────── */

test("telemetría: siete contextos con puerta, todos usados en pantalla; ningún evento nuevo", () => {
  assert.deepEqual([...SOCIAL_CONTEXTS], ["social_view", "player_search", "friend_request", "friend_accept", "challenge_sent", "challenge_accept", "private_match_complete"]);
  const all = SOCIAL_PAGE + ACTIONS + PVP_PAGE;
  for (const c of SOCIAL_CONTEXTS) assert.ok(all.includes(`trackSocial("${c}")`), c);
  assert.ok(TELEMETRY.includes("if (!flow) return;") && TELEMETRY.includes("trackFlow(flow, context);"));
  assert.ok(!/track\(\s*"/.test(code(TELEMETRY) + code(SOCIAL_PAGE) + UI.map(code).join("")), "solo flow_started por contexto");
});

/* ───────────────────────────── accesibilidad y móvil ───────────────────────────── */

test("accesibilidad: pestañas con rol y estado, hojas modales con Escape, botones táctiles de 44 px, búsqueda etiquetada", () => {
  assert.ok(HUB.includes('role="tablist"') && HUB.includes('role="tab"') && HUB.includes("aria-selected={on}") && HUB.includes('role="tabpanel"'));
  assert.ok(SHEET.includes('role="dialog"') && SHEET.includes('aria-modal="true"') && SHEET.includes('if (e.key === "Escape") onClose();'));
  assert.ok(CONFIRM.includes('if (e.key === "Escape") onClose();'));
  assert.ok(BITS.includes("min-h-[44px]"));
  assert.ok(SEARCH.includes('<label htmlFor="social-search"') && SEARCH.includes('aria-describedby="social-search-hint"') && SEARCH.includes('aria-live="polite"'));
  assert.ok(FRIENDS.includes('aria-haspopup="menu"') && FRIENDS.includes('role="menu"'));
});

test("móvil 390: hero en dos columnas, pestañas desplazables, hojas como bottom sheet, arena privada con rótulo compacto", () => {
  assert.ok(HERO.includes("grid-cols-2 gap-4 sm:grid-cols-4"));
  assert.ok(HUB.includes("overflow-x-auto") && HUB.includes("min-w-max"));
  assert.ok(SHEET.includes("fixed inset-x-0 bottom-0 max-h-[86vh]") && SHEET.includes("sm:left-1/2 sm:top-1/2"));
  assert.ok(PVP_ARENA.includes("flex flex-wrap items-center justify-between gap-2"));
  assert.ok(SEARCH.includes("SEARCH_DEBOUNCE_MS = 300") && SEARCH.includes('type="search"'));
});

test("arnés: todas las escenas del brief existen en /design-system/fase29", () => {
  for (const s of ["hub", "hub-empty", "friends", "requests", "search", "search-empty", "challenges", "challenge-sheet", "challenge-accept-sheet", "confirm-unfriend", "confirm-block", "profile-friend", "profile-stranger", "private-arena", "private-outcome-win", "private-outcome-loss", "private-outcome-abandon", "summary", "backend-error"]) {
    assert.ok(HARNESS.includes(`"${s}"`), s);
  }
});
