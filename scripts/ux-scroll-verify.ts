/**
 * VERIFICACIÓN DE SCROLL Y ZONA DE JUEGO — `npm run ux:scroll`
 *
 *   npm run build && npx next start -p 3005     (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 npm run ux:scroll
 *
 * Nace de dos problemas encontrados JUGANDO, no por ningún test:
 *
 *   A. **La rueda del ratón no desplazaba la página.** El lienzo del Entrenador registraba
 *      `wheel` con `preventDefault()` incondicional. El tablero mide ~640 × 1100 px —casi
 *      todo el viewport—, así que el cursor está encima de él prácticamente siempre y la
 *      página no bajaba: había que arrastrar la barra del navegador a mano.
 *
 *   B. **La mano de Duelos quedaba por debajo del pliegue.** La arena pedía 947 px de alto
 *      fijo; en 1440×900, 1366×768, 1280×720, 1024×768 y 390×844 las diez cartas caían
 *      fuera de la pantalla, y a 1280×720 hasta el botón de confirmar.
 *
 * ────────────────────────── CÓMO SE MIDE, Y POR QUÉ ASÍ ──────────────────────────
 *
 * Para (A) NO se sintetiza un gesto de rueda: en este Chrome sin cabeza,
 * `Input.synthesizeScrollGesture` no desplaza ni una página trivial de 5.000 px, así que
 * un «no se movió» no probaría nada. Se mide la CAUSA directamente: se lanza un `wheel`
 * cancelable sobre el centro del lienzo y se comprueba si alguien lo cancela. Sin Ctrl no
 * puede cancelarse —la rueda es de la página—; con Ctrl sí, porque entonces es zoom.
 *
 * Para (B) se cuentan las cartas de la mano cuyo rectángulo cae ENTERO dentro del viewport,
 * sin desplazar. Es la pregunta del jugador: ¿puedo ver y pulsar mis cartas sin bajar?
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch } from "./lib/cdp";
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
if (!URL_ || !ANON || !SERVICE) {
  console.error("Faltan credenciales de Supabase en .env.local");
  process.exit(1);
}

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/** Las resoluciones que pidió producto, de la más holgada a la más apretada. */
const VIEWPORTS: [number, number, string][] = [
  [1440, 900, "escritorio"],
  [1366, 768, "portátil"],
  [1280, 720, "portátil bajo"],
  [1024, 768, "tableta apaisada"],
  [768, 1024, "tableta"],
  [390, 844, "móvil"],
];

/** Rutas con lienzo grande: son las que podían tragarse la rueda. */
const CON_LIENZO = ["/entrenador/mapas", "/entrenador/strats"];

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const registry = new CardRegistry();

/**
 * Diez cartas legales, dos por rol.
 *
 * Se conceden por la RPC real y el mazo se guarda con `saveDeck`, el mismo servicio que usa
 * el constructor: aquí no se inserta nada a mano en `user_cards` ni en `duel_decks`, porque
 * un mazo sembrado por fuera podría ser uno que el juego no aceptaría.
 */
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

async function main(): Promise<void> {
  console.log(`# Verificación de SCROLL y ZONA DE JUEGO — ${BASE}\n`);

  const ping = await fetch(`${BASE}/duelos`).catch(() => null);
  if (!ping?.ok) {
    console.error(`No hay servidor en ${BASE}. Arranca \`npx next start -p 3005\` y repite.`);
    process.exit(1);
  }

  const email = `uxscroll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: creado, error: e1 } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { username: `ux${Date.now().toString(36)}` },
  });
  if (e1 || !creado.user) throw new Error(e1?.message ?? "no se pudo crear la cuenta");
  const userId = creado.user.id;

  // Mazo listo antes de abrir el navegador: la arena necesita una partida para medirse.
  await db.rpc("app_grant_cards", {
    p_user: userId,
    p_instances: cartasParaDuelo().map((cardId) => ({ cardId, serial: null })),
    p_mint_delta: {},
    p_origin: "admin",
  });
  const col = await listCollection(db, userId);
  const guardado = await saveDeck(db, userId, {
    name: "Mazo UX",
    cardUids: (col.data?.cards ?? []).map((c) => c.uid).slice(0, 10),
  });
  if (!guardado.ok || !guardado.data?.deck.valid) {
    throw new Error("no se pudo sembrar un mazo válido para medir la arena");
  }

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  const session = signin!.session!;
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  const browser = await launch();
  const tab = browser.tab;

  try {
    await tab.send("Network.enable");
    await tab.send("Network.setCacheDisabled", { cacheDisabled: true });
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/`, 1200);
    await tab.setStorage(storageKey, JSON.stringify(session));

    // ══════════════════════════════════════════════════════════════════
    console.log("## 1 · LA RUEDA ES DE LA PÁGINA");
    // ══════════════════════════════════════════════════════════════════
    for (const ruta of CON_LIENZO) {
      await tab.goto(`${BASE}${ruta}`, 2600);
      const r = await tab.js<{
        hayLienzo: boolean; alto: number; vp: number; ocupa: number;
        sinCtrl: boolean | null; conCtrl: boolean | null;
      }>(`(() => {
        const svg = document.querySelector('svg[role="application"]');
        const d = document.documentElement;
        if (!svg) return { hayLienzo: false, alto: d.scrollHeight, vp: innerHeight, ocupa: 0, sinCtrl: null, conCtrl: null };
        const b = svg.getBoundingClientRect();
        const x = b.x + b.width / 2, y = b.y + b.height / 2;
        const el = document.elementFromPoint(x, y) || svg;
        const tirar = (ctrl) => {
          const ev = new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true, ctrlKey: ctrl });
          el.dispatchEvent(ev);
          return ev.defaultPrevented;
        };
        return {
          hayLienzo: true, alto: d.scrollHeight, vp: innerHeight,
          ocupa: Math.round((b.height / innerHeight) * 100),
          sinCtrl: tirar(false), conCtrl: tirar(true),
        };
      })()`);

      check(`${ruta}: hay lienzo y ocupa el viewport`, r.hayLienzo, `${r.ocupa} % del alto`);
      check(`${ruta}: la rueda SIN Ctrl no se cancela (la página baja)`, r.sinCtrl === false,
        r.sinCtrl === null ? "sin lienzo" : `cancelada=${r.sinCtrl}`);
      check(`${ruta}: la rueda CON Ctrl sí se cancela (hace zoom)`, r.conCtrl === true,
        r.conCtrl === null ? "sin lienzo" : `cancelada=${r.conCtrl}`);
    }

    // Y ninguna otra pantalla puede tragarse la rueda.
    console.log("\n## 2 · NINGUNA PANTALLA SE QUEDA LA RUEDA");
    for (const ruta of ["/", "/coleccion", "/tienda", "/logros", "/duelos", "/cuenta", "/eventos"]) {
      await tab.goto(`${BASE}${ruta}`, 2100);
      const r = await tab.js<{ cancelada: boolean; alto: number; vp: number }>(`(() => {
        const puntos = [[innerWidth/2, innerHeight*0.35],[innerWidth/2, innerHeight*0.6],[innerWidth*0.25, innerHeight*0.5]];
        let cancelada = false;
        for (const [x, y] of puntos) {
          const el = document.elementFromPoint(x, y);
          if (!el) continue;
          const ev = new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true });
          el.dispatchEvent(ev);
          if (ev.defaultPrevented) cancelada = true;
        }
        const d = document.documentElement;
        return { cancelada, alto: d.scrollHeight, vp: innerHeight };
      })()`);
      check(`${ruta}: la rueda llega a la página`, r.cancelada === false,
        `alto ${r.alto} · viewport ${r.vp}`);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 3 · DUELOS · LA MANO SE VE SIN DESPLAZAR");
    // ══════════════════════════════════════════════════════════════════
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/duelos/jugar`, 3000);
    const arrancada = await tab.js<boolean>(`(async()=>{
      const s = ms => new Promise(r => setTimeout(r, ms));
      const B = () => [...document.querySelectorAll('button')];
      const c = B().find(x => /Comenzar duelo/i.test(x.textContent));
      if (c) { c.click(); await s(3200); }
      return !!document.querySelector('[aria-label="Tu mano"]');
    })()`);
    check("hay una partida en curso con su mano", arrancada);

    for (const [w, h, nombre] of VIEWPORTS) {
      await tab.resize(w, h, 1);
      await tab.js(`new Promise(r=>setTimeout(r,650))`);
      const m = await tab.js<{
        cartas: number; visibles: number; botonVisible: boolean;
        pagina: number; vp: number; overflowX: boolean; reversos: number; cartasRival: number;
      }>(`(() => {
        const d = document.documentElement;
        const mano = document.querySelector('[aria-label="Tu mano"]');
        const cartas = mano ? [...mano.querySelectorAll('button')] : [];
        const dentro = (q) => q.top >= 0 && q.bottom <= innerHeight && q.width > 20;
        const boton = [...document.querySelectorAll('button')]
          .find(x => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(x.textContent.trim()));
        const rival = document.querySelector('[aria-label^="El rival tiene"]');
        return {
          cartas: cartas.length,
          visibles: cartas.filter(c => dentro(c.getBoundingClientRect())).length,
          botonVisible: boton ? dentro(boton.getBoundingClientRect()) : false,
          pagina: d.scrollHeight, vp: innerHeight,
          overflowX: d.scrollWidth > d.clientWidth + 1,
          reversos: rival ? rival.querySelectorAll('div').length : 0,
          // Ninguna carta del rival sin jugar puede tener texto legible.
          cartasRival: rival ? [...rival.querySelectorAll('*')].filter(n => (n.textContent || '').trim().length > 1).length : 0,
        };
      })()`);

      const etiqueta = `${w}×${h} (${nombre})`;
      check(`${etiqueta}: TODAS las cartas de la mano se ven sin desplazar`,
        m.cartas > 0 && m.visibles === m.cartas, `${m.visibles}/${m.cartas}`);
      check(`${etiqueta}: el botón de jugar está a la vista`, m.botonVisible);
      check(`${etiqueta}: sin desbordamiento horizontal`, !m.overflowX);
      check(`${etiqueta}: la mano del rival sigue oculta`,
        m.reversos > 0 && m.cartasRival === 0, `${m.reversos} reversos, ${m.cartasRival} con texto`);
    }
  } finally {
    await browser.close().catch(() => {});
    await db.from("duel_matches").delete().eq("user_id", userId);
    await db.from("duel_decks").delete().eq("user_id", userId);
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    fail === 0
      ? `\n✅ LA RUEDA DESPLAZA Y LA MANO SE VE — ${pass}/${pass + fail}`
      : `\n❌ ${fail} COMPROBACIÓN(ES) FALLARON — ${pass}/${pass + fail}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
