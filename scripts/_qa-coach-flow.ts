/**
 * QA DEL FLUJO DEL ENTRENADOR — instrumento de un solo uso (prefijo `_`, fuera de CI).
 *
 * Recorre el circuito entero con un Chrome real y una sesión real, y sobre todo comprueba lo
 * que sale del recorrido: que un partido terminado APAREZCA en el historial, y que el
 * historial y la carrera hablen de los mismos partidos.
 *
 * Comprueba además, en las cuatro anchuras, dos cosas que ninguna aserción de unidad ve:
 * que no haya enlaces muertos en el Entrenador y que las acciones críticas estén dentro del
 * viewport sin desplazarse.
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
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

const OUT = join(ROOT, "docs", "product", "qa", "entrenador2-cierre");
mkdirSync(OUT, { recursive: true });

const cuentas: string[] = [];
let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const title = (t: string): void => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

async function cuenta() {
  const email = `qaflow-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data!.user!.id;
  cuentas.push(id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  return { id, session: s.data.session! };
}

async function sembrarEquipo(userId: string) {
  const { data: defs } = await db.from("content_cards")
    .select("card_id, player_id").eq("lifecycle", "PUBLISHED").limit(400);
  const filas = (defs ?? []) as { card_id: string; player_id: string }[];
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
  return {
    state: {
      teams: [{
        id: "qa-team", name: "Flujo FC", logo: "🛡️",
        starters: uids, subs: [], createdAt: Date.now(), lastUsedAt: null,
      }],
      activeTeamId: "qa-team",
    },
    version: 0,
  };
}

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
    check("hay equipo con cinco titulares", !!equipo, equipo ? "sembrado" : "NO se pudo sembrar");

    // ══════════════════════════════════════════════════════════════════
    title("1 · ESTADO VACÍO ANTES DE JUGAR");
    await tab.goto(`${BASE}/entrenador/partidos`, 6000);
    await sleep(3000);
    await tab.shot(join(OUT, "10-partidos-vacio-1440.png"));
    const vacio = await tab.js<{ texto: boolean; tabla: boolean }>(
      "(() => ({" +
      "  texto: /todav[ií]a no has dirigido/i.test(document.body.innerText || '')," +
      "  tabla: !!document.querySelector('table')," +
      "}))()",
    );
    check("sin partidos, se explica en vez de enseñar una tabla vacía", vacio.texto && !vacio.tabla,
      vacio.tabla ? "hay una tabla" : "estado vacío");
    const cta = await sinScroll(tab, "jugar partido");
    check("y el estado vacío lleva DIRECTO a jugar, sin desplazarse", cta.hay && cta.dentro,
      cta.hay ? `top ${cta.top}px` : "no hay CTA");
    const ctaHref = await tab.js<string | null>(
      "(() => { const a = [...document.querySelectorAll('a')].find(e => /jugar partido/i.test(e.textContent || ''));" +
      " return a ? a.getAttribute('href') : null; })()",
    );
    check("y ese CTA va al modo de juego", ctaHref === "/entrenador/partido", String(ctaHref));

    await tab.goto(`${BASE}/carrera`, 6000);
    await sleep(3000);
    await tab.shot(join(OUT, "01-carrera-vacia-1440.png"));
    const carreraVacia = await tab.js<{ texto: boolean; href: string | null; ceros: boolean }>(
      "(() => { const t = document.body.innerText || '';" +
      " const a = [...document.querySelectorAll('a')].find(e => /dirigir mi primer partido/i.test(e.textContent || ''));" +
      " return { texto: /tu carrera empieza/i.test(t), href: a ? a.getAttribute('href') : null," +
      "   ceros: /balance\\s*0\\s*[–-]\\s*0/i.test(t) }; })()",
    );
    check("la carrera sin partidos invita a jugar", carreraVacia.texto && carreraVacia.href === "/entrenador/partido",
      String(carreraVacia.href));
    check("y no pinta un balance 0–0 inventado", !carreraVacia.ceros, carreraVacia.ceros ? "pinta 0–0" : "sin ceros");

    // ══════════════════════════════════════════════════════════════════
    title("2 · EL CIRCUITO: JUGAR → PARTIDO → FINAL");
    await tab.goto(`${BASE}/entrenador/partido`, 6000);
    await sleep(2500);
    await pulsar(tab, "sortear lado y jugar");
    await sleep(4000);
    await pulsar(tab, "empezar el partido");
    await sleep(3000);

    /*
     * Se juega el partido ENTERO. Es lento —hay que responder las decisiones del entrenador y
     * dejar correr las rondas— pero es el único modo de comprobar lo que importa: que un
     * partido TERMINADO aparezca en el historial. Simular la fila por la API habría probado la
     * API, no el circuito.
     */
    let terminado = false;
    for (let i = 0; i < 220 && !terminado; i++) {
      await tab.js(
        "(() => {" +
        // Decisión del entrenador: solo dentro del overlay, nunca la cabecera.
        "  const ov = document.querySelector('[class*=\"inset-0\"][class*=\"z-20\"]');" +
        "  if (ov) { const b = [...ov.querySelectorAll('button')].filter(e => e.getBoundingClientRect().height > 0)[0]; if (b) { b.click(); return; } }" +
        "  const av = [...document.querySelectorAll('button')]" +
        "    .filter(e => /comenzar fase de compra|jugar la ronda|siguiente ronda|ver resultado del partido/i.test(e.textContent || ''))" +
        "    .filter(e => e.getBoundingClientRect().height > 0)[0];" +
        "  if (av) av.click();" +
        "})()",
      );
      // A 8× para no eternizar el recorrido.
      await tab.js("(() => { const b=[...document.querySelectorAll('button')].find(e=>/^\\s*8×\\s*$/.test(e.textContent||'')); if(b)b.click(); })()");
      await sleep(1200);
      terminado = await tab.js<boolean>(
        "(() => /victoria|derrota/i.test(document.body.innerText || '') && !document.querySelector('[data-immersive]'))()",
      );
    }
    check("el partido llega al final", terminado, terminado ? "ceremonia final" : "no terminó");
    if (terminado) await tab.shot(join(OUT, "11-final-1440.png"));

    // ── El final: acciones a la vista, sin botones muertos, y el registro dicho ──
    await sleep(2500);
    const fin = await tab.js<{ revancha: boolean; partidos: string | null; top: number; muertos: string[]; estado: string }>(
      "(() => {" +
      "  const bar = document.querySelector('[data-ceremony-actions]');" +
      "  const vis = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight; };" +
      "  const rev = bar && [...bar.querySelectorAll('button')].find(e => /revancha/i.test(e.textContent || ''));" +
      "  const pj = bar && [...bar.querySelectorAll('a')].find(e => /partidos jugados/i.test(e.textContent || ''));" +
      "  const muertos = [...document.querySelectorAll('button[disabled],a[aria-disabled=\"true\"]')]" +
      "    .filter(e => e.getBoundingClientRect().height > 0).map(e => (e.textContent || '').trim().slice(0, 30));" +
      "  const st = bar && bar.querySelector('[role=status]');" +
      "  return { revancha: !!rev && vis(rev), partidos: pj && vis(pj) ? pj.getAttribute('href') : null," +
      "    top: rev ? Math.round(rev.getBoundingClientRect().top) : -1, muertos," +
      "    estado: st ? st.textContent || '' : '' };" +
      "})()",
    );
    check("@1440 la revancha está a la vista sin desplazarse", fin.revancha, `top ${fin.top}px`);
    check("y el paso siguiente —partidos jugados— también", fin.partidos === "/entrenador/partidos", String(fin.partidos));
    check("el final no tiene botones muertos", fin.muertos.length === 0, fin.muertos.join(" | ") || "ninguno");
    check("el final dice que el partido consta", /registrado en tu expediente|ya constaba/i.test(fin.estado), fin.estado);

    for (const [w, h] of [[1024, 768], [768, 1024], [390, 844]] as const) {
      await tab.resize(w, h);
      await sleep(1200);
      const r = await tab.js<{ dentro: boolean; top: number; desborde: boolean }>(
        "(() => { const bar = document.querySelector('[data-ceremony-actions]');" +
        " const rev = bar && [...bar.querySelectorAll('button')].find(e => /revancha/i.test(e.textContent || ''));" +
        " const r = rev ? rev.getBoundingClientRect() : null;" +
        // La barra de navegación móvil es `fixed` al pie: la revancha no puede quedar debajo.
        // Se busca POR SU NOMBRE: el propio pie del final también es `fixed` y no cuenta.
        " const mb = document.querySelector('nav[aria-label=\"Navegación principal\"]');" +
        " const mr = mb ? mb.getBoundingClientRect() : null;" +
        " const tapa = r && mr && mr.height > 0 ? r.bottom > mr.top + 1 : false;" +
        " return { dentro: !!r && r.top >= 0 && r.bottom <= window.innerHeight && !tapa, top: r ? Math.round(r.top) : -1," +
        "   desborde: document.documentElement.scrollWidth > window.innerWidth + 1 }; })()",
      );
      check(`@${w} la revancha está a la vista, sin quedar bajo la barra`, r.dentro, `top ${r.top}px`);
      check(`@${w} el final no desborda`, !r.desborde, r.desborde ? "desborda" : "encaja");
      await tab.shot(join(OUT, `11-final-${w}.png`));
    }
    await tab.resize(1440, 900);
    await sleep(800);

    // ══════════════════════════════════════════════════════════════════
    title("3 · EL PARTIDO CONSTA · Y NO SE DUPLICA AL RECARGAR");
    await sleep(2500);
    const { count: tras } = await db.from("coach_matches")
      .select("id", { count: "exact", head: true }).eq("user_id", jugador.id);
    check("el partido terminado queda registrado", tras === 1, `${tras} filas`);

    // La revancha arranca otro partido de verdad —no es un botón decorativo— y no escribe nada.
    await tab.js(
      "(() => { const bar = document.querySelector('[data-ceremony-actions]');" +
      " const b = bar && [...bar.querySelectorAll('button')].find(e => /revancha/i.test(e.textContent || ''));" +
      " if (b) b.click(); })()",
    );
    await sleep(3500);
    const enRevancha = await tab.js<boolean>(
      "(() => !document.querySelector('[data-ceremony-actions]') &&" +
      " /sala t[aá]ctica|fase de compra|empezar el partido/i.test(document.body.innerText || ''))()",
    );
    check("la revancha arranca otro partido", enRevancha, enRevancha ? "nueva preparación" : "no arrancó");

    /*
     * Recargar. `MatchState` vive en memoria, así que la recarga vuelve al menú y no reenvía
     * nada: esto comprueba el circuito, no la idempotencia —esa la prueba `coach-history:verify`
     * con siete envíos del mismo partido—.
     */
    await tab.js("(() => location.reload())()");
    await sleep(5000);
    const { count: trasRecarga } = await db.from("coach_matches")
      .select("id", { count: "exact", head: true }).eq("user_id", jugador.id);
    check("ni la revancha ni recargar crean otro partido", trasRecarga === tras,
      `${tras} → ${trasRecarga}`);

    // ══════════════════════════════════════════════════════════════════
    title("4 · APARECE EN EL HISTORIAL Y EN LA CARRERA");
    await tab.goto(`${BASE}/entrenador/partidos`, 6000);
    await sleep(3000);
    await tab.shot(join(OUT, "12-partidos-1440.png"));
    const hist = await tab.js<{ fichas: number; resultado: boolean; mapa: boolean; balance: boolean; carrera: boolean }>(
      "(() => {" +
      "  const t = document.body.innerText || '';" +
      "  return {" +
      "    fichas: document.querySelectorAll('section[aria-label=\"Partidos dirigidos\"] ul li').length," +
      "    resultado: /victoria|derrota/i.test(t)," +
      "    mapa: /ascent/i.test(t)," +
      "    balance: /balance/i.test(t)," +
      "    carrera: !!document.querySelector('a[href=\"/carrera\"]')," +
      "  };" +
      "})()",
    );
    check("el historial enseña el partido", hist.fichas === tras, `${hist.fichas} fichas · BD ${tras}`);
    check("con su resultado y su mapa reales", hist.resultado && hist.mapa, "victoria/derrota · Ascent");
    check("y el balance del entrenador", hist.balance, "presente");
    check("y sigue el recorrido hacia la carrera", hist.carrera, "enlace a /carrera");

    await tab.goto(`${BASE}/carrera`, 6000);
    await sleep(3000);
    await tab.shot(join(OUT, "13-carrera-1440.png"));
    const carrera = await tab.js<{ trayectoria: boolean; dirigidos: boolean; enlace: boolean }>(
      "(() => {" +
      "  const t = document.body.innerText || '';" +
      "  return {" +
      "    trayectoria: /trayectoria/i.test(t)," +
      "    dirigidos: /dirigidos/i.test(t)," +
      "    enlace: !!document.querySelector('a[href=\"/entrenador/partidos\"]')," +
      "  };" +
      "})()",
    );
    check("la carrera enseña la trayectoria del entrenador", carrera.trayectoria, "presente");
    check("con los partidos dirigidos, de la misma fuente", carrera.dirigidos, "presente");
    check("y enlaza con el expediente", carrera.enlace, "enlace a /entrenador/partidos");
    const dirigidos = await tab.js<string>(
      "(() => { const l = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^dirigidos$/i.test((e.textContent || '').trim()));" +
      " return l && l.parentElement ? l.parentElement.textContent || '' : ''; })()",
    );
    // El número, leído como número: con `\b` la cifra pegada a la etiqueta («Dirigidos1») no casaba.
    const cifra = Number((dirigidos.match(/dirigidos\s*(\d+)/i) ?? [])[1]);
    check("y la cifra de dirigidos es la de la base de datos", cifra === tras,
      `pantalla ${cifra} · BD ${tras}`);
    const textoCarrera = await tab.js<string>("(() => document.body.innerText || '')()");
    check("el nivel es el GLOBAL de la cuenta, no uno de entrenador", /nivel de cuenta/i.test(textoCarrera), "nivel de cuenta");

    // ══════════════════════════════════════════════════════════════════
    title("5 · SIN ENLACES MUERTOS");
    const rutas = ["/entrenador", "/entrenador/partido", "/entrenador/partidos", "/carrera", "/entrenador/mapas", "/entrenador/equipos"];
    const destinos = new Set<string>();
    for (const ruta of rutas) {
      await tab.goto(`${BASE}${ruta}`, 4500);
      await sleep(1500);
      const hrefs = await tab.js<string[]>(
        "(() => [...document.querySelectorAll('a[href^=\"/\"]')]" +
        ".map(a => a.getAttribute('href') || '')" +
        ".filter(h => h && !h.startsWith('//')))()",
      );
      for (const h of hrefs) destinos.add(h.split("#")[0]);
    }
    const rotos: string[] = [];
    for (const d of destinos) {
      const code = await fetch(`${BASE}${d}`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
      if (code >= 400 || code === 0) rotos.push(`${d} (${code})`);
    }
    check(`ningún enlace del Entrenador está roto (${destinos.size} destinos)`,
      rotos.length === 0, rotos.slice(0, 3).join(", ") || "todos responden");

    // ══════════════════════════════════════════════════════════════════
    title("6 · RESPONSIVE · 390 · 768 · 1024 · 1440");
    const ALTO: Record<number, number> = { 390: 844, 768: 1024, 1024: 768, 1440: 900 };
    for (const ancho of [390, 768, 1024, 1440]) {
      await tab.resize(ancho, ALTO[ancho]);
      for (const ruta of ["/entrenador", "/entrenador/partidos", "/carrera"]) {
        await tab.goto(`${BASE}${ruta}`, 4500);
        await sleep(2000);
        const r = await tab.js<{ desborde: boolean; chicos: number }>(
          "(() => ({" +
          "  desborde: document.documentElement.scrollWidth > window.innerWidth + 1," +
          "  chicos: [...document.querySelectorAll('button,a')].filter(e => {" +
          "    const b = e.getBoundingClientRect();" +
          "    return b.width > 0 && b.height > 0 && b.height < 32;" +
          "  }).length," +
          "}))()",
        );
        check(`@${ancho} ${ruta} · sin desbordamiento`, !r.desborde, r.desborde ? "desborda" : "encaja");
        if (ruta === "/entrenador") {
          const j = await sinScroll(tab, "dirigir partido");
          check(`@${ancho} /entrenador · JUGAR a la vista sin desplazarse`, j.hay && j.dentro,
            j.hay ? `top ${j.top}px` : "no hay CTA");
        }
        await tab.shot(join(OUT, `20-${ruta.replace(/^\//, "").replace(/\//g, "_")}-${ancho}.png`));
      }
    }
    await tab.resize(1440, 900);

    // ══════════════════════════════════════════════════════════════════
    title("7 · SIN SESIÓN");
    await tab.js(`(() => { localStorage.removeItem(${JSON.stringify(key)}); })()`);
    await tab.goto(`${BASE}/entrenador/partidos`, 5000);
    await sleep(2500);
    await tab.shot(join(OUT, "30-partidos-sin-sesion-1440.png"));
    const sinSesion = await tab.js<boolean>("(() => /el historial vive en tu cuenta/i.test(document.body.innerText || ''))()");
    check("sin sesión, el historial lo dice en vez de enseñarse vacío", sinSesion,
      sinSesion ? "invita a entrar" : "no lo dice");

    const errores = tab.takeErrors().filter((e) => !/favicon|manifest|sw\.js|404/i.test(e));
    check("sin errores de consola", errores.length === 0, errores.slice(0, 2).join(" | ") || "limpia");
    console.log(`\n  capturas en ${OUT}`);
  } finally {
    await b.close();
    for (const id of cuentas) {
      await db.from("coach_matches").delete().eq("user_id", id);
      await db.from("user_cards").delete().eq("user_id", id);
      await db.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n${"─".repeat(60)}\n  ${pass} correctas · ${fail} fallidas`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
