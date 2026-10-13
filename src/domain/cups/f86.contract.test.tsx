/**
 * F86 · TORNEOS — contratos (migración 0069, autoridad, aislamiento, privacidad, menú, perfil, hidratación) y render de
 * las vistas reales con los fixtures del arnés. La atomicidad sobre Postgres (carreras, CHECK, guardias, paridad SQL ⇄
 * dominio en los 61 tamaños, rollback) está en `scripts/ops/_cups-dryrun.sh`; el camino del servidor, en
 * `server/services/f86.cups.service.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV_SECTIONS } from "@/design/nav";
import { ADMIN_SECTIONS } from "@/domain/admin/nav";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { badgeFact, cupBadgeFact, cupBadgeId } from "@/domain/collectionSets/badges";
import { CupDetailView } from "@/components/cups/CupDetailScreen";
import { CupsHubView } from "@/components/cups/CupsHubScreen";
import { CupBracket } from "@/components/cups/CupBracket";
import { PvpOutcome } from "@/components/duel/pvp/PvpOutcome";
import { remainingText } from "@/components/cups/CupParts";
import {
  HUB, HUB_EMPTY, DETAIL_OPEN, DETAIL_REGISTERED, DETAIL_FULL, DETAIL_LIVE_8, DETAIL_LIVE_64, DETAIL_CHAMPION, DETAIL_COMPLETED_PUBLIC, DETAIL_CANCELLED, DETAIL_SCHEDULED,
  DETAIL_BEFORE_READY,
} from "@/app/design-system/cups/fixtures";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const MIG = read("supabase", "migrations", "0069_player_cups.sql");
const RB = read("docs", "operations", "rollback", "0069_player_cups.ROLLBACK.sql");
const SERVICE = read("src", "server", "services", "cups.ts");
const ROUTE = read("src", "app", "api", "game", "cups", "route.ts");
const PVP = read("src", "server", "services", "duelsPvp.ts");
const SOCIAL = read("src", "server", "services", "social.ts");
const ADMIN = read("src", "server", "admin", "cups.ts");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

test("F86-C1 · 0069: tres tablas solo servidor (RLS sin políticas, sin privilegios de cliente), RPC solo service_role", () => {
  for (const t of ["cups", "cup_registrations", "cup_matches"]) {
    assert.ok(MIG.includes(`create table if not exists public.${t} (`), t);
    assert.ok(MIG.includes(`alter table public.${t} enable row level security;`), `${t} RLS`);
  }
  assert.ok(MIG.includes("revoke all on public.cups, public.cup_registrations, public.cup_matches from anon, authenticated;"));
  assert.ok(!/create policy/i.test(MIG), "sin políticas: el navegador no lee ni escribe torneos");
  assert.ok(MIG.includes("execute format('revoke all on function %s from public, anon, authenticated', f);"));
  assert.ok(MIG.includes("execute format('grant execute on function %s to service_role', f);"));
  assert.match(MIG, /has_function_privilege\('authenticated', 'public\.cup_settle_game\(uuid\)', 'EXECUTE'\)/);
});

test("F86-C2 · restricciones en la BD: inscripción única, capacidad, un cruce por posición, jugadores distintos, ganador participante, una partida por cruce, un dueño por trofeo, ciclo de vida", () => {
  assert.ok(MIG.includes("primary key (cup_id, user_id)"), "una inscripción por cuenta y torneo");
  assert.ok(MIG.includes("constraint cups_capacity check (participant_count <= max_participants)"), "nunca 65 de 64");
  assert.ok(MIG.includes("unique (cup_id, round, slot)"), "un cruce por posición: un solo cuadro");
  assert.ok(MIG.includes("constraint cup_matches_distinct check (player_a is null or player_b is null or player_a <> player_b)"));
  assert.ok(MIG.includes("constraint cup_matches_winner check (winner_id is null or winner_id = player_a or winner_id = player_b)"));
  assert.ok(MIG.includes("game_match_id     uuid unique,"), "exactamente una partida por cruce y viceversa");
  assert.ok(MIG.includes("create unique index if not exists user_cosmetics_cup_trophy_once on public.user_cosmetics (cosmetic_id) where cosmetic_id like 'insignia:torneo:%';"));
  assert.ok(MIG.includes("create unique index if not exists cup_registrations_seed_key on public.cup_registrations (cup_id, seed) where seed is not null;"));
  assert.ok(MIG.includes("max_participants      int not null check (max_participants between 4 and 64)"));
  assert.ok(MIG.includes("constraint cups_lifecycle check ("));
  assert.ok(MIG.includes("constraint cup_matches_decided check ((status in ('COMPLETED', 'BYE')) = (winner_id is not null))"));
});

test("F86-C3 · guardias de escritura para TODO rol: estado, ganador, seed y avance solo por sus RPC (drl.cup_writer); publicado = solo texto; nada publicado se borra", () => {
  assert.ok(MIG.includes("create trigger cups_guard before insert or update or delete on public.cups"));
  assert.ok(MIG.includes("create trigger cup_registrations_guard before insert or update or delete on public.cup_registrations"));
  assert.ok(MIG.includes("create trigger cup_matches_guard before insert or update or delete on public.cup_matches"));
  assert.ok(MIG.includes("raise exception 'CUP_WRITE_FORBIDDEN: % solo cambia por las RPC de torneo', tg_table_name"));
  assert.ok(MIG.includes("raise exception 'CUP_LOCKED: un torneo publicado solo admite cambios de texto'"));
  assert.ok(MIG.includes("raise exception 'CUP_IMMUTABLE: solo se puede borrar un borrador'"));
  assert.ok(MIG.includes("raise exception 'CUP_FINAL: un torneo terminado o cancelado no cambia'"));
  // Cada RPC que escribe levanta la bandera y la baja al terminar.
  for (const fn of ["cup_register", "cup_withdraw", "cup_generate", "cup_ready", "cup_mark_active", "cup_start_failed", "cup_settle_game", "cup_admin_publish", "cup_admin_cancel", "cup_admin_resolve"]) {
    const body = MIG.slice(MIG.indexOf(`create or replace function public.${fn}(`));
    const end = body.indexOf("end $$;");
    assert.ok(body.slice(0, end).includes("perform set_config('drl.cup_writer', 'on', true);"), fn);
  }
});

test("F86-C4 · autoridad: cerrojo de la copa en cada RPC; generar UNA vez; el resultado lo lee la BD del MOTOR (status/winner/closed_by), nunca del cliente; empate o cierre = retenido; jamás sorteo", () => {
  for (const fn of ["cup_register", "cup_withdraw", "cup_generate", "cup_ready", "cup_settle_game", "cup_admin_publish", "cup_admin_cancel", "cup_admin_resolve"]) {
    const body = MIG.slice(MIG.indexOf(`create or replace function public.${fn}(`));
    assert.ok(body.slice(0, body.indexOf("end $$;")).includes("from public.cups where id = "), `${fn} lee la copa`);
    assert.ok(/for update/.test(body.slice(0, body.indexOf("end $$;"))), `${fn} toma el cerrojo`);
  }
  assert.ok(MIG.includes("if c.started_at is not null then return jsonb_build_object('code', 'ALREADY'"));
  assert.ok(MIG.includes("v_winner := case when d.closed_by = d.user_id then d.player_b_id else d.user_id end; v_res := 'ABANDON';"));
  assert.ok(MIG.includes("v_winner := case when d.winner = 'A' then d.user_id else d.player_b_id end; v_res := 'PLAYED';"));
  assert.ok(MIG.includes("update public.cup_matches set status = 'ACTION_REQUIRED' where id = v_id;"));
  assert.ok(!/random\(\)/i.test(MIG), "ningún sorteo en la SQL (los seeds se desempatan por md5 estable)");
  assert.ok(MIG.includes("md5(p_cup::text || ':' || g.user_id::text) collate \"C\" asc"));
  assert.ok(!/winner|seed|userId|advance|champion|trophy/i.test(ROUTE.match(/const KEYS = new Set\(\[[^\]]*\]\)/)![0]), "el cuerpo del jugador no admite ganador, seed, usuario, avance ni trofeo");
  assert.ok(ROUTE.includes("if (extra) return bad(`Campo no permitido: ${extra.slice(0, 40)}`);"));
  assert.ok(ADMIN.includes('readBody(req, ["action", "id", "version", "fields", "reason", "confirm", "round", "slot", "decision"])'), "lista blanca del panel");
  assert.ok(!/update\(\{[^}]*winner_id/.test(ADMIN + SERVICE), "ningún servicio escribe un ganador a mano");
});

test("F86-C5 · aislamiento: partida = PVP_PRIVATE del motor (sin rating, sin misiones, sin XP, sin tope de parejas); el gancho solo mira PVP_PRIVATE; Social excluye los cruces", () => {
  assert.ok(SERVICE.includes('{ matchId: game, mode: "PVP_PRIVATE" }'), "la partida nace como PVP_PRIVATE por createPvpMatch");
  assert.ok(PVP.includes('if (rec.mode !== "PVP") return false;'), "el rating sigue exigiendo ranked");
  assert.ok(PVP.includes('{ mode: "RANKED", difficulty: null, finished: true }'), "las misiones PvP siguen siendo solo ranked");
  assert.ok(PVP.includes('if (rec.mode !== "PVP_PRIVATE") return;') && PVP.includes("await settleCupGame(sb, rec.id);"));
  assert.ok(SOCIAL.includes("return withoutCupGames(sb, (data ?? []) as MatchDbRow[]);"), "cara a cara y rivales recientes sin cruces de torneo");
  assert.ok(!/credit_transactions|user_packs|_ledger_apply|app_grant_reward|user_cards/.test(MIG), "0 créditos, 0 sobres, 0 cartas: sin economía");
  assert.ok(!/season_xp|app_season_apply|mission_events|duel_pvp_rating_events/.test(MIG), "sin XP de temporada, misiones ni libro de rating");
});

test("F86-C6 · rollback: quita tablas, RPC y guardias; NO quita trofeos ganados ni partidas jugadas", () => {
  for (const t of ["cups", "cup_registrations", "cup_matches"]) assert.ok(RB.includes(`drop table if exists public.${t};`));
  assert.ok(RB.includes("drop function if exists public.cup_settle_game(uuid);"));
  assert.ok(!/delete from public\.user_cosmetics/.test(RB.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")), "no borra trofeos");
  assert.ok(!/duel_matches/.test(RB.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")), "no toca partidas");
});

test("F86-C7 · menú: «Torneos» en Jugar (≤ 7) con indicador; Pick'ems sigue vivo en su ruta; admin en el panel existente; cubetas propias", () => {
  const jugar = NAV_SECTIONS.find((s) => s.id === "jugar")!;
  const item = jugar.items.find((i) => i.href === "/copas");
  assert.ok(item && item.label === "Torneos" && item.badge === "cup");
  assert.ok(jugar.items.length <= 7);
  assert.ok(existsSync(join(process.cwd(), "src/app/pickems/page.tsx")), "Pick'ems no se borra");
  assert.ok(jugar.items.some((i) => i.href === "/torneos" && i.label === "Eventos"), "la capa esports sigue siendo «Eventos»");
  assert.ok(ADMIN_SECTIONS.some((s) => s.href === "/admin/copas"));
  assert.ok(ADMIN.includes('runAdmin(req, deps, "admin_write"') && ADMIN.includes('runAdmin(req, deps, "admin_read"'), "el admin de siempre (is_admin), sin roles nuevos");
  assert.ok(!/tournament_admin|moderator|permissions/i.test(MIG + ADMIN));
  assert.equal(RATE_POLICY.cup_write.limit, 30); assert.equal(RATE_POLICY.cup_read.limit, 60);
});

test("F86-C8 · perfil intacto: la tarjeta de identidad no lee torneos; el historial vive en /copas y el trofeo en la Sala de Trofeos", () => {
  const card = read("src", "components", "player", "ProfileIdentityCard.tsx");
  assert.ok(!/cup|torneo|tournament/i.test(card.replace(/\/\*[\s\S]*?\*\//g, "")), "sin datos de torneo en el perfil");
  assert.ok(read("src", "components", "cups", "CupsHubScreen.tsx").includes('aria-labelledby="cup-history"'));
});

test("F86-C9 · trofeo canónico F82: tipo TOURNAMENT con torneo y fecha reales; sin el torneo no se pinta", () => {
  const info = new Map([["valorosters-open-1", { name: "Valorosters Open #1", completedAt: "2026-10-12T21:00:00Z" }]]);
  const f = cupBadgeFact(cupBadgeId("valorosters-open-1"), info)!;
  assert.equal(f.kind, "TOURNAMENT"); assert.equal(f.label, "Campeón · Valorosters Open #1"); assert.equal(f.caption, "Torneo · 12 oct 2026");
  assert.equal(badgeFact("insignia:torneo:valorosters-open-1", new Map(), info)?.kind, "TOURNAMENT", "por la puerta canónica");
  assert.equal(cupBadgeFact("insignia:torneo:otro", info), null, "nada a ciegas");
  assert.equal(cupBadgeFact("insignia:torneo:../x", info), null);
});

test("F86-C10 · hidratación (F81.2/F85): la foto va atada a la cuenta que la pidió; al cambiar de sesión se descarta", () => {
  for (const f of ["CupDetailScreen.tsx", "CupsHubScreen.tsx"]) {
    const s = read("src", "components", "cups", f);
    assert.ok(s.includes("if (reqFor.current !== who) return;"), `${f}: respuesta de otra cuenta descartada`);
    assert.ok(s.includes("setState((s) => (s && s.for === viewer ? s : null));"), `${f}: nunca la foto de otra cuenta`);
    assert.ok(/state && state\.for === viewer|s\.for === viewer/.test(s));
  }
  const d = read("src", "components", "cups", "CupDetailScreen.tsx");
  assert.ok(d.includes("decks && decks.for === viewer ? decks.list : null"), "los equipos también son de la cuenta actual");
});

test("F86-R1 · ficha abierta: nombre grande, estado en texto, participantes, cuenta atrás accesible, INSCRIBIRME; INSCRITO ✓ + RETIRARME; COMPLETO; sin sesión «Entra para inscribirte»", () => {
  const open = html(<CupDetailView detail={DETAIL_OPEN} signedIn decks={[]} />);
  assert.match(open, /data-testid="cup-name"[^>]*>Valorosters Open #1</);
  assert.ok(open.includes(">Inscripción abierta<") && open.includes('data-testid="cup-register"') && open.includes(">Inscribirme<"));
  assert.match(open, /<time dateTime="[^"]+" title="[^"]+" aria-label="La inscripción cierra en /);
  assert.ok(open.includes("Trofeo de campeón") && !/cr[eé]ditos|sobres? de premio/i.test(open.replace(/no hay premios en créditos ni sobres/, "")));
  const reg = html(<CupDetailView detail={DETAIL_REGISTERED} signedIn decks={[]} />);
  assert.ok(reg.includes(">Inscrito ✓<") && reg.includes('data-testid="cup-withdraw"'));
  const full = html(<CupDetailView detail={DETAIL_FULL} signedIn decks={[]} />);
  assert.ok(full.includes(">Completo<") && !full.includes('data-testid="cup-register"'), "lleno: no hay botón que vaya a fallar");
  const anon = html(<CupDetailView detail={{ ...DETAIL_OPEN, me: null }} signedIn={false} decks={null} />);
  assert.ok(anon.includes("Entra para inscribirte"));
  const sched = html(<CupDetailView detail={DETAIL_SCHEDULED} signedIn decks={[]} />);
  assert.ok(sched.includes("Inscripciones abren en"));
});

test("F86-R2 · en curso: TU PARTIDA ESTÁ LISTA con rival (#TAG), ronda, plazo, equipo y JUGAR; cuadro con nombres de ronda verdaderos y «Ver mi partida»", () => {
  // F86.1 · nadie listo → «Tu partida está lista» + JUGAR; con el rival ya listo → «Tu rival ya está listo» + «Jugar ya».
  const before = html(<CupDetailView detail={DETAIL_BEFORE_READY} signedIn decks={[{ id: "d1", name: "Equipo", valid: true } as never]} activeDeckId="d1" />);
  assert.ok(before.includes(">Tu partida está lista<") && before.includes('data-testid="cup-play"') && before.includes(">Jugar<"));
  const live = html(<CupDetailView detail={DETAIL_LIVE_8} signedIn decks={[{ id: "d1", name: "Equipo", valid: true } as never]} activeDeckId="d1" />);
  assert.ok(live.includes(">Tu rival ya está listo<") && live.includes(">Jugar ya<"));
  assert.ok(live.includes("✓ Tu rival está listo"));
  assert.ok(live.includes(">Semifinal<"));
  for (const n of ["Cuartos de final", "Semifinal", "Final"]) assert.ok(live.includes(n), n);
  assert.ok(live.includes('data-testid="cup-go-mine"') && live.includes(">Ver mi partida<"));
  assert.ok(!/mi rival no vino|reclamar victoria/i.test(live), "nadie gana por pulsar «mi rival no vino»");
  const b64 = html(<CupBracket rounds={DETAIL_LIVE_64.bracket!} />);
  for (const n of ["Ronda de 64", "Ronda de 32", "Ronda de 16", "Cuartos de final", "Semifinal", "Final"]) assert.ok(b64.includes(`>${n}<`), n);
  // Escritorio: el árbol entero (63). Móvil: solo la ronda abierta (la mía: ronda de 32 → 16), nunca 63 tarjetas encogidas.
  assert.equal((b64.match(/data-testid="cup-match"/g) ?? []).length, 63 + 16, "63 cruces del árbol + la ronda de la pestaña, sin pedir nada más");
  assert.ok(b64.includes('data-state="ACTIVE"') && b64.includes(">En juego<"), "EN JUEGO sin marcador inventado");
  assert.ok(b64.includes('data-state="ACTION_REQUIRED"') && b64.includes(">En revisión<"));
  assert.match(b64, /aria-label="Ronda de 64, cruce 1: [^"]+ contra [^"]+, gana [^"]+\. Terminada\."/, "cada cruce se lee entero (no solo color)");
  assert.ok(b64.includes('role="tablist" aria-label="Rondas"') && b64.includes('role="tab"'), "móvil: pestañas por ronda");
});

test("F86-R3 · final: CAMPEÓN (jugador, #TAG, torneo, trofeo); el campeón ve su celebración; los demás, el campeón; cancelado sin campeón", () => {
  const champ = html(<CupDetailView detail={DETAIL_CHAMPION} signedIn decks={[]} />);
  assert.ok(champ.includes('data-testid="cup-champion"') && champ.includes(">¡Eres el campeón!<") && champ.replace(/<[^>]+>/g, "").includes("Tu trofeo ya está en tu Sala de Trofeos.")); // F86.2 · «Sala de Trofeos» ahora es un enlace
  const pub = html(<CupDetailView detail={DETAIL_COMPLETED_PUBLIC} signedIn={false} decks={null} />);
  assert.ok(pub.includes(">Campeón<") && !pub.includes("¡Eres el campeón!"));
  const c = html(<CupDetailView detail={DETAIL_CANCELLED} signedIn decks={[]} />);
  assert.ok(c.includes("Torneo cancelado.") && c.includes("No se alcanzó el mínimo de 4 inscritos.") && !c.includes('data-testid="cup-champion"'));
});

test("F86-R4 · hub: partida lista primero, mis torneos, secciones, archivo con «Ver más», historial; vacío honesto", () => {
  const h = html(<CupsHubView hub={HUB} signedIn onMore={() => {}} />);
  assert.ok(h.indexOf('data-testid="cup-ready-banner"') < h.indexOf('data-testid="cup-section-mis-torneos"'));
  for (const s of ["En inscripción", "Próximos", "En curso", "Finalizados", "Mis torneos", "Tu historial"]) assert.ok(h.includes(s), s);
  assert.ok(h.includes('data-testid="cups-more"'));
  assert.ok(h.includes("Sala de Trofeos"));
  const e = html(<CupsHubView hub={HUB_EMPTY} signedIn />);
  assert.ok(e.includes("No hay torneos abiertos ahora") && !e.includes('data-testid="cup-card"'), "sin torneos inventados");
});

test("F86-R5 · resultado de un cruce: sin rating, sin escalera, SIN revancha; «Volver al torneo»", () => {
  const out = html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={null} outcome={null} rating={null} onAgain={() => {}} onBack={() => {}}
    cupMatch={{ name: "Valorosters Open #1", roundName: "Semifinal", href: "/copas/valorosters-open-1" }} />);
  assert.ok(out.includes('data-mode="CUP"') && out.includes("Volver al torneo") && out.includes("Torneo · Semifinal"));
  assert.ok(!out.includes("Rating PvP") && !out.includes("Revancha") && !out.includes("Buscar otro rival") && !out.includes("Escalera ranked"));
  assert.ok(read("src", "app", "duelos", "pvp", "page.tsx").includes("privateDuel={privada && !cupDeEsta ? {"), "el panel con revancha no aparece en un cruce");
});

test("F86-R6 · cuenta atrás legible (la elegibilidad la decide el servidor)", () => {
  assert.equal(remainingText(0), "ahora");
  assert.equal(remainingText(90_000), "1 min");
  assert.equal(remainingText(3 * 3_600_000 + 5 * 60_000), "3 h 5 min");
  assert.equal(remainingText(2 * 86_400_000 + 3_600_000), "2 d 1 h");
});
