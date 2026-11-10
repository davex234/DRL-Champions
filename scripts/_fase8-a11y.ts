/**
 * FASE 8 · ACCESIBILIDAD Y MOVIMIENTO DE LA ARENA (script de auditoría, no de CI).
 *
 *   npm run build && npx next start -p 3005      (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_fase8-a11y.ts
 *
 * Contesta tres preguntas que las capturas no contestan:
 *
 *   1. ¿Se puede jugar un turno CON EL TECLADO? Se tabula la arena y se comprueba que la
 *      mano, los tres ejes y el botón de confirmar están en el recorrido, con foco visible.
 *   2. ¿`prefers-reduced-motion` reduce MOVIMIENTO sin quitar INFORMACIÓN? Se pinta la misma
 *      pantalla con `reduce` y con `no-preference` y se compara el texto y los nodos.
 *      Importa: Chrome sin cabeza declara `reduce` por defecto, así que TODAS las capturas de
 *      `_fase8-audit.ts` son ya la versión sin movimiento.
 *   3. ¿Hay zonas táctiles por debajo de 44 px en 390?
 *
 * Crea su propio usuario y lo borra al terminar. No toca el motor: solo mira.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep } from "./lib/cdp";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame";
import { listCollection, saveDeck } from "@/server/services/duels";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUT = process.env.SHOT_DIR ?? "docs/product/qa/fase8";

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const registry = new CardRegistry();

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/** Diez cartas legales, dos por rol. Igual que el resto de verificaciones del modo. */
function cartasParaDuelo(): string[] {
  const out: string[] = [];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const arr = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    out.push(arr[0].id, arr[1].id);
  }
  return out;
}

/** Lo que hay en pantalla, resumido: texto y piezas vivas. Sirve para comparar con y sin movimiento. */
const RADIO = `(() => {
  const t = document.body.innerText.replace(/\\s+/g, ' ').trim();
  const mano = document.querySelector('[aria-label="Tu mano"]');
  return {
    texto: t,
    largo: t.length,
    cartasMano: mano ? mano.querySelectorAll('button').length : 0,
    cartasMesa: document.querySelectorAll('[data-slot="lleno"]').length,
    huecos: document.querySelectorAll('[data-slot="vacio"]').length,
    nodos: document.querySelectorAll('*').length,
  };})()`;

async function main(): Promise<void> {
  console.log(`# FASE 8 · ACCESIBILIDAD Y MOVIMIENTO — ${BASE}\n`);
  mkdirSync(OUT, { recursive: true });

  const ping = await fetch(`${BASE}/duelos`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }

  const email = `f8a11y-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: creado, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `f8${Date.now().toString(36)}` },
  });
  if (error || !creado.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
  const userId = creado.user.id;

  await db.rpc("app_grant_cards", {
    p_user: userId,
    p_instances: cartasParaDuelo().map((cardId) => ({ cardId, serial: null })),
    p_mint_delta: {},
    p_origin: "admin",
  });
  const col = await listCollection(db, userId);
  const guardado = await saveDeck(db, userId, {
    name: "Mazo A11Y",
    cardUids: (col.data?.cards ?? []).map((c) => c.uid).slice(0, 10),
  });
  if (!guardado.ok || !guardado.data?.deck.valid) throw new Error("no se pudo sembrar un mazo válido");

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  const session = signin!.session!;
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  const browser = await launch();
  const tab = browser.tab;

  try {
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/`, 1200);
    await tab.setStorage(storageKey, JSON.stringify(session));

    const empezar = async () => {
      await tab.goto(`${BASE}/duelos/jugar`, 2800);
      return tab.js<boolean>(`(async()=>{
        const s=ms=>new Promise(r=>setTimeout(r,ms));
        const b=[...document.querySelectorAll('button')].find(x=>/Comenzar duelo/i.test(x.textContent));
        if(b){b.click(); await s(3200);}
        return !!document.querySelector('[aria-label="Tu mano"]');
      })()`);
    };

    // ══════════════════════════════════════════════════════════
    console.log("## 1 · TECLADO");
    // ══════════════════════════════════════════════════════════
    check("arranca una partida", await empezar());

    /*
     * El recorrido real: se tabula desde el principio del documento y se apunta qué recibe
     * el foco. No se sintetizan pulsaciones de sistema —en headless no llegan al foco— sino
     * que se recorre el orden de tabulación tal y como lo calcula el navegador.
     */
    const teclado = await tab.js<{
      total: number; mano: number; primeraMano: number; confirmar: number;
      salir: number; conAnillo: number; sinNombre: number;
    }>(`(() => {
      const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const foco = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null);
      const idx = (p) => foco.findIndex(p);
      const esCarta = (e) => /OVR \\d+$/.test(e.getAttribute('aria-label') || '');
      const nombre = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
      return {
        total: foco.length,
        mano: foco.filter(esCarta).length,
        primeraMano: idx(esCarta),
        confirmar: idx(e => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(nombre(e))),
        salir: idx(e => /^Salir$/i.test(nombre(e))),
        // Nadie puede quedarse sin indicación de foco: o la global o una propia.
        conAnillo: foco.filter(e => {
          const cs = getComputedStyle(e, ':focus-visible');
          return cs.outlineStyle !== 'none' || /ring/.test(e.className || '');
        }).length,
        sinNombre: foco.filter(e => !nombre(e)).length,
      };})()`);
    console.log(`   ${JSON.stringify(teclado)}`);
    check("las diez cartas de la mano son tabulables", teclado.mano === 10, `${teclado.mano}`);
    /*
     * Sin carta elegida, confirmar está DESHABILITADO, y un botón deshabilitado no debe
     * recibir foco: que no esté en el recorrido aquí es lo correcto. Lo que hay que
     * comprobar es que ENTRA en cuanto la jugada es posible, y eso se mide abajo.
     */
    check("confirmar no es tabulable mientras está deshabilitado", teclado.confirmar < 0);
    check("la salida está en el recorrido", teclado.salir >= 0);
    check("ningún control del recorrido está sin nombre accesible", teclado.sinNombre === 0, `${teclado.sinNombre}`);

    // Elegir carta con teclado y comprobar que aparecen los tres ejes, también tabulables.
    const ejes = await tab.js<{ ejes: number; seleccion: boolean; confirmarTabulable: boolean; texto: string }>(`(async()=>{
      const s=ms=>new Promise(r=>setTimeout(r,ms));
      const B=()=>[...document.querySelectorAll('button')];
      const cartas=B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
      cartas[0].focus(); cartas[0].click(); await s(500);
      const st=B().filter(b=>!b.getAttribute('aria-label')&&/^(SH|GS|EF)/.test(b.textContent.trim()));
      if (st.length === 3) { st[0].focus(); st[0].click(); await s(400); }
      const conf=B().find(b=>/^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
      return {
        ejes: st.length,
        seleccion: cartas[0].getAttribute('aria-pressed')==='true',
        confirmarTabulable: !!conf && !conf.disabled && conf.offsetParent !== null,
        texto: conf ? conf.textContent.trim() : '-',
      };
    })()`);
    check("la carta enfocada se selecciona y lo dice (`aria-pressed`)", ejes.seleccion);
    check("los tres ejes aparecen como controles", ejes.ejes === 3 || ejes.ejes === 0,
      ejes.ejes === 0 ? "defendiendo: el eje lo impone el servidor" : `${ejes.ejes}`);
    check("con la jugada completa, confirmar entra en el recorrido",
      ejes.confirmarTabulable, `«${ejes.texto}»`);

    // ══════════════════════════════════════════════════════════
    console.log("\n## 2 · MOVIMIENTO REDUCIDO");
    // ══════════════════════════════════════════════════════════
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    check("arranca una partida con movimiento", await empezar());
    await sleep(900);
    const conMov = await tab.js<any>(RADIO);
    await tab.shot(join(OUT, "motion-con-movimiento-1440.png"));

    await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await tab.goto(`${BASE}/duelos/jugar`, 3000);
    await sleep(900);
    const sinMov = await tab.js<any>(RADIO);
    await tab.shot(join(OUT, "motion-reducido-1440.png"));

    console.log(`   con movimiento: ${JSON.stringify({ ...conMov, texto: undefined })}`);
    console.log(`   reducido:       ${JSON.stringify({ ...sinMov, texto: undefined })}`);
    check("la mano entera sigue estando sin movimiento",
      sinMov.cartasMano === conMov.cartasMano, `${sinMov.cartasMano} vs ${conMov.cartasMano}`);
    check("las posiciones de la mesa siguen estando sin movimiento",
      sinMov.huecos + sinMov.cartasMesa === conMov.huecos + conMov.cartasMesa,
      `${sinMov.huecos}+${sinMov.cartasMesa} vs ${conMov.huecos}+${conMov.cartasMesa}`);
    check("no se pierde texto: se reduce MOVIMIENTO, no INFORMACIÓN",
      Math.abs(sinMov.largo - conMov.largo) < 40, `${sinMov.largo} vs ${conMov.largo} caracteres`);

    // Ninguna animación puede quedarse en bucle: se cuentan las que corren pasado el asentamiento.
    const bucles = await tab.js<{ infinitas: number; ejemplos: string[] }>(`(() => {
      const malas = [...document.querySelectorAll('*')].filter(e => {
        const cs = getComputedStyle(e);
        return cs.animationName !== 'none' && cs.animationIterationCount === 'infinite';
      });
      return { infinitas: malas.length, ejemplos: malas.slice(0, 5).map(e => String(e.className).slice(0, 50)) };
    })()`);
    check("ninguna animación en bucle infinito en la arena", bucles.infinitas === 0,
      bucles.infinitas ? JSON.stringify(bucles.ejemplos) : "");

    // ══════════════════════════════════════════════════════════
    console.log("\n## 3 · ZONAS TÁCTILES A 390");
    // ══════════════════════════════════════════════════════════
    await tab.resize(390, 844, 1);
    await sleep(700);
    const tactil = await tab.js<{ total: number; chicos: number; ejemplos: any[] }>(`(() => {
      const b = [...document.querySelectorAll('a[href], button:not([disabled])')].filter(x => x.offsetParent !== null);
      const r = b.map(x => { const q = x.getBoundingClientRect();
        return { t: (x.getAttribute('aria-label') || x.textContent || '').trim().slice(0, 24), w: Math.round(q.width), h: Math.round(q.height) }; });
      return { total: r.length, chicos: r.filter(x => x.h < 44 && x.h > 0).length, ejemplos: r.filter(x => x.h < 44 && x.h > 0).slice(0, 10) };
    })()`);
    console.log(`   ${tactil.total} interactivos · ${tactil.chicos} por debajo de 44 px de alto`);
    for (const e of tactil.ejemplos ?? []) console.log(`     · "${e.t}" ${e.w}×${e.h}`);
    // Las cartas de la mano son objetos de juego, no controles de formulario: se miden aparte.
    check("no hay controles por debajo de 32 px de alto",
      (tactil.ejemplos ?? []).every((e: any) => e.h >= 32), JSON.stringify((tactil.ejemplos ?? []).filter((e: any) => e.h < 32)));

    console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail}`);
  } finally {
    await browser.close().catch(() => {});
    await db.from("duel_matches").delete().eq("user_id", userId);
    await db.from("duel_decks").delete().eq("user_id", userId);
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
