/**
 * 0068 · TAG PÚBLICO DE CUENTA — dominio (formato, normalización, capacidad), búsqueda F85 por #TAG exacto, tarjeta del
 * perfil (tag bajo el nombre, copiable, accesible) y contratos sobre la migración (registro sin reutilización, inmutable,
 * generado por la BD). La atomicidad real (UNIQUE, 100 altas concurrentes, colisión forzada, agotamiento, 100.000 tags,
 * borrado sin reutilización, rollback) se prueba sobre Postgres en `scripts/ops/_tag-dryrun.sh`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TAG_ALPHABET, TAG_LENGTH, TAG_PATTERN, normalizeTag, looksLikeTagQuery, formatTag, tagAriaLabel, tagSpace } from "./tag";
import { MemorySupabase } from "@/server/services/testing/memorySupabase";
import { searchPlayers } from "@/server/services/social";
import { ProfileIdentityCard } from "@/components/player/ProfileIdentityCard";
import { OWN_FULL, PUBLIC_FULL } from "@/app/design-system/fase89/fixtures";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const MIG = read("supabase", "migrations", "0068_public_account_tag.sql");

test("TAG-1 · alfabeto de 31 sin ambiguos (ni 0/O ni 1/I/L), 7 símbolos, el mismo patrón que el CHECK de la BD", () => {
  assert.equal(TAG_ALPHABET.length, 31);
  assert.equal(new Set(TAG_ALPHABET).size, 31);
  for (const c of "01OIL") assert.ok(!TAG_ALPHABET.includes(c), c);
  assert.equal(TAG_LENGTH, 7);
  assert.ok(MIG.includes("'^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$'") && MIG.includes("alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'"), "SQL y dominio comparten alfabeto y longitud");
  assert.equal(TAG_PATTERN.source, "^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$");
});

test("TAG-2 · normalización: «#» opcional, minúsculas → MAYÚSCULAS; inválidos (corto, largo, ambiguos, otros símbolos) → null", () => {
  assert.equal(normalizeTag("#7k4m92x"), "7K4M92X");
  assert.equal(normalizeTag("  7K4M92X "), "7K4M92X");
  for (const bad of ["#7K4M92", "#7K4M92XX", "#7K4M92O", "#7K4M921", "#7K4M92I", "#7K4M92L", "#7K4-92X", "##7K4M92X", "", null, 42, "#7K4M92 X"]) assert.equal(normalizeTag(bad), null, String(bad));
  assert.equal(formatTag("7K4M92X"), "#7K4M92X");
  assert.equal(tagAriaLabel("7K4M92X"), "Identificador de cuenta #7K4M92X");
  assert.ok(looksLikeTagQuery(" #abc") && !looksLikeTagQuery("abc") && !looksLikeTagQuery(null));
});

test("TAG-3 · capacidad: 31^7 = 27.512.614.111; a 10 M de cuentas, 1 de cada ~2.751 tags al azar es real y fallar 10 intentos seguidos es despreciable", () => {
  const s10m = tagSpace(10_000_000);
  assert.equal(s10m.size, 27_512_614_111);
  assert.ok(s10m.bits > 34.6 && s10m.bits < 34.8);
  assert.ok(Math.round(s10m.oneIn) === 2751);
  assert.ok(s10m.failWith10 < 1e-30);
  const six = tagSpace(10_000_000, 6);
  assert.ok(Math.round(six.oneIn) === 89, "con 6 símbolos, 1 de cada 89: por eso son 7");
  assert.ok(tagSpace(100_000).birthdayNoRetry > 0.1, "sin reintento SÍ habría choques a 100.000: el registro con reintento es imprescindible");
});

/* ───────────── búsqueda F85 por #TAG ───────────── */

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = id(1), OTHER = id(2), BLOCKER = id(3), BANNED = id(4);
function world() {
  const db = new MemorySupabase();
  db.tables.profiles = [
    { id: ME, username: "yo", avatar: "🎮", last_seen_at: iso(NOW), email: "yo@example.com", public_tag: "MEMEME2" },
    { id: OTHER, username: "kaelis", avatar: "🦊", last_seen_at: iso(NOW), email: "k@example.com", public_tag: "K7M2QXA" },
    { id: BLOCKER, username: "bloquea", avatar: "🐍", last_seen_at: iso(NOW), email: "b@example.com", public_tag: "B7CK3RS" },
    { id: BANNED, username: "sancion", avatar: "🦂", last_seen_at: iso(NOW), email: "s@example.com", public_tag: "BNN9DDD" },
  ];
  db.tables.duel_friendships = []; db.tables.duel_challenges = []; db.tables.duel_matches = []; db.tables.duel_pvp_queue = []; db.tables.duel_pvp_ratings = [];
  db.tables.social_blocks = [{ blocker_id: BLOCKER, blocked_id: ME, created_at: iso(NOW) }];
  db.tables.user_sanctions = [{ user_id: BANNED, type: "ban", expires_at: null, revoked_at: null }];
  db.tables.competitive_seasons = []; db.tables.competitive_season_players = []; db.tables.player_profile_customization = [];
  return db;
}

test("TAG-4 · F85: «#TAG» devuelve EXACTAMENTE esa cuenta (minúsculas normalizadas), con su tag y sin correo", async () => {
  const r = (await searchPlayers(world().client, ME, "#k7m2qxa", { now: NOW })).data!;
  assert.equal(r.query, "#K7M2QXA");
  assert.deepEqual(r.players.map((p) => [p.username, p.tag]), [["kaelis", "K7M2QXA"]]);
  assert.equal(r.hasMore, false);
  assert.ok(!JSON.stringify(r).includes("@example.com"), "nunca el correo");
  assert.ok(!/registry|assigned_at|is_admin|credits/.test(JSON.stringify(r)), "nada interno ni privado");
});

test("TAG-5 · F85: sin difuso ni prefijo; tag inválido → 400; tag sin cuenta → vacío; el propio, quien me bloqueó y sancionados no salen", async () => {
  assert.equal((await searchPlayers(world().client, ME, "#K7M2", { now: NOW })).status, 400, "un trozo de tag no busca por prefijo");
  assert.equal((await searchPlayers(world().client, ME, "#K7M2QX0", { now: NOW })).status, 400, "con un símbolo ambiguo no es un tag");
  assert.deepEqual((await searchPlayers(world().client, ME, "#ZZZZZZZ", { now: NOW })).data!.players, []);
  assert.deepEqual((await searchPlayers(world().client, ME, "#MEMEME2", { now: NOW })).data!.players, [], "el propio buscador no se encuentra a sí mismo");
  assert.deepEqual((await searchPlayers(world().client, ME, "#B7CK3RS", { now: NOW })).data!.players, [], "quien me bloqueó: indistinguible de un tag sin cuenta");
  assert.deepEqual((await searchPlayers(world().client, ME, "#BNN9DDD", { now: NOW })).data!.players, [], "una cuenta sancionada no aparece");
  // La búsqueda por NOMBRE sigue igual (y ahora trae también el tag).
  assert.deepEqual((await searchPlayers(world().client, ME, "kae", { now: NOW })).data!.players.map((p) => p.tag), ["K7M2QXA"]);
});

/* ───────────── tarjeta del perfil ───────────── */

test("TAG-6 · perfil propio y ajeno: #TAG bajo el nombre, botón copiable accesible; sin tag no se pinta nada; el perfil sigue simple", () => {
  const own = renderToStaticMarkup(<ProfileIdentityCard snap={{ ...OWN_FULL, player: { ...OWN_FULL.player, tag: "7K4M92X" } }} owner={{ onEdit: () => {}, onSignOut: () => {} }} />);
  const pub = renderToStaticMarkup(<ProfileIdentityCard snap={{ ...PUBLIC_FULL, player: { ...PUBLIC_FULL.player, tag: "K7M2QXA" } }} />);
  for (const [h, tag] of [[own, "7K4M92X"], [pub, "K7M2QXA"]] as const) {
    assert.ok(h.includes(`data-testid="account-tag" data-tag="${tag}"`) && h.includes(`#${tag}`));
    assert.ok(h.includes(`aria-label="Identificador de cuenta #${tag}. Pulsa para copiarlo"`) && /<button[^>]*data-testid="account-tag"/.test(h), "botón (teclado) con nombre accesible");
    assert.ok(h.includes('role="status"'), "el «Tag copiado» se anuncia");
    assert.ok(h.indexOf('data-field="player-name"') < h.indexOf('data-testid="account-tag"'), "debajo del nombre");
    assert.ok(!/Nivel de cuenta|Partidas|Victorias|Temporada actual|Colecci[oó]n(?!es)|Insignias|Cartas destacadas/.test(h.replace(/<[^>]+>/g, " ")), "el perfil sigue siendo identidad");
  }
  const none = renderToStaticMarkup(<ProfileIdentityCard snap={{ ...PUBLIC_FULL, player: { ...PUBLIC_FULL.player, tag: null } }} />);
  assert.ok(!none.includes('data-testid="account-tag"'));
  const chip = read("src", "components", "player", "AccountTag.tsx");
  assert.ok(chip.includes("navigator.clipboard.writeText(label)") && chip.includes('"Tag copiado"') && chip.includes("font-mono"));
});

/* ───────────── contratos de la migración ───────────── */

test("TAG-7 · 0068: registro sin FK (borrar no libera), append-only, generación EN LA BD sin sesgo, reintento acotado, inmutable para cualquier rol", () => {
  const reg = MIG.slice(MIG.indexOf("create table if not exists public.account_tag_registry"), MIG.indexOf("comment on table public.account_tag_registry"));
  assert.ok(!/references/i.test(reg), "sin clave foránea: el tag sobrevive al borrado de la cuenta");
  assert.ok(reg.includes("tag         text primary key") && reg.includes("unique (user_id)"));
  assert.ok(MIG.includes("before update or delete on public.account_tag_registry") && MIG.includes("ACCOUNT_TAG_REGISTRY_APPEND_ONLY"));
  assert.ok(MIG.includes("revoke all on public.account_tag_registry from public, anon, authenticated;"));
  assert.ok(MIG.includes("extensions.gen_random_bytes(16)") && MIG.includes("if v < 248"), "pgcrypto + muestreo por rechazo (248 = 31·8)");
  assert.ok(MIG.includes("if attempt > 10 then raise exception 'ACCOUNT_TAG_EXHAUSTED'"), "agotamiento acotado: nunca un bucle infinito");
  assert.ok(MIG.includes("new.public_tag := public._account_tag_claim(new.id);"), "el alta NUNCA acepta un tag del cliente");
  assert.ok(MIG.includes("raise exception 'ACCOUNT_TAG_IMMUTABLE") && MIG.includes("before update on public.profiles"), "inmutable para cualquier rol");
  assert.ok(MIG.includes("alter table public.profiles disable trigger profiles_touch;") && MIG.includes("alter table public.profiles enable trigger profiles_touch;"), "el backfill no mueve updated_at");
  assert.ok(MIG.includes("where p.public_tag is null") && MIG.includes("alter column public_tag set not null"), "backfill idempotente y NOT NULL después");
  assert.ok(MIG.includes("'target_tag', v_tag"), "la auditoría de admins guarda el tag como instantánea humana");
  // Ninguna ruta del cliente puede escribir el tag: ni el perfil ni el registro aparecen en mutaciones del servidor.
  const svc = read("src", "server", "services", "playerIdentity.ts");
  assert.ok(!/update\(\{[^}]*public_tag/.test(svc) && !/insert\([^)]*public_tag/.test(svc));
});
