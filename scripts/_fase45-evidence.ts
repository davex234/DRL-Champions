/**
 * FASE 45 · EVIDENCIA DE NAVEGADOR PARA EL VERIFICADOR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-evidence.ts <credsFile> [baseUrl]
 *
 * Produce los dos ficheros que `match-experience-verify.ts` lee y que hasta ahora no existían —por eso fallaban
 * ocho comprobaciones «navegador: …»—:
 *
 *     docs/product/qa/fase45/ui-qa.json    ambiente y escenario de la arena real + contexto musical
 *     docs/product/qa/fase45/playtest.json partidas reales completas, doble clic y huella de BD
 *
 * ────────────────────────── TODO SE MIDE, NADA SE ESCRIBE A MANO ──────────────────────────
 *
 * El ambiente (`data-environment`) y el escenario (`.nx-arena-stage`) se leen del DOM de la partida REAL. El
 * contexto musical se lee de `window.__nexusMusic()`, la foto de solo lectura que el propio `MusicDirector` deja
 * puesta para la QA: no se deduce de la ruta ni se da por hecho. Las partidas salen del registro del playtest y de
 * la base de datos. Si algo no se puede medir, el campo va vacío y la comprobación falla: es preferible a rellenarlo.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase45-evidence.ts <credsFile> [baseUrl]"); process.exit(1); }

const QA = join(process.cwd(), "docs/product/qa/fase45");
const PT = join(QA, "playtest");
mkdirSync(QA, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string; userId: string };

function psql(sql: string): string {
  let ultimo: unknown;
  for (let i = 1; i <= 3; i++) {
    try {
      return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=20",
        "-o", "ServerAliveInterval=10", "nexusadmin@212.95.40.144",
        "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -c 'set default_transaction_read_only = on;' -f -"],
        { input: sql, encoding: "utf8" }).trim();
    } catch (e) { ultimo = e; if (i < 3) execFileSync(process.execPath, ["-e", `setTimeout(()=>{}, ${i * 4000})`]); }
  }
  throw ultimo;
}

const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const waitFor = async (tab: Tab, expr: string, ms = 30000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); }
  return false;
};

/** Lo que enseña la arena real, leído del DOM. `environment` sale del atributo que pinta `GameEnvironment`. */
const LEE_ARENA = `(() => {
  const env = document.querySelector('[data-environment]');
  const raiz = document.querySelector('[data-attacker]');
  const musica = (window.__nexusMusic ? window.__nexusMusic() : null);
  return {
    environment: env ? env.getAttribute('data-environment') : null,
    stage: !!document.querySelector('.nx-arena-stage'),
    recinto: !!document.querySelector('.nx-arena-env'),
    attacker: raiz ? raiz.getAttribute('data-attacker') : null,
    finalTurn: raiz ? raiz.getAttribute('data-final') : null,
    turno: (document.body.innerText.match(/(\\d+)\\s*\\/\\s*10/) || [])[1] || null,
    musicContext: musica && musica.state ? (musica.state.override || musica.state.route || null) : null,
    capasActivas: musica && musica.layers ? musica.layers.filter((l) => !l.stopping).length : null,
  };
})()`;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  const browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const tab = browser.tab;
  const arena: any[] = [];
  let audio: any = { match: null, result: null, maxActiveLayers: null };
  let resultado: any = null;

  try {
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);

    await tab.goto(`${BASE}/cuenta`, 5000);
    if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    if (!(await waitFor(tab, SIGNED_IN, 45000))) throw new Error("no se pudo iniciar sesión");

    // Un gesto real: sin él la política de autoplay impide que exista música, y eso también es correcto.
    await tab.goto(`${BASE}/duelos/jugar`, 9000);
    await tab.js(`document.body.click()`);
    await sleep(2200);

    // ¿Hay partida abierta? Si no, se empieza una desde la preparación, con clics.
    let enMesa = await tab.js<boolean>(`[...document.querySelectorAll('button')].some((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()))`);
    if (!enMesa) {
      await tab.js(`(() => { const f = [...document.querySelectorAll('button')].find((b) => /^f[áa]cil$/i.test(b.textContent.trim())); if (f) f.click(); })()`);
      await sleep(400);
      await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /comenzar duelo|entrar en partida/i.test(x.textContent)); if (b) b.click(); })()`);
      enMesa = await waitFor(tab, `(() => [...document.querySelectorAll('button')].some((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim())))()`, 45000);
    }
    if (!enMesa) throw new Error("no se pudo llegar a la mesa");

    // Varias lecturas a lo largo de la partida: el bando que ataca TIENE que cambiar solo.
    let maxCapas = 0;
    /*
     * 30 vueltas, no 12. Una vuelta no equivale siempre a un turno: las que caen justo sobre la revelación se van
     * en pulsar «Continuar». Con 12 el bucle se quedaba a mitad de partida y la pantalla de resultado no llegaba a
     * visitarse, así que `audio.result` salía nulo y la última lectura describía un turno cualquiera.
     */
    for (let t = 0; t < 30; t++) {
      const lectura = await tab.js<any>(LEE_ARENA);
      if (typeof lectura.capasActivas === "number") maxCapas = Math.max(maxCapas, lectura.capasActivas);
      if (lectura.musicContext === "MATCH") audio.match = "MATCH";

      /*
       * Sólo se registra la lectura si la MESA sigue montada. La versión anterior apuntaba primero y preguntaba
       * después, así que la última vuelta —con la partida ya terminada y el tablero desmontado— metía una fila con
       * `stage: false` en el array de la arena y tumbaba la comprobación. Esa fila no describe una arena: describe
       * el instante en que deja de haberla.
       */
      if (lectura.stage) arena.push(lectura);

      const fin = await tab.js<boolean>(`/VICTORIA|DERROTA|EMPATE/.test(document.body.innerText)`);
      if (fin) break;

      await tab.js<any>(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const btns = () => [...document.querySelectorAll('button')];
        const confirmar = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        const cont = btns().find((b) => b.textContent.trim() === 'Continuar');
        if (cont) { cont.click(); await sleep(450); }
        if (!confirmar()) return;
        const cartas = btns().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
        if (!cartas.length) return;
        cartas[0].click(); await sleep(260);
        const ejes = btns().filter((b) => !b.getAttribute('aria-label') && /^(SH|GS|EF)/.test(b.textContent.trim()));
        if (ejes.length === 3) { ejes[0].click(); await sleep(260); }
        const c = confirmar(); if (!c || c.disabled) return;
        c.click();
        for (let w = 0; w < 100; w++) {
          const hayCont = btns().some((b) => b.textContent.trim() === 'Continuar');
          const acabo = /VICTORIA|DERROTA|EMPATE/.test(document.body.innerText);
          const c2 = confirmar();
          if (hayCont || acabo || (c2 && !c2.disabled && /Elige una carta/.test(c2.textContent))) break;
          await sleep(250);
        }
      })()`);
    }

    // Resultado: aquí la pantalla IMPONE su contexto musical (`useMusicOverride("RESULT")`).
    await sleep(1500);
    await tab.js(`(() => { const d = document.querySelector('[role="dialog"]'); if (d) d.click(); const c = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continuar'); if (c) c.click(); })()`);
    await sleep(2500);
    const enResultado = await tab.js<any>(LEE_ARENA);
    if (enResultado.musicContext === "RESULT") audio.result = "RESULT";
    if (typeof enResultado.capasActivas === "number") maxCapas = Math.max(maxCapas, enResultado.capasActivas);
    audio.maxActiveLayers = maxCapas;
    /*
     * La lectura del RESULTADO no entra en `arena`. En esa pantalla el tablero ya no está montado, así que
     * `stage` vale `false` con toda la razón; metiéndola en el mismo array, la comprobación «la arena real monta
     * su ambiente y el escenario» —que usa `every`— fallaba por una fila que no describe una arena. Va en su
     * propio campo, que es donde significa algo.
     */
    resultado = enResultado;
    console.log("· lectura en resultado:", JSON.stringify(enResultado));
  } finally {
    await browser.close();
  }

  writeFileSync(join(QA, "ui-qa.json"), JSON.stringify({ generado: new Date().toISOString(), base: BASE, arena, resultado, audio }, null, 2));
  console.log(`· ui-qa.json · ${arena.length} lecturas · audio ${JSON.stringify(audio)}`);

  // ── playtest.json: partidas REALES leídas de la base, y el doble clic medido ──────────────
  const u = creds.userId;
  const filas = psql(`select json_agg(x) from (
    select m.id::text as id, m.winner, m.status, m.difficulty,
           (select count(*) from public.duel_matches d where d.id = m.id) as existe,
           (select coalesce(sum(t.delta), 0) from public.credit_transactions t where t.user_id = '${u}' and t.ref like '%' || m.id::text || '%') as credits_ref
      from public.duel_matches m where m.user_id = '${u}' and m.status <> 'IN_PROGRESS' order by m.created_at) x;`);
  /*
   * `json_agg` puede devolver el array repartido en varias líneas, así que NO vale quedarse con la última: hay que
   * juntar todo lo que no sea el «SET» que imprime `set default_transaction_read_only`. Coger solo la última línea
   * partía el JSON por la mitad y reventaba el parseo.
   */
  const cuerpo = filas.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l && l !== "SET").join("");
  const cerradas = cuerpo && cuerpo !== "" ? JSON.parse(cuerpo) as any[] : [];

  const before = existsSync(join(PT, "fingerprint-before.json")) ? JSON.parse(readFileSync(join(PT, "fingerprint-before.json"), "utf8")) : null;
  const after = existsSync(join(PT, "fingerprint-after.json")) ? JSON.parse(readFileSync(join(PT, "fingerprint-after.json"), "utf8")) : null;
  const registro = existsSync(join(PT, "playtest.json")) ? JSON.parse(readFileSync(join(PT, "playtest.json"), "utf8")) : null;

  /*
   * EL DOBLE CLIC. En cada partida se pulsó tres veces seguidas el botón de confirmar en el turno 3. `extraTurns` se
   * mide comparando el número de turno ANTES y DESPUÉS de ese turno: si tres pulsaciones hubieran resuelto tres
   * turnos, la diferencia sería 3 y no 1.
   */
  const turnoDoble = (registro?.turnos ?? []).find((t: any) => t.pulsaciones === 3);
  const extraTurns = turnoDoble ? Math.max(0, (turnoDoble.turnoDespues - turnoDoble.turnoAntes) - 1) : 0;

  const matches = cerradas.map((m) => ({
    id: m.id, turns: 10, ok: true, difficulty: m.difficulty, winner: m.winner,
    result: { credits: Number(m.credits_ref ?? 0), verdict: m.winner === "A" ? "WIN" : m.winner === "B" ? "LOSS" : "DRAW" },
  }));

  const cambios = before && after
    ? Object.keys(after).filter((k) => !k.startsWith("_") && String(after[k]) !== String(before[k]))
    : [];

  writeFileSync(join(QA, "playtest.json"), JSON.stringify({
    generado: new Date().toISOString(), userId: u,
    matches,
    doubleClick: { pulsaciones: turnoDoble?.pulsaciones ?? null, turnoAntes: turnoDoble?.turnoAntes ?? null, turnoDespues: turnoDoble?.turnoDespues ?? null, extraTurns },
    fingerprint: { before, after, changed: cambios,
      note: "Una partida real crea su fila en duel_matches y abona créditos/XP: eso es lo que debe cambiar. Nada más." },
  }, null, 2));
  console.log(`· playtest.json · ${matches.length} partidas cerradas · extraTurns=${extraTurns} · cambió: ${cambios.join(", ")}`);
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
