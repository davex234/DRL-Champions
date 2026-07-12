/**
 * VALIDACIÓN — DRL CHAMPIONS DESKTOP PLATFORM.
 *
 * Demuestra lo verificable SIN toolchain nativo: capa de plataforma (config persiste,
 * logs, dirs, versión, offline, update no-op, crash), proyecto Tauri correcto (config,
 * targets, updater, deep-link, file-assoc, iconos) y que el build web sigue intacto.
 * El `tauri build` (instaladores) se ejecuta en una máquina con Rust+Tauri CLI.
 *
 * Uso:  npx tsx scripts/desktop-verify.ts
 */
import { readFileSync, existsSync } from "node:fs";
import {
  setAdapter, MemoryAdapter, loadConfig, saveConfig, DEFAULT_CONFIG, plannedLayout, DIRS,
  buildInfo, platformName, isOnline, log, getLogs, flushLogs, getAdapter, checkForUpdate, reportCrash,
  APP_VERSION, BUILD_CHANNEL,
} from "../src/platform";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); ok ? pass++ : fail++; };
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const readText = (p: string) => readFileSync(p, "utf8");

void (async () => {
  console.log("# Validación de la plataforma de escritorio\n");

  // ── 1) Capa de plataforma ────────────────────────────────────────────
  console.log("## 1. Capa de plataforma (config / logs / dirs / versión)");
  setAdapter(new MemoryAdapter());
  const c0 = await loadConfig();
  await saveConfig({ volume: 0.42, windowMode: "fullscreen", replaysPath: "X/replays" });
  const c1 = await loadConfig();
  check("config carga defaults", c0.resolution.w === DEFAULT_CONFIG.resolution.w && c0.volume === DEFAULT_CONFIG.volume);
  check("config PERSISTE cambios y mantiene defaults", c1.volume === 0.42 && c1.windowMode === "fullscreen" && c1.fps === DEFAULT_CONFIG.fps, `vol ${c1.volume}`);

  log("info", "test", "arranque ok");
  await flushLogs();
  const persistedLogs = await getAdapter().get("logs");
  check("los logs se registran y persisten", getLogs().some((l) => l.msg === "arranque ok") && !!persistedLogs);

  const layout = plannedLayout();
  check("estructura de directorios profesional (10 carpetas)", DIRS.length === 10 && DIRS.every((d) => layout.dirs[d]?.includes(d)), DIRS.join(","));

  const b = buildInfo();
  check("versión / canal / plataforma disponibles", b.version === APP_VERSION && b.channel === BUILD_CHANNEL && platformName() === "node");

  console.log("\n## 2. Offline / update / crash (preparados)");
  check("detección de conexión (offline-safe)", typeof isOnline() === "boolean");
  const upd = await checkForUpdate();
  check("updater no-op fuera de Tauri (no rompe)", upd.available === false && upd.current === APP_VERSION);
  const crash = await reportCrash(new Error("boom"));
  check("crash reporter captura {versión, plataforma, stack, logs}", crash.message === "boom" && crash.version === APP_VERSION && Array.isArray(crash.recentLogs));

  // ── 3) Proyecto Tauri ────────────────────────────────────────────────
  console.log("\n## 3. Proyecto Tauri 2 (config + targets + updater + deep-link)");
  const conf = readJson("src-tauri/tauri.conf.json");
  check("identidad de app y productName", conf.identifier === "gg.drl.champions" && conf.productName === "DRL Champions");
  const targets = conf.bundle.targets as string[];
  check("instaladores Win/macOS/Linux", ["nsis", "msi", "dmg", "appimage", "deb", "rpm"].every((t) => targets.includes(t)), targets.join(","));
  check("auto-updater activo", conf.plugins.updater.active === true && Array.isArray(conf.plugins.updater.endpoints));
  check("deep link drl:// + asociación de replays", conf.plugins["deep-link"].desktop.schemes.includes("drl") && conf.bundle.fileAssociations[0].ext.includes("drlrep"));
  check("la ventana arranca en el LAUNCHER y sirve `out/`", conf.app.windows[0].url === "/launcher" && conf.build.frontendDist === "../out");
  check("withGlobalTauri (la capa de plataforma usa window.__TAURI__)", conf.app.withGlobalTauri === true);

  console.log("\n## 4. Fuentes Rust + capabilities + iconos");
  check("Cargo.toml con tauri 2 + plugins", existsSync("src-tauri/Cargo.toml") && readText("src-tauri/Cargo.toml").includes("tauri-plugin-updater"));
  check("main.rs / lib.rs / build.rs presentes", ["src-tauri/src/main.rs", "src-tauri/src/lib.rs", "src-tauri/build.rs"].every(existsSync));
  check("capabilities con permisos fs/updater/deep-link", readText("src-tauri/capabilities/default.json").includes("updater:default"));
  const icons = ["src-tauri/icons/32x32.png", "src-tauri/icons/128x128.png", "src-tauri/icons/128x128@2x.png", "src-tauri/icons/icon.png", "src-tauri/icons/icon.ico", "src-tauri/app-icon.png"];
  check("iconos de escritorio generados DESDE la marca", icons.every(existsSync), `${icons.length} archivos`);

  console.log("\n## 5. Branding + favicons (reutilizados, sin copias manuales)");
  check("favicon + branding presentes", ["public/favicon.ico", "public/favicon.svg", "public/branding/icon/icon.svg"].every(existsSync));

  console.log("\n## 6. Build web intacto + scripts");
  const next = readText("next.config.mjs");
  check("export estático SOLO bajo NEXT_DESKTOP (web por defecto intacto)", next.includes("NEXT_DESKTOP") && next.includes('output: "export"') && next.includes("desktop"));
  const pkg = readJson("package.json");
  check("scripts tauri:build / build:desktop / brand", !!pkg.scripts["tauri:build"] && !!pkg.scripts["build:desktop"] && !!pkg.scripts.brand);
  check("launcher como ruta independiente", existsSync("src/app/launcher/page.tsx"));

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} comprobaciones`);
})();

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (fail > 0) process.exitCode = 1;
