/**
 * QA VISUAL del Entrenador 2.0 — instrumento de un solo uso (prefijo `_`, fuera de CI).
 *
 * Recorre el guion del encargo con un Chrome real y una sesión real: home → jugar →
 * preparación → sorteo 50/50 → sala táctica → compra → ronda → fin de ronda, y la pizarra con
 * agente y habilidad. Guarda una captura de cada estado importante para MIRARLAS.
 *
 * Mide además lo que el encargo pide medir y una aserción no puede afirmar sola: si la acción
 * principal está DENTRO del viewport sin desplazarse.
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
// El roster COMPILADO: es quien sabe el rol de cada jugador. `content_cards` guarda la carta,
// no el rol — el rol vive en el jugador, y el equipo se valida por roles.
import { getPlayer } from "@/data/catalog";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE = "http://127.0.0.1:3005";
const db: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const OUT = join(ROOT, "docs", "product", "qa", "entrenador2");
mkdirSync(OUT, { recursive: true });

const cuentas: string[] = [];
let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};

async function cuenta() {
  const email = `qat2-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data!.user!.id;
  cuentas.push(id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  return { id, session: s.data.session! };
}

/** ¿Está el control visible SIN desplazarse? Es la pregunta del encargo, medida. */
const sinScroll = (tab: Tab, texto: string) => tab.js<{ hay: boolean; dentro: boolean; top: number }>(
  "(() => {" +
  `  const re = /${texto}/i;` +
  "  const b = [...document.querySelectorAll('button,a')]" +
  "    .filter(e => re.test(e.textContent || ''))" +
  "    .filter(e => e.getBoundingClientRect().height > 0)[0];" +
  "  if (!b) return { hay: false, dentro: false, top: -1 };" +
  "  const r = b.getBoundingClientRect();" +
  "  return { hay: true, dentro: r.top >= 0 && r.bottom <= window.innerHeight, top: Math.round(r.top) };" +
  "})()",
);

const pulsar = (tab: Tab, texto: string) => tab.js<boolean>(
  "(() => {" +
  `  const re = /${texto}/i;` +
  "  const b = [...document.querySelectorAll('button,a')]" +
  "    .filter(e => re.test(e.textContent || ''))" +
  "    .filter(e => e.getBoundingClientRect().height > 0)[0];" +
  "  if (!b) return false; b.click(); return true;" +
  "})()",
);

/**
 * Cinco cartas y un equipo con los cinco titulares.
 *
 * Sin equipo, `/entrenador/partido` enseña la puerta cerrada y nunca se llega al sorteo del
 * lado — que es justo lo que hay que comprobar. `useTeamStore` se persiste en `localStorage`,
 * así que el equipo se siembra ahí; las cartas, en `user_cards`, que es su sitio real.
 */
async function sembrarEquipo(userId: string) {
  const { data: defs } = await db.from("content_cards")
    .select("card_id, player_id").eq("lifecycle", "PUBLISHED").limit(400);
  const filas = (defs ?? []) as { card_id: string; player_id: string }[];
  // Uno por rol: la validación del equipo exige los cinco roles del juego.
  const porRol = new Map<string, string>();
  for (const f of filas) {
    const rol = getPlayer(f.player_id)?.role;
    if (rol && !porRol.has(rol)) porRol.set(rol, f.card_id);
  }
  const elegidas = [...porRol.values()].slice(0, 5);
  if (elegidas.length < 5) return null;

  const { data: ins } = await db.from("user_cards")
    .insert(elegidas.map((card_id) => ({ user_id: userId, card_id, origin: "pack", minted_version: 1 })))
    .select("uid");
  const uids = ((ins ?? []) as { uid: string }[]).map((r) => r.uid);
  if (uids.length < 5) return null;

  const ahora = Date.now();
  return {
    state: {
      teams: [{
        id: "qa-team", name: "QA Esports", logo: "🛡️",
        starters: uids, subs: [], createdAt: ahora, lastUsedAt: null,
      }],
      activeTeamId: "qa-team",
    },
    version: 0,
  };
}

async function main() {
  const jugador = await cuenta();
  const equipo = await sembrarEquipo(jugador.id);
  const b = await launch({ width: 1440, height: 900 });
  const tab = b.tab;
  const key = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  try {
    await tab.goto(`${BASE}/`, 1500);
    await tab.setStorage(key, JSON.stringify(jugador.session));
    if (equipo) await tab.setStorage("drl-champions-teams", JSON.stringify(equipo));
    check("el QA tiene equipo con cinco titulares", !!equipo, equipo ? "sembrado" : "NO se pudo sembrar");

    // ═══ 1 · LA HOME ═══
    console.log("\n─── 1 · HOME DEL ENTRENADOR ───");
    await tab.goto(`${BASE}/entrenador`, 5000);
    await sleep(2500);
    await tab.shot(join(OUT, "01-home-1440.png"));
    const jugar = await sinScroll(tab, "jugar|crear tu equipo|completar la alineaci");
    check("la entrada al modo existe", jugar.hay, `top ${jugar.top}px`);
    check("y se ve SIN desplazarse", jugar.dentro, jugar.dentro ? "dentro del viewport" : `top ${jugar.top}px`);

    /*
     * El dominio se mide contra una HERRAMIENTA de la sección de herramientas, no contra la
     * primera tarjeta que aparezca: las miniaturas de mapa son cuadradas y altas por su
     * proporción, y compararse con ellas medía otra cosa.
     */
    const dominio = await tab.js<{ portal: number; herramienta: number; total: number }>(
      "(() => {" +
      "  const a = [...document.querySelectorAll('a')]" +
      "    .find(e => /entrenador\\/(partido|equipos)$/.test(e.getAttribute('href') || ''));" +
      "  const sec = [...document.querySelectorAll('section')]" +
      "    .find(e => /Herramientas/i.test(e.getAttribute('aria-label') || ''));" +
      "  const t = sec ? sec.querySelector('a') : null;" +
      "  return { portal: a ? Math.round(a.getBoundingClientRect().height) : 0," +
      "           herramienta: t ? Math.round(t.getBoundingClientRect().height) : 0," +
      "           total: sec ? Math.round(sec.getBoundingClientRect().height) : 0 };" +
      "})()",
    );
    check("la entrada DOMINA sobre una herramienta",
      dominio.portal > dominio.herramienta * 2.5,
      `${dominio.portal}px vs ${dominio.herramienta}px`);
    check("y sobre la sección de herramientas ENTERA",
      dominio.portal > dominio.total * 0.9,
      `${dominio.portal}px vs ${dominio.total}px las seis juntas`);

    // ═══ 2 · PREPARACIÓN Y SORTEO ═══
    console.log("\n─── 2 · PREPARACIÓN · SORTEO 50/50 ───");
    await tab.goto(`${BASE}/entrenador/partido`, 5000);
    await sleep(2500);
    await tab.shot(join(OUT, "02-preparacion-1440.png"));

    const eleccion = await tab.js<{ pildoras: number; texto: boolean }>(
      "(() => ({" +
      "  pildoras: [...document.querySelectorAll('button')]" +
      "    .filter(e => /^\\s*(ataque|defensa)\\s*$/i.test(e.textContent || '')).length," +
      "  texto: /50\\s*\\/\\s*50/.test(document.body.innerText || '')," +
      "}))()",
    );
    check("el usuario YA NO puede elegir lado", eleccion.pildoras === 0,
      `${eleccion.pildoras} píldoras de bando`);
    check("y la pantalla dice que es 50/50", eleccion.texto, "«50 / 50» en pantalla");

    const cta = await sinScroll(tab, "sortear lado y jugar|crear mi primer equipo|gestionar equipos");
    check("la acción principal se ve sin desplazarse", cta.hay && cta.dentro, `top ${cta.top}px`);

    // ═══ 2b · DENTRO DEL PARTIDO ═══
    console.log("\n─── 2b · DENTRO DEL PARTIDO ───");
    const arranca = await pulsar(tab, "sortear lado y jugar");
    check("se puede entrar al partido", arranca, arranca ? "pulsado" : "no hay botón");
    // El sorteo tarda ~1,1 s y después entra la intro cinemática.
    await sleep(4000);
    await tab.js("(() => { const b=[...document.querySelectorAll('button')].find(e=>/empezar el partido/i.test(e.textContent||'')); if(b)b.click(); })()");
    await sleep(3500);

    const inmersivo = await tab.js<{ modo: string; alto: number; vp: number; scroll: boolean }>(
      "(() => {" +
      "  const el = document.querySelector('[data-immersive]');" +
      "  const d = document.documentElement;" +
      "  return {" +
      "    modo: el ? (el.getAttribute('data-immersive') || '') : ''," +
      "    alto: el ? Math.round(el.getBoundingClientRect().height) : 0," +
      "    vp: window.innerHeight," +
      "    scroll: d.scrollHeight > d.clientHeight + 4," +
      "  };" +
      "})()",
    );
    check("el partido ocupa el viewport", inmersivo.modo !== "" && inmersivo.alto >= inmersivo.vp * 0.8,
      `${inmersivo.alto}px de ${inmersivo.vp}px · modo «${inmersivo.modo}»`);
    check("y no obliga a desplazarse verticalmente", !inmersivo.scroll,
      inmersivo.scroll ? "hay scroll" : "sin scroll");
    await tab.shot(join(OUT, "05-sala-tactica-1440.png"));

    const compra = await sinScroll(tab, "comenzar fase de compra");
    check("COMENZAR FASE DE COMPRA se ve sin desplazarse", compra.hay && compra.dentro,
      compra.hay ? `top ${compra.top}px` : "no está");

    if (compra.hay) {
      await pulsar(tab, "comenzar fase de compra");
      await sleep(2500);
      await tab.shot(join(OUT, "06-compra-1440.png"));
      const jugarRonda = await sinScroll(tab, "jugar la ronda");
      check("JUGAR LA RONDA se ve sin desplazarse", jugarRonda.hay && jugarRonda.dentro,
        jugarRonda.hay ? `top ${jugarRonda.top}px` : "no está");

      if (jugarRonda.hay) {
        await pulsar(tab, "jugar la ronda");
        await sleep(3000);
        await tab.shot(join(OUT, "07-ronda-1440.png"));
        const mapa = await tab.js<{ svg: boolean; area: number; vp: number }>(
          "(() => {" +
          "  const el = document.querySelector('[data-immersive] svg, [data-immersive] canvas');" +
          "  const r = el ? el.getBoundingClientRect() : null;" +
          "  return { svg: !!el, area: r ? Math.round(r.width * r.height) : 0," +
          "           vp: window.innerWidth * window.innerHeight };" +
          "})()",
        );
        check("el campo domina la pantalla durante la ronda",
          mapa.svg && mapa.area > mapa.vp * 0.35,
          `${Math.round((mapa.area / mapa.vp) * 100)}% del viewport`);

        // Acelerar hasta el fin de ronda.
        await tab.js("(() => { const b=[...document.querySelectorAll('button')].find(e=>/^\\s*8×\\s*$/.test(e.textContent||'')); if(b)b.click(); })()");
        let finRonda = { hay: false, dentro: false, top: -1 };
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          /*
           * La ronda SE DETIENE a pedir una decisión al entrenador —«¡Execute ya!», «Rush al
           * sitio»…— y no sigue hasta que se responde. Es lo correcto: el modo consiste en
           * decidir. Un recorrido automático que no responda se queda ahí para siempre, así
           * que aquí se contesta siempre la primera opción.
           */
          await tab.js(
            "(() => {" +
            /*
             * SOLO dentro del overlay de decisión. La cabecera del escenario también es `z-20`
             * y su primer botón es «Abandonar»: un selector amplio salía del partido en vez de
             * responder, y el campo pasaba a medir cero.
             */
            "  const ov = document.querySelector('[class*=\"inset-0\"][class*=\"z-20\"]');" +
            "  if (!ov) return false;" +
            "  const b = [...ov.querySelectorAll('button')]" +
            "    .filter(e => e.getBoundingClientRect().height > 0)[0];" +
            "  if (b) { b.click(); return true; }" +
            "  return false;" +
            "})()",
          );
          finRonda = await sinScroll(tab, "siguiente ronda|ver resultado del partido");
          if (finRonda.hay) break;
        }
        check("se llega al fin de ronda", finRonda.hay, finRonda.hay ? "sí" : "no llegó en 60 s");
        if (finRonda.hay) {
          await tab.shot(join(OUT, "08-fin-de-ronda-1440.png"));
          check("SIGUIENTE RONDA se ve sin desplazarse", finRonda.dentro, `top ${finRonda.top}px`);
          const resultado = await tab.js<boolean>(
            "(() => /ronda ganada|ronda perdida/i.test(document.body.innerText || ''))()",
          );
          check("y el resultado de la ronda se anuncia", resultado, resultado ? "anunciado" : "no se ve");
        }
      }
    }

    console.log(`\n  capturas en ${OUT}`);

    // ═══ 3 · LA PIZARRA CON AGENTES ═══
    console.log("\n─── 3 · PIZARRA · AGENTES Y HABILIDADES REALES ───");
    await tab.goto(`${BASE}/entrenador/strats`, 7000);
    await sleep(3500);
    // Seleccionar la primera ficha de jugador del mapa.
    /*
     * La ficha se pulsa por su CENTRO real. Un `pointerdown` en (0,0) cae fuera del elemento
     * y el arrastre lo descarta: la pizarra empieza a arrastrar desde donde se pulsa, así que
     * hay que pulsar donde la ficha está.
     */
    const seleccion = await tab.js<boolean>(
      "(() => {" +
      "  const g = [...document.querySelectorAll('svg[role=\"application\"] [tabindex=\"0\"]')]" +
      "    .filter(e => e.getBoundingClientRect().width > 0)[0];" +
      "  if (!g) return false;" +
      "  const r = g.getBoundingClientRect();" +
      "  const x = r.left + r.width / 2, y = r.top + r.height / 2;" +
      "  const o = { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true };" +
      "  g.dispatchEvent(new PointerEvent('pointerdown', o));" +
      "  window.dispatchEvent(new PointerEvent('pointerup', o));" +
      "  return true;" +
      "})()",
    );
    check("se puede seleccionar una ficha de jugador", seleccion, seleccion ? "seleccionada" : "no hay fichas");
    await sleep(1500);
    const pizarra = await tab.js<{ agentes: string[]; falsos: string[] }>(
      "(() => {" +
      "  const t = document.body.innerText || '';" +
      "  const reales = ['Veil','Haze','Probe','Pulse','Spear','Blitz','Warden','Tripwire','Specter','Echo'];" +
      "  const falsos = ['Jett','Sova','Omen','Reyna','Killjoy','Sage','Viper','Phoenix'];" +
      // SIN distinguir mayúsculas: la interfaz los pinta en caja alta («VEIL», «PROBE»).
      "  return { agentes: reales.filter(n => new RegExp('\\\\b'+n+'\\\\b','i').test(t))," +
      "           falsos: falsos.filter(n => new RegExp('\\\\b'+n+'\\\\b','i').test(t)) };" +
      "})()",
    );
    await tab.shot(join(OUT, "03-pizarra-1440.png"));
    check("la pizarra ofrece los agentes REALES del proyecto", pizarra.agentes.length >= 5,
      pizarra.agentes.join(", ") || "ninguno visible");
    check("y NINGÚN agente inventado", pizarra.falsos.length === 0,
      pizarra.falsos.join(", ") || "ninguno");

    // ═══ 4 · RESPONSIVE ═══
    console.log("\n─── 4 · RESPONSIVE ───");
    for (const ancho of [390, 768, 1024, 1440]) {
      await tab.resize(ancho, 900);
      await tab.goto(`${BASE}/entrenador`, 4500);
      await sleep(2200);
      const r = await tab.js<{ desborde: boolean; pequenos: number }>(
        "(() => {" +
        "  const chicos = [...document.querySelectorAll('button,a')].filter(e => {" +
        "    const b = e.getBoundingClientRect();" +
        "    return b.width > 0 && b.height > 0 && b.height < 32;" +
        "  }).length;" +
        "  return { desborde: document.documentElement.scrollWidth > window.innerWidth + 1, pequenos: chicos };" +
        "})()",
      );
      check(`@${ancho} · sin desbordamiento horizontal`, !r.desborde, r.desborde ? "desborda" : "encaja");
      const v = await sinScroll(tab, "jugar|crear tu equipo|completar la alineaci");
      check(`@${ancho} · la acción principal se ve sin desplazarse`, v.dentro, `top ${v.top}px`);
      if (ancho === 390) await tab.shot(join(OUT, "04-home-390.png"));
    }

    const errores = tab.takeErrors().filter((e) => !/favicon|manifest|sw\.js|404/i.test(e));
    check("sin errores de consola", errores.length === 0, errores.slice(0, 2).join(" | ") || "limpia");
  } finally {
    await b.close();
    for (const id of cuentas) {
      await db.from("user_cards").delete().eq("user_id", id);
      await db.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n${"─".repeat(60)}\n  ${pass} correctas · ${fail} fallidas`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
