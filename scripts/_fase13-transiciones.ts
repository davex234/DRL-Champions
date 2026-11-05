/**
 * FASE 13 · LAS TRANSICIONES DEL CICLO (instrumento, NO forma parte de CI).
 *
 *   npx tsx scripts/_fase13-transiciones.ts [antes|despues]
 *
 * ────────────────────────── POR QUÉ HACE FALTA ──────────────────────────
 *
 * `_fase13-loop-audit.ts` mide el estado de ENTRADA de cada pantalla: llega, mira y
 * apunta. Eso responde «¿qué puedo hacer aquí?» pero no responde la pregunta que de
 * verdad decide si un ciclo está cerrado: **«acabo de hacer algo, ¿y ahora qué?»**
 *
 * Los momentos que importan de un videojuego no son pantallas: son los segundos justo
 * después de una acción. Abres el sobre y ves las cartas. Ganas el duelo y ves el
 * marcador. Reclamas el logro. Ahí es donde un producto o te empuja a la siguiente
 * vuelta o te deja mirando el resultado sin saber qué tocar.
 *
 * Este instrumento ACTÚA: pulsa los botones reales y mide el estado resultante.
 *
 * ────────────────────────── LAS CUATRO TRANSICIONES ──────────────────────────
 *
 *   T1  constructor sin cartas   — el jugador nuevo pulsa «Crear mi primer mazo» sin
 *                                  tener ni una carta. ¿Se le dice qué hacer, y puede?
 *   T2  ceremonia del sobre      — abre el sobre de verdad. ¿Qué ofrece el resumen?
 *   T3  colección con cartas     — vuelve a la colección ya no vacía. ¿Hay salida?
 *   T4  duelo completo           — juega los diez turnos y llega al resultado.
 *
 * No concede nada por su cuenta: las recompensas las reparte el servidor por las mismas
 * rutas que usaría un jugador con el ratón. Borra la cuenta al terminar.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep } from "./lib/cdp";

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
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const ETIQUETA = process.argv[2] ?? "antes";
const OUT = join(ROOT, "docs", "product", "qa", "fase13");

/** Misma medida de salidas que la auditoría de estados, para poder comparar. */
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
  const texto = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g,' ').slice(0,44);
  const destinos = new Map();
  for (const a of scope.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href') || '';
    if (!h.startsWith('/')) continue;
    const ruta = h.split('?')[0].split('#')[0];
    if (ruta === aqui || !ruta) continue;
    if (!visible(a)) continue;
    if (!destinos.has(ruta)) destinos.set(ruta, texto(a));
  }
  const acciones = [];
  for (const b of scope.querySelectorAll('button:not([disabled])')) {
    if (visible(b) && texto(b)) acciones.push(texto(b));
  }
  return {
    ruta: aqui,
    salidas: [...destinos.entries()].map(([r,t]) => r + ' «' + t + '»'),
    acciones,
    texto: ((main ? main.innerText : document.body.innerText) || '').replace(/\\s+/g,' ').slice(0, 420),
  };
})()`;

/** Pulsa el primer elemento cuyo texto visible contenga `frase`. Devuelve si lo encontró. */
const pulsar = (frase: string) => `(() => {
  const objetivo = ${JSON.stringify(frase)}.toLowerCase();
  const todos = [...document.querySelectorAll('button, a, [role="button"]')];
  for (const el of todos) {
    const t = (el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (!t.includes(objetivo)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return t.slice(0, 60);
  }
  return null;
})()`;

async function estadoDe(userId: string) {
  const [{ data: perfil }, packs, cartas, duelos] = await Promise.all([
    db.from("profiles").select("points, xp, credits").eq("id", userId).maybeSingle(),
    db.from("user_packs").select("qty").eq("user_id", userId).gt("qty", 0),
    db.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", userId),
    db.from("duel_matches").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return {
    ...(perfil as Record<string, number> | null ?? {}),
    sobres: (packs.data ?? []).reduce((s: number, r: { qty: number }) => s + r.qty, 0),
    cartas: cartas.count ?? 0,
    duelos: duelos.count ?? 0,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const ping = await fetch(`${BASE}/`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }

  console.log(`# FASE 13 · TRANSICIONES (${ETIQUETA}) — ${BASE}\n`);

  const email = `f13-tr-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: creado, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { username: `f13tr${Date.now().toString(36)}` },
  });
  if (error || !creado.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
  const userId = creado.user.id;

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  const session = signin!.session!;
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  const browser = await launch();
  const tab = browser.tab;

  const paso = async (titulo: string, archivo: string) => {
    const r = await tab.js<any>(MEDIDA);
    await tab.shot(join(OUT, `${ETIQUETA}-T-${archivo}.png`));
    console.log(`\n   ▸ ${titulo}`);
    console.log(`     ruta ${r.ruta} · salidas ${r.salidas.length} · acciones ${r.acciones.length}`);
    if (r.salidas.length) console.log(`     → ${r.salidas.slice(0, 6).join(" · ")}`);
    if (r.acciones.length) console.log(`     ⚡ ${r.acciones.slice(0, 8).join(" · ")}`);
    console.log(`     «${r.texto.slice(0, 200)}»`);
    return r;
  };

  try {
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/`, 1200);
    await tab.setStorage(storageKey, JSON.stringify(session));

    console.log(`## Estado inicial: ${JSON.stringify(await estadoDe(userId))}`);

    // ══ T1 · El constructor sin una sola carta ══
    console.log(`\n${"═".repeat(78)}\n## T1 · «Crear mi primer mazo» con CERO cartas\n${"═".repeat(78)}`);
    await tab.goto(`${BASE}/duelos/mazos`, 2600);
    await sleep(1200);
    const p1 = await tab.js<string | null>(pulsar("crear mi primer mazo"));
    console.log(`   pulsado: ${p1 ?? "NO ENCONTRADO"}`);
    await sleep(2200);
    await paso("constructor abierto sin cartas", "1-constructor-sin-cartas");

    // ══ T2 · La ceremonia del sobre, de verdad ══
    console.log(`\n${"═".repeat(78)}\n## T2 · Abrir el sobre inicial\n${"═".repeat(78)}`);
    await tab.goto(`${BASE}/abrir/inicial`, 2600);
    await sleep(1200);
    await paso("antes de abrir", "2a-sobre-cerrado");
    const p2 = await tab.js<string | null>(pulsar("abrir sobre"));
    console.log(`   pulsado: ${p2 ?? "NO ENCONTRADO"}`);
    // La ceremonia revela las cartas de una en una; se le da tiempo real.
    await sleep(9000);
    const revelar = await tab.js<string | null>(pulsar("ver todas"));
    if (revelar) { console.log(`   pulsado: ${revelar}`); await sleep(2500); }
    await paso("resumen del sobre", "2b-sobre-resumen");
    console.log(`   estado tras abrir: ${JSON.stringify(await estadoDe(userId))}`);

    // ══ T3 · La colección, ya no vacía ══
    console.log(`\n${"═".repeat(78)}\n## T3 · La colección con cartas dentro\n${"═".repeat(78)}`);
    await tab.goto(`${BASE}/coleccion`, 3000);
    await sleep(1800);
    await paso("colección con cartas", "3-coleccion-con-cartas");

    // Y el vestíbulo: ¿cambió lo que propone ahora que tiene cartas?
    const loop = await fetch(`${BASE}/api/game/loop`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    }).then((r) => r.json()).catch(() => ({}));
    console.log(`\n   «qué hacer ahora» tras abrir el primer sobre:`);
    for (const s of loop.steps ?? []) {
      console.log(`     ${String(s.priority).padStart(2)} · ${s.kind.padEnd(8)} ${s.label.padEnd(24)} → ${s.href}`);
    }

    // ══ T4 · Un duelo entero hasta el resultado ══
    console.log(`\n${"═".repeat(78)}\n## T4 · Duelo completo hasta el marcador\n${"═".repeat(78)}`);
    // Se le dan las diez cartas necesarias por la misma vía que usa el servidor.
    await tab.goto(`${BASE}/duelos/jugar`, 2600);
    await sleep(1500);
    const antes = await estadoDe(userId);
    const r4 = await paso("preparación del duelo", "4a-preparacion");

    if (r4.acciones.some((a: string) => a.toLowerCase().includes("comenzar"))) {
      await tab.js(pulsar("comenzar duelo"));
      await sleep(3500);
      await paso("primer turno", "4b-turno1");

      // Diez turnos: se elige siempre la primera estadística disponible.
      for (let turno = 0; turno < 12; turno++) {
        const jugado = await tab.js<boolean>(`(() => {
          const btns = [...document.querySelectorAll('button:not([disabled])')]
            .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 40 && r.height > 24; });
          const stat = btns.find((b) => /puntería|reflejos|táctica|impacto|aguante|control|atk|def|precisión/i.test(b.innerText || ''));
          const carta = btns.find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('carta'));
          const el = stat || carta;
          if (!el) return false;
          el.click();
          return true;
        })()`);
        if (!jugado) break;
        await sleep(2600);
      }
      await sleep(3000);
      await paso("resultado del duelo", "4c-resultado");
      console.log(`   antes:   ${JSON.stringify(antes)}`);
      console.log(`   después: ${JSON.stringify(await estadoDe(userId))}`);
    } else {
      console.log(`   ⚠ sin mazo válido: el duelo no se puede empezar desde aquí.`);
    }
  } finally {
    await browser.close().catch(() => {});
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log("\nListo.");
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
