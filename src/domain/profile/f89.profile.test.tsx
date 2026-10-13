/**
 * F89 · PROFILE 2.0 — dominio (carrera, historial, equipo favorito, miembro desde), privacidad de la foto pública,
 * vistas propietario/pública, XSS, textos largos, estados vacíos y contratos sobre el código real.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { careerStats, careerHighlights, historyItem, nextCursor, PUBLIC_MODES, SELF_MODES, careerModeOf, type HistoryRowFact } from "./career";
import { favoriteTeamOptions, parseFavoriteTeam, teamFact } from "./favoriteTeam";
import { monthOf } from "./identity";
import { CARDS, getPlayer } from "@/data/catalog";
import { hintTeamLogoSrc } from "@/data/teamLogos";
import { PlayerIdentityView } from "@/components/player/PlayerIdentityView";
import { ProfileOwnerView, PublicProfileView } from "@/components/player/ProfileViews";
import { OWN_FULL, PUBLIC_FULL, PUBLIC_ANON, NO_BADGES_PUBLIC, NO_TEAM_LOGO, EMPTY_OWN, EMPTY_PUBLIC, LONG_TEXT, XSS_NAME, matchesOf } from "@/app/design-system/fase89/fixtures";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const noop = () => {};
const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const RIVAL = "bbbbbbbb-0000-4000-8000-000000000002";

const row = (o: Partial<HistoryRowFact> & { matchId: string; at: number }): HistoryRowFact => ({
  mode: "RANKED", status: "COMPLETED", winner: "A", closedReason: null, closedBy: null, playerAId: ME, playerBId: RIVAL, scoreA: 6, scoreB: 3, difficulty: "NORMAL", ...o,
});

/* ═══════════════════ carrera ═══════════════════ */

test("F89-C1 · cuenta solo lo TERMINADO con desenlace; % = V / (V+D+E); en curso y sin resolver fuera del denominador", () => {
  const rows = [
    row({ matchId: "1", at: 10, winner: "A" }),
    row({ matchId: "2", at: 9, winner: "B" }),
    row({ matchId: "3", at: 8, status: "DRAW", winner: null }),
    row({ matchId: "4", at: 7, status: "IN_PROGRESS", winner: null }),                                         // en curso
    row({ matchId: "5", at: 6, status: "COMPLETED", winner: null }),                                           // sin resolver
    row({ matchId: "6", at: 5, status: "IN_PROGRESS", winner: null, closedReason: "ABANDONED", closedBy: RIVAL }), // abandono del rival = victoria
    row({ matchId: "7", at: 4, status: "IN_PROGRESS", winner: null, closedReason: "EXPIRED", closedBy: ME }),     // tiempo agotado propio = derrota
  ];
  const s = careerStats(rows, ME, SELF_MODES, { read: rows.length, capped: false });
  assert.deepEqual([s.total.played, s.total.wins, s.total.losses, s.total.draws], [5, 2, 2, 1]);
  assert.equal(s.total.winrate, 40);
});

test("F89-C2 · bando B: el ganador «B» es victoria del jugador B (sin intercambiar marcador)", () => {
  const r = row({ matchId: "x", at: 1, playerAId: RIVAL, playerBId: ME, winner: "B", scoreA: 2, scoreB: 6 });
  const s = careerStats([r], ME, PUBLIC_MODES, { read: 1, capped: false });
  assert.equal(s.total.wins, 1);
  const h = historyItem(r, ME, { userId: RIVAL, username: "Kaelis", avatar: "🐉" }, false);
  assert.deepEqual([h.letter, h.scoreYou, h.scoreRival], ["W", 6, 2]);
});

test("F89-C3 · el perfil PÚBLICO no cuenta duelos privados; el propio sí (y lo dice en `modes`)", () => {
  const rows = [row({ matchId: "p", at: 2, mode: "PRIVATE" }), row({ matchId: "r", at: 1, mode: "RANKED", winner: "B" })];
  const pub = careerStats(rows, ME, PUBLIC_MODES, { read: 2, capped: false });
  const own = careerStats(rows, ME, SELF_MODES, { read: 2, capped: false });
  assert.equal(pub.total.played, 1); assert.equal(pub.byMode.PRIVATE, undefined); assert.ok(!pub.modes.includes("PRIVATE"));
  assert.equal(own.total.played, 2); assert.equal(own.byMode.PRIVATE?.wins, 1);
  assert.ok(!PUBLIC_MODES.includes("PRIVATE"));
});

test("F89-C4 · rachas: actual (de la más reciente hacia atrás) y mejor racha de victorias", () => {
  const seq = ["W", "W", "L", "W", "W", "W", "D", "W"]; // más reciente primero
  const rows = seq.map((l, i) => row({ matchId: String(i), at: 100 - i, status: l === "D" ? "DRAW" : "COMPLETED", winner: l === "D" ? null : l === "W" ? "A" : "B" }));
  const s = careerStats(rows, ME, SELF_MODES, { read: rows.length, capped: false });
  assert.deepEqual(s.currentStreak, { kind: "W", n: 2 });
  assert.equal(s.bestWinStreak, 3);
  assert.equal(careerStats([], ME, SELF_MODES, { read: 0, capped: false }).currentStreak, null);
});

test("F89-C5 · modos reales de duel_matches; el Coach (otra tabla) y modos desconocidos no son carrera", () => {
  assert.equal(careerModeOf("PVP"), "RANKED"); assert.equal(careerModeOf("PVE"), "PVE");
  assert.equal(careerModeOf("DRAFT_GAUNTLET"), "DRAFT"); assert.equal(careerModeOf("PVP_PRIVATE"), "PRIVATE");
  assert.equal(careerModeOf("COACH"), null);
});

test("F89-C6 · momentos: primera partida, primera victoria, hitos y colecciones; con lectura acotada NO se inventan «primeros»", () => {
  const rows = matchesOf(ME, 30);
  const comp = [{ setId: "team-g2-v1", title: "G2", kind: "TEAM", logo: "/hints/teams/g2.png", completedAt: Date.UTC(2026, 9, 1) }];
  const h = careerHighlights({ matches: rows, userId: ME, modes: SELF_MODES, capped: false, completions: comp });
  const kinds = h.map((x) => x.kind);
  assert.ok(kinds.includes("FIRST_MATCH") && kinds.includes("FIRST_WIN") && kinds.includes("COLLECTION_COMPLETED"));
  assert.ok(h.some((x) => x.id === "matches-10") && h.some((x) => x.id === "matches-25") && !h.some((x) => x.id === "matches-50"));
  assert.equal(h.find((x) => x.kind === "COLLECTION_COMPLETED")!.href, "/coleccion/trofeos/team-g2-v1");
  const capped = careerHighlights({ matches: rows, userId: ME, modes: SELF_MODES, capped: true, completions: comp });
  assert.deepEqual(capped.map((x) => x.kind), ["COLLECTION_COMPLETED"]);
  for (const x of h) assert.equal(x.at % 86_400_000, 0, "fechas al día");
});

test("F89-C7 · historial: rival humano solo con nombre/avatar públicos; IA etiquetada; enlace SOLO en el propio perfil", () => {
  const pvp = row({ matchId: "m1", at: 1 });
  const pve = row({ matchId: "m2", at: 2, mode: "PVE", playerBId: "", difficulty: "HARD" });
  const pub = historyItem(pvp, ME, { userId: RIVAL, username: "Kaelis", avatar: "🐉" }, false);
  assert.equal(pub.href, null);
  assert.deepEqual(Object.keys(pub.opponent).sort(), ["avatar", "kind", "profileId", "username"]);
  assert.equal(historyItem(pvp, ME, null, true).href, "/duelos/competitivo/partida/m1");
  const ai = historyItem(pve, ME, null, true);
  assert.deepEqual(ai.opponent, { kind: "AI", label: "IA · difícil" });
  assert.equal(ai.href, "/duelos/replay/m2");
  assert.equal(historyItem(pve, ME, null, false).href, null);
  assert.equal(nextCursor([{ at: 5 }], 1), 5); assert.equal(nextCursor([], 10), null);
});

/* ═══════════════════ equipo favorito ═══════════════════ */

test("F89-T1 · opciones = identidades REALES impresas en cartas; sin `raw:` ni identidades sin fijar (20.2)", () => {
  const opts = favoriteTeamOptions(CARDS, getPlayer);
  const ids = new Set(opts.map((o) => o.id));
  for (const id of ["team-heretics", "g2", "fnatic", "leviatan"]) assert.ok(ids.has(id), id);
  for (const id of ["drx", "edward-gaming", "gen-g", "sentinels"]) assert.ok(!ids.has(id), `${id} no está probado (auditoría 20.2)`);
  assert.ok(opts.every((o) => !o.id.startsWith("raw:")));
  assert.ok(opts.every((o) => o.logo === hintTeamLogoSrc(o.id)), "el logo sale del sistema, nunca de otro sitio");
  assert.ok(opts.length >= 30 && opts.length <= 41);
});

test("F89-T2 · validación: id exacto o null; nombre, URL, logo, número u objeto → rechazado", () => {
  const ids = new Set(favoriteTeamOptions(CARDS, getPlayer).map((o) => o.id));
  assert.deepEqual(parseFavoriteTeam("team-heretics", ids), { ok: true, value: "team-heretics" });
  assert.deepEqual(parseFavoriteTeam(null, ids), { ok: true, value: null });
  for (const bad of ["Team Heretics", "https://evil.example/logo.png", "/hints/teams/g2.png", "", 42, {}, ["g2"], undefined, "x".repeat(60)]) {
    assert.equal(parseFavoriteTeam(bad, ids).ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(parseFavoriteTeam("equipo-inventado", ids), { ok: false, code: "UNKNOWN_TEAM" });
  assert.equal(teamFact("no-existe"), null);
});

test("F89-T3 · miembro desde: solo el MES (nunca el instante de alta)", () => {
  assert.equal(monthOf(Date.UTC(2026, 6, 17, 10, 30, 12)), Date.UTC(2026, 6, 1));
  assert.equal(monthOf(null), null);
  assert.equal(OWN_FULL.memberSince, Date.UTC(2026, 6, 1));
});

/* ═══════════════════ privacidad de la foto ═══════════════════ */

test("F89-P1 · foto PÚBLICA: sin correo, saldo, XP, versión, uids, insignias propias, duelos privados ni progreso de colección", () => {
  for (const s of [PUBLIC_FULL, PUBLIC_ANON, NO_BADGES_PUBLIC, EMPTY_PUBLIC, XSS_NAME]) {
    const j = JSON.stringify(s);
    assert.equal(s.self, null);
    for (const k of ["email", "credits", "balance", "xpIntoLevel", "packsOpened", "privateDuels", "showcaseUids", "featuredBadgeIds", "ownedBadges", "version", "token", "is_admin", "createdAt", "requirements", "missing", "locked"]) {
      assert.ok(!new RegExp(`"${k}"`).test(j), `${k} en la foto pública`);
    }
    assert.ok(!(s.career?.stats.modes ?? []).includes("PRIVATE"));
    assert.ok((s.career?.history.items ?? []).every((i) => i.mode !== "PRIVATE" && i.href === null), "ni duelos privados ni enlaces a partidas ajenas");
  }
  assert.ok(OWN_FULL.career!.stats.modes.includes("PRIVATE") && OWN_FULL.self!.ownedBadges.length > 0);
});

test("F89-P2 · colecciones: lo COMPLETADO (trofeo) sí; números de F82 (numerador ≤ denominador)", () => {
  const c = PUBLIC_FULL.collections!;
  assert.equal(c.completed.length, 3);
  assert.ok(c.publishedCompleted <= c.publishedSets);
  assert.ok(c.completed.every((x) => x.logo === null || x.logo.startsWith("/hints/teams/")));
});

/* ═══════════════════ vistas y render ═══════════════════ */

test("F89-V1 · PROPIETARIO: editar perfil, cuenta y ajustes, Sala de Trofeos y CERRAR SESIÓN; PÚBLICO: ninguna acción de cuenta", () => {
  const own = text(html(<ProfileOwnerView snap={OWN_FULL} onEdit={noop} onSignOut={noop} />));
  for (const t of ["Editar perfil", "Cuenta y ajustes", "Sala de Trofeos", "Cerrar sesión"]) assert.ok(own.includes(t), t);
  // PERFIL = IDENTIDAD · insignias, vitrina y equipo se gestionan dentro de «Editar perfil», no con botones sueltos.
  for (const t of ["Gestionar insignias", "Copiar enlace", "Editar equipo", "Elegir cartas"]) assert.ok(!own.includes(t), t);
  const pub = text(html(<PublicProfileView snap={PUBLIC_FULL} />));
  for (const t of ["Editar perfil", "Cuenta y ajustes", "Cerrar sesión", "Gestionar insignias", "Equipar insignias", "Elegir equipo favorito", "Editar vitrina", "Editar equipo", "Sala de Trofeos"]) assert.ok(!pub.includes(t), t);
  assert.equal(html(<ProfileOwnerView snap={PUBLIC_FULL} onEdit={noop} onSignOut={noop} />), "", "la vista del propietario no monta nada sobre una foto ajena");
});

test("F89-V2 · identidad: avatar, nombre, equipo favorito con logo REAL y alt, miembro desde; sin insignias ni cartas en el perfil", () => {
  const h = html(<PublicProfileView snap={PUBLIC_FULL} />);
  assert.ok(h.includes('data-testid="favorite-team"') && h.includes('src="/hints/teams/team-heretics.png"') && h.includes('alt="Escudo de Team Heretics"'));
  assert.match(text(h), /Miembro desde julio de 2026/);
  assert.ok(h.includes(`Avatar de ${PUBLIC_FULL.player.username}`) && h.includes('data-field="player-name"'));
  // PERFIL = IDENTIDAD · insignias (Sala de Trofeos) y cartas destacadas (Colección) ya no se pintan aquí.
  assert.ok(!h.includes('data-testid="hero-badges"') && !h.includes('data-testid="hero-cards"') && !h.includes("data-card-art"));
  const noLogo = html(<PublicProfileView snap={NO_TEAM_LOGO} />);
  assert.ok(noLogo.includes('data-team="paper-rex"') && !noLogo.includes("/hints/teams/paper-rex.png"), "sin logo real: sigla, nunca un escudo inventado");
});

test("F89-V3 · PERFIL = IDENTIDAD: ni estadísticas, ni historial, ni colecciones, ni momentos (los datos siguen en la foto)", () => {
  const h = html(<PublicProfileView snap={PUBLIC_FULL} />);
  const s = PUBLIC_FULL.career!.stats.total;
  assert.ok(s.played > 0 && PUBLIC_FULL.collections!.completed.length > 0, "la foto del servidor sigue trayendo carrera y colecciones");
  for (const t of ["data-played=", 'data-testid="match-history"', 'data-action="history-more"', 'href="/coleccion/trofeos/team-fnatic-v1"', 'data-testid="career-highlights"', 'data-testid="hero-xp"']) assert.ok(!h.includes(t), t);
  assert.ok(!/% de victorias|Victorias|Derrotas|Empates|Partidas/.test(text(h)), "nada de dashboard estadístico");
});

test("F89-V4 · perfil vacío (sin rango, sin equipo): queda la identidad limpia, sin huecos ni invitaciones de dashboard", () => {
  const ownH = html(<ProfileOwnerView snap={EMPTY_OWN} onEdit={noop} onSignOut={noop} />);
  const own = text(ownH);
  assert.ok(own.includes(EMPTY_OWN.player.username) && own.includes("Editar perfil") && own.includes("Cerrar sesión"));
  assert.ok(!ownH.includes('data-testid="favorite-team"') && !ownH.includes('data-testid="profile-rank"'), "sin equipo ni rango: no se pinta nada vacío");
  assert.ok(!/Sin partidas registradas|primera insignia|Elegir cartas|Elegir equipo favorito/.test(own));
  const pub = text(html(<PublicProfileView snap={EMPTY_PUBLIC} />));
  assert.ok(!/Sin partidas registradas|Aún no ha completado|Elegir equipo favorito|Elegir cartas|Equipar insignias/.test(pub));
});

test("F89-V5 · XSS: el nombre se pinta como TEXTO escapado; textos largos con corte seguro", () => {
  const h = html(<PublicProfileView snap={XSS_NAME} />);
  assert.ok(!h.includes("<script>alert(2)</script>") && !h.includes("<img src=x"));
  assert.ok(h.includes("&lt;img src=x"));
  const long = html(<ProfileOwnerView snap={LONG_TEXT} onEdit={noop} onSignOut={noop} />);
  assert.ok(long.includes("[overflow-wrap:anywhere]") && long.includes("break-words"));
  assert.ok(long.includes("truncate"), "nombre de equipo con truncado");
  for (const f of ["ProfileIdentityCard.tsx", "PlayerHero.tsx", "ProfileCareer.tsx", "ProfileCollections.tsx", "ProfileViews.tsx", "bits.tsx", "ShowcaseEditor.tsx"]) {
    assert.ok(!/dangerouslySetInnerHTML/.test(read("src", "components", "player", f)), f);
  }
});

test("F89-V6 · accesibilidad: títulos semánticos, h1 único, W/L no solo color, logos con alt, movimiento reducido", () => {
  const h = html(<PlayerIdentityView snap={OWN_FULL} onEdit={noop} onSignOut={noop} />);
  assert.equal((h.match(/<h1/g) ?? []).length, 1);
  assert.ok(h.includes('role="img" aria-label="Avatar de'), "el avatar emoji tiene nombre accesible");
  assert.ok(/aria-label="Rating [\d.]+"/.test(h) || !h.includes('data-field="rating"'), "el rating se lee como número, no solo por color");
  assert.ok((h.match(/min-h-\[44px\]/g) ?? []).length >= 4, "acciones táctiles de 44 px");
  assert.ok(!/<img(?![^>]*alt=)[^>]*>/.test(h), "toda imagen lleva alt");
});

/* ═══════════════════ contratos sobre el código ═══════════════════ */

const SERVICE = code(read("src", "server", "services", "playerIdentity.ts"));
const ROUTE = code(read("src", "app", "api", "game", "player", "route.ts"));
const PAGE = code(read("src", "components", "player", "PlayerProfileScreen.tsx"));
const MIG = read("supabase", "migrations", "0063_profile_favorite_team.sql").replace(/^\s*--.*$/gm, "");

test("F89-S1 · equipo favorito: id validado en servidor contra las opciones reales, RPC con versión, sin URL/logo del cliente", () => {
  assert.ok(SERVICE.includes("const parsed = parseFavoriteTeam(teamId, favoriteTeamIds());"));
  assert.ok(SERVICE.includes('sb.rpc("player_profile_set_favorite_team", { p_user: userId, p_team: parsed.value, p_expected_version: version.value })'));
  assert.ok(ROUTE.includes('set_favorite_team: ["action", "teamId", "expectedVersion"]'));
  assert.ok(ROUTE.includes("setFavoriteTeam(admin, userId, body.teamId, body.expectedVersion)"));
  assert.ok(!/logo|url/i.test(MIG.slice(MIG.indexOf("create or replace function"))), "la BD no guarda logos ni URLs");
});

test("F89-S2 · 0063 aditiva, RLS existente, SECURITY DEFINER + search_path, EXECUTE solo service_role, forma del id en BD", () => {
  assert.ok(MIG.includes("add column if not exists favorite_team_id text"));
  assert.ok(MIG.includes("favorite_team_id ~ '^[a-z0-9-]{1,48}$'"));
  assert.ok(/security definer set search_path = public/.test(MIG));
  assert.ok(MIG.includes("revoke all on function public.player_profile_set_favorite_team(uuid, text, int) from public, anon, authenticated"));
  assert.ok(MIG.includes("grant execute on function public.player_profile_set_favorite_team(uuid, text, int) to service_role"));
  assert.ok(MIG.includes("if p_team is not distinct from cur.favorite_team_id then") && MIG.includes("p_expected_version <> cur.version"));
  assert.ok(!/drop table|alter table public\.(profiles|user_cards)|grant select/i.test(MIG));
  assert.ok(existsSync(join(ROOT, "docs", "operations", "rollback", "0063_profile_favorite_team.ROLLBACK.sql")));
});

test("F89-S3 · historial paginado: cursor numérico, solo `id/history/before`, misma visibilidad (404 y bloqueo), sin `state` entero", () => {
  assert.ok(ROUTE.includes('if ([...q.keys()].some((k) => k !== "id" && k !== "history" && k !== "before")) return bad("Parámetro no válido");'));
  assert.ok(ROUTE.includes('if (before !== null && (!Number.isInteger(before) || before <= 0)) return bad("Cursor no válido");'));
  assert.ok(SERVICE.includes('if (!prow) return fail(404, "Jugador no encontrado");'));
  assert.ok(/getPlayerHistory[\s\S]*blockedByPlayer\(sb, viewerId, playerId\)/.test(SERVICE));
  assert.ok(SERVICE.includes('scoreA:state->scoreA, scoreB:state->scoreB') && !/CAREER_COLS = "[^"]*\bstate,/.test(SERVICE), "solo el marcador del state");
  assert.ok(SERVICE.includes("const modesFor = (isSelf: boolean): readonly CareerMode[] => (isSelf ? SELF_MODES : PUBLIC_MODES);"));
});

test("F89-S4 · una agregación: carrera, equipo y colecciones en el MISMO Promise.all; lectura de carrera acotada y por páginas", () => {
  assert.ok(SERVICE.includes("careerRows(sb, playerId, modesFor(isSelf), CAREER_CAP, null),"));
  assert.ok(SERVICE.includes("favoriteTeamOf(sb, playerId),") && SERVICE.includes("profileCollections(sb, playerId).catch(() => null),"));
  assert.ok(SERVICE.includes("const CAREER_CAP = 5000;"));
  assert.ok(!/for \(const [a-z]+ of [a-zA-Z]+\) \{[^}]*await sb\.from/.test(SERVICE), "nada de N+1");
});

test("F89-H1 · hidratación/cambio de cuenta: la foto va atada a (perfil, cuenta) y una respuesta tardía de otra cuenta se descarta", () => {
  assert.ok(PAGE.includes("const viewKey = `${id}|${user?.id ?? \"anon\"}`;"));
  assert.ok(PAGE.includes("const snap = loaded?.key === viewKey ? loaded.snap : null;"));
  assert.ok(PAGE.includes("if (keyRef.current === key) setLoaded({ key, snap: next });"));
  assert.match(PAGE, /ownedReady \? storeOwned : \[\]/, "F81.2: el editor nunca elige entre cartas de la caché o la demo");
  const hist = read("src", "components", "player", "ProfileCareer.tsx");
  assert.ok(hist.includes("const key = `${snap.player.userId}:${snap.view}`;") && hist.includes("s.key !== key ? s :"), "el historial paginado no mezcla perfiles");
});

test("F89-E1 · economía, mercado y pagos intactos; F82/F81 sin tocar por el perfil", () => {
  const all = [SERVICE, ROUTE, PAGE, code(read("src", "domain", "profile", "career.ts")), code(read("src", "domain", "profile", "favoriteTeam.ts"))].join("\n");
  assert.ok(!/credit|economy_ops|app_buy_pack|salvage|craft|price|PAYMENTS_ENABLED|GLOBAL_MARKET_ENABLED|market/i.test(all.replace(/\/coleccion\/trofeos/g, "")));
  assert.ok(!/app_collection_claim|collection_sets.*(insert|update|delete)/.test(SERVICE), "el perfil solo LEE F82");
});
