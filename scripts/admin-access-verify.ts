/**
 * ACCESO ADMINISTRATIVO POR ROL — `npm run admin-access:verify`
 *
 * El enlace al panel vive en la CUENTA y solo existe para quien es administrador. Esto lo
 * comprueba con navegador, sesión de verdad y las tres identidades que importan:
 *
 *   A) admin (`profiles.is_admin = true`)  → «Administración NEXUS» visible
 *   B) jugador normal                      → invisible
 *   C) sin sesión                          → invisible
 *
 * Y comprueba lo que de verdad protege, que no es el enlace: que `/admin` sigue cerrado y
 * que las rutas `/api/admin/*` siguen devolviendo 401 a quien no debe entrar.
 *
 * ────────────────────────── POR QUÉ ESTO NO SOBRA ──────────────────────────
 *
 * Un enlace condicional es la clase de cosa que se rompe en silencio: basta con que alguien
 * cambie el orden de un `if`, o que un estado antiguo sobreviva a un cierre de sesión, para
 * que un jugador cualquiera vea una puerta que no le corresponde. No abriría nada —el
 * servidor sigue negando— pero enseñar la existencia del panel a quien no debe verlo ya es
 * un fallo de producto.
 *
 * La cuenta administradora se crea aquí y se borra al terminar. **No se toca `is_admin` de
 * ninguna cuenta existente.**
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";

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
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const SHOTS = join(ROOT, "docs", "product", "qa", "admin-access");
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const paso = (n: number, s: string): void => console.log(`\n${n}. ${s}\n${"─".repeat(72)}`);

const cuentas: string[] = [];

async function cuenta(tag: string, esAdmin: boolean) {
  const email = `acceso-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  if (esAdmin) await db.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, email, session: s.data.session, token: s.data.session.access_token };
}

const storageKey = (): string => `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

/** ¿Está el acceso administrativo pintado en esta pantalla? Por su enlace real a `/admin`. */
const accesoVisible = (tab: Tab) => tab.js<{ enlace: boolean; rotulo: boolean; alto: number }>(`(() => {
  const a = [...document.querySelectorAll('a[href="/admin"]')]
    .filter(e => e.getBoundingClientRect().width > 0);
  const t = document.body.innerText || '';
  return {
    enlace: a.length > 0,
    rotulo: /herramientas internas/i.test(t) || /administraci[oó]n nexus/i.test(t),
    alto: a.length ? Math.round(a[0].getBoundingClientRect().height) : 0,
  };
})()`);

/** La navegación principal del juego, tal cual la ve el jugador. */
const navPrincipal = (tab: Tab) => tab.js<string[]>(`(() => {
  const nav = document.querySelector('header nav, nav');
  if (!nav) return [];
  return [...nav.querySelectorAll('a[href]')]
    .filter(e => e.getBoundingClientRect().width > 0)
    .map(e => (e.textContent || '').trim().toUpperCase())
    .filter(Boolean);
})()`);

async function main(): Promise<void> {
  console.log("\n═══ ACCESO ADMINISTRATIVO POR ROL ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin", true);
  const jugador = await cuenta("jugador", false);

  const { tab, close } = await launch({ width: 1440, height: 900 });
  try {
    // ── A · Administrador ──
    paso(1, "A · ADMINISTRADOR (is_admin = true)");
    await tab.goto(`${BASE}/`, 1500);
    await tab.setStorage(storageKey(), JSON.stringify(admin.session));
    await tab.goto(`${BASE}/cuenta`, 5000);
    await sleep(2500);
    const vA = await accesoVisible(tab);
    check("el acceso a administración aparece en la cuenta", vA.enlace && vA.rotulo,
      `enlace=${vA.enlace} · rótulo=${vA.rotulo}`);
    check("y su área interactiva llega a 44 px", vA.alto >= 44, `${vA.alto} px`);

    const navA = await navPrincipal(tab);
    check("la navegación principal NO gana una sección de administración",
      !navA.some((x) => /^admin/i.test(x)),
      navA.length ? navA.join(" · ") : "(sin nav a este ancho)");
    await tab.js(`document.querySelector('a[href="/admin"]')?.scrollIntoView({ block: 'center' })`);
    await sleep(1200);
    await tab.shot(join(SHOTS, "01-admin-ve-el-acceso-1440.png"));

    // ── B · Jugador normal ──
    paso(2, "B · JUGADOR NORMAL (is_admin = false)");
    await tab.goto(`${BASE}/`, 1500);
    await tab.setStorage(storageKey(), JSON.stringify(jugador.session));
    await tab.goto(`${BASE}/cuenta`, 5000);
    await sleep(2500);
    const vB = await accesoVisible(tab);
    check("un jugador normal NO ve el acceso", !vB.enlace && !vB.rotulo,
      `enlace=${vB.enlace} · rótulo=${vB.rotulo}`);
    await tab.js(`window.scrollTo(0, document.body.scrollHeight)`);
    await sleep(1200);
    await tab.shot(join(SHOTS, "02-jugador-no-lo-ve-1440.png"));

    await tab.goto(`${BASE}/admin`, 4000);
    await sleep(2000);
    const textoB = await tab.js<string>("document.body.innerText");
    check("y escribiendo /admin a mano recibe «Acceso restringido»",
      /acceso restringido/i.test(textoB), textoB.slice(0, 60).replace(/\s+/g, " "));

    // ── C · Sin sesión ──
    paso(3, "C · SIN SESIÓN");
    await tab.goto(`${BASE}/`, 1500);
    await tab.js(`Object.keys(localStorage).filter(k=>/sb-.*-auth-token/.test(k)).forEach(k=>localStorage.removeItem(k))`);
    await tab.goto(`${BASE}/cuenta`, 5000);
    await sleep(2500);
    const vC = await accesoVisible(tab);
    check("sin sesión NO se ve el acceso", !vC.enlace && !vC.rotulo,
      `enlace=${vC.enlace} · rótulo=${vC.rotulo}`);

    await tab.goto(`${BASE}/admin`, 4000);
    await sleep(2000);
    check("y /admin sigue cerrado",
      /acceso restringido/i.test(await tab.js<string>("document.body.innerText")), "cerrado");

    // ── La barrera real, que no depende de la interfaz ──
    paso(4, "LA SEGURIDAD NO LA DA EL ENLACE");
    const rutas = ["/api/admin/session", "/api/admin/cards", "/api/admin/pools"] as const;
    let sinSesion = 0, comoJugador = 0, comoAdmin = 0;
    for (const r of rutas) {
      const metodo = r.endsWith("session") ? "GET" : "POST";
      const cuerpo = metodo === "POST" ? JSON.stringify({ action: "list" }) : undefined;
      const pedir = async (token: string | null): Promise<number> => {
        const res = await fetch(`${BASE}${r}`, {
          method: metodo,
          headers: {
            "content-type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: cuerpo, cache: "no-store",
        });
        return res.status;
      };
      if (await pedir(null) === 401) sinSesion++;
      if (await pedir(jugador.token) === 401) comoJugador++;
      if (await pedir(admin.token) === 200) comoAdmin++;
    }
    check("sin sesión, las rutas admin responden 401", sinSesion === rutas.length,
      `${sinSesion}/${rutas.length}`);
    check("con sesión de jugador normal, también 401", comoJugador === rutas.length,
      `${comoJugador}/${rutas.length}`);
    check("y el administrador sí entra", comoAdmin === rutas.length, `${comoAdmin}/${rutas.length}`);

    // ── Responsive ──
    paso(5, "RESPONSIVE — 390 / 768 / 1024 / 1440");
    await tab.goto(`${BASE}/`, 1500);
    await tab.setStorage(storageKey(), JSON.stringify(admin.session));
    for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]] as const) {
      await tab.resize(w, h, 1);
      await tab.goto(`${BASE}/cuenta`, 4500);
      await sleep(2200);
      const v = await accesoVisible(tab);
      const m = await tab.js<{ overflow: number }>(
        `({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
      check(`${w}px · visible, ≥44 px y sin desbordamiento`,
        v.enlace && v.alto >= 44 && m.overflow <= 1,
        `alto ${v.alto} px · desbordamiento ${m.overflow} px`);
      await tab.js(`document.querySelector('a[href="/admin"]')?.scrollIntoView({ block: 'center' })`);
      await sleep(1000);
      await tab.shot(join(SHOTS, `03-acceso-${w}.png`));
    }

    /*
     * EL CIERRE DE SESIÓN VA AL FINAL, Y CON SU PROPIA CUENTA.
     *
     * `signOut()` de Supabase revoca la sesión del usuario en el servidor, no solo en este
     * navegador. Haciéndolo antes con la cuenta de `admin`, el token que este script guarda
     * en Node quedaba invalidado y todo lo que venía después —las llamadas a `/api/admin/*`
     * y el barrido responsive— fallaba por una sesión muerta, no por un defecto del producto.
     * Una cuenta aparte y el último lugar del guion: así lo que se mide es lo que se cree.
     */
    paso(6, "CERRAR SESIÓN NO DEJA EL ENLACE PINTADO");
    const admin2 = await cuenta("admin2", true);
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/`, 1500);
    await tab.setStorage(storageKey(), JSON.stringify(admin2.session));
    await tab.goto(`${BASE}/cuenta`, 5000);
    await sleep(2500);
    check("el admin lo ve antes de cerrar sesión", (await accesoVisible(tab)).enlace, "visible");
    const salio = await tab.js<boolean>(`(() => {
      const b = [...document.querySelectorAll('button, a')]
        .find(e => /cerrar sesi[oó]n|salir/i.test((e.textContent || '').trim()));
      if (!b) return false; b.click(); return true;
    })()`);
    await sleep(4000);
    const vD = await accesoVisible(tab);
    check("tras cerrar sesión desaparece", !vD.enlace,
      salio ? `enlace=${vD.enlace}` : "no había botón de salir; se comprueba el estado igualmente");
  } finally {
    await close();
  }
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];
  for (const id of cuentas) {
    await db.from("user_cards").delete().eq("user_id", id);
    await db.from("user_packs").delete().eq("user_id", id);
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }
  const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
  console.log(`\n  limpieza: ${cuentas.length} cuentas de prueba borradas · ${count} admin(s) en la base`);
  check("la verificación no deja cuentas suyas detrás", restos.length === 0,
    restos.length ? restos.join(" | ") : "ninguna");
}

main()
  .catch((e) => { console.error("\n✕ Verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => { console.error("  ✕ limpieza:", e); fail++; });
    console.log("\n" + "─".repeat(72));
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0
      ? "  ✅ EL PANEL SE ABRE DESDE LA CUENTA Y SOLO PARA QUIEN DEBE"
      : "  ❌ EL ACCESO ADMINISTRATIVO TIENE FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
