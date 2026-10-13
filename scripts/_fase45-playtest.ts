/**
 * FASE 45 · TRES PARTIDAS REALES, JUGADAS A CLICS (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-playtest.ts <credsFile> [baseUrl] [--difficulties=EASY,NORMAL,HARD]
 *
 * Juega de verdad con la cuenta QA contra el servidor real: elige mazo y dificultad, pulsa «Comenzar duelo», juega los
 * diez turnos, prueba el DOBLE CLIC en un turno (no debe resolver dos), ve el golpe final y lee el resultado. Va
 * fotografiando el camino (preparación, intro, turnos, golpe final, resultado).
 *
 * ESTO SÍ ESCRIBE: son partidas de verdad (crean `duel_matches`, mueven créditos y XP). Por eso toma una HUELLA de la
 * base ANTES y DESPUÉS —en solo lectura, por SSH— y deja escrito exactamente qué cambió. No fuerza nada por SQL.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const DIFFS = (process.argv.find((a) => a.startsWith("--difficulties="))?.slice(15) ?? "EASY,NORMAL,HARD").split(",");
const OUT = process.env.F45_OUT ?? join(process.cwd(), "docs/product/qa/fase45");
const SHOTS = join(OUT, "playtest");
mkdirSync(SHOTS, { recursive: true });

const LABEL: Record<string, string> = { EASY: "Fácil", NORMAL: "Normal", HARD: "Difícil" };

/** Huella de la BD en SOLO LECTURA (la transacción se fija `read only` antes de nada). */
const psql = (sql: string) => execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -c 'set default_transaction_read_only = on;' -f -"], { input: sql, encoding: "utf8" }).trim();

const fingerprint = (u: string) => {
  const raw = psql(`
select count(*) from public.duel_matches where user_id = '${u}';
select coalesce(sum(delta), 0) from public.credit_transactions where user_id = '${u}';
select count(*) from public.credit_transactions where user_id = '${u}';
select coalesce((select xp::text from public.profiles where id = '${u}'), '');
select coalesce(md5(string_agg(id::text || array_to_string(card_uids, ',') || updated_at::text, ';' order by id)), '') from public.duel_decks where user_id = '${u}';
select coalesce(md5(string_agg(pack_id || ':' || qty::text, ',' order by pack_id)), '') from public.user_packs where user_id = '${u}';`);
  // `psql` imprime «SET» por el `set default_transaction_read_only`: esa línea no es un dato.
  const [matches, creditSum, creditRows, xp, decks, packs] = raw.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l !== "SET");
  return { matches: Number(matches), creditSum: Number(creditSum), creditRows: Number(creditRows), xp, decks, packs };
};

/** La mesa acepta jugadas: hay botón de confirmar y la intro ya no está. */
const READY = `(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(x.textContent.trim())); return !!b && !document.querySelector('[data-scene="intro"]'); })()`;

const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const waitFor = async (tab: Tab, expr: string, ms = 25000) => { for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; };

async function login(tab: Tab) {
  const creds = JSON.parse(readFileSync(CREDS, "utf8"));
  await tab.goto(`${BASE}/cuenta`, 4500);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  }
  if (!(await waitFor(tab, SIGNED_IN, 40000))) throw new Error("no se pudo iniciar sesión con la cuenta QA");
  return await tab.js<string>(`(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); const t = JSON.parse(localStorage.getItem(k)); return t?.user?.id ?? ""; })()`);
}

const shot = (tab: Tab, name: string) => tab.shot(join(SHOTS, `${name}.png`));

/** Termina una partida que estuviera abierta, para que cada dificultad empiece limpia. */
async function finishOpenMatch(tab: Tab) {
  await tab.goto(`${BASE}/duelos/jugar`, 7000);
  const enJuego = await tab.js<boolean>(`/\\d+ \\/ 10/.test(document.body.innerText) && !/Preparación/.test(document.body.innerText)`);
  if (!enJuego) return false;
  await playTurns(tab, { doubleClickAt: -1 });
  return true;
}

/** Juega turnos con clics reales hasta que la partida termina. Devuelve el registro de turnos. */
async function playTurns(tab: Tab, o: { doubleClickAt: number }) {
  return await tab.js<any>(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btns = () => [...document.querySelectorAll('button')];
    const confirm = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
    const turnNow = () => { const m = document.body.innerText.match(/(\\d+) \\/ 10/); return m ? Number(m[1]) : null; };
    const log = [];
    let doubles = 0;
    for (let t = 0; t < 16; t++) {
      const cont = btns().find((b) => b.textContent.trim() === 'Continuar');
      if (cont) { cont.click(); await sleep(420); }
      const c0 = confirm();
      if (!c0) break;
      const cards = btns().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
      if (!cards.length) break;
      const before = turnNow();
      cards[0].click(); await sleep(240);
      const stats = btns().filter((b) => !b.getAttribute('aria-label') && /^(SH|GS|EF)/.test(b.textContent.trim()));
      if (stats.length === 3) { stats[0].click(); await sleep(240); }
      const c = confirm();
      if (!c || c.disabled) { log.push({ turn: before, blocked: true }); break; }
      if (t === ${o.doubleClickAt}) {
        // DOBLE CLIC A PROPÓSITO: dos pulsaciones seguidas en el mismo botón.
        c.click(); c.click(); c.click();
        doubles++;
      } else {
        c.click();
      }
      for (let w = 0; w < 80; w++) {
        const c2 = confirm();
        const done = /VICTORIA|DERROTA|EMPATE/.test(document.body.innerText);
        const cont3 = btns().find((b) => b.textContent.trim() === 'Continuar');
        if (cont3 || done || (c2 && !c2.disabled && /Elige una carta/.test(c2.textContent))) break;
        await sleep(250);
      }
      const after = turnNow();
      log.push({ turn: before, next: after, attacked: stats.length === 3 });
      if (/VICTORIA|DERROTA|EMPATE/.test(document.body.innerText) && !confirm()) break;
    }
    const cont2 = btns().find((b) => b.textContent.trim() === 'Continuar');
    if (cont2) { cont2.click(); await sleep(900); }
    return { log, doubles, text: document.body.innerText.slice(0, 600) };
  })()`);
}

/** Lee del DOM lo que enseña el resultado (marcador y recompensas REALES del servidor). */
const readResult = (tab: Tab) => tab.js<any>(`(() => {
  const text = document.body.innerText;
  const verdict = /VICTORIA/.test(text) ? "WIN" : /DERROTA/.test(text) ? "LOSS" : /EMPATE/.test(text) ? "DRAW" : null;
  const score = text.match(/(\\d+)\\s*[–-]\\s*(\\d+)/);
  const credits = text.match(/\\+(\\d+)[\\s\\S]{0,40}?Créditos/i) || text.match(/Créditos[\\s\\S]{0,40}?\\+(\\d+)/i);
  const xp = text.match(/\\+(\\d+)[\\s\\S]{0,40}?Experiencia/i) || text.match(/Experiencia[\\s\\S]{0,40}?\\+(\\d+)/i);
  const actions = [...document.querySelectorAll('[data-testid="result-actions"] a, [data-testid="result-actions"] button')].map((b) => (b.textContent || '').trim()).filter(Boolean);
  const primary = document.querySelector('[data-testid="result-actions"] [data-cta="primary"]');
  return {
    verdict,
    scoreYou: score ? Number(score[1]) : null,
    scoreRival: score ? Number(score[2]) : null,
    credits: credits ? Number(credits[1]) : null,
    xp: xp ? Number(xp[1]) : null,
    actions,
    primaryAction: primary ? (primary.textContent || '').trim() : null,
    rewardItems: document.querySelectorAll('[data-reward-item]').length,
  };
})()`);

async function playMatch(tab: Tab, difficulty: string, index: number) {
  const t0 = Date.now();
  await tab.goto(`${BASE}/duelos/jugar`, 7000);
  await waitFor(tab, `/Preparación/.test(document.body.innerText)`, 25000);
  await shot(tab, `${index}-${difficulty}-1-prematch`);
  // Dificultad y arranque, con los textos reales de la pantalla.
  await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(LABEL[difficulty])}); if (b) b.click(); })()`);
  await sleep(400);
  await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Comenzar duelo/i.test(x.textContent)); if (b && !b.disabled) b.click(); })()`);
  await sleep(900);
  await shot(tab, `${index}-${difficulty}-2-intro`);
  // La intro es saltable: se salta como lo haría el jugador y se espera a que la mesa acepte jugadas.
  await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Saltar$/i.test(x.textContent.trim())); if (b) b.click(); })()`);
  await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await waitFor(tab, READY, 25000);
  await shot(tab, `${index}-${difficulty}-3-turn1`);

  const played = await playTurns(tab, { doubleClickAt: 3 });
  await shot(tab, `${index}-${difficulty}-4-complete`);
  await waitFor(tab, `!!document.querySelector('[data-scene="result"]')`, 20000);
  await sleep(900);
  await shot(tab, `${index}-${difficulty}-5-result`);
  const result = await readResult(tab);

  const turns = (played.log ?? []).filter((l: any) => l.next !== null).length;
  // El doble clic no puede haber saltado un turno: entre el turno antes y después de cada jugada hay como mucho 1.
  const jumps = (played.log ?? []).filter((l: any) => l.turn != null && l.next != null && l.next - l.turn > 1).length;
  return {
    difficulty,
    turns: (played.log ?? []).length,
    resolvedTurns: turns,
    doubleClicks: played.doubles ?? 0,
    turnJumps: jumps,
    result,
    seconds: Math.round((Date.now() - t0) / 1000),
    ok: (played.log ?? []).length >= 10 && jumps === 0 && result.verdict !== null,
  };
}

async function main() {
  if (!CREDS || !existsSync(CREDS)) throw new Error("hacen falta credenciales QA");
  const b = await launch({ width: 1440, height: 900, userDataDir: join(CREDS, "..", "f45-playtest-profile"), args: ["--renderer-process-limit=1", "--disable-extensions", "--in-process-gpu", "--mute-audio", "--disable-features=BackForwardCache"] });
  const tab = b.tab;
  const matches: any[] = [];
  let before: ReturnType<typeof fingerprint> | null = null;
  let after: ReturnType<typeof fingerprint> | null = null;
  let userId = "";
  try {
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    userId = await login(tab);
    before = fingerprint(userId);
    console.log(`cuenta ${userId.slice(0, 8)} · huella antes ${JSON.stringify(before)}`);
    const closed = await finishOpenMatch(tab);
    if (closed) console.log("había una partida abierta: se ha terminado antes de empezar");
    for (const [i, d] of DIFFS.entries()) {
      const m = await playMatch(tab, d, i + 1);
      matches.push(m);
      console.log(`${d}: ${m.turns} turnos · ${m.result.verdict} ${m.result.scoreYou}-${m.result.scoreRival} · +${m.result.credits ?? "?"} créditos · +${m.result.xp ?? "?"} XP · saltos ${m.turnJumps} · ${m.seconds} s`);
    }
    after = fingerprint(userId);
  } finally {
    await b.close();
  }
  const changed = before && after ? (Object.keys(before) as (keyof typeof before)[]).filter((k) => before![k] !== after![k]) : [];
  const out = {
    generatedAt: new Date().toISOString(), base: BASE, account: userId.slice(0, 8),
    matches,
    doubleClick: {
      attempts: matches.reduce((n, m) => n + m.doubleClicks, 0),
      extraTurns: matches.reduce((n, m) => n + m.turnJumps, 0),
    },
    fingerprint: { before, after, changed, note: "Una partida real crea su fila en duel_matches y abona créditos/XP: eso es lo que debe cambiar. Nada más." },
  };
  writeFileSync(join(OUT, "playtest.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`huella: cambió ${changed.join(", ") || "nada"} · partidas ${matches.filter((m) => m.ok).length}/${matches.length} correctas`);
}
void main();
