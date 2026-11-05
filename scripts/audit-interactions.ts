/**
 * AUDITORÍA DE INTERACCIONES — modales, cajones y autenticación.
 *
 *   npm run dev                (en otra terminal)
 *   npm run audit:interactions
 *
 * La auditoría de rutas comprueba que las pantallas MONTAN. Esto comprueba que RESPONDEN:
 * abrir una carta, cerrar el modal, desplegar el menú de secciones, cambiar de pestaña,
 * cerrar sesión y volver a entrar.
 *
 * Son los caminos que más se rompen en una refactorización y los que ningún test unitario
 * cubre: un modal que no cierra o un cierre de sesión que deja la pantalla a medias no dan
 * error de compilación ni de tipos.
 *
 * El usuario se crea con CARTAS y SALDO, porque un modal de carta no se puede abrir en una
 * colección vacía.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame";
import { launch, sleep, type Browser } from "./lib/cdp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✕"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
};

/** Errores de consola que no sean arte ausente. */
const realErrors = (errs: string[]) => errs.filter((e) => !/404/.test(e));

function duelReadyCardIds(): string[] {
  const registry = new CardRegistry();
  const ids: string[] = [];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const arr = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    if (arr[0]) ids.push(arr[0].id);
    if (arr[1]) ids.push(arr[1].id);
  }
  return ids;
}

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor NEXUS en ${BASE}. Arranca 'npm run dev'.`);
    process.exit(1);
  }

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const email = `inter-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "interaudit" },
  });
  if (error || !created.user) throw new Error(error?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  await admin.rpc("app_grant_cards", {
    p_user: userId,
    p_instances: duelReadyCardIds().map((cardId) => ({ cardId, serial: null })),
    p_mint_delta: {},
    p_origin: "admin",
  });

  const browser: Browser = await launch({ width: 1440, height: 900 });

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
    await browser.tab.goto(`${BASE}/`, 900);
    await browser.tab.setStorage(storageKey, JSON.stringify(signin!.session!));

    console.log(`# Auditoría de interacciones — ${BASE}\n`);

    // ── 1 · Modal de detalle de carta ──
    console.log("## Modal de carta (Colección)");
    await browser.tab.goto(`${BASE}/coleccion`, 3500);
    browser.tab.takeErrors();

    const opened = await browser.tab.js<boolean>(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      /*
        Las cartas de la colección NO llevan aria-label: su nombre accesible sale del
        contenido. Se localizan por la FORMA de la rejilla —un contenedor cuyos hijos son
        todos botones— en vez de por un atributo que no existe. Buscarlas por aria-label
        encontraba cero cartas y hacía fallar la prueba por culpa del selector, no de la
        aplicación.
      */
      const grids = [...document.querySelectorAll('div')]
        .filter((d) => d.children.length >= 8 && [...d.children].every((c) => c.tagName === 'BUTTON'));
      const grid = grids.sort((a, b) => b.children.length - a.children.length)[0];
      if (!grid) return false;
      // Las poseídas van primero y son las únicas que abren el detalle; las que faltan
      // se pintan en escala de grises.
      const card = [...grid.children].find((b) => !b.querySelector('.grayscale'));
      if (!card) return false;
      card.click();
      await s(1400);
      return true;
    })()`);
    check(opened, "hay cartas pulsables en la colección");

    const modal = await browser.tab.js<{ open: boolean; text: number }>(`(() => {
      const dlg = document.querySelector('[role="dialog"], [aria-modal="true"]');
      return { open: !!dlg, text: dlg ? (dlg.textContent || '').trim().length : 0 };
    })()`);
    check(modal.open, "el modal de detalle se abre");
    check(modal.text > 30, "y tiene contenido", `${modal.text} caracteres`);
    check(realErrors(browser.tab.takeErrors()).length === 0, "abrir el modal no da errores");

    // Cerrar con Escape: es lo primero que prueba cualquiera.
    await browser.tab.send("Input.dispatchKeyEvent", {
      type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27,
    });
    await browser.tab.send("Input.dispatchKeyEvent", {
      type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27,
    });
    await sleep(900);
    const closed = await browser.tab.js<boolean>(
      `!document.querySelector('[role="dialog"], [aria-modal="true"]')`,
    );
    check(closed, "el modal se cierra con Escape");
    check(realErrors(browser.tab.takeErrors()).length === 0, "cerrar el modal no da errores");

    // ── 2 · Menú de secciones de la barra superior ──
    console.log("\n## Menú de secciones");
    await browser.tab.goto(`${BASE}/`, 2500);
    browser.tab.takeErrors();
    const menu = await browser.tab.js<{ expanded: boolean; items: number }>(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const link = [...document.querySelectorAll('header nav a')]
        .find((a) => a.textContent.trim() === 'Colección');
      if (!link) return { expanded: false, items: 0 };
      link.focus();
      await s(500);
      const id = link.getAttribute('aria-controls');
      const panel = id ? document.getElementById(id) : null;
      return {
        expanded: link.getAttribute('aria-expanded') === 'true',
        items: panel ? panel.querySelectorAll('a').length : 0,
      };
    })()`);
    check(menu.expanded, "el desplegable se abre con el teclado");
    check(menu.items > 0, "y ofrece destinos", `${menu.items}`);
    check(realErrors(browser.tab.takeErrors()).length === 0, "el menú no da errores");

    // ── 3 · Pestañas dentro de una pantalla ──
    console.log("\n## Pestañas (Colección · Forja, Clasificación · ámbitos)");
    await browser.tab.goto(`${BASE}/coleccion`, 3000);
    browser.tab.takeErrors();
    const forge = await browser.tab.js<boolean>(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find((x) => /Forja/i.test(x.textContent));
      if (!b) return false;
      b.click();
      await s(1200);
      return document.body.innerText.length > 200;
    })()`);
    check(forge, "la pestaña Forja se abre y pinta contenido");
    check(realErrors(browser.tab.takeErrors()).length === 0, "cambiar de pestaña no da errores");

    await browser.tab.goto(`${BASE}/ranking`, 3000);
    browser.tab.takeErrors();
    const scopes = await browser.tab.js<number>(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const tabs = [...document.querySelectorAll('button')]
        .filter((b) => /Global|Por región|Por torneo/i.test(b.textContent));
      for (const t of tabs) { t.click(); await s(900); }
      return tabs.length;
    })()`);
    check(scopes >= 2, "los ámbitos de la clasificación cambian", `${scopes}`);
    check(realErrors(browser.tab.takeErrors()).length === 0, "cambiar de ámbito no da errores");

    // ── 4 · Cierre de sesión y vuelta ──
    console.log("\n## Autenticación");
    await browser.tab.goto(`${BASE}/cuenta`, 3200);
    browser.tab.takeErrors();

    const signedOut = await browser.tab.js<boolean>(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find((x) => /Cerrar sesi/i.test(x.textContent));
      if (!b) return false;
      b.click();
      await s(2500);
      return true;
    })()`);
    check(signedOut, "el botón de cerrar sesión existe y responde");

    await sleep(1500);
    const afterOut = await browser.tab.js<{ text: number; hasForm: boolean }>(`(() => ({
      text: (document.body.innerText || '').trim().length,
      hasForm: !!document.querySelector('input[type="email"], input[type="password"]'),
    }))()`);
    check(afterOut.text > 100, "tras cerrar sesión la pantalla sigue teniendo contenido", `${afterOut.text}`);
    check(afterOut.hasForm, "y ofrece volver a entrar");
    check(realErrors(browser.tab.takeErrors()).length === 0, "cerrar sesión no deja errores en consola");

    // Navegar ya sin sesión: la rama anónima no puede reventar.
    for (const path of ["/", "/coleccion", "/duelos", "/logros"]) {
      await browser.tab.goto(`${BASE}${path}`, 2500);
      const errs = realErrors(browser.tab.takeErrors());
      const chars = await browser.tab.js<number>("(document.body.innerText||'').trim().length");
      check(errs.length === 0 && chars > 60, `${path} funciona sin sesión`, errs[0]?.slice(0, 120) ?? `${chars} car.`);
    }
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(failures === 0 ? "\n✅ PASA" : `\n❌ ${failures} comprobación(es) fallidas`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
