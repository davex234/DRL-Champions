/**
 * FASE 47 · QA DE CIERRE — el recorrido completo POR INTERFAZ (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase47-close-qa.ts <credsFile> [baseUrl]
 *
 * Lo que el informe anterior no podía demostrar: que un entrenador haga todo esto sin terminal,
 * sin API a mano, sin SQL y sin DevTools.
 *
 *   composiciones → nueva → 5 agentes → guardar → recargar
 *   plan de partida → elegir composición → asignar jugada → presentar → pantalla completa
 *   dos pestañas sobre la misma jugada → conflicto seguro
 *   mapa cruzado → rechazo del servidor
 *
 * Guardián de memoria de la Fase 44.1: un Chrome, cierre garantizado, parada si baja la RAM.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase47-close-qa.ts <credsFile> [baseUrl]"); process.exit(1); }
const OUT = join(process.cwd(), "docs/product/qa/fase47");
mkdirSync(OUT, { recursive: true });
const freeMb = () => Math.round(freemem() / 1048576);

const COMP_NAME = "__QA_F47_COMPOSITION__";
let n = 20;   // continúa la numeración de la QA anterior
const foto = async (tab: Tab, nombre: string) => {
  await tab.shot(join(OUT, `${String(++n).padStart(2, "0")}-${nombre}.png`));
  console.log(`· ${nombre}`);
};

const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };
const informe: Record<string, unknown> = { base: BASE, inicio: new Date().toISOString() };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function entrar(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 4500);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  }
  for (let i = 0; i < 180; i++) {
    if (await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

/** El token de la sesión del navegador: se usa para las dos comprobaciones de servidor. */
const token = (tab: Tab) => tab.js<string>(
  `(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); try { return JSON.parse(localStorage.getItem(k)).access_token ?? ""; } catch { return ""; } })()`,
);

async function main() {
  if (freeMb() < 2048) { console.log(`PARADA: RAM libre ${freeMb()} MB`); return; }
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1600, height: 980, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    await tab.resize(1600, 980, 1);
    if (!(await entrar(tab))) throw new Error("no se pudo iniciar sesión");

    /* ═════════ 1 · COMPOSICIÓN, DESDE LA INTERFAZ ═════════ */
    await tab.goto(`${BASE}/entrenador/composiciones`, 4000);
    await sleep(2200);
    await foto(tab, "composition-manager");

    /* El mapa PRIMERO: la composición debe nacer en el mismo mapa que la partida QA (ascent). */
    await tab.js(`document.querySelector('[data-testid="map-ascent"]')?.click()`);
    await sleep(500);
    await tab.js(`document.querySelector('[data-testid="new-composition"]')?.click()`);
    await sleep(900);
    await foto(tab, "composition-builder-vacio");

    // Nombre + cinco agentes, a clics sobre el roster.
    await tab.js(`(() => {
      const i = document.querySelector('[data-testid="composition-name"]');
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(i, ${JSON.stringify(COMP_NAME)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);

    const elegidos = await tab.js<any>(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const botones = [...document.querySelectorAll('[data-testid="agent-roster"] button')];
      let n = 0;
      for (const b of botones.slice(0, 5)) { b.click(); n++; await sleep(220); }
      const llenos = [...document.querySelectorAll('[data-testid^="slot-"]')].filter((s) => s.getAttribute('data-filled') === 'true').length;
      return { pulsados: n, slotsLlenos: llenos, contador: document.querySelector('[data-testid="composition-count"]')?.textContent?.trim() };
    })()`);
    informe.composicion = elegidos;
    console.log("composición:", JSON.stringify(elegidos));
    await foto(tab, "composition-5-5");

    await tab.js(`document.querySelector('[data-testid="composition-save"]')?.click()`);
    await sleep(2200);
    await foto(tab, "composition-guardada");

    // RECARGAR: lo que de verdad demuestra que se ha guardado.
    await tab.goto(`${BASE}/entrenador/composiciones`, 4000);
    await sleep(2400);
    informe.trasRecargar = await tab.js<any>(`(() => {
      const t = document.body.innerText;
      const fila = [...document.querySelectorAll('[data-testid^="composition-"]')]
        .find((e) => e.textContent.includes(${JSON.stringify(COMP_NAME)}));
      return { existe: !!fila, texto: fila ? fila.textContent.replace(/\\s+/g, ' ').slice(0, 90) : null, mencion: t.includes(${JSON.stringify(COMP_NAME)}) };
    })()`);
    console.log("tras recargar:", JSON.stringify(informe.trasRecargar));
    await foto(tab, "composition-persistida");

    /* ═════════ 2 · FIXTURES QA POR LA VÍA REAL DEL PRODUCTO ═════════ */
    /*
     * La cuenta QA no tiene jugadas ni partidas de entrenador, así que el plan no se podría probar
     * con datos reales. Se crean por las MISMAS rutas que usa el producto —`/api/game/strats` y
     * `/api/game/coach-matches`, con su validación entera— y con nombre `__QA_F47_*` para poder
     * identificarlos después sin ambigüedad. Nada de SQL y nada de saltarse una regla.
     */
    const jwt = await token(tab);
    informe.fixtures = await tab.js<any>(`(async () => {
      const h = { authorization: 'Bearer ' + ${JSON.stringify(jwt)}, 'content-type': 'application/json' };
      const MAPA = 'ascent';

      const lista = await fetch('/api/game/strats', { headers: h }).then((r) => r.json());
      /*
       * Nombre EXACTO. Con un prefijo, la jugada de bind -que existe a proposito para probar el
       * rechazo cruzado- hacia de coincidencia y la de ascent no se llegaba a crear: el plan salia
       * sin jugadas y parecia un fallo del producto.
       * (Sin acentos ni comillas invertidas: esto viaja DENTRO de una plantilla de JS.)
       */
      let strat = (lista.strats ?? []).find((s) => s.name === '__QA_F47_STRAT__');

      if (!strat) {
        const plan = {
          id: 'nueva', name: '__QA_F47_STRAT__', mapId: MAPA, side: 'attack',
          description: '', tags: [], notes: '', version: 2,
          steps: [1, 2, 3].map((i) => ({
            id: 's' + i, at: 0, label: 'Paso ' + i, notes: '',
            state: {
              // Un jugador por ROL: el dominio exige los cinco distintos, igual que un mazo de duelo.
              players: ['Duelista', 'Controlador', 'Iniciador', 'Centinela', 'Flex'].map((rol, j) => ({
                id: 'p' + (j + 1), role: rol, label: rol.slice(0, 3).toUpperCase(),
                x: 0.3 + j * 0.06 + i * 0.03, y: 0.4 + (j % 2) * 0.1 + i * 0.04,
              })),
              utilities: [], drawings: [], annotations: [],
            },
          })),
        };
        const r = await fetch('/api/game/strats', {
          method: 'POST', headers: h, body: JSON.stringify({ action: 'save', id: null, strat: plan }),
        });
        const j = await r.json();
        if (!r.ok) return { stratId: null, matchId: null, status: 'save-failed', code: r.status, error: j.error ?? null, issues: j.issues ?? null };
        const otra = await fetch('/api/game/strats', { headers: h }).then((x) => x.json());
        strat = (otra.strats ?? []).find((s) => s.id === j.id) ?? null;
      }

      // Una segunda jugada en OTRO mapa: hace falta para probar el rechazo de mapa cruzado.
      const bind = (lista.strats ?? []).find((s) => s.mapId === 'bind');
      if (!bind) {
        await fetch('/api/game/strats', {
          method: 'POST', headers: h,
          body: JSON.stringify({ action: 'save', id: null, strat: {
            id: 'nueva', name: '__QA_F47_STRAT_BIND__', mapId: 'bind', side: 'defense',
            description: '', tags: [], notes: '', version: 2,
            steps: [{ id: 's1', at: 0, label: 'Paso 1', notes: '', state: { players: [], utilities: [], drawings: [], annotations: [] } }],
          } }),
        });
      }

      const partidas = await fetch('/api/game/coach-matches?limit=20', { headers: h }).then((r) => r.json());
      let partida = (partidas.matches ?? []).find((m) => (m.mapId ?? m.map_id) === MAPA);
      if (!partida) {
        const r = await fetch('/api/game/coach-matches', {
          method: 'POST', headers: h, body: JSON.stringify({
            seed: 470470, mapId: MAPA, startSide: 'ATK', difficulty: 'normal',
            scoreHome: 13, scoreAway: 9, rounds: 22,
            teamName: '__QA_F47__', rivalName: '__QA_F47_RIVAL__',
          }),
        });
        const j = await r.json();
        partida = j.match ?? null;
      }
      return { stratId: strat?.id ?? null, matchId: partida?.id ?? null, status: 'ok' };
    })()`);
    console.log("fixtures:", JSON.stringify(informe.fixtures));

    const datos = await tab.js<any>(`(async () => {
      const h = { authorization: 'Bearer ' + ${JSON.stringify(jwt)} };
      const [m, s] = await Promise.all([
        fetch('/api/game/coach-matches?limit=5', { headers: h }).then((r) => r.json()),
        fetch('/api/game/strats', { headers: h }).then((r) => r.json()),
      ]);
      return { partidas: (m.matches ?? []).length, primera: (m.matches ?? [])[0] ?? null, strats: (s.strats ?? []).length, primeraStrat: (s.strats ?? [])[0] ?? null };
    })()`);
    informe.datos = { partidas: datos.partidas, strats: datos.strats };
    console.log("datos:", JSON.stringify(informe.datos));

    if (datos.primera) {
      const matchId = datos.primera.id;
      await tab.goto(`${BASE}/entrenador/plan?match=${matchId}`, 4000);
      await sleep(2600);
      await foto(tab, "tactical-plan");

      informe.plan = await tab.js<any>(`(() => ({
        montado: !!document.querySelector('[data-testid="tactical-plan"]'),
        comps: document.querySelectorAll('[data-testid^="pick-comp-"]').length,
        jugadas: document.querySelectorAll('[data-testid^="assign-"]').length,
        presentar: document.querySelectorAll('[data-testid^="present-"]').length,
      }))()`);
      console.log("plan:", JSON.stringify(informe.plan));

      // Elegir composición + asignar la primera jugada compatible.
      await tab.js(`document.querySelector('[data-testid^="pick-comp-"]')?.click()`);
      await sleep(600);
      await foto(tab, "plan-composicion-elegida");

      await tab.js(`document.querySelector('[data-testid^="assign-"]')?.click()`);
      await sleep(1800);
      informe.asignado = await tab.js<any>(`(() => {
        const z = document.querySelector('[data-testid="plan-assigned"]');
        return { texto: z ? z.textContent.replace(/\\s+/g, ' ').slice(0, 120) : null,
                 error: document.querySelector('[data-testid="plan-error"]')?.textContent ?? null };
      })()`);
      console.log("asignado:", JSON.stringify(informe.asignado));
      await foto(tab, "plan-strat-asignada");

      // RECARGAR: la asignación tiene que seguir ahí.
      await tab.goto(`${BASE}/entrenador/plan?match=${matchId}`, 4000);
      await sleep(2600);
      informe.planPersistido = await tab.js<any>(`(() => document.querySelector('[data-testid="plan-assigned"]')?.textContent?.replace(/\\s+/g,' ').slice(0,120) ?? null)()`);
      console.log("plan persistido:", JSON.stringify(informe.planPersistido));
      await foto(tab, "plan-persistido");

      // PRESENTAR → teatro a pantalla completa. Éste es el gate central.
      const presentado = await tab.js<any>(`(() => {
        const b = document.querySelector('[data-testid^="present-"]');
        if (!b) return { ok: false };
        b.click();
        return { ok: true };
      })()`);
      await sleep(2000);
      informe.presentacion = await tab.js<any>(`(() => {
        const t = document.querySelector('[data-testid="tactical-theater"]');
        return { montado: !!t, modo: t?.getAttribute('data-mode') ?? null,
                 linea: !!document.querySelector('[data-testid="theater-timeline"]'),
                 lado: document.querySelector('[data-testid="theater-side"]')?.textContent?.trim() ?? null,
                 composicion: document.querySelectorAll('[data-testid="theater-composition"] > span').length };
      })()`);
      console.log("presentación:", JSON.stringify(presentado), JSON.stringify(informe.presentacion));
      await foto(tab, "present-from-match");

      await tab.js(`document.querySelector('[data-testid="theater-next"]')?.click()`);
      await sleep(900);
      await foto(tab, "present-paso-2");

      /* ═════════ 3 · MAPA CRUZADO: el servidor manda ═════════ */
      informe.crossMap = await tab.js<any>(`(async () => {
        const h = { authorization: 'Bearer ' + ${JSON.stringify(jwt)}, 'content-type': 'application/json' };
        const s = await fetch('/api/game/strats', { headers: h }).then((r) => r.json());
        const m = await fetch('/api/game/coach-matches?limit=20', { headers: h }).then((r) => r.json());
        const partida = (m.matches ?? [])[0];
        // Una jugada de OTRO mapa que el de la partida.
        const otra = (s.strats ?? []).find((x) => x.mapId !== (partida?.mapId ?? partida?.map_id));
        if (!partida || !otra) return { probado: false, motivo: 'no hay jugada de otro mapa' };
        const r = await fetch('/api/game/match-strats', {
          method: 'POST', headers: h,
          body: JSON.stringify({ action: 'assign', matchId: partida.id, stratId: otra.id }),
        });
        return { probado: true, status: r.status, cuerpo: (await r.text()).slice(0, 160) };
      })()`);
      console.log("mapa cruzado:", JSON.stringify(informe.crossMap));

      /* ═════════ 4 · CONCURRENCIA: dos pestañas ═════════ */
      if (datos.primeraStrat) {
        informe.concurrencia = await tab.js<any>(`(async () => {
          const h = { authorization: 'Bearer ' + ${JSON.stringify(jwt)}, 'content-type': 'application/json' };
          const lista = await fetch('/api/game/strats', { headers: h }).then((r) => r.json());
          const s = (lista.strats ?? [])[0];
          if (!s) return { probado: false };
          const version = s.updatedAt;

          // PESTAÑA A: guarda con la versión que leyó. Debe funcionar y avanzar la versión.
          const a = await fetch('/api/game/strats', {
            method: 'POST', headers: h,
            body: JSON.stringify({ action: 'save', id: s.id, strat: { ...s.plan, name: s.name }, baseVersion: version }),
          });
          const aJson = await a.json();

          // PESTAÑA B: guarda con la versión VIEJA. NO puede pisar a A.
          const b = await fetch('/api/game/strats', {
            method: 'POST', headers: h,
            body: JSON.stringify({ action: 'save', id: s.id, strat: { ...s.plan, name: s.name + ' (B)' }, baseVersion: version }),
          });
          const bJson = await b.json();

          // ¿Qué quedó guardado? Tiene que ser lo de A.
          const tras = await fetch('/api/game/strats', { headers: h }).then((r) => r.json());
          const final = (tras.strats ?? []).find((x) => x.id === s.id);
          return {
            probado: true,
            aStatus: a.status, aVersion: aJson.version ?? null,
            bStatus: b.status, bCode: bJson.code ?? null, bMensaje: bJson.error ?? null,
            nombreFinal: final?.name ?? null, pisado: final?.name?.endsWith('(B)') ?? false,
          };
        })()`);
        console.log("concurrencia:", JSON.stringify(informe.concurrencia));
      }

      /* ═════════ 5 · TABLET ═════════ */
      await tab.js(`document.querySelector('[data-testid="theater-close"]')?.click()`);
      await sleep(600);
      await tab.resize(768, 1024, 2);
      await tab.goto(`${BASE}/entrenador/plan?match=${matchId}`, 4000);
      await sleep(2400);
      await foto(tab, "plan-tablet-768");

      await tab.resize(2560, 1440, 1);
      await tab.goto(`${BASE}/entrenador/composiciones`, 4000);
      await sleep(2200);
      await foto(tab, "composiciones-2560");
    } else {
      console.log("· sin partidas de entrenador: el plan no se puede probar con datos reales");
      informe.plan = { montado: false, motivo: "la cuenta QA no tiene partidas de entrenador" };
    }

    informe.fin = new Date().toISOString();
    informe.capturas = n - 20;
  } finally {
    if (browser) await browser.close();
    writeFileSync(join(OUT, "close-qa.json"), JSON.stringify(informe, null, 2));
    console.log(`\nFIN · RAM ${freeMb()} MB · → docs/product/qa/fase47/close-qa.json`);
  }
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
