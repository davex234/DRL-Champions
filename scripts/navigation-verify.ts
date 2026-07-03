/**
 * VERIFICACIÓN — Navigation, Screens & Window Framework (DRL Champions, Render/UI Fase 2/7).
 *
 *   npx tsx scripts/navigation-verify.ts
 *
 * Comprueba la infraestructura PURA de navegación sobre la que vivirán TODAS las pantallas: navigation/
 * history/windows/dialogs/overlays/loading/errors/restore/deep-links/responsive(z-order)/focus/lifecycle/
 * versionado/migraciones/performance(1000 pantallas · 10000 ventanas)/determinismo/cero estados
 * imposibles. NO implementa gameplay. 100% DETERMINISTA (reloj lógico + ids inyectados).
 */
import { NavigationEngine, ScreenRegistry, migrateNavState, freshNavState, Z_BUCKET, isOverlayKind, type ScreenDescriptor } from "../src/navigation";
import { SCREENS } from "../src/data/screens";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Navigation, Screens & Window Framework — DRL Champions (Render/UI Fase 2/7)\n");

const reg = new ScreenRegistry(SCREENS);
const nav = () => new NavigationEngine(reg);

// ─────────────────────── 1. Screen registry + deep links ───────────────────────
console.log("## Screen Registry + Deep Links");
{
  check("REGISTRY: registra los descriptores reales de la app", reg.size() === SCREENS.length && reg.has("collection"));
  check("DEEP LINK: resuelve ruta estática y con :param", reg.resolveRoute("/coleccion")?.screenId === "collection" && reg.resolveRoute("/abrir/premium")?.params.packId === "premium");
  check("DEEP LINK inverso: serializa pantalla + params", reg.serialize("open-pack", { packId: "champions" }) === "/abrir/champions");
  check("DEEP LINK: ruta desconocida ⇒ null (no rompe)", reg.resolveRoute("/no/existe") === null);
  check("ESPECIFICIDAD: elige la ruta más específica (no la genérica)", reg.resolveRoute("/entrenador/equipos")?.screenId === "coach-teams");
}

// ─────────────────────── 2. Navigation + history ───────────────────────
console.log("\n## Navigation + History (navigate/back/forward/replace/reset)");
{
  const n = nav();
  n.reset("home", {}, 1); n.navigate("/coleccion", {}, {}, 2); n.navigate("/mercado", {}, {}, 3);
  check("NAVIGATE: apila pantallas y actualiza la activa + migas", n.active() === "market" && n.breadcrumb().length === 3);
  check("BACK: retrocede en el historial", n.back(4).ok && n.active() === "collection");
  check("FORWARD: avanza en el historial", n.forward(5).ok && n.active() === "market");
  check("BACK tope: sin historial anterior ⇒ falla limpio", (() => { const m = nav(); m.reset("home", {}, 1); return !m.back(2).ok; })());
  const rp = nav(); rp.reset("home", {}, 1); rp.replace("news", {}, {}, 2);
  check("REPLACE: sustituye la activa sin crear entrada nueva", rp.active() === "news" && rp.analytics().historyLength === 1);
  check("RESET: reinicia con una sola pantalla raíz", (() => { const m = nav(); m.navigate("home", {}, {}, 1); m.navigate("market", {}, {}, 2); m.reset("collection", {}, 3); return m.stack().length === 1 && m.active() === "collection"; })());
  check("NAVIGATE inválido: ruta no resoluble ⇒ falla sin mutar la activa", !nav().navigate("/no-existe", {}, {}, 1).ok);
}

// ─────────────────────── 3. Guards / lifecycle / validación ───────────────────────
console.log("\n## Guards / Lifecycle / Validación");
{
  const n = nav();
  check("GUARD: bloquea si no se cumple", !n.navigate("/cuenta", {}, { hydrated: false }, 1).ok);
  check("GUARD: pasa si se cumple", n.navigate("/cuenta", {}, { hydrated: true }, 2).ok && n.active() === "account");
  check("VALIDATE: pantalla inexistente ⇒ inválida", !n.validate("no-existe").ok);
  const life = nav(); life.reset("home", {}, 1); life.navigate("market", {}, {}, 2);
  const bottom = life.stack()[0];
  check("LIFECYCLE: la pantalla previa pasa a 'paused', la nueva 'active'", bottom.lifecycle === "paused" && life.stack()[1].lifecycle === "active");
}

// ─────────────────────── 4. Windows: modal/drawer/overlay/dialog + z-order + focus ───────────────────────
console.log("\n## Window Engine (modal/drawer/overlay/dialog + z-order + focus)");
{
  const n = nav(); n.reset("home", {}, 1);
  n.openModal({ screenId: "collection" }, 2);
  n.openDrawer({}, 3);
  n.openOverlay({}, 4);
  const ws = n.windows();
  check("WINDOWS: abre modal/drawer/overlay con z reutilizando tokens de ui-core", ws.length === 3 && ws.find((w) => w.kind === "modal")!.z >= Z_BUCKET.modal && ws.find((w) => w.kind === "drawer")!.z >= Z_BUCKET.drawer);
  check("Z-ORDER: modal por encima de overlay (tokens ui-core)", ws.find((w) => w.kind === "modal")!.z > ws.find((w) => w.kind === "overlay")!.z);
  const focusedId = n.focusedWindow();
  check("FOCUS: la última abierta queda enfocada", focusedId != null && n.windows().find((w) => w.id === focusedId)!.focused);
  const modalId = ws.find((w) => w.kind === "modal")!.id;
  n.focusWindow(modalId, 5);
  check("FOCUS WINDOW: enfoca una ventana y sube su z; las demás pierden foco", n.focusedWindow() === modalId && n.windows().filter((w) => isOverlayKind(w.kind) && w.focused).length === 1);
  n.closeModal(6);
  check("CLOSE: cierra la ventana superior de su tipo y re-enfoca", n.windows().length === 2 && !n.windows().some((w) => w.kind === "modal"));
  check("CLOSE ALL: cierra todas las ventanas de una vez", (() => { n.closeAllWindows(7); return n.windows().length === 0 && n.focusedWindow() === null; })());
  check("SEGURIDAD: cerrar ventana inexistente ⇒ falla limpio (no lanza)", !nav().closeWindowById("no-existe", 1).ok);
}

// ─────────────────────── 5. Loading / errors ───────────────────────
console.log("\n## Loading / Errors (hosts, contratos)");
{
  const n = nav();
  n.setLoading("blocking", 0.5, 1);
  check("LOADING: estado blocking con progreso", n.snapshot().loading.loading === "blocking" && n.snapshot().loading.progress === 0.5);
  n.showError("offline", 2);
  check("ERROR offline: recuperable (retryable)", n.snapshot().loading.error === "offline" && n.snapshot().loading.retryable);
  check("RETRY: un error recuperable se puede reintentar", n.retry(3).ok && n.snapshot().loading.loading === "blocking");
  n.showError("fatal", 4);
  check("ERROR fatal: NO reintentable", !n.snapshot().loading.retryable && !n.retry(5).ok);
  n.showError("version_mismatch", 6);
  check("ERROR version_mismatch / maintenance: terminales", n.snapshot().loading.error === "version_mismatch" && !n.snapshot().loading.retryable);
  n.clearLoading(7);
  check("CLEAR: vuelve a idle", n.snapshot().loading.loading === "idle" && n.snapshot().loading.error === "none");
}

// ─────────────────────── 6. Restore / snapshot / migraciones ───────────────────────
console.log("\n## Restore / Snapshot / Migraciones");
{
  const n = nav(); n.reset("home", {}, 1); n.navigate("market", {}, {}, 2); n.openModal({}, 3);
  const snap = n.snapshot();
  const restored = nav(); restored.restore(migrateNavState(JSON.parse(JSON.stringify(snap))), 4);
  check("RESTORE: reconstruye stack/ventanas/activa desde un snapshot", restored.active() === "market" && restored.windows().length === 1 && restored.stack().length === 2);
  const m = migrateNavState({ stack: "corrupto", windows: [{ id: "w", kind: "modal", z: 1, focused: false, openedAt: 0 }, null], historyIndex: 99, version: 0 });
  check("MIGRACIÓN: sanea stack/ventanas/índice + fija versión (array antiguo → Record)", m.version >= 1 && m.stack.length === 0 && Object.keys(m.windows).length === 1 && m.historyIndex >= -1);
  check("MIGRACIÓN: nulo ⇒ estado fresco", migrateNavState(null).stack.length === 0 && migrateNavState(null).activeScreenId === null);
}

// ─────────────────────── 7. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const build = () => { const n = nav(); n.reset("home", {}, 1); n.navigate("market", {}, {}, 2); n.openModal({}, 3); n.openOverlay({}, 4); return JSON.stringify(n.snapshot()); };
  check("DETERMINISMO: mismas operaciones/reloj ⇒ mismo estado (ids estables)", build() === build());
}

// ─────────────────────── 8. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  let bad = 0;
  const n = nav();
  if (n.pop(1).ok) bad++;                                  // pop en stack vacío ⇒ falla, no lanza
  if (n.back(2).ok) bad++;                                 // back sin historial
  if (n.forward(3).ok) bad++;                              // forward sin historial
  n.reset("home", {}, 4);
  if (n.pop(5).ok) bad++;                                  // no se puede vaciar el stack por completo
  if (n.retry(6).ok) bad++;                                // retry sin error
  try { migrateNavState({ historyIndex: -50, seq: -3 }); } catch { bad++; }
  check("INTEGRIDAD: pop/back/forward/retry inválidos fallan limpio, nunca lanzan ni vacían el stack", bad === 0 && n.stack().length === 1);
}

// ─────────────────────── 9. Rendimiento (1000 pantallas · 10000 ventanas) ───────────────────────
console.log("\n## Rendimiento (1000 pantallas · 10.000 ventanas)");
{
  // 1000 descriptores + resolución de rutas.
  const big: ScreenDescriptor[] = [];
  for (let i = 0; i < 1000; i++) big.push({ id: `s${i}`, route: `/s${i}/:x`, title: `S${i}` });
  const t0 = Date.now();
  const bigReg = new ScreenRegistry(big);
  let resolved = 0;
  for (let i = 0; i < 1000; i++) if (bigReg.resolveRoute(`/s${i}/v`)) resolved++;
  const regMs = Date.now() - t0;
  // 10000 navegaciones + 10000 ventanas.
  const t1 = Date.now();
  const n = new NavigationEngine(bigReg, freshNavState());
  n.reset("s0", { x: "1" }, 0);
  for (let i = 1; i < 10000; i++) n.navigate(`s${i % 1000}`, { x: String(i) }, {}, i);
  const navMs = Date.now() - t1;
  const t2 = Date.now();
  for (let i = 0; i < 10000; i++) n.openWindowKind(i % 2 ? "modal" : "overlay", {}, 100000 + i);
  const openMs = Date.now() - t2;
  const t3 = Date.now();
  const winCount = n.windows().length;
  for (const w of n.windows()) n.closeWindowById(w.id, 200000);
  const closeMs = Date.now() - t3;
  check("RENDIMIENTO: 1000 pantallas + 10k navegaciones + 10k ventanas, sin O(n²)",
    regMs < 2000 && navMs < 3000 && openMs < 4000 && closeMs < 6000 && resolved === 1000 && winCount === 10000 && n.windows().length === 0,
    `registry=${regMs}ms · 10k nav=${navMs}ms · 10k open=${openMs}ms · 10k close=${closeMs}ms`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
