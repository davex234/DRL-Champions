/**
 * PLAYER IDENTITY 2.0 · CONTRATOS SOBRE EL CÓDIGO REAL (Fase 31).
 *
 * Sin base de datos: se afirma lo que la migración, el servicio, la ruta, el cliente y las pantallas
 * escriben, y lo que NO pueden romper. Bloques: identidad canónica, vitrina y RPC, privacidad,
 * seguridad (57–65), competitivo (49–53), social (41–48), Pick'ems (54–56), regresión (66–84),
 * telemetría, accesibilidad, móvil.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isFlow } from "@/lib/telemetry/contract";
import { zoneFromPath } from "@/lib/telemetry/contract";
import { PROFILE_CONTEXTS, PROFILE_FLOW } from "@/lib/player/telemetry";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { NAV_SECTIONS, MOBILE_NAV, sectionForPath } from "@/design/nav";
import { playerHref, PLAYER_ME_HREF, playerShareUrl } from "@/lib/player/href";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (s: string) => s.replace(/^\s*--.*$/gm, "");

const MIG49 = read("supabase", "migrations", "0049_player_profile_customization.sql");
const MIG46 = read("supabase", "migrations", "0046_telemetry_flows_progression.sql");
const DOMAIN = read("src", "domain", "profile", "identity.ts");
const SERVICE = read("src", "server", "services", "playerIdentity.ts");
const ROUTE = read("src", "app", "api", "game", "player", "route.ts");
const CLIENT = read("src", "lib", "player", "client.ts");
const PAGE = read("src", "components", "player", "PlayerProfileScreen.tsx");
const LEGACY = read("src", "app", "duelos", "competitivo", "jugador", "[id]", "page.tsx");
const COMP = (f: string) => read("src", "components", "player", f);
const UI_FILES = ["bits.tsx", "PlayerHero.tsx", "CardShowcase.tsx", "ProfileSections.tsx", "ShowcaseEditor.tsx", "PlayerIdentityView.tsx", "ProfilePreviewCard.tsx"];
const UI = UI_FILES.map(COMP).join("\n");
const CUENTA = read("src", "app", "cuenta", "page.tsx");
const HARNESS = read("src", "app", "design-system", "fase31", "page.tsx");
const FIXTURES = read("src", "app", "design-system", "fase31", "fixtures.ts");

/* ───────────────────────────── identidad canónica ───────────────────────────── */

test("una sola ruta pública: /jugador/[id]; la ruta antigua del competitivo redirige; /jugador/me al propio", () => {
  assert.equal(playerHref("abc"), "/jugador/abc");
  assert.equal(PLAYER_ME_HREF, "/jugador/me");
  assert.ok(LEGACY.includes("redirect(playerHref(id));") && !/fetchCompetitivePlayer|PlayerProfile/.test(code(LEGACY)));
  // F82 · la redirección conserva la consulta (`?editar=insignias` desde la Sala de Trofeos); sigue yendo al id canónico.
  assert.ok(PAGE.includes('if (id === "me" && !loading && user) router.replace(playerHref(user.id) + (typeof window !== "undefined" ? window.location.search : ""));'));
  const dirs = readdirSync(join(process.cwd(), "src", "app"));
  assert.ok(!dirs.includes("perfil") && !dirs.includes("profile"), "sin rutas públicas competidoras");
  assert.ok(!/ProfileV2|PublicProfileV3|CompetitiveProfile2|SocialProfileNew/.test(code(UI) + code(SERVICE)));
});

test("52–53 · escalera, historial, detalle de partida, perfil competitivo, Social y post-partida enlazan al perfil canónico", () => {
  for (const f of [["components", "competitive", "Leaderboard.tsx"], ["components", "competitive", "MatchHistoryList.tsx"], ["components", "competitive", "MatchDetailView.tsx"], ["components", "competitive", "PlayerProfile.tsx"], ["components", "social", "bits.tsx"], ["app", "duelos", "pvp", "page.tsx"]]) {
    const src = code(read("src", ...f));
    assert.ok(src.includes("playerHref("), f.join("/"));
    assert.ok(!src.includes("/duelos/competitivo/jugador/"), `${f.join("/")} ya no enlaza a la ruta antigua`);
  }
  const all = readdirSync(join(process.cwd(), "src", "components"), { recursive: true }).filter((f) => /\.tsx?$/.test(String(f)));
  for (const f of all) assert.ok(!code(read("src", "components", String(f))).includes("/duelos/competitivo/jugador/"), String(f));
});

test("los jugadores esports (Fase 30) no se enlazan a usuarios NEXUS por coincidencia de nombre", () => {
  const live = readdirSync(join(process.cwd(), "src", "components", "liveEvents")).map((f) => read("src", "components", "liveEvents", f)).join("\n");
  assert.ok(!/playerHref|\/jugador\//.test(code(live)));
  assert.ok(!/username/.test(code(read("src", "domain", "liveEvents", "playerCards.ts"))));
});

test("cuenta ≠ perfil: /cuenta conserva sesión y ajustes y muestra la tarjeta TU PERFIL; la navegación separa los dos", () => {
  assert.ok(CUENTA.includes('<ProfilePreviewCard enabled={!!user} className="mt-4" />'));
  assert.ok(CUENTA.includes('aria-label={t("Ajustes del perfil")}') && CUENTA.includes("signOut"));
  assert.ok(CUENTA.includes('import { AVATARS } from "@/domain/profile/avatars";') && !/const AVATARS = \[/.test(CUENTA));
  const progreso = NAV_SECTIONS.find((s) => s.id === "progreso")!;
  // IA 2026-10-07 · Mi perfil y Cuenta ya no son entradas del menú de Temporada: viven en MI CUENTA (icono + dock), donde
  // PERFIL es la misma pantalla que /jugador/[id] y CUENTA la de ajustes de siempre.
  assert.ok(!progreso.items.some((i) => i.href === "/jugador/me" || i.href === "/cuenta"));
  assert.equal(MOBILE_NAV.find((m) => m.href === "/cuenta")?.label, "Cuenta");
  assert.equal(sectionForPath("/jugador/00000000-0000-4000-8000-000000000001")?.id, "progreso");
  assert.equal(zoneFromPath("/jugador/abc"), "account");
  assert.ok(COMP("ProfilePreviewCard.tsx").includes("Ver perfil") && COMP("ProfilePreviewCard.tsx").includes("?editar=1"));
});

test("compartir: URL canónica por id, portapapeles o share nativo, sin servidor ni acortador", () => {
  assert.equal(playerShareUrl("https://nexus.gg/", "abc"), "https://nexus.gg/jugador/abc");
  assert.ok(CLIENT.includes("navigator.clipboard.writeText(url)"));
  assert.ok(!/shorten|bit\.ly|tinyurl/i.test(CLIENT));
  // PERFIL = IDENTIDAD · el perfil ya no ofrece «Copiar enlace» (la URL canónica /jugador/[id] sigue siendo la del perfil).
  assert.ok(!PAGE.includes("shareProfile(") && !PAGE.includes('data-action="share"'));
});

/* ───────────────────────────── vitrina y persistencia (0049) ───────────────────────────── */

test("0049: tabla aditiva solo servidor con máximos, sin nulos, sin duplicados y versión; aplicada en la Fase 35.1", () => {
  assert.ok(/— APLICADA \(VPS 2026-09-15, Fase 35\.1\)\.$/.test(MIG49.split("\n")[0]));
  assert.ok(MIG49.includes("create table if not exists public.player_profile_customization"));
  assert.ok(MIG49.includes("showcase_card_uids        uuid[] not null default '{}'"));
  assert.ok(MIG49.includes("check (coalesce(cardinality(showcase_card_uids), 0) <= 3)") && MIG49.includes("check (coalesce(cardinality(featured_achievement_ids), 0) <= 3)"));
  assert.ok(MIG49.includes("check (public._uuid_array_is_unique(showcase_card_uids))") && MIG49.includes("check (array_position(showcase_card_uids, null) is null)"));
  assert.ok(MIG49.includes("version                   int not null default 0"));
  assert.ok(MIG49.includes("enable row level security") && MIG49.includes("revoke all on public.player_profile_customization from anon, authenticated"));
  assert.ok(!/create policy/.test(sql(MIG49)));
  assert.ok(!/schema_migrations/.test(sql(MIG49)));
  assert.ok(!/alter table public\.profiles|add column/.test(sql(MIG49)), "nada de preferencias sin esquema en profiles");
});

test("61–62 · el RPC valida propiedad (user_cards del jugador) y logros reclamados en la MISMA transacción, con versión e idempotencia", () => {
  const fn = MIG49.slice(MIG49.indexOf("create or replace function public.player_profile_set"));
  assert.ok(fn.includes("for update"));
  assert.ok(fn.includes("select count(*) into n from public.user_cards where user_id = p_user and uid = any (v_show);"));
  assert.ok(fn.includes("select count(*) into n from public.user_achievements where user_id = p_user and achievement_id = any (v_feat);"));
  assert.ok(fn.indexOf("'UNCHANGED'") < fn.indexOf("'CONFLICT'"), "mismo contenido = idempotente antes de mirar la versión");
  assert.ok(fn.includes("version = cur.version + 1"));
  assert.ok(fn.includes("security definer set search_path = public"));
  assert.ok(MIG49.includes("grant execute on function public.player_profile_set(uuid, uuid[], text[], int) to service_role;"));
  assert.ok(MIG49.includes("revoke all on function public.player_profile_set(uuid, uuid[], text[], int) from public, anon, authenticated;"));
});

test("el servicio valida también antes del RPC (defensa en profundidad) y degrada si 0049 no está aplicada", () => {
  assert.ok(SERVICE.includes('sb.from("user_cards").select("uid").eq("user_id", userId).in("uid", parsed.value)'));
  assert.ok(SERVICE.includes('sb.from("user_achievements").select("achievement_id").eq("user_id", userId).in("achievement_id", parsed.value)'));
  assert.ok(SERVICE.includes("parseFeatured(achievementIds, CATALOG_IDS)"), "solo ids del catálogo real de logros");
  assert.ok(SERVICE.includes('return fail(503, "La personalización del perfil todavía no está disponible", "NOT_READY")'));
  assert.ok(SERVICE.includes("if (isMissingSchema(error)) return null;"), "leer el perfil sin 0049 no rompe");
  assert.ok(!/localStorage|sessionStorage/.test(code(UI) + code(PAGE) + code(CLIENT)), "la vitrina no se guarda en el navegador");
});

test("vitrina = instancias reales: se leen por uid y dueño; serial y variante vienen del ejemplar y del catálogo del servidor", () => {
  assert.ok(SERVICE.includes('sb.from("user_cards").select("uid, card_id, serial, minted_version, obtained_at").eq("user_id", playerId).in("uid", uids)'));
  assert.ok(SERVICE.includes("const def = cat.instance(cardId, mintedVersion);"), "la definición histórica bajo la que se acuñó");
  assert.ok(DOMAIN.includes("lowSerial: isLowSerial(inst.serial, fact.serialLimit)"));
  assert.ok(!/value|price|credits/.test(code(DOMAIN).slice(code(DOMAIN).indexOf("export interface ShowcaseSlot"), code(DOMAIN).indexOf("export interface CollectionSummary"))), "la serie no da valor económico");
});

test("67–68 · se pinta con PlayerCard + Card3D y el CardViewer canónico; sin renderizador de perfil propio ni arrastrar-y-soltar obligatorio", () => {
  const sc = COMP("CardShowcase.tsx");
  assert.ok(sc.includes("<PlayerCard card={def}") && sc.includes("<Card3D") && sc.includes("<CardViewer card={openDef}"));
  assert.ok(!existsSync(join(process.cwd(), "src", "components", "player", "ProfileCardRenderer.tsx")));
  assert.ok(!/function \w*CardRenderer|draggable|onDragStart/.test(code(UI)));
  assert.ok(sc.includes('mode={lead && s.rarity === "legendary" ? "legendary"'), "un solo halo, en la destacada");
  assert.ok((sc.match(/<Card3D/g) ?? []).length === 1, "como mucho 3 Card3D (una por slot)");
});

test("editor: reutiliza CollectionEngine, applyFilter e instancesOf (sin segunda colección) y ordena con botones", () => {
  const ed = COMP("ShowcaseEditor.tsx");
  assert.ok(ed.includes("new CollectionEngine(owned).ownedViews()") && ed.includes("applyFilter(views,") && ed.includes("instancesOf(owned, cardId)"));
  for (const l of ["Buscar carta", "Equipo", "Rol", "Rareza", "Duplicadas"]) assert.ok(ed.includes(l), l);
  // I18N · la plantilla pasó a clave con parámetro: mismo texto, mismo `i + 1`, en el mismo aria-label.
  for (const verbo of ["Subir", "Bajar", "Quitar"]) {
    assert.ok(new RegExp("aria-label=\\{(?:`" + verbo + " slot \\$\\{i \\+ 1\\}`|(?:t|tr|i18nT)\\(\"" + verbo + " slot \\{(\\w+)\\}\", \\{ \\1: i \\+ 1 \\}\\))\\}").test(ed), verbo);
  }
  assert.ok(ed.includes('data-testid="instance-picker"') && ed.includes("Exponer esta copia"));
  assert.ok(ed.includes('role="dialog"') && ed.includes('aria-modal="true"') && ed.includes('e.key === "Escape"'));
});

/* ───────────────────────────── privacidad (31–40) ───────────────────────────── */

test("31–39 · el servicio solo proyecta columnas públicas de profiles y nunca lee datos privados", () => {
  // F89 · `created_at` entra solo para «miembro desde» (el dominio publica el mes, `monthOf`).
  // 0068 · `public_tag` entra porque es PÚBLICO por diseño (identificador de cuenta); nada privado se añade.
  assert.ok(SERVICE.includes('const PROFILE_COLS = "id, username, avatar, xp, equipped, packs_opened, created_at, public_tag";'));
  assert.ok(DOMAIN.includes("memberSince: monthOf(facts.createdAt)"));
  const c = code(SERVICE);
  assert.ok(!/\bemail\b|\bcredits\b|is_admin|credit_transactions|economy_ops|user_pass|duel_decks|pickem_answers|pickem_submissions|auth\.users|last_seen_at/.test(c));
  assert.ok(!/select\("\*"\)/.test(c));
  assert.ok(DOMAIN.includes("self: isSelf ? {"), "lo privado se decide en el servidor, no con CSS");
  assert.ok(!/data-private|hidden=\{!isSelf\}|className=\{isSelf \? "" : "hidden"\}/.test(UI), "nada se esconde con CSS");
});

test("47 · partidas privadas: nunca en el historial público; solo el cara a cara con el espectador que participó", () => {
  assert.ok(SERVICE.includes("viewerId && !isSelf") && SERVICE.includes("and(user_id.eq.${viewerId},player_b_id.eq.${playerId})"));
  assert.ok(SERVICE.includes('isSelf\n        ? sb.from("duel_matches").select("id", { count: "exact", head: true }).eq("mode", "PVP_PRIVATE")'), "el recuento de privados solo para uno mismo");
});

test("45 · bloqueo: quien te bloqueó responde 404 (como inexistente); sin la tabla social no hay bloqueo que aplicar", () => {
  assert.ok(SERVICE.includes('if (viewerId && !isSelf && await blockedByPlayer(sb, viewerId, playerId)) return fail(404, "Jugador no encontrado");'));
  assert.ok(SERVICE.includes("if (error) return false;"));
});

/* ───────────────────────────── seguridad (57–65) ───────────────────────────── */

test("57–59 · mutaciones: sesión obligatoria, userId del token, cuerpo estricto con lista blanca por acción", () => {
  assert.ok(ROUTE.includes('if (!session) return bad("No autenticado", 401);'));
  assert.ok(ROUTE.includes("const { admin, userId } = session;"));
  assert.ok(ROUTE.includes('if (Object.keys(body).some((k) => !allowed.includes(k))) return bad("Campos no permitidos", 400, "BAD_BODY");'));
  assert.ok(ROUTE.includes('set_showcase: ["action", "cardUids", "expectedVersion"]'));
  assert.ok(!/body\.(userId|user_id|playerId|targetUserId)/.test(code(ROUTE)), "el cuerpo no dice de quién es el perfil");
});

test("60 · id de perfil validado (UUID) en ruta y servicio; me=1 exige sesión", () => {
  assert.ok(ROUTE.includes('if (!UUID.test(id)) return bad("Jugador no válido");'));
  assert.ok(SERVICE.includes('if (!isUuid(playerId)) return fail(400, "Jugador no válido");'));
  assert.ok(ROUTE.includes('if (q.has("me")) {\n      if (!session) return bad("No autenticado", 401);'));
});

test("63–65 · consultas acotadas y agrupadas; sin service key en cliente; rate limit de lectura y escritura", () => {
  assert.ok(SERVICE.includes("const MAX_INSTANCES = 20_000;") && SERVICE.includes(".range(from, from + PAGE - 1)"));
  assert.ok(SERVICE.includes(".limit(100)") && SERVICE.includes('.in("achievement_id", [...CATALOG_IDS])'));
  assert.ok(!/for \(const [a-z]+ of [a-zA-Z]+\) \{[^}]*await sb\.from/.test(code(SERVICE)), "ninguna consulta por carta, logro o partida");
  assert.ok(!/service_role|SUPABASE_SERVICE|SERVICE_KEY/i.test(CLIENT + UI + PAGE));
  assert.equal(RATE_POLICY.profile_read.limit, 60);
  assert.equal(RATE_POLICY.profile_write.limit, 20);
  assert.ok(ROUTE.includes('takeRate(admin, session?.userId ?? anonSubject(req), "profile_read")') && ROUTE.includes('takeRate(session.admin, session.userId, "profile_write")'));
  assert.ok(ROUTE.includes('createHash("sha256")'), "la IP anónima no se guarda en claro");
});

test("avatar: el servidor solo acepta el conjunto cerrado de emojis; el perfil nunca lo pinta como imagen", () => {
  assert.ok(SERVICE.includes('if (!isAllowedAvatar(avatar)) return fail(400, "Avatar no válido", "BAD_AVATAR");'));
  assert.ok(!/<img[^>]*avatar|src=\{[^}]*avatar/.test(UI));
  assert.ok(COMP("bits.tsx").includes('aria-label={t("Avatar de {username}", { username })}'));
});

test("un 5xx del servicio nunca viaja crudo", () => {
  assert.ok(ROUTE.includes("if (!r.ok && r.status >= 500 && r.code !== \"NOT_READY\")"));
});

/* ───────────────────────────── competitivo, social, Pick'ems ───────────────────────────── */

test("49–51 · el ranked se lee de getCompetitivePlayer (Fase 28): mismo rating, posición y W/L/D; sin tiers inventados", () => {
  assert.ok(SERVICE.includes("getCompetitivePlayer(sb, viewerId ?? playerId, playerId)"));
  assert.ok(!/duel_pvp_settle|duel_pvp_ratings"\)\.(update|insert|upsert)|kFactor|K_ESTABLISHED/.test(code(SERVICE)));
  assert.ok(!/Bronce|Plata|Platino|Diamante|Inmortal|Radiante|RankBadge|RankEmblem|rankProgress/.test(code(UI).replace(/"Oro"/g, "")));
  assert.ok(COMP("ProfileSections.tsx").includes("<RecentForm form={r.form} streak={r.streak} />"), "forma reciente reutilizada");
  assert.ok(COMP("ProfileSections.tsx").includes("outcomeTone(m.outcome as MatchOutcome)") && COMP("ProfileSections.tsx").includes("OUTCOME_LABEL[m.outcome as MatchOutcome]"));
});

test("41–44, 48 · acciones sociales = SocialActions de la Fase 29; nunca en el perfil propio; si el social cae, el perfil sigue", () => {
  // F89 · las acciones sociales solo existen en la vista PÚBLICA (`PublicProfileView`); la del propietario no las recibe.
  assert.ok(PAGE.includes('social={user ? <SocialActions playerId={snap.player.userId}'));
  assert.ok(PAGE.indexOf("<PublicProfileView") < PAGE.indexOf("social={user ? <SocialActions") && PAGE.indexOf("<ProfileOwnerView") < PAGE.indexOf("<PublicProfileView"));
  assert.ok(!/social=/.test(PAGE.slice(PAGE.indexOf("<ProfileOwnerView"), PAGE.indexOf("<PublicProfileView"))), "la vista del propietario no lleva acciones sociales");
  assert.ok(read("src", "components", "social", "SocialActions.tsx").includes("catch { /* el perfil competitivo sigue */ }"));
  assert.ok(COMP("PlayerHero.tsx").includes('{snap.view !== "SELF" && social &&'));
  assert.ok(COMP("PlayerHero.tsx").includes('snap.view === "SELF" ?') && COMP("PlayerHero.tsx").includes("Editar perfil"));
});

test("54–56 · Pick'ems: solo pickem_scores (ya corregidos) y títulos; nunca respuestas ni envíos", () => {
  assert.ok(SERVICE.includes('sb.from("pickem_scores").select("pickem_event_id, points, correct, total, scored_at").eq("user_id", playerId)'));
  assert.ok(!/pickem_answers|pickem_submissions|pickem_questions/.test(code(SERVICE)));
  assert.ok(COMP("ProfileSections.tsx").includes("nunca una elección antes de su cierre"));
});

test("sin estadísticas inventadas ni sistemas nuevos (bio, enlaces, feed, seguidores, clanes, trading)", () => {
  const all = code(UI) + code(SERVICE) + code(DOMAIN) + code(ROUTE);
  assert.ok(!/Skill \d|Prestigio \d|Collector Score|Puntuación de coleccionista/i.test(all));
  assert.ok(!/\bbio\b|twitter|twitch|discord|followers|seguidores|clan|trade|gift|regalo|spectat|chat/i.test(all));
  assert.ok(!/<textarea/.test(UI));
});

/* ───────────────────────────── regresión (66–84) ───────────────────────────── */

test("66–79 · colección, packs, duelo, ranked, social, Pick'ems, Live Events, XP y recompensas de logros intactos", () => {
  for (const f of [
    "src/collection/engine.ts", "src/collection/filter.ts", "src/components/cards/CardRenderer.tsx", "src/components/visual/Card3D.tsx", "src/components/cards/CardViewer.tsx",
    "src/domain/packs/openPack.ts", "src/pack/engine.ts", "src/data/packs.ts", "src/domain/cardgame/combat/index.ts", "src/server/services/duelsRating.ts",
    // F85 · `social.ts` usa ahora el perfil público (comparación lado a lado): sale de esta lista de «no cambia en F31».
    "src/server/services/duelsMatchmaking.ts", "src/server/services/duelsPvp.ts", "src/server/services/pickems.ts",
    "src/server/services/liveEvents.ts", "src/domain/progression/levels.ts", "src/domain/progression/achievements.ts", "src/server/services/progression.ts",
    "src/lib/esports/autosync/runner.ts", "src/data/teamIdentities.ts",
  ]) {
    if (!existsSync(join(process.cwd(), ...f.split("/")))) continue;
    assert.ok(!/Fase 31|FASE 31|playerIdentity|player_profile_customization/.test(read(...f.split("/"))), `${f} no cambia en esta fase`);
  }
  assert.ok(!/award\(|app_grant_reward|claimAchievement/.test(code(SERVICE)), "destacar un logro no paga nada");
});

test("80–84 · Marketplace OFF; 0046/0047/0048/0049 aplicadas en la Fase 35.1; 0049 es la del perfil", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  const files = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  // Fase 32 añade la 0050 (equipo activo): la intención de este test es que la 0049 sea la migración del perfil,
  // única y sin aplicar, no que ninguna fase posterior pueda tener la suya (mismo criterio que social.contract · 65).
  assert.ok(files.some((f) => f.startsWith("0049_player_profile_customization")), "0049 es la migración del perfil");
  assert.equal(files.filter((f) => f.startsWith("0049_")).length, 1);
  for (const n of ["0046", "0047", "0048", "0049"]) assert.ok(/— APLICADA \(VPS 2026-09-15, Fase 35\.1\)\.$/.test(read("supabase", "migrations", files.find((x) => x.startsWith(n))!).split("\n")[0]), n);
  assert.ok(MIG46.includes("'player_profile'"));
});

/* ───────────────────────────── telemetría, accesibilidad, móvil, arnés ───────────────────────────── */

test("telemetría: cinco contextos con puerta; los cuatro que tienen gesto en el perfil se usan; flujo reservado en 0046 sin aplicar", () => {
  assert.deepEqual([...PROFILE_CONTEXTS], ["profile_view", "profile_edit", "showcase_edit", "showcase_card_view", "achievement_feature"]);
  // PERFIL = IDENTIDAD · ya no hay cartas que abrir en el perfil: `showcase_card_view` queda declarado pero sin gesto aquí.
  for (const c of PROFILE_CONTEXTS.filter((x) => x !== "showcase_card_view")) assert.ok(PAGE.includes(`"${c}"`), c);
  assert.ok(!PAGE.includes('"showcase_card_view"'));
  assert.equal(isFlow(PROFILE_FLOW), false);
});

test("accesibilidad: serie y rareza en texto, cartas pulsables con etiqueta, pestañas, foco, táctil 44, W/L con letra", () => {
  const sc = COMP("CardShowcase.tsx");
  assert.ok(sc.includes('data-field="serial"') && sc.includes("{s.rarityLabel}"));
  assert.ok(sc.includes("label={`Ver ${s.nick}, ${s.variantLabel}, ${serialText(s.serial, s.serialLimit)}`}"));
  assert.ok(COMP("ShowcaseEditor.tsx").includes('role="tablist"') && COMP("ShowcaseEditor.tsx").includes("aria-selected={tab === id}"));
  assert.ok((UI.match(/min-h-\[44px\]|h-11 w-11/g) ?? []).length >= 10);
  assert.ok((UI.match(/nx-focus/g) ?? []).length >= 10);
  assert.ok(COMP("ProfileSections.tsx").includes('{m.letter ?? "—"}'));
  assert.ok(COMP("PlayerHero.tsx").includes("<h1"));
  assert.ok(!/aria-live="assertive"/.test(UI));
});

test("móvil 390: vitrina en carrusel con snap y la destacada primero; hero y estadísticas en dos columnas", () => {
  const sc = COMP("CardShowcase.tsx");
  assert.ok(sc.includes("snap-x snap-mandatory") && sc.includes("snap-center") && sc.includes("order-first lg:order-2"));
  assert.ok(COMP("PlayerHero.tsx").includes("grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:gap-8"));
  // F89 · las estadísticas viven en ProfileCareer (todas las partidas): misma rejilla de 2 columnas en móvil.
  assert.ok(COMP("ProfileCareer.tsx").includes("grid grid-cols-2 gap-x-6 gap-y-4"));
});

test("arnés QA: escenas del brief, datos QA SYNTHETIC solo en el arnés", () => {
  for (const s of ["own-full", "public-full", "new-player", "no-cards", "empty-showcase", "showcase-one", "showcase-full", "low-serial", "duplicates", "editor", "instance-picker", "save-showcase", "achievement-editor", "no-achievements", "unranked", "h2h", "friend", "unknown", "pending", "blocked", "social-unavailable", "pickems", "no-pickems", "account-preview", "leaderboard", "search", "share", "backend-error", "not-found", "no-session"]) {
    assert.ok(HARNESS.includes(`"${s}"`), s);
  }
  assert.ok(FIXTURES.includes("QA SYNTHETIC"));
  assert.ok(!/design-system\/fase31/.test(code(SERVICE) + code(ROUTE) + code(PAGE) + code(CLIENT)));
});
