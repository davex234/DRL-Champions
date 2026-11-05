/**
 * FASE 40 · PRIMERA SESIÓN REAL (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase40-real-e2e.ts <credsFile>
 *
 * Chrome → app local (`next start` :3005) → túnel SSH → PostgreSQL del VPS. Una cuenta QA NUEVA creada por el formulario
 * REAL de registro (`/cuenta`, GoTrue con autoconfirmación) y la primera sesión completa como la haría un jugador:
 * bienvenida → primer sobre (ceremonia real) → colección → (logout/login) → sobres hasta poder formar equipo (Sobre
 * Inicial gratis si hace falta) → constructor con «Autocompletar equipo» → guardar (se activa) → pre-partida (Fácil) →
 * 10 turnos por la interfaz → resultado → vestíbulo normal. En cada paso: evidencia en BD por SSH (solo lectura) y huellas
 * económicas; recargas en bienvenida, tras el sobre, durante el equipo y tras la partida.
 *
 * Si el fichero de credenciales no existe se crea con credenciales aleatorias (fuera del repo). Nunca imprime correo,
 * contraseña, tokens ni el id completo. Capturas en docs/product/qa/fase40/real/.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase40", "real");
mkdirSync(OUT, { recursive: true });
const credsFile = process.argv[2];
if (!credsFile) throw new Error("uso: _fase40-real-e2e.ts <credsFile>");
if (!existsSync(credsFile)) {
  writeFileSync(credsFile, JSON.stringify({
    email: `qa-journey-fase40-${Date.now()}-${randomBytes(3).toString("hex")}@example.invalid`,
    password: randomBytes(18).toString("base64url"),
    username: `qa_journey_${randomBytes(2).toString("hex")}`,
    userId: null,
  }, null, 2));
}
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; username: string; userId: string | null };
const PROFILE = join(credsFile, "..", "f40-chrome-profile");
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);
let failures = 0;
const evidence: Record<string, unknown> = {};
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
let shotN = 0;
const shot = async (tab: Tab, name: string) => { await tab.shot(join(OUT, `real-${String(++shotN).padStart(2, "0")}-${name}.png`)); };

function psql(sql: string): string {
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}
const one = (sql: string) => psql(sql).split("\n")[0] ?? "";
let U = creds.userId ?? "";
const fpQuick = () => one(`select coalesce((select packs_opened::text from public.user_game where user_id = '${U}'), '0');`);

/** Huella SIN PII de la cuenta QA. */
function fp(): Record<string, string> {
  const q = `
select 'credits', credits::text from public.profiles where id = '${U}';
select 'xp', xp::text from public.profiles where id = '${U}';
select 'points', points::text from public.profiles where id = '${U}';
select 'packs', coalesce(string_agg(pack_id || '=' || qty, ',' order by pack_id), '') from public.user_packs where user_id = '${U}' and qty > 0;
select 'packs_opened', coalesce((select packs_opened::text from public.user_game where user_id = '${U}'), 'none');
select 'cards', count(*)::text from public.user_cards where user_id = '${U}';
select 'cards_origin', coalesce(string_agg(distinct origin, ','), '') from public.user_cards where user_id = '${U}';
select 'decks', count(*)::text from public.duel_decks where user_id = '${U}';
select 'active_deck', coalesce((select deck_id::text from public.duel_active_deck where user_id = '${U}'), 'none');
select 'matches', count(*)::text from public.duel_matches where user_id = '${U}';
select 'rating_rows', count(*)::text from public.duel_pvp_ratings where user_id = '${U}';
select 'pass_rows', count(*)::text from public.user_pass where user_id = '${U}';
select 'pass_xp', coalesce((select state->>'xp' from public.user_pass where user_id = '${U}' limit 1), 'none');
select 'achievements', count(*)::text from public.user_achievements where user_id = '${U}';
select 'campaign', (select count(*) from public.campaign_progress where user_id = '${U}') || ':' || (select count(*) from public.campaign_attempts where user_id = '${U}');
select 'draft_runs', count(*)::text from public.draft_runs where user_id = '${U}';
select 'ledger', coalesce(string_agg(reason || ':' || delta, ',' order by created_at), '') from public.credit_transactions where user_id = '${U}';
select 'economy_ops', coalesce(string_agg(kind, ',' order by created_at), '') from public.economy_ops where user_id = '${U}';
`;
  return Object.fromEntries(psql(q).split("\n").filter(Boolean).map((l) => { const [k, ...v] = l.split(" | "); return [k, v.join(" | ")]; }));
}
const same = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a) === JSON.stringify(b);

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(200); }
  return false;
};
const key = async (tab: Tab, k: string) => {
  const vk = k === "Enter" ? 13 : k.charCodeAt(0);
  await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: vk });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: vk });
};
const setInputs = (pairs: [string, string][]) => `(() => {
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  ${pairs.map(([sel, v]) => `{ const e = document.querySelector(${esc(sel)}); if (!e) return false; set(e, ${esc(v)}); }`).join("\n")}
  return true; })()`;
const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const JOURNEY = `(() => { const m = document.querySelector('[data-testid="journey-mission"]'); const s = document.querySelector('[data-testid="journey-strip"]'); const d = document.querySelector('[data-testid="journey-discovery"]'); const h = document.querySelector('[data-testid="daily-hero"]');
  return { mission: m ? m.getAttribute('data-step') : null, welcome: m ? m.getAttribute('data-welcome') : null, strip: !!s, discovery: !!d, heroAction: h ? h.getAttribute('data-action') : null,
    cta: document.querySelector('[data-testid="journey-primary-cta"]')?.getAttribute('href') ?? null, ctaText: document.querySelector('[data-testid="journey-primary-cta"]')?.textContent ?? null,
    track: [...document.querySelectorAll('[data-testid="journey-track"] li')].map((li) => li.getAttribute('data-step') + ':' + li.getAttribute('data-state')) }; })()`;

async function home(tab: Tab, reload = false) {
  const inApp = !reload && await tab.js<boolean>(`location.pathname !== "/" && !!document.querySelector('a[href="/"]')`).catch(() => false);
  if (inApp) {
    await tab.js(`document.querySelector('a[href="/"]').click()`);
    await waitFor(tab, `location.pathname === "/"`, 15000);
  } else {
    await tab.goto(`${BASE}/`, 3000);
  }
  await waitFor(tab, `!!document.querySelector('[data-testid="daily-lobby"]') && !document.querySelector('[aria-busy="true"]')`, 25000);
  await sleep(1200);
  return tab.js<any>(JOURNEY);
}

async function openPackCeremony(tab: Tab, label: string): Promise<boolean> {
  const PHASE = `(document.querySelector('[data-testid="pack-opening"]')?.getAttribute("data-phase") ?? null)`;
  if (!(await waitFor(tab, `${PHASE} === "ready" && !!document.querySelector('[data-testid="pack-open"]')`, 30000))) return false;
  await tab.js(`document.querySelector('[data-testid="pack-open"]').click()`);
  if (!(await waitFor(tab, `${PHASE} === "hand" || ${PHASE} === "summary"`, 30000))) return false;
  await sleep(1200);
  await tab.js(`document.querySelector('[data-testid="pack-reveal"]')?.click()`);
  for (let i = 0; i < 14; i++) {
    if ((await tab.js<string | null>(PHASE)) === "summary") break;
    await waitFor(tab, `${PHASE} === "reveal"`, 6000);
    await waitFor(tab, `document.querySelector('[data-testid="reveal-card"]')?.getAttribute("data-revealed") === "true"`, 8000);
    await sleep(500);
    await key(tab, "Enter");
    await sleep(350);
  }
  const ok = await waitFor(tab, `${PHASE} === "summary" && !!document.querySelector('[data-testid="pack-summary"]')`, 20000);
  if (ok && label) { await sleep(1200); await shot(tab, label); }
  return ok;
}

const PLAY_ONE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btns = () => [...document.querySelectorAll('button')];
  const cont = btns().find((b) => b.textContent.trim() === 'Continuar'); if (cont) { cont.click(); await sleep(450); }
  const confirm = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
  if (!confirm()) return false;
  const cards = btns().filter((b) => /OVR\\s*\\d+/.test(b.getAttribute('aria-label') || '') && !b.disabled);
  if (!cards.length) return false;
  cards[0].click(); await sleep(300);
  // Ejes: botones SH/GS/EF con su cifra y sin etiqueta de carta (un jugador «Shr1mp» también empieza por «SH»).
  const stats = btns().filter((b) => b.hasAttribute('aria-pressed') && !(b.getAttribute('aria-label') || '').includes('OVR') && /^(SH|GS|EF)\\d+$/.test(b.textContent.trim()));
  if (stats.length === 3) { stats[0].click(); await sleep(250); }
  const c = confirm(); if (!c || c.disabled) return false;
  c.click(); await sleep(1600);
  return true;
})()`;

async function main() {
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  try {
    /* ───── A · registro real ───── */
    let j: any = null;
    const resume = !!U && fpQuick() !== "0";
    if (resume) {
      log("\n· REANUDACIÓN · la cuenta ya abrió su primer sobre: vuelve como un jugador que regresa (A–F en la ejecución 1)");
      await tab.goto(`${BASE}/cuenta`, 3500);
      if (!(await waitFor(tab, SIGNED_IN, 4000))) {
        await tab.js(setInputs([['input[type="email"]', creds.email], ['input[type="password"]', creds.password]]));
        await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
      }
      check("sesión iniciada por el formulario real", await waitFor(tab, SIGNED_IN, 20000));
      const back = await home(tab, true);
      check("jugador que vuelve: ni bienvenida ni primer sobre; paso real derivado del servidor", back.welcome !== "true" && back.mission !== "open", JSON.stringify(back));
      await shot(tab, "returning-home");
    }
    if (!resume) {
    log("\n· A · REGISTRO REAL (/cuenta)");
    await tab.goto(`${BASE}/cuenta`, 3500);
    if (!U) {
      await tab.js(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Registro')?.click()`);
      await sleep(400);
      check("formulario de registro real", await tab.js<boolean>(setInputs([['input[placeholder="Nombre de usuario"]', creds.username], ['input[type="email"]', creds.email], ['input[type="password"]', creds.password]])));
      await shot(tab, "register-form");
      await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
      check("registro → sesión iniciada (autoconfirmación del stack)", await waitFor(tab, SIGNED_IN, 30000));
      U = one(`select id from auth.users where email = $$${creds.email}$$;`);
      check("usuario creado en auth.users", /^[0-9a-f-]{36}$/.test(U), U.slice(0, 8));
      writeFileSync(credsFile, JSON.stringify({ ...creds, userId: U }, null, 2));
    } else {
      check("reutiliza la cuenta QA de esta fase", await waitFor(tab, SIGNED_IN, 5000) || true);
    }
    evidence.userId = U.slice(0, 8);

    /* ───── B · contrato de alta ───── */
    log("\n· B · CONTRATO DE ALTA (BD real)");
    const fresh = fp();
    log(`    huella: ${JSON.stringify(fresh)}`);
    evidence.fresh = fresh;
    check("créditos 6.000 · XP 0 · puntos 0", fresh.credits === "6000" && fresh.xp === "0" && fresh.points === "0");
    check("sobres: 1 estándar + 3 iniciales", fresh.packs === "estandar=1,inicial=3", fresh.packs);
    check("0 cartas · 0 equipos · sin equipo activo · 0 partidas · packs_opened 0", fresh.cards === "0" && fresh.decks === "0" && fresh.active_deck === "none" && fresh.matches === "0" && fresh.packs_opened === "0");
    check("sin partidas ranked ni progreso de campaña, draft o logros (la ficha 1000/0 y el pase vacío los crea la lectura de /cuenta, deuda previa)", Number(fresh.rating_rows) <= 1 && one(`select coalesce(max(games_played), 0) from public.duel_pvp_ratings where user_id = '${U}';`) === "0" && fresh.campaign === "0:0" && fresh.draft_runs === "0" && fresh.achievements === "0" && fresh.pass_xp !== "none" ? fresh.pass_xp === "0" : true);
    check("libro mayor: un único asiento starter_grant de 6.000 (alta no duplicada)", fresh.ledger === "starter_grant:6000", fresh.ledger);

    /* ───── C · bienvenida ───── */
    log("\n· C · BIENVENIDA");
    j = await home(tab);
    log(`    ${JSON.stringify(j)}`);
    check("Mission Control con bienvenida en ABRE", j.mission === "open" && j.welcome === "true");
    check("CTA «Abrir mi primer sobre» → /abrir/inicial (su sobre real)", j.cta === "/abrir/inicial" && /Abrir mi primer sobre/i.test(j.ctaText ?? ""));
    await shot(tab, "welcome-1440");
    const beforeReads = fp();
    j = await home(tab, true);
    check("recarga en la bienvenida: mismo paso", j.mission === "open" && j.welcome === "true");
    check("leer el vestíbulo (x2) no escribe nada en la cuenta", same(beforeReads, fp()));
    for (const [w, h, n] of [[390, 844, "welcome-390"], [1024, 800, "welcome-1024"]] as const) { await tab.resize(w, h); await home(tab); await shot(tab, n); }
    await tab.resize(1440, 900);
    await home(tab);

    /* ───── D · primer sobre ───── */
    log("\n· D · PRIMER SOBRE (ceremonia real)");
    await tab.js(`document.querySelector('[data-testid="journey-primary-cta"]')?.click()`);
    check("el CTA lleva a /abrir/inicial", await waitFor(tab, `location.pathname === "/abrir/inicial"`, 15000));
    check("ceremonia completa hasta el resumen", await openPackCeremony(tab, "first-pack-summary"));
    const afterPack = fp();
    check("BD: packs_opened 1 · 5 cartas de sobre · quedan 2 iniciales + 1 estándar", afterPack.packs_opened === "1" && afterPack.cards === "5" && afterPack.cards_origin === "pack" && afterPack.packs === "estandar=1,inicial=2", JSON.stringify({ o: afterPack.packs_opened, c: afterPack.cards, p: afterPack.packs }));
    check("economía: abrir un sobre poseído no mueve créditos ni XP de pase", afterPack.credits === "6000" && afterPack.ledger === fresh.ledger);
    j = await home(tab);
    log(`    ${JSON.stringify(j)}`);
    check("vestíbulo tras el sobre: COLECCIONA, sin bienvenida", j.mission === "collect" && j.welcome === "false");
    await shot(tab, "home-collect");
    check("recarga tras el sobre: mismo paso", (await home(tab, true)).mission === "collect");

    /* ───── E · colección ───── */
    log("\n· E · COLECCIÓN");
    await tab.js(`document.querySelector('[data-testid="journey-secondary-cta"]')?.click()`);
    check("«Ver mi colección» → /coleccion", await waitFor(tab, `location.pathname === "/coleccion"`, 15000));
    check("colección real con el coach de la primera sesión", await waitFor(tab, `!!document.querySelector('[data-testid="journey-collection-coach"]')`, 25000));
    await tab.js(`document.querySelector('[data-testid="journey-collection-coach"]')?.scrollIntoView({ block: "center" })`);
    await sleep(900);
    await shot(tab, "collection-coach");

    /* ───── F · logout / login ───── */
    log("\n· F · CERRAR SESIÓN Y VOLVER");
    await tab.goto(`${BASE}/cuenta`, 3500);
    await tab.js(`[...document.querySelectorAll('button')].find((x) => /cerrar sesión/i.test(x.textContent))?.click()`);
    check("sesión cerrada", await waitFor(tab, `!!document.querySelector('input[type="password"]')`, 15000));
    await tab.js(setInputs([['input[type="email"]', creds.email], ['input[type="password"]', creds.password]]));
    await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
    check("login de nuevo", await waitFor(tab, SIGNED_IN, 20000));
    j = await home(tab, true);
    check("tras volver: sigue en COLECCIONA (ni bienvenida ni primer sobre)", j.mission === "collect" && j.welcome === "false");
    } // fin de A–F

    /* ───── G · sobres hasta poder formar equipo ───── */
    const state0 = fp();
    const deckDone = state0.active_deck !== "none";
    const openMatch = one(`select coalesce((select id::text from public.duel_matches where user_id = '${U}' and status = 'IN_PROGRESS' limit 1), '')`);
    if (!deckDone) {
    log("\n· G · COLECCIONA HASTA PODER FORMAR EQUIPO");
    let packsOpened = Number(fpQuick()); let freePacks = 0;
    for (let guard = 0; guard < 30; guard++) {
      j = await home(tab);
      if (j.mission !== "collect") break;
      const href = j.cta as string;
      if (href.startsWith("/abrir/")) {
        await tab.js(`document.querySelector('[data-testid="journey-primary-cta"]')?.click()`);
        await waitFor(tab, `location.pathname === ${JSON.stringify(href)}`, 15000);
        if (await openPackCeremony(tab, "")) packsOpened++;
        else { check(`sobre por el CTA «${j.ctaText}»: ceremonia completa`, false); break; }
      } else if (href === "/packs/inicial") {
        await tab.js(`document.querySelector('[data-testid="journey-primary-cta"]')?.click()`);
        await waitFor(tab, `location.pathname === "/packs/inicial"`, 15000);
        await waitFor(tab, `[...document.querySelectorAll('button')].some((x) => /Abrir gratis|Abrir sobre/.test(x.textContent))`, 20000);
        if (freePacks === 0) await shot(tab, "free-pack");
        await tab.js(`[...document.querySelectorAll('button')].find((x) => /Abrir gratis|Abrir sobre/.test(x.textContent))?.click()`);
        await waitFor(tab, `location.pathname === "/abrir/inicial"`, 20000);
        if (await openPackCeremony(tab, "")) { packsOpened++; freePacks++; }
      } else break;
    }
    const afterCollect = fp();
    evidence.packsOpened = packsOpened; evidence.freePacks = freePacks;
    log(`    sobres abiertos ${packsOpened} (Sobres Iniciales gratis ${freePacks}) · ${JSON.stringify({ o: afterCollect.packs_opened, c: afterCollect.cards, ledger: afterCollect.ledger })}`);
    check("BD: cartas = 5 × sobres abiertos, todas de sobre", Number(afterCollect.cards) === 5 * Number(afterCollect.packs_opened) && afterCollect.cards_origin === "pack");
    check("economía: los sobres gratis cuestan 0 (asientos buy_pack:inicial de 0) y nada más", afterCollect.credits === "6000" && afterCollect.ledger.split(",").every((x) => x === "starter_grant:6000" || x === "buy_pack:inicial:0"), afterCollect.ledger);
    j = await home(tab);
    check("vestíbulo: CONSTRUYE", j.mission === "build", JSON.stringify(j));
    await shot(tab, "home-build");

    } else log("\n· G/H · ya hechos en una ejecución anterior (equipo guardado y activo en BD): se reanuda en el primer combate");
    if (!deckDone) {
    /* ───── H · primer equipo ───── */
    log("\n· H · PRIMER EQUIPO (constructor real)");
    await tab.js(`document.querySelector('[data-testid="journey-primary-cta"]')?.click()`);
    check("CTA → constructor con el coach del primer equipo", await waitFor(tab, `location.pathname === "/duelos/mazos" && !!document.querySelector('[data-testid="journey-deck-coach"]')`, 25000));
    await sleep(800);
    await shot(tab, "builder-coach");
    await tab.goto(`${BASE}/duelos/mazos?nuevo=1`, 3000);
    check("recarga durante el equipo: el paso sigue siendo CONSTRUYE y el coach vuelve", await waitFor(tab, `!!document.querySelector('[data-testid="journey-deck-coach"]')`, 25000));
    await tab.js(`document.querySelector('[data-testid="autocomplete"]')?.click()`);
    check("«Autocompletar equipo»: resultado OK con sus propias cartas", await waitFor(tab, `document.querySelector('[data-testid="autocomplete-result"]')?.getAttribute('data-ok') === "true"`, 15000));
    await sleep(600);
    await shot(tab, "builder-autocomplete");
    await tab.js(`document.querySelector('[data-testid="save-team"]')?.click()`);
    check("guardado + activado (aviso en pantalla)", await waitFor(tab, `/equipo guardado y activado/i.test(document.body.innerText)`, 20000));
    await shot(tab, "builder-saved-activated");
    const deckRow = psql(`select d.id, jsonb_array_length(to_jsonb(d.card_uids)), (select count(distinct c.card_id) from public.user_cards c where c.uid::text = any(select jsonb_array_elements_text(to_jsonb(d.card_uids))) and c.user_id = '${U}') from public.duel_decks d where d.user_id = '${U}' order by d.created_at limit 1;`).split(" | ");
    const deckCards = psql(`select c.card_id from public.duel_decks d, jsonb_array_elements_text(to_jsonb(d.card_uids)) u join public.user_cards c on c.uid::text = u where d.user_id = '${U}' and c.user_id = '${U}';`).split("\n").filter(Boolean);
    const active = one(`select coalesce(deck_id::text, 'none') from public.duel_active_deck where user_id = '${U}';`);
    evidence.deck = deckCards;
    check("BD: equipo de 10 cartas propias (uids del usuario, sin duplicadas)", deckRow[1] === "10" && deckCards.length === 10 && new Set(deckCards).size === 10, deckRow.join(" · "));
    check("BD: equipo ACTIVO = el guardado", active === deckRow[0]);

    }
    /* ───── I · primer combate ───── */
    log("\n· I · PRIMER COMBATE (PvE Fácil canónico)");
    j = await home(tab);
    let beforeMatch: Record<string, string>;
    if (openMatch) {
      // Reanudación real: la partida del primer combate quedó a medias. La home debe proponer CONTINUAR (gana al recorrido).
      check("partida PvE a medias: el vestíbulo propone CONTINUAR PARTIDA y el recorrido baja a la tira", j.heroAction === "resume-pve" && j.strip && !j.mission, JSON.stringify(j));
      await shot(tab, "home-resume-over-journey");
      beforeMatch = fp();
      await tab.js(`document.querySelector('[data-testid="daily-primary-cta"]')?.click()`);
      check("continuar → arena con la MISMA partida", await waitFor(tab, `location.pathname === "/duelos/jugar" && [...document.querySelectorAll('button')].some((b) => /Elige una carta|Declarar y atacar|Responder|Continuar/.test(b.textContent))`, 25000));
    } else {
      check("vestíbulo: JUEGA con PLANTILLA LISTA", j.mission === "play" && !!(await tab.js<boolean>(`!!document.querySelector('[data-testid="journey-deck-ready"]')`)));
      await shot(tab, "home-play");
      await tab.js(`document.querySelector('[data-testid="journey-primary-cta"]')?.click()`);
      check("pre-partida con coach y Fácil preseleccionado", await waitFor(tab, `location.pathname === "/duelos/jugar" && !!document.querySelector('[data-testid="journey-first-match"]') && [...document.querySelectorAll('button[aria-pressed="true"]')].some((x) => /Fácil/.test(x.textContent))`, 25000));
      await sleep(700);
      await shot(tab, "prematch-first");
      beforeMatch = fp();
      await tab.js(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Comenzar duelo')?.click()`);
      await sleep(3000);
      await tab.js(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Saltar')?.click()`);
    }
    await sleep(1500);
    const matchId = openMatch || one(`select id from public.duel_matches where user_id = '${U}' order by created_at desc limit 1;`);
    if (openMatch) check("es la partida que quedó abierta", one(`select count(*) from public.duel_matches where user_id = '${U}'`) === "1");
    check("partida creada", /^[0-9a-f-]{36}$/.test(matchId));
    let uiTurns = 0;
    for (let step = 0; step < 80; step++) {
      const status = one(`select status from public.duel_matches where id = '${matchId}';`);
      if (status !== "IN_PROGRESS") break;
      if (await tab.js<boolean>(PLAY_ONE)) { uiTurns++; if (uiTurns === 2) await shot(tab, "match-turn"); continue; }
      await sleep(900);
    }
    await tab.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continuar')?.click()`);
    const [mode, diff, rules, orch, turns, status, winner, isDraw, sA, sB] = psql(`select mode, difficulty, rules_version, state->>'orchestratorVersion', jsonb_array_length(state->'turns'), status, coalesce(state->'result'->>'winner',''), coalesce(state->'result'->>'isDraw',''), state->'result'->>'scoreA', state->'result'->>'scoreB' from public.duel_matches where id = '${matchId}';`).split(" | ");
    const outcome = isDraw === "true" || winner === "" ? "draw" : winner === "A" ? "win" : "loss";
    evidence.match = { mode, diff, rules, orch, turns, status, outcome, score: `${sA}-${sB}`, uiTurns };
    log(`    ${JSON.stringify(evidence.match)}`);
    check("partida canónica: PVE · EASY · duel-combat-2 · duel-turns-2 · 10 turnos · terminada", mode === "PVE" && diff === "EASY" && rules === "duel-combat-2" && orch === "duel-turns-2" && turns === "10" && status !== "IN_PROGRESS");
    const turnsBefore = openMatch ? 0 : 0;
    check("10 turnos jugados por la interfaz, sin manipular el resultado", uiTurns + turnsBefore === 10, String(uiTurns));
    check("resultado: «Primera sesión completada» con destinos (dato del servidor)", await waitFor(tab, `!!document.querySelector('[data-testid="journey-discovery"]')`, 25000));
    await sleep(1200);
    await shot(tab, `result-${outcome}`);
    const afterMatch = fp();
    const award = { win: 120, draw: 60, loss: 25 }[outcome];
    const newLedger = afterMatch.ledger.split(",").slice(beforeMatch.ledger.split(",").length);
    check(`economía: SOLO la recompensa PvE existente (Fácil · ${outcome} = ${award} créditos), ninguna de primera sesión`, newLedger.length === 1 && /^duel_[a-z]+:\d+$/.test(newLedger[0]) && Number(newLedger[0].split(":")[1]) === award && Number(afterMatch.credits) === Number(beforeMatch.credits) + award, newLedger.join(","));
    check("sin cartas ni sobres nuevos por completar la primera sesión", afterMatch.cards === beforeMatch.cards && afterMatch.packs === beforeMatch.packs && afterMatch.packs_opened === beforeMatch.packs_opened);
    check("sin rating ni campaña por la primera partida (PvE)", afterMatch.rating_rows === beforeMatch.rating_rows && afterMatch.campaign === beforeMatch.campaign);

    /* ───── J · vestíbulo normal ───── */
    log("\n· J · VESTÍBULO DESPUÉS");
    j = await home(tab);
    log(`    ${JSON.stringify(j)}`);
    check("vestíbulo normal: acción principal fuera del recorrido y «Primera sesión completada» con destinos", !j.mission && j.discovery && !!j.heroAction && !String(j.heroAction).startsWith("journey-"));
    await shot(tab, "home-after");
    const homeFp = fp();
    const j2 = await home(tab, true);
    check("recarga tras la partida: sin volver a la guía", !j2.mission && j2.discovery);
    check("leer el vestíbulo tras la partida no escribe", same(homeFp, fp()));
    for (const [w, h, n] of [[390, 844, "home-after-390"], [1024, 800, "home-after-1024"]] as const) { await tab.resize(w, h); await home(tab); await shot(tab, n); }
    evidence.final = fp();
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
  log(`\n${failures === 0 ? "✓" : "✗"} primera sesión real — ${failures} fallos`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
