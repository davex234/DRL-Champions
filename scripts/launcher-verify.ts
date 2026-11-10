/**
 * VERIFICACIÓN DEL LAUNCHER — recorrido real por el cliente de escritorio.
 *
 *   npm run dev                 (en otra terminal)
 *   npm run launcher:verify
 *   npm run launcher:verify -- --shots      (además guarda capturas)
 *
 * No es un test de humo: PULSA los botones. Instala un título, comprueba que la descarga
 * avanza de verdad, la pausa, la reanuda, la cancela, recorre las cinco pantallas y mide el
 * cliente en las cuatro resoluciones del encargo buscando desbordamientos horizontales.
 *
 * Existe porque el gestor de descargas es una máquina de estados con reloj: los tests
 * unitarios prueban la máquina, pero solo un navegador prueba que el reloj está conectado.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep, type Tab } from "./lib/cdp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "docs", "product", "launcher");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const WANT_SHOTS = process.argv.includes("--shots");

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Texto visible de la página, EN MINÚSCULAS.
 *
 * El launcher escribe casi todo con `text-transform: uppercase`, así que `innerText` devuelve
 * mayúsculas aunque el código diga «Biblioteca». Comparar en minúsculas evita que la
 * verificación dependa de una decisión tipográfica.
 */
const text = (tab: Tab) => tab.js<string>("document.body.innerText.toLowerCase()");

/** Pulsa el primer elemento cuyo texto coincida. Devuelve si encontró algo. */
async function clickText(tab: Tab, selector: string, needle: string): Promise<boolean> {
  return tab.js<boolean>(`(() => {
    const needle = ${JSON.stringify(needle.toLowerCase())};
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((n) => (n.innerText || "").toLowerCase().includes(needle));
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

/** Espera a que una condición se cumpla en la página (o se rinde). */
async function waitFor(tab: Tab, expression: string, timeoutMs = 12_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await tab.js<boolean>(`Boolean(${expression})`)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Progreso REAL de la descarga de la dársena, con decimales.
 *
 * `aria-valuenow` va redondeado a enteros, y 2,5 s de una descarga de 22,5 GB son un 0,14 %:
 * medido en enteros parecería que no avanza. El medidor publica el valor exacto en
 * `data-progress`, que es lo que se lee aquí.
 */
const progress = (tab: Tab) =>
  tab.js<number>(`(() => {
    const bar = document.querySelector('footer [role="progressbar"]');
    return bar ? Number(bar.getAttribute("data-progress")) : -1;
  })()`);

async function main(): Promise<void> {
  if (WANT_SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

  const browser = await launch({ width: 1920, height: 1080 });
  const { tab } = browser;
  // El launcher es una interfaz animada: sin esto Chrome sin cabeza la fotografía en reposo.
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);

  try {
    console.log("\n▸ Arranque");
    await tab.goto(`${BASE}/launcher`, 1000);
    // El BootGate hace splash → comprobación → home. Se espera al armazón, no a un tiempo fijo.
    const booted = await waitFor(tab, `document.body.innerText.toLowerCase().includes("biblioteca")`, 20_000);
    check("el cliente arranca y llega al launcher", booted);
    if (!booted) throw new Error("El launcher no llegó a la pantalla principal");

    const home = await text(tab);
    check("hero con el título del cliente", home.includes("drl champions"));
    check("carril de biblioteca con los cinco títulos",
      ["drl champions", "project alpha", "project nexus", "project zero", "project omega"].every((n) => home.includes(n)));
    check("panel de amigos", home.includes("amigos") && home.includes("conectados"));
    check("sección de novedades", home.includes("novedades"));
    check("sin la marca prohibida en la interfaz", !/valorant/i.test(home),
      /valorant/i.test(home) ? "aparece en pantalla" : undefined);
    if (WANT_SHOTS) await tab.shot(join(SHOTS, "01-home-1920.png"));

    console.log("\n▸ Cambio de juego");
    const switched = await clickText(tab, "button", "Project Alpha");
    await sleep(900);
    const alpha = await text(tab);
    check("seleccionar un juego actualiza el hero", switched && alpha.includes("project alpha"));
    check("el estado del título es 'No instalado'", alpha.includes("no instalado"));
    check("el CTA ofrece INSTALAR", /instalar/i.test(alpha));
    if (WANT_SHOTS) await tab.shot(join(SHOTS, "02-hero-alpha-1920.png"));

    console.log("\n▸ Instalación");
    await clickText(tab, "button", "Instalar");
    const modal = await waitFor(tab, `document.querySelector('[role="dialog"]')`);
    const modalText = await text(tab);
    check("se abre el diálogo de instalación", modal);
    check("permite elegir ubicación",
      modalText.includes("ubicación de instalación") && modalText.includes("c:\\games\\nexus"));
    check("muestra espacio necesario y disponible",
      modalText.includes("espacio necesario") && modalText.includes("disponible"));
    if (WANT_SHOTS) await tab.shot(join(SHOTS, "03-install-modal-1920.png"));

    // La unidad externa (18,2 GB libres) no admite un título de 22,5 GB: el botón se bloquea.
    await clickText(tab, "button", "Unidad externa");
    await sleep(400);
    const blocked = await tab.js<boolean>(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((n) => /^instalar$/i.test(n.innerText.trim()));
      return Boolean(b && b.disabled);
    })()`);
    check("bloquea instalar si no cabe en la unidad", blocked);
    await clickText(tab, "button", "Disco local");
    await sleep(300);

    await tab.js(`(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((n) => /^instalar$/i.test(n.innerText.trim()));
      if (b) b.click();
    })()`);
    const started = await waitFor(tab, `document.body.innerText.toLowerCase().includes("descargando")`);
    check("la descarga arranca", started);

    const p0 = await progress(tab);
    await sleep(2500);
    const p1 = await progress(tab);
    check("el progreso avanza con el tiempo", p1 > p0, `${p0.toFixed(3)}% → ${p1.toFixed(3)}%`);
    const downloading = await text(tab);
    check("muestra bytes, velocidad y tiempo restante",
      /gb|mb/.test(downloading) && /\/s/.test(downloading) && downloading.includes("restantes"));
    check("la dársena de descargas está presente", downloading.includes("instalación"));
    if (WANT_SHOTS) await tab.shot(join(SHOTS, "04-descargando-1920.png"));

    console.log("\n▸ Pausa / reanudación / cancelación");
    await tab.js(`(() => {
      const b = [...document.querySelectorAll('button')].find((n) => n.getAttribute("aria-label") === "Pausar");
      if (b) b.click();
    })()`);
    await waitFor(tab, `document.body.innerText.toLowerCase().includes("en pausa")`, 4000);
    const pausedAt = await progress(tab);
    await sleep(1800);
    const stillPaused = await progress(tab);
    check("pausar detiene el progreso", Math.abs(stillPaused - pausedAt) < 0.01,
      `${pausedAt.toFixed(3)}% → ${stillPaused.toFixed(3)}%`);
    if (WANT_SHOTS) await tab.shot(join(SHOTS, "05-pausa-1920.png"));

    await tab.js(`(() => {
      const b = [...document.querySelectorAll('button')].find((n) => n.getAttribute("aria-label") === "Reanudar");
      if (b) b.click();
    })()`);
    await sleep(2200);
    const resumed = await progress(tab);
    check("reanudar continúa la descarga", resumed > stillPaused,
      `${stillPaused.toFixed(3)}% → ${resumed.toFixed(3)}%`);

    await tab.js(`(() => {
      const b = [...document.querySelectorAll('button')].find((n) => n.getAttribute("aria-label") === "Cancelar");
      if (b) b.click();
    })()`);
    const cancelled = await waitFor(tab, `!document.body.innerText.toLowerCase().includes("descargando")`, 6000);
    check("cancelar retira el trabajo y devuelve el juego a 'No instalado'",
      cancelled && (await text(tab)).includes("no instalado"));

    console.log("\n▸ Navegación");
    for (const [label, needle] of [
      ["Novedades", "novedades"],
      ["Tienda", "catálogo"],
      ["Juegos", "requisitos del sistema"],
    ] as const) {
      await clickText(tab, "header button", label);
      await sleep(700);
      const ok = (await text(tab)).includes(needle);
      check(`la pestaña ${label} carga`, ok);
      if (WANT_SHOTS) await tab.shot(join(SHOTS, `06-${label.toLowerCase()}-1920.png`));
    }

    console.log("\n▸ Perfil y configuración");
    await clickText(tab, "header button", "Comandante");
    const menu = await waitFor(tab, `document.body.innerText.toLowerCase().includes("actividad reciente")`, 4000);
    check("el menú de usuario se despliega", menu);
    if (WANT_SHOTS) await tab.shot(join(SHOTS, "07-perfil-menu-1920.png"));

    await clickText(tab, "button", "Configuración");
    const settings = await waitFor(tab, `document.body.innerText.toLowerCase().includes("intensidad de efectos")`, 6000);
    const settingsText = await text(tab);
    check("la pantalla de configuración carga", settings);
    check("tiene las cinco secciones",
      ["general", "launcher", "descargas", "interfaz", "cliente"].every((s) => settingsText.includes(s)));
    if (WANT_SHOTS) await tab.shot(join(SHOTS, "08-configuracion-1920.png"));

    // Cambiar un ajuste tiene que APLICARSE: el tema repinta el lienzo.
    const before = await tab.js<string>(`getComputedStyle(document.querySelector("main").parentElement.parentElement).background`);
    await clickText(tab, "button", "Abismo");
    await sleep(600);
    const after = await tab.js<string>(`getComputedStyle(document.querySelector("main").parentElement.parentElement).background`);
    check("cambiar el tema repinta el cliente", before !== after);
    await clickText(tab, "button", "Medianoche");
    await sleep(400);

    console.log("\n▸ Resoluciones");
    for (const [w, h] of [[1366, 768], [1920, 1080], [2560, 1440], [3440, 1440]] as const) {
      await tab.resize(w, h);
      await sleep(700);
      const overflow = await tab.js<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
      check(`${w}×${h} sin desbordamiento horizontal`, overflow <= 1, `${overflow}px`);
      if (WANT_SHOTS && w !== 1920) {
        await clickText(tab, "header button", "Inicio");
        await sleep(600);
        await tab.shot(join(SHOTS, `09-home-${w}.png`));
      }
    }
    await tab.resize(1920, 1080);

    console.log("\n▸ Consola");
    const errors = tab.takeErrors().filter((e) => !/favicon|manifest|404/i.test(e));
    check("sin errores de consola", errors.length === 0, errors.slice(0, 3).join(" | ") || undefined);
    check("sin bucles de recarga", tab.loadCount() <= 2, `${tab.loadCount()} cargas`);
  } finally {
    await browser.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length === 0 ? "✅" : "❌"} ${checks.length - failed.length}/${checks.length} comprobaciones`);
  if (WANT_SHOTS) console.log(`   Capturas en ${SHOTS}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`   ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
