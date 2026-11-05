/**
 * F85 · SOCIAL 2.0 — dominio puro y espejo con la SQL de 0066: relación con bloqueos por dirección, presencia de
 * servidor, límites (amigos, solicitudes, retos por pareja), TTL de 5 min, cuenta atrás, búsqueda sin comodines.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  relationFor, actionsFor, presenceOf, normalizeQuery, likePrefix, effectiveStatus, FRIENDS_LIMIT, OUTGOING_PENDING_LIMIT, CHALLENGE_PAIR_PER_HOUR,
  CHALLENGE_TTL_SECONDS, HEARTBEAT_MS, HEARTBEAT_WRITE_MIN_MS, PRESENCE_WINDOWS, SEARCH_MAX_OFFSET, PRESENCE_LABEL, OUTGOING_POLL_MS, type FriendshipRow,
} from "./social";
import { remainingText } from "@/components/social/bits";

const MIG66 = readFileSync(join(process.cwd(), "supabase", "migrations", "0066_social_2.sql"), "utf8");
const A = "a", B = "b";
const row = (o: Partial<FriendshipRow> = {}): FriendshipRow => ({ userLo: A, userHi: B, requesterId: A, status: "ACCEPTED", blockedBy: null, createdAt: 0, respondedAt: 0, ...o });

test("D1 · un bloqueo (en cualquier sentido) manda sobre la amistad y apaga toda interacción", () => {
  assert.equal(relationFor(row(), A, B), "FRIENDS");
  assert.equal(relationFor(row(), A, B, { byMe: true, byThem: false }), "BLOCKED_BY_ME");
  assert.equal(relationFor(row(), A, B, { byMe: false, byThem: true }), "BLOCKED_ME");
  assert.equal(relationFor(null, A, B, { byMe: true, byThem: true }), "BLOCKED_BY_ME", "bloqueo mutuo: me ve como bloqueado por mí (puedo desbloquear el mío)");
  const off = actionsFor("BLOCKED_ME");
  assert.ok(!off.add && !off.challenge && !off.accept && !off.block && !off.unblock, "al bloqueado no se le ofrece nada");
  assert.ok(actionsFor("BLOCKED_BY_ME").unblock && !actionsFor("BLOCKED_BY_ME").challenge);
  assert.equal(relationFor(null, A, A), "SELF");
});

test("D2 · presencia: cuatro estados con palabra; EN PARTIDA sin latido; EN COLA solo con latido; TTL 2 min", () => {
  assert.deepEqual(Object.keys(PRESENCE_LABEL).sort(), ["IN_MATCH", "IN_QUEUE", "OFFLINE", "ONLINE"]);
  assert.equal(presenceOf(null, 1e6, { inMatch: true }), "IN_MATCH");
  assert.equal(presenceOf(1e6 - 1000, 1e6, { inQueue: true }), "IN_QUEUE");
  assert.equal(presenceOf(1e6 - PRESENCE_WINDOWS.onlineMs, 1e6, { inQueue: true }), "OFFLINE");
  assert.ok(HEARTBEAT_MS < PRESENCE_WINDOWS.onlineMs / 2, "dos latidos caben en el TTL: una pestaña viva no parpadea");
  assert.ok(HEARTBEAT_WRITE_MIN_MS + HEARTBEAT_MS < PRESENCE_WINDOWS.onlineMs, "el latido más viejo de una pestaña viva (umbral + pulso) cabe en el TTL");
  assert.ok(HEARTBEAT_WRITE_MIN_MS >= 2 * HEARTBEAT_MS, "el pulso lee cada 20 s pero escribe como mucho cada 40 s: sin escrituras por segundo");
});

test("D3 · límites del dominio = los de la BD (0066): 300 amigos, 50 salientes, 10 retos/pareja/hora; reto de 5 min", () => {
  assert.equal(FRIENDS_LIMIT, 300); assert.equal(OUTGOING_PENDING_LIMIT, 50); assert.equal(CHALLENGE_PAIR_PER_HOUR, 10); assert.equal(CHALLENGE_TTL_SECONDS, 300);
  assert.equal((MIG66.match(/>= 300/g) ?? []).length >= 4, true, "el tope de amigos se comprueba en solicitar, cruzar y aceptar");
  assert.ok(MIG66.includes(">= 50 then") && MIG66.includes("interval '1 hour') >= 10"));
  assert.ok(MIG66.includes("duel_challenges_pending_pair_uniq") && MIG66.includes("least(challenger_id, challenged_id), greatest(challenger_id, challenged_id)) where status = 'PENDING'"), "un reto pendiente por PAREJA");
  assert.ok(MIG66.includes("constraint social_blocks_not_self check (blocker_id <> blocked_id)"), "bloquearse a uno mismo es imposible en BD");
});

test("D4 · el reto caduca por la hora del servidor (exacta incluida) y la cuenta atrás es m:ss", () => {
  assert.equal(effectiveStatus({ status: "PENDING", expiresAt: 1000 }, 999), "PENDING");
  assert.equal(effectiveStatus({ status: "PENDING", expiresAt: 1000 }, 1000), "EXPIRED");
  assert.equal(remainingText(1_000 + 299_000, 1_000), "Caduca en 4:59");
  assert.equal(remainingText(1_000 + 5_000, 1_000), "Caduca en 0:05");
  assert.equal(remainingText(1_000, 1_000), "Caducado");
});

test("D5 · búsqueda: sin comodines ni separadores de PostgREST, sin correo, mínimo 2, como mucho 32 y 5 páginas", () => {
  assert.equal(normalizeQuery("  Ka%el,(i)s*  "), "kaelis");
  assert.equal(normalizeQuery("QA_Camp"), "qa_camp", "el guion bajo de los nombres se conserva");
  assert.equal(likePrefix("qa_camp"), "qa\\_camp%", "y en el patrón va escapado: literal, no comodín de un carácter");
  assert.equal(normalizeQuery("a@b.com"), null);
  assert.equal(normalizeQuery("k"), null);
  assert.equal(normalizeQuery("x".repeat(80))?.length, 32);
  assert.equal(normalizeQuery("Ñandú"), "ñandú", "acentos y eñes se conservan (comparación sin mayúsculas en BD)");
  assert.equal(SEARCH_MAX_OFFSET, 40);
});

test("D6 · aceptar un reto re-comprueba TODO en BD bajo cerrojo: amistad, bloqueo, partida activa, cola y caducidad", () => {
  const fn = MIG66.slice(MIG66.indexOf("create or replace function public.social_challenge_respond"));
  for (const k of ["_social_lock_pair(c.challenger_id, c.challenged_id)", "for update", "c.expires_at <= now()", "_social_blocked(c.challenger_id, c.challenged_id)", "x.status = 'ACCEPTED'", "_duel_pvp_has_active_match(p_user)", "_social_in_queue(p_user)"]) {
    assert.ok(fn.includes(k), k);
  }
  assert.ok(fn.indexOf("_social_lock_pair") < fn.indexOf("for update"), "orden de cerrojos fijo: pareja → fila (igual que dejar de ser amigos / bloquear)");
  const unf = MIG66.slice(MIG66.indexOf("create or replace function public.social_unfriend"), MIG66.indexOf("create or replace function public.social_block"));
  assert.ok(unf.includes("set status = 'CANCELLED'"), "dejar de ser amigos cancela el reto pendiente");
});

test("D9 · reserva: un reto aceptado cuya partida está naciendo cuenta como ocupado (nunca dos partidas amistosas)", () => {
  assert.ok(MIG66.includes("create or replace function public._social_reserved(p_user uuid)"));
  assert.ok(MIG66.includes("c.status = 'ACCEPTED'") && MIG66.includes("c.responded_at > now() - interval '2 minutes'"), "reserva acotada a 2 min por la hora de la BD");
  assert.ok((MIG66.match(/public\._social_reserved\(/g) ?? []).length >= 5, "crear y aceptar comprueban la reserva de los dos jugadores");
  assert.ok(MIG66.includes("not exists (select 1 from public.duel_matches m where m.id = c.match_id)"), "la caducidad perezosa cancela reservas huérfanas");
  assert.ok(OUTGOING_POLL_MS >= 5_000 && OUTGOING_POLL_MS < HEARTBEAT_MS, "esperando respuesta se relee más rápido, sin bajar de 5 s");
});

test("D10 · aceptar desde el aviso: equipo activo legal o el ÚNICO legal; con varios y sin activo, la hoja (sin elegir por el jugador)", () => {
  const live = readFileSync(join(process.cwd(), "src", "components", "social", "SocialLive.tsx"), "utf8");
  assert.ok(live.includes("valid.find((x) => x.id === d.activeDeckId) ?? (valid.length === 1 ? valid[0] : null)"));
  assert.ok(live.includes("router.push(`/social?tab=retos&aceptar=${c.id}`)"), "si hay que elegir, la hoja de aceptar se abre sola en Social");
});

test("D11 · el enlace `?aceptar=` no se da por hecho hasta que la foto trae el reto (con el hub abierto la foto es anterior)", () => {
  const page = readFileSync(join(process.cwd(), "src", "app", "social", "page.tsx"), "utf8");
  const effect = page.slice(page.indexOf('const deepAccept = params.get("aceptar")'), page.indexOf("const onMoreFriends"));
  assert.ok(effect.length > 0);
  const found = effect.indexOf("if (!c)"), done = effect.indexOf("deepDone.current = deepAccept;");
  assert.ok(found > 0 && done > found, "se marca como hecho DESPUÉS de encontrar el reto en la foto");
  assert.ok(effect.includes("void load();"), "si la foto no lo trae, se relee una vez");
  assert.ok(effect.includes("handlers.onAcceptChallenge(c)"));
});
