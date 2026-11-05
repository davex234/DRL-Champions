"use client";

/**
 * DRL LAUNCHER — BOOTGATE: orquestador de arranque AAA (estilo Riot/Epic/Steam).
 *
 * Es el punto de entrada real de la ventana (montado por /launcher). Secuencia:
 *
 *   Splash → Inicializar plataforma → Comprobar conexión → Comprobar actualizaciones
 *      ├─ Offline            → pantalla "sin conexión" (continuar / reintentar / salir)
 *      ├─ Al día             → "✔ Actualizado vX" unos segundos → Launcher
 *      └─ Hay actualización  → pantalla EXCLUSIVA de actualización (no se entra al juego)
 *                              (auto-descarga/instala/reinicia según Configuración)
 *
 * Toda la lógica vive en la capa Platform/Updater; aquí solo se orquestan pantallas.
 * NINGÚN motor del juego se toca: el juego se monta después, al pulsar JUGAR (router → "/").
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  initPlatform, isOnline, loadUpdatePrefs, loadChannel, getUpdateController,
  recordUpdate, warn as logWarn, buildInfo, loadLastSeenVersion, saveLastSeenVersion,
} from "@/platform";
import { useUpdater } from "./useUpdater";
import { BootSplash } from "./BootSplash";
import { OfflineScreen } from "./OfflineScreen";
import { UpdateRequiredScreen } from "./UpdateRequiredScreen";
import { LauncherHome } from "./LauncherHome";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

type Screen = "splash" | "welcome" | "uptodate" | "offline" | "update" | "home";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MIN_SPLASH_MS = 1300;

export function BootGate() {
  useLocale();
  const up = useUpdater();
  const [screen, setScreen] = useState<Screen>("splash");
  const [bootMsg, setBootMsg] = useState("Inicializando…");
  const ran = useRef(false);

  const runBoot = useCallback(async () => {
    const t0 = Date.now();
    setScreen("splash");

    setBootMsg(t("Inicializando plataforma…"));
    try {
      await initPlatform();
    } catch (e) {
      logWarn("boot", t("initPlatform falló: {message}", { message: td((e as Error).message) }));
    }

    const prefs = await loadUpdatePrefs();
    const channel = await loadChannel();
    const ctrl = getUpdateController(channel);

    // ¿Acabamos de actualizar? (versión instalada distinta a la última vista) → bienvenida.
    const current = buildInfo().full;
    const lastSeen = await loadLastSeenVersion();
    await saveLastSeenVersion(current);
    if (lastSeen && lastSeen !== current) {
      recordUpdate(t("Actualización aplicada: {lastSeen} → {current}", { lastSeen: td(lastSeen), current: td(current) }));
      const dt = Date.now() - t0;
      if (dt < MIN_SPLASH_MS) await sleep(MIN_SPLASH_MS - dt);
      setScreen("welcome");
      await sleep(2200);
    }

    setBootMsg(t("Comprobando conexión…"));
    const online = isOnline();
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_SPLASH_MS) await sleep(MIN_SPLASH_MS - elapsed);

    if (!online) {
      setScreen("offline");
      return;
    }
    if (!prefs.checkOnStart) {
      setScreen("home");
      return;
    }

    setBootMsg(t("Buscando actualizaciones…"));
    let phase: string;
    try {
      phase = (await ctrl.check()).phase;
    } catch (e) {
      recordUpdate(t("Comprobación fallida (servidor inaccesible): {message}", { message: td((e as Error).message) }));
      setScreen("offline");
      return;
    }

    if (phase === "available") {
      setScreen("update");
      if (prefs.autoDownload) {
        void ctrl.start({ autoInstall: prefs.autoInstall, autoRestart: prefs.autoRestart });
      }
    } else {
      setScreen("uptodate");
      setTimeout(() => setScreen((s) => (s === "uptodate" ? "home" : s)), 2200);
    }
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void runBoot();
  }, [runBoot]);

  // Nota: una actualización descubierta MIENTRAS se está en el launcher NO secuestra la
  // pantalla (eso es solo el flujo OBLIGATORIO de arranque). En el home se muestra como
  // estado "Actualización disponible" + botón ACTUALIZAR (LauncherHome), menos intrusivo.

  switch (screen) {
    case "splash":
      return <BootSplash variant="loading" title={td(bootMsg)} />;
    case "welcome":
      return (
        <BootSplash
          variant="success"
          title={t("DRL Champions actualizado correctamente")}
          subtitle={t("Bienvenido a la versión {version}", { version: td(buildInfo().version) })}
          version={buildInfo().full}
        />
      );
    case "uptodate":
      return <BootSplash variant="success" title={t("DRL Champions está actualizado")} version={buildInfo().full} />;
    case "offline":
      return (
        <OfflineScreen
          current={up.state.current}
          onContinue={() => setScreen("home")}
          onRetry={() => void runBoot()}
          onExit={up.exit}
        />
      );
    case "update":
      return (
        <UpdateRequiredScreen
          state={up.state}
          onUpdate={() => void up.start({ autoInstall: up.prefs.autoInstall, autoRestart: up.prefs.autoRestart })}
          onInstall={up.install}
          onRestart={up.restart}
          onRetry={() => void up.start({ autoInstall: up.prefs.autoInstall, autoRestart: up.prefs.autoRestart })}
          onExit={up.exit}
        />
      );
    case "home":
      return <LauncherHome up={up} />;
  }
}
