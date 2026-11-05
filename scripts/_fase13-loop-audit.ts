/**
 * FASE 13 · AUDITORÍA DEL CICLO DE JUEGO (instrumento, NO forma parte de CI).
 *
 *   npx tsx scripts/_fase13-loop-audit.ts [antes|despues]
 *
 * ────────────────────────── QUÉ PREGUNTA RESPONDE ──────────────────────────
 *
 * `loop:verify` ya demuestra que la CADENA DE DATOS del ciclo funciona: que ganar un
 * duelo mueve puntos, créditos y XP; que un Pick'em resuelto reparte recompensa; que
 * `getLoop` responde con el estado real. Eso está probado y no hace falta volver a
 * probarlo aquí.
 *
 * Lo que NO está probado en ningún sitio es la otra mitad: **si el jugador VE ese ciclo**.
 * Un producto puede tener la cadena entera conectada por dentro y aun así dejar al
 * jugador mirando una pantalla sin saber qué hacer. Este instrumento mide exactamente
 * eso, y por eso su unidad de medida no es el píxel sino la SALIDA:
 *
 *   · ¿desde este estado, adónde puede ir el jugador?
 *   · ¿hay una acción destacada, o solo una lista de enlaces?
 *   · ¿el estado vacío ofrece la acción que lo llena?
 *   · ¿ve cuánto tiene y cuánto le falta?
 *
 * Un estado del que no se sale es un DEAD END. Un estado con salidas pero sin una
 * destacada es FRICCIÓN. Los dos se cuentan por separado porque no son el mismo problema.
 *
 * ────────────────────────── DOS JUGADORES, NO UNO ──────────────────────────
 *
 * La Fase 12 midió con un usuario sembrado —40 cartas, 18 000 créditos— porque medía
 * presentación y necesitaba pantallas llenas. Aquí eso sería justo la trampa: el ciclo
 * de un veterano y el de alguien que acaba de registrarse son recorridos distintos, y el
 * segundo es el que decide si el producto se entiende.
 *
 *   NUEVO     — cuenta recién creada, SIN sembrar nada. Lo único que tiene es lo que le
 *               da el disparador de alta: 4 sobres y 6000 créditos. Cero cartas.
 *   VETERANO  — cartas, puntos, XP y un mazo válido guardado con el MISMO servicio que
 *               usa el servidor al empezar una partida. Nada inventado.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No escribe en dominio, no concede recompensas por su cuenta, no cambia reglas y no
 * inventa métricas: cada número que imprime sale de contar elementos reales del DOM o de
 * leer `/api/game/loop`, que es de solo lectura. Borra las dos cuentas al terminar.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
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
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan credenciales de Supabase en .env.local");
  process.exit(1);
}

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const registry = new CardRegistry();
const ETIQUETA = process.argv[2] ?? "antes";
const OUT = join(ROOT, "docs", "product", "qa", "fase13");

/**
 * LOS ESTADOS DEL CICLO.
 *
 * No es la lista de rutas del producto: es la lista de sitios donde un jugador se
 * pregunta «¿y ahora qué?». Por eso incluye pantallas de transición (`/abrir`, el
 * resultado de un duelo) y no incluye páginas de herramienta que nadie visita en mitad
 * de una sesión de juego.
 */
const ESTADOS: [string, string, string][] = [
  // etiqueta                ruta                 momento del ciclo
  ["01-home",                "/",                 "ENTRAR"],
  ["02-inventario",          "/inventario",       "ABRIR"],
  ["03-tienda",              "/tienda",           "CONSEGUIR"],
  ["04-abrir",               "/abrir/inicial",    "CEREMONIA"],
  ["05-coleccion",           "/coleccion",        "COLECCIÓN"],
  ["06-colecciones",         "/colecciones",      "OBJETIVO"],
  ["07-mercado",             "/mercado",          "ECONOMÍA"],
  ["08-duelos",              "/duelos",           "ELEGIR"],
  ["09-duelos-mazos",        "/duelos/mazos",     "PREPARAR"],
  ["10-duelos-jugar",        "/duelos/jugar",     "JUGAR"],
  ["11-torneos",             "/torneos",          "COMPETIR"],
  ["12-pickems",             "/pickems",          "PREDECIR"],
  ["13-logros",              "/logros",           "RECLAMAR"],
  ["14-recompensas",         "/recompensas",      "RECOMPENSA"],
  ["15-ranking",             "/ranking",          "RANGO"],
  ["16-cuenta",              "/cuenta",           "IDENTIDAD"],
  ["17-eventos",             "/eventos",          "VOLVER"],
  ["18-entrenador",          "/entrenador",       "TÁCTICA"],
];

/**
 * LA MEDIDA.
 *
 * Todo se mide DENTRO de `<main>`. El armazón tiene siete enlaces de navegación en las
 * dieciocho pantallas: si contaran, ninguna pantalla sería jamás un callejón sin salida y
 * la medida no diría nada. La pregunta real es si el CONTENIDO propone continuar.
 */
const MEDIDA = `(() => {
  const main = document.querySelector('main');
  const scope = main || document.body;
  const aqui = location.pathname;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const texto = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 40);

  // ── Salidas: adónde se puede ir desde el contenido ──
  const destinos = new Map();
  for (const a of scope.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href') || '';
    if (!h.startsWith('/')) continue;
    const ruta = h.split('?')[0].split('#')[0];
    if (ruta === aqui || ruta === '') continue;
    if (!visible(a)) continue;
    if (!destinos.has(ruta)) destinos.set(ruta, texto(a));
  }

  // ── Acciones: botones habilitados que hacen algo aquí mismo ──
  const acciones = [];
  for (const b of scope.querySelectorAll('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')) {
    if (!visible(b)) continue;
    const t = texto(b);
    if (!t) continue;
    acciones.push(t);
  }

  // ── La acción destacada: el control relleno más grande del contenido ──
  let destacada = null, areaMax = 0;
  for (const el of scope.querySelectorAll('a, button')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const bg = s.backgroundColor || '';
    const m = bg.match(/rgba?\\(([^)]+)\\)/);
    if (!m) continue;
    const partes = m[1].split(',').map(Number);
    const alpha = partes.length > 3 ? partes[3] : 1;
    // Relleno de verdad: no un hover translúcido ni un borde.
    if (alpha < 0.5) continue;
    if (partes[0] + partes[1] + partes[2] < 90) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > areaMax) { areaMax = area; destacada = texto(el); }
  }

  // ── Visibilidad del progreso ──
  const cuerpo = (main ? main.innerText : document.body.innerText) || '';
  const armazon = document.body.innerText || '';
  const señales = {
    creditos: /créditos|crédito|🪙|[0-9][0-9.,]*\\s*(cr|créd)/i.test(armazon),
    nivel: /nivel/i.test(armazon),
    xp: /\\bXP\\b|experiencia/i.test(cuerpo),
    puntos: /\\bpuntos?\\b/i.test(cuerpo),
    rango: /rango|bronce|plata|oro|platino|diamante|ascendente|inmortal|radiante|sin clasificar/i.test(cuerpo),
  };

  // ── Estado vacío / carga / error ──
  const vacio = /no (hay|tienes)|todavía no|aún no|ninguna?|vací|sin cartas|sin mazos|empieza/i.test(cuerpo)
    && cuerpo.length < 1400;
  const cargando = /cargando|cargand/i.test(cuerpo) && cuerpo.length < 400;

  return {
    ruta: aqui,
    salidas: [...destinos.keys()],
    salidasTexto: [...destinos.entries()].slice(0, 6).map(([r, t]) => r + ' «' + t + '»'),
    acciones: acciones.length,
    accionesTexto: acciones.slice(0, 6),
    destacada,
    señales,
    vacio,
    cargando,
    largoTexto: cuerpo.length,
    dom: document.querySelectorAll('*').length,
  };
})()`;

/** Las diez cartas —dos por rol— con las que se puede montar un mazo válido. */
function cartasParaMazo(): string[] {
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

interface Persona {
  nombre: string;
  userId: string;
  email: string;
  password: string;
}

async function crear(prefijo: string): Promise<Persona> {
  const email = `f13-${prefijo}-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { username: `f13${prefijo}${Date.now().toString(36)}` },
  });
  if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
  return { nombre: prefijo, userId: data.user.id, email, password };
}

/** El veterano. Cartas reales, mazo guardado por el servicio real, nada inventado. */
async function sembrarVeterano(userId: string): Promise<string> {
  const ids = cartasParaMazo();
  await db.rpc("app_grant_cards", {
    p_user: userId,
    p_instances: ids.map((cardId) => ({ cardId, serial: null })),
    p_mint_delta: {}, p_origin: "admin",
  });
  const col = await listCollection(db as never, userId);
  const saved = await saveDeck(db as never, userId, {
    name: "Mazo de auditoría", cardUids: (col.data?.cards ?? []).map((c) => c.uid),
  });
  await db.from("profiles")
    .update({ points: 640, xp: 4200, credits: 18000, region: "EMEA" }).eq("id", userId);
  const { data: p } = await db.from("profiles")
    .select("points, xp, credits").eq("id", userId).maybeSingle();
  return `${ids.length} cartas · mazo válido ${saved.ok && saved.data?.deck.valid ? "sí" : "NO"} · ${JSON.stringify(p)}`;
}

async function estadoDe(userId: string) {
  const [{ data: perfil }, packs, cartas] = await Promise.all([
    db.from("profiles").select("points, xp, credits").eq("id", userId).maybeSingle(),
    db.from("user_packs").select("qty").eq("user_id", userId).gt("qty", 0),
    db.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return {
    ...(perfil as Record<string, number> | null ?? {}),
    sobres: (packs.data ?? []).reduce((s: number, r: { qty: number }) => s + r.qty, 0),
    cartas: cartas.count ?? 0,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const ping = await fetch(`${BASE}/`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }

  console.log(`# FASE 13 · AUDITORÍA DEL CICLO (${ETIQUETA}) — ${BASE}\n`);

  const nuevo = await crear("nuevo");
  const veterano = await crear("veterano");
  console.log(`## NUEVO     — ${JSON.stringify(await estadoDe(nuevo.userId))}`);
  console.log(`## VETERANO  — ${await sembrarVeterano(veterano.userId)}\n`);

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
  const browser = await launch();
  const tab = browser.tab;
  const filas: any[] = [];
  const erroresTodos: string[] = [];

  try {
    await tab.resize(1440, 900, 1);

    for (const persona of [nuevo, veterano]) {
      const { data: signin } = await pub.auth.signInWithPassword({
        email: persona.email, password: persona.password,
      });
      const session = signin!.session!;

      // ── Lo que el SERVIDOR dice que hay que hacer ──
      const loopRes = await fetch(`${BASE}/api/game/loop`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const loop = await loopRes.json().catch(() => ({}));

      console.log(`\n${"═".repeat(78)}`);
      console.log(`## ${persona.nombre.toUpperCase()} · «qué hacer ahora» según el servidor`);
      console.log("═".repeat(78));
      if (Array.isArray(loop.steps)) {
        for (const s of loop.steps) {
          console.log(`   ${String(s.priority).padStart(2)} · ${s.kind.padEnd(8)} ${s.label.padEnd(24)} → ${String(s.href).padEnd(18)} ${s.urgent ? "URGENTE " : ""}${s.detail}`);
        }
        console.log(`   rango: ${loop.rank?.label ?? "?"} (${loop.rank?.points ?? 0} pts, sin clasificar: ${loop.rank?.unranked})`);
        console.log(`   circuito: ${loop.circuit ? `${loop.circuit.name} · ${loop.circuit.openQuestions} preguntas abiertas · ${loop.circuit.pendingPicks} sin responder` : "ninguno"}`);
        console.log(`   duelos: ${loop.duels?.played ?? 0} jugados · ${loop.duels?.won ?? 0} ganados`);
      } else {
        console.log(`   ⚠ ${loopRes.status} ${JSON.stringify(loop).slice(0, 160)}`);
      }

      await tab.goto(`${BASE}/`, 1200);
      await tab.setStorage(storageKey, JSON.stringify(session));

      console.log(`\n${"─".repeat(78)}`);
      console.log(`## ${persona.nombre.toUpperCase()} · recorrido`);
      console.log("─".repeat(78));

      for (const [etq, ruta, momento] of ESTADOS) {
        await tab.goto(`${BASE}${ruta}`, 2800);
        await sleep(1500);
        await tab.shot(join(OUT, `${ETIQUETA}-${persona.nombre}-${etq}.png`));

        const r = await tab.js<any>(MEDIDA);
        const errs = tab.takeErrors();
        erroresTodos.push(...errs.map((e) => `${persona.nombre} ${ruta} · ${e}`));

        // Un estado del que no se sale por el contenido y que tampoco ofrece una acción
        // que lo cambie es un callejón. Las dos condiciones, no una.
        const callejon = r.salidas.length === 0 && r.acciones === 0;
        const sinDestacada = r.salidas.length + r.acciones > 0 && !r.destacada;

        filas.push({
          persona: persona.nombre, etq, ruta, momento,
          salidas: r.salidas.length, acciones: r.acciones,
          destacada: r.destacada, callejon, sinDestacada,
          vacio: r.vacio, cargando: r.cargando, errs: errs.length,
          señales: r.señales, dom: r.dom,
        });

        const marca = callejon ? "🔴 CALLEJÓN" : sinDestacada ? "🟡 sin acción destacada" : "🟢";
        console.log(`\n   ── ${etq.padEnd(18)} ${ruta.padEnd(18)} [${momento}]  ${marca}`);
        console.log(`      salidas ${String(r.salidas.length).padStart(2)} · acciones ${String(r.acciones).padStart(2)} · destacada: ${r.destacada ? `«${r.destacada}»` : "—"}`);
        if (r.salidasTexto.length) console.log(`      → ${r.salidasTexto.join(" · ")}`);
        if (r.accionesTexto.length) console.log(`      ⚡ ${r.accionesTexto.join(" · ")}`);
        const s = r.señales;
        console.log(`      progreso: créditos ${s.creditos ? "sí" : "NO"} · nivel ${s.nivel ? "sí" : "NO"} · xp ${s.xp ? "sí" : "no"} · puntos ${s.puntos ? "sí" : "no"} · rango ${s.rango ? "sí" : "no"}`);
        if (r.vacio) console.log(`      ⬜ estado vacío (texto ${r.largoTexto})`);
        if (r.cargando) console.log(`      ⏳ ATASCADO EN CARGA`);
        if (errs.length) console.log(`      ⚠ ${errs.length} errores`);
      }

      // ── El estado del jugador al final del recorrido: ¿cambió algo por navegar? ──
      console.log(`\n   estado final: ${JSON.stringify(await estadoDe(persona.userId))}`);
    }

    // ══════════════════════════ RESUMEN ══════════════════════════
    console.log(`\n\n${"═".repeat(78)}\n## MATRIZ DEL CICLO\n${"═".repeat(78)}`);
    for (const p of ["nuevo", "veterano"]) {
      const f = filas.filter((x) => x.persona === p);
      console.log(`\n### ${p.toUpperCase()}`);
      console.log(`    estado              momento      sal acc  destacada                 estado`);
      for (const x of f) {
        const marca = x.callejon ? "CALLEJÓN" : x.sinDestacada ? "sin destacada" : x.vacio ? "vacío" : "ok";
        console.log(`    ${x.etq.padEnd(19)} ${x.momento.padEnd(12)} ${String(x.salidas).padStart(3)} ${String(x.acciones).padStart(3)}  ${(x.destacada ?? "—").padEnd(25).slice(0, 25)} ${marca}`);
      }
      console.log(`    ${"".padEnd(19)} ${"TOTAL".padEnd(12)} ${String(f.reduce((s, x) => s + x.salidas, 0)).padStart(3)} ${String(f.reduce((s, x) => s + x.acciones, 0)).padStart(3)}`);
      console.log(`    callejones: ${f.filter((x) => x.callejon).length} · sin destacada: ${f.filter((x) => x.sinDestacada).length} · vacíos: ${f.filter((x) => x.vacio).length} · atascados: ${f.filter((x) => x.cargando).length}`);
    }

    console.log(`\n## VISIBILIDAD DEL PROGRESO (cuántos de los 18 estados la muestran)`);
    for (const p of ["nuevo", "veterano"]) {
      const f = filas.filter((x) => x.persona === p);
      const cnt = (k: string) => f.filter((x) => x.señales[k]).length;
      console.log(`    ${p.padEnd(10)} créditos ${cnt("creditos")}/18 · nivel ${cnt("nivel")}/18 · xp ${cnt("xp")}/18 · puntos ${cnt("puntos")}/18 · rango ${cnt("rango")}/18`);
    }

    console.log(`\n## ERRORES DE CONSOLA: ${erroresTodos.length}`);
    const unicos = [...new Set(erroresTodos.map((e) => e.split(" · ").slice(1).join(" · ")))];
    for (const e of unicos.slice(0, 12)) console.log(`   · ${e}`);
  } finally {
    await browser.close().catch(() => {});
    for (const p of [nuevo, veterano]) {
      await db.auth.admin.deleteUser(p.userId).catch(() => {});
    }
  }

  console.log("\nListo.");
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
