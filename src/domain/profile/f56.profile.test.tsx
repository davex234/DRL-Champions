/**
 * FASE 56 · PERFIL DE JUGADOR 4.0 — dominio, privacidad, seguridad (contratos sobre el código real) y render.
 *
 * Complementa `identity.test.ts` y `profile.contract.test.ts` (Fase 31): aquí lo nuevo —competitivo de la Fase 55 en
 * el perfil, temporada, logros recientes, nombre seguro, enlaces desde competitivo— y una batería de privacidad
 * que serializa la foto PÚBLICA y busca cualquier campo privado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { rankedRecap } from "@/domain/season/recap";
import { publicName, standingOf, seasonOf, resolveShowcase, type CardLookup } from "./identity";
import { PlayerIdentityView } from "@/components/player/PlayerIdentityView";
import { RecentMatchCards } from "@/components/competitive/ranked/RecentMatchCards";
import { PvpOutcome } from "@/components/duel/pvp/PvpOutcome";
import { OWN, OTHER, RANKED_PLAYER, PLACEMENT_PLAYER, NO_RANKED, RECENT_ACHIEVEMENTS, LONG_NAME, EMPTY, ANON, EMAIL_NAME, SELF_ID, RIVAL_ID } from "@/app/design-system/fase56/fixtures";
import { HISTORY } from "@/app/design-system/fase55/fixtures";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const noop = () => {};

const SERVICE = read("src", "server", "services", "playerIdentity.ts");
const ROUTE = read("src", "app", "api", "game", "player", "route.ts");
const COMPETITIVE = read("src", "server", "services", "competitive.ts");

/* ═══════════════════ identidad ═══════════════════ */

test("I1 · nombre público: el de BD; vacío o con forma de correo → «Jugador NEXUS · XXXX» del id PÚBLICO", () => {
  assert.equal(publicName("kaelis", RIVAL_ID), "kaelis");
  assert.equal(publicName("  ", RIVAL_ID), "Jugador NEXUS · 0000");
  assert.equal(publicName(null, "abcdef12-0000-4000-8000-000000000000"), "Jugador NEXUS · ABCD");
  assert.ok(!publicName("alguien@example.com", RIVAL_ID).includes("@"), "nunca un correo como nombre");
  assert.equal(publicName("x".repeat(80), RIVAL_ID).length, 40);
  assert.ok(!JSON.stringify(EMAIL_NAME).includes("@example.com"));
});

test("I2 · perfil propio vs ajeno: SELF lleva `self` (XP, versión, uids); PUBLIC no lleva ninguno", () => {
  assert.equal(OWN.view, "SELF"); assert.ok(OWN.self);
  for (const s of [OTHER, ANON, RANKED_PLAYER]) { assert.equal(s.view, "PUBLIC"); assert.equal(s.self, null); }
});

/* ═══════════════════ privacidad (serialización de la foto pública) ═══════════════════ */

test("P1 · la foto PÚBLICA no contiene correo, saldo, XP exacta, sobres, duelos privados, versión ni uids guardados", () => {
  for (const s of [OTHER, ANON, RANKED_PLAYER, PLACEMENT_PLAYER, EMPTY]) {
    const j = JSON.stringify(s);
    for (const k of ["email", "credits", "balance", "xpIntoLevel", "xpForNext", "packsOpened", "privateDuels", "showcaseUids", "featuredIds", "claimedAchievements", "version", "token", "session", "ip", "is_admin"]) {
      assert.ok(!new RegExp(`"${k}"`).test(j), `${k} en la foto pública`);
    }
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(j), "sin correos");
  }
});

test("P2 · colección privada: el perfil público solo resume (conteos y rareza), nunca la lista de cartas ni de mazos", () => {
  const j = JSON.stringify(OTHER);
  assert.ok(!/"instanceCardIds"|"cardUids"|"deck|"decks"/.test(j));
  assert.ok(OTHER.collection.instances > 0 && OTHER.showcase.length > 0, "solo la vitrina que el jugador ELIGIÓ enseña cartas");
  // Servicio: la proyección de `profiles` sigue fija y sin correo; ni mazos ni créditos se leen.
  // F89 · añade `created_at` (solo se publica el MES: «miembro desde»). Pin reescrito a su intención.
  // 0068 · añade `public_tag` (el tag PÚBLICO de la cuenta). Pin reescrito a su intención: sigue sin correo ni privados.
  assert.ok(SERVICE.includes('const PROFILE_COLS = "id, username, avatar, xp, equipped, packs_opened, created_at, public_tag";'));
  assert.ok(!/duel_decks|credits|email/.test(code(SERVICE)));
});

test("P3 · vecinos de escalera: solo campos públicos de la clasificación (id de perfil, nombre, puesto, rating)", () => {
  const fn = COMPETITIVE.slice(COMPETITIVE.indexOf("export async function readLadderNeighbors"), COMPETITIVE.indexOf("/** Solo la posición propia"));
  // F84 · los vecinos son los de la clasificación de la temporada competitiva activa (acotada al Top).
  assert.ok(fn.includes("ladderSlice(sb, cseason.id, from, Math.min(position + 1, cseason.top.size))") && fn.includes("publicPlayers(sb,"));
  assert.ok(!/games_played|wins|losses|email|credits/.test(fn));
  assert.deepEqual(Object.keys(OTHER.standing!.above!).sort(), ["gap", "position", "rating", "userId", "username"]);
});

/* ═══════════════════ seguridad de escritura ═══════════════════ */

test("S1 · mutaciones solo sobre uno mismo: userId del token, cuerpo estricto, sin acción para cambiar el perfil de otro", () => {
  assert.ok(ROUTE.includes("const session = await getSession(req);") && ROUTE.includes('if (!session) return bad("No autenticado", 401);'));
  assert.ok(ROUTE.includes("if (Object.keys(body).some((k) => !allowed.includes(k))) return bad(\"Campos no permitidos\", 400, \"BAD_BODY\");"));
  assert.ok(!/body\.(userId|playerId|id|username)\b/.test(code(ROUTE)), "el cuerpo nunca dice de quién es el perfil");
  assert.ok(/setShowcase\(admin, userId,/.test(ROUTE) && /setAvatar\(admin, userId,/.test(ROUTE));
});

test("S2 · vitrina: forma (≤ 3, UUID, sin duplicados) y PROPIEDAD en servidor + RPC; avatar de conjunto cerrado", () => {
  assert.ok(SERVICE.includes("const parsed = parseShowcase(cardUids);") && SERVICE.includes("checkShowcaseOwnership(parsed.value,"));
  assert.ok(SERVICE.includes('if (!isAllowedAvatar(avatar)) return fail(400, "Avatar no válido", "BAD_AVATAR");'));
  assert.ok(ROUTE.includes('if (!UUID.test(id)) return bad("Jugador no válido");'), "id malformado → 400");
  assert.ok(SERVICE.includes('if (!p) return fail(404, "Jugador no encontrado");'), "inexistente → 404");
});

test("S3 · XSS: el nombre se pinta como TEXTO (React escapa); ningún dangerouslySetInnerHTML en el perfil", () => {
  const evil = { ...OTHER, player: { ...OTHER.player, username: '<img src=x onerror="alert(1)">' } };
  const h = html(<PlayerIdentityView snap={evil} />);
  assert.ok(!h.includes("<img src=x") && h.includes("&lt;img src=x"));
  for (const f of ["PlayerHero.tsx", "ProfileSections.tsx", "CardShowcase.tsx", "PlayerIdentityView.tsx"]) {
    assert.ok(!/dangerouslySetInnerHTML/.test(read("src", "components", "player", f)), f);
  }
});

/* ═══════════════════ competitivo (Fase 55) en el perfil ═══════════════════ */

test("C1 · clasificado: #puesto + rating, vecinos con enlace a SU perfil y el hueco para superar al de delante", () => {
  const st = RANKED_PLAYER.standing!;
  assert.equal(st.state, "RANKED");
  assert.equal(st.above!.position, 2); assert.equal(st.below!.position, 4);
  assert.equal(st.above!.gap, 1501 - 1488 + 1);
  // PERFIL = IDENTIDAD · los vecinos y el hueco siguen en la foto (y en Competitivo); el perfil ya no pinta la escalera.
  const h = html(<PlayerIdentityView snap={RANKED_PLAYER} />);
  assert.ok(!h.includes(`href="/jugador/${st.above!.userId}"`), "la escalera vive en Competitivo, no en el perfil");
  assert.ok(!/\b(Hierro|Bronce|Plata|Oro|Platino|Diamante|Inmortal|Radiante)\b/.test(text(h).replace(/Sobre (Plata|Oro|Bronce)/g, "")), "sin rangos con nombre para el Elo");
});

test("C2 · colocación REAL de la temporada competitiva (F84): 3 / 5, ni «clasificado» ni rango", () => {
  // F56 contaba la colocación como las 10 primeras partidas de por vida (K provisional); F84 la cuenta POR TEMPORADA (5).
  assert.equal(PLACEMENT_PLAYER.competitive!.state, "PLACEMENT");
  assert.deepEqual(PLACEMENT_PLAYER.competitive!.placement, { played: 3, total: 5 });
  assert.equal(PLACEMENT_PLAYER.competitive!.rank, null, "sin rango hasta cerrar la colocación");
  const h = html(<PlayerIdentityView snap={PLACEMENT_PLAYER} />);
  assert.match(text(h), /Colocación 3\/5/, "el perfil dice en qué punto de la colocación está, sin inventar rango");
  assert.ok(h.includes('data-rank-state="PLACEMENT"') && !h.includes("data-tier="));
});

test("C3 · sin ranked: sin foto competitiva y el estado vacío honesto", () => {
  assert.equal(NO_RANKED.standing, null); assert.equal(NO_RANKED.ranked, null);
  assert.equal(standingOf({ ranked: { ...RANKED_PLAYER.ranked!, gamesPlayed: 0 }, neighbors: null }), null);
  // Sin clasificar: el perfil no pinta un rango vacío (ni un panel de «aún no ha jugado»): simplemente no hay rango.
  const h = html(<PlayerIdentityView snap={NO_RANKED} />);
  assert.ok(!h.includes('data-testid="profile-rank"'));
});

/* ═══════════════════ temporada ═══════════════════ */

test("T1 · temporada: el tramo ranked se cuenta con rankedRecap (la función de /temporada), neto = final − inicio", () => {
  const events = [{ createdAt: 10, result: "WIN" as const, oldRating: 1000, newRating: 1018 }, { createdAt: 20, result: "LOSS" as const, oldRating: 1018, newRating: 1004 }];
  const s = seasonOf({ season: { id: "s", displayName: "S", startsAtMs: 0, endsAtMs: 100, remainingMs: 5, events } })!;
  const r = rankedRecap(events, 0, 100)!;
  assert.deepEqual([s.ranked.games, s.ranked.wins, s.ranked.losses, s.ranked.best, s.ranked.net], [r.games, r.wins, r.losses, r.highestRating, 4]);
  assert.equal(seasonOf({ season: null }), null);
  // PERFIL = IDENTIDAD · la temporada vive en /temporada: ni el propio ni el ajeno la pintan (la foto la sigue trayendo).
  const own = html(<PlayerIdentityView snap={OWN} />), other = html(<PlayerIdentityView snap={OTHER} />);
  for (const h of [own, other]) assert.ok(!h.includes('data-action="season"') && !/Temporada actual|progreso de temporada/i.test(text(h)));
  assert.ok(!/"passLevel"|"missions"|"objectives"/.test(JSON.stringify(OTHER)), "el pase es privado");
});

/* ═══════════════════ logros ═══════════════════ */

test("L1 · logros: destacados si los eligió; si no, los ÚLTIMOS conseguidos (fecha de reclamo, día), rotulados como tal", () => {
  assert.equal(OWN.recentAchievements.length, 0, "con destacados no hay fallback");
  const r = RECENT_ACHIEVEMENTS.recentAchievements;
  assert.ok(r.length > 0 && r.length <= 3);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].claimedAt >= r[i].claimedAt, "más recientes primero");
  for (const a of r) assert.equal(a.claimedAt % 86_400_000, 0, "fecha pública al día");
  // PERFIL = IDENTIDAD · los logros viven en la Sala de Trofeos / Logros: el perfil no los pinta.
  assert.ok(!/Últimos logros conseguidos|Aún no hay logros/.test(text(html(<PlayerIdentityView snap={RECENT_ACHIEVEMENTS} />))));
});

/* ═══════════════════ cartas ═══════════════════ */

test("K1 · vitrina: cardId EXACTO de cada ejemplar (dos variantes del mismo jugador no se colapsan) y CardArt canónico", () => {
  const lookup: CardLookup = (cardId) => ({ cardId, variantId: cardId.split("__")[1], variantLabel: cardId, rank: 3, serialLimit: null, ovr: 80, nick: "same", team: null, role: null, glow: "#fff" });
  const { slots } = resolveShowcase(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"], [
    { uid: "00000000-0000-4000-8000-000000000001", cardId: "aspas__gold", serial: null, mintedVersion: null, obtainedAt: 0 },
    { uid: "00000000-0000-4000-8000-000000000002", cardId: "aspas__icon", serial: 3, mintedVersion: null, obtainedAt: 0 },
  ], lookup);
  assert.deepEqual(slots.map((s) => s.cardId), ["aspas__gold", "aspas__icon"]);
  const sc = read("src", "components", "player", "CardShowcase.tsx");
  assert.ok(sc.includes("const def = getCard(s.cardId);") && sc.includes("<PlayerCard card={def}"));
  assert.ok(read("src", "components", "cards", "PlayerCard.tsx").includes("CardFace") && read("src", "components", "cards", "CardVisual.tsx").includes("<CardArt"), "PlayerCard → CardFace → CardArt");
  // PERFIL = IDENTIDAD · la vitrina sigue editable (Editar perfil) pero el perfil ya no reserva huecos de cartas.
  for (const s of [EMPTY, OWN, OTHER]) assert.ok(!/Sin cartas destacadas|Expón tus cartas|Elegir cartas/.test(text(html(<PlayerIdentityView snap={s} />))));
});

/* ═══════════════════ enlaces a perfil ═══════════════════ */

test("E1 · clasificación e historial abren /jugador/[id] (el id público de la URL canónica); el resultado ya no lo apila", () => {
  assert.ok(read("src", "components", "competitive", "Leaderboard.tsx").includes("playerHref(e.userId)"));
  const h = html(<RecentMatchCards matches={HISTORY.slice(0, 2)} />);
  assert.ok(h.includes(`href="/jugador/${HISTORY[0].rival.userId}"`) && h.includes('data-action="rival-profile"'));
  assert.ok(h.includes(`href="/duelos/competitivo/partida/${HISTORY[0].matchId}"`), "la ficha sigue abriendo el detalle");
  // RESULTADO ÚNICO · el resultado de la partida no apila el perfil del rival: se llega desde el historial (arriba) y la clasificación.
  const out = html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={null} rating={1} outcome={null} onAgain={noop} onBack={noop} rivalHref="/jugador/abc" />);
  assert.ok(!out.includes('data-testid="rival-profile"') && !out.includes('href="/jugador/abc"'));
});

/* ═══════════════════ render: propio vs ajeno, responsive ═══════════════════ */

test("R1 · el propio ofrece editar, cuenta, trofeos y cerrar sesión; el ajeno, nunca", () => {
  const own = html(<PlayerIdentityView snap={OWN} onEdit={noop} onSignOut={noop} />);
  const other = html(<PlayerIdentityView snap={OTHER} onEdit={noop} onSignOut={noop} />);
  for (const a of ['data-action="edit"', "Editar perfil", 'data-action="account"', 'data-action="trophy-room"', 'data-action="sign-out"', "Cerrar sesión"]) assert.ok(own.includes(a), a);
  for (const a of ['data-action="edit"', "Editar perfil", 'data-action="account"', 'data-action="sign-out"', "Cerrar sesión", "Editar vitrina", "Elegir logros", 'data-action="edit-team"']) assert.ok(!other.includes(a), a);
});

test("R2 · nombre largo: dos líneas como mucho y corte de palabra, sin desbordar", () => {
  const h = html(<PlayerIdentityView snap={LONG_NAME} />);
  assert.ok(/data-field="player-name"/.test(h) && /break-words/.test(h) && /overflow-wrap:anywhere/.test(h));
});

test("R3 · perfiles de las cuentas propias/ajenas usan el id de la URL canónica, nunca el correo", () => {
  assert.equal(OWN.player.userId, SELF_ID);
  assert.ok(!JSON.stringify([OWN, OTHER]).includes("@example.invalid"));
});
