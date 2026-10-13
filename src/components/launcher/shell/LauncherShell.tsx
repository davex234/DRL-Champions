"use client";

/**
 * NEXUS LAUNCHER — ARMAZÓN.
 *
 * La ventana entera: barra superior, carril de biblioteca, escenario, panel de amigos y
 * dársena de descargas. Este componente ORQUESTA; no calcula nada.
 *
 *   · Qué botón se enseña → `@/launcher/library` (puro)
 *   · Cómo avanza una descarga → `@/launcher/download` (puro)
 *   · Dónde se guarda → `useLauncherStore`
 *   · Cuándo avanza → `launcherClock`, un único temporizador para toda la aplicación
 *
 * El reloj se arranca aquí y SOLO aquí, y se para cuando no queda nada vivo: un launcher que
 * despierta la CPU cada 250 ms para no mover nada es un launcher que calienta el portátil.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { buildInfo, channelInfo, isOnline } from "@/platform";
import {
  DEFAULT_GAME_ID, THEME_CANVAS, getGame, getGames, heavyEffectsEnabled, initialEntry, isJobActive,
  launcherClock, motionScale as computeMotion, primaryAction,
  type DownloadKind, type Game, type GameAction, type LauncherNews, type LauncherUser, type PresenceId,
} from "@/launcher";
import { USER } from "@/launcher/social";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useLauncherStore, type LauncherView } from "@/store/useLauncherStore";
import type { UpdaterApi } from "../useUpdater";
import { DownloadDock } from "./DownloadDock";
import { FriendsPanel } from "./FriendsPanel";
import { GameDetail } from "./GameDetail";
import { GameRail } from "./GameRail";
import { HeroStage } from "./HeroStage";
import { InstallModal } from "./InstallModal";
import { NewsReader, NewsSection, NewsView } from "./NewsSection";
import { ProfileMenu } from "./ProfileMenu";
import { ProfileView } from "./ProfileView";
import { SettingsView } from "./SettingsView";
import { StoreView } from "./StoreView";
import { TopBar } from "./TopBar";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

/** Detección de `prefers-reduced-motion`. El sistema operativo tiene la última palabra. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function LauncherShell({ up }: { up: UpdaterApi }) {
  useLocale();
  const router = useRouter();
  const { toast, notify } = useToast();
  const reducedMotion = usePrefersReducedMotion();

  const view = useLauncherStore((s) => s.view);
  const selectedGameId = useLauncherStore((s) => s.selectedGameId);
  const entries = useLauncherStore((s) => s.entries);
  const jobs = useLauncherStore((s) => s.jobs);
  const settings = useLauncherStore((s) => s.settings);
  const store = useLauncherStore;

  const [profileOpen, setProfileOpen] = useState(false);
  const [dockExpanded, setDockExpanded] = useState(false);
  const [reading, setReading] = useState<LauncherNews | null>(null);
  const [installFor, setInstallFor] = useState<{ game: Game; kind: DownloadKind } | null>(null);
  const [presence, setPresence] = useState<PresenceId>(USER.presence);
  const [online, setOnline] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  const games = useMemo(() => getGames(), []);
  const game = getGame(selectedGameId) ?? games[0];
  // Una biblioteca guardada antes de que existiera un título no tiene su fila: se rellena aquí.
  const entry = entries[game.id] ?? initialEntry(game);
  const job = jobs[game.id] ?? null;
  const activeJobs = useMemo(
    () => Object.values(jobs).filter((j) => j.status !== "done" && j.status !== "cancelled"),
    [jobs],
  );

  const motion$ = computeMotion(settings, reducedMotion);
  const heavy = heavyEffectsEnabled(settings, reducedMotion);
  const user: LauncherUser = useMemo(() => ({ ...USER, presence }), [presence]);
  const info = useMemo(() => buildInfo(), []);

  /* ── Reloj de descargas: arranca solo si hay algo vivo, y se apaga al terminar ── */
  const anyLive = activeJobs.some((j) => isJobActive(j.status));
  useEffect(() => {
    if (!anyLive) {
      launcherClock.stop();
      return;
    }
    launcherClock.start((dt, now) => store.getState().tick(dt, now));
    return () => launcherClock.stop();
  }, [anyLive, store]);

  /* ── Aviso cuando una descarga termina ── */
  const prevJobIds = useRef<string[]>([]);
  useEffect(() => {
    const ids = Object.keys(jobs);
    for (const id of prevJobIds.current) {
      if (!ids.includes(id)) {
        const g = getGame(id);
        const e = store.getState().entries[id];
        if (g && e?.state === "ready" && settings.notifications) notify(t("{name} está listo para jugar", { name: g.name }), true);
      }
    }
    prevJobIds.current = ids;
  }, [jobs, notify, settings.notifications, store]);

  /* ── Conectividad ── */
  useEffect(() => {
    setOnline(isOnline());
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  const setView = useCallback(
    (v: LauncherView) => {
      store.getState().setView(v);
      contentRef.current?.scrollTo({ top: 0 });
    },
    [store],
  );

  const selectGame = useCallback(
    (id: string, v?: LauncherView) => {
      store.getState().select(id, v);
      if (v) contentRef.current?.scrollTo({ top: 0 });
    },
    [store],
  );

  const runAction = useCallback(
    (target: Game, action: GameAction) => {
      const s = store.getState();
      switch (action.id) {
        case "install":
          setInstallFor({ game: target, kind: "install" });
          break;
        case "update":
          setInstallFor({ game: target, kind: "update" });
          break;
        case "pause":
          s.pause(target.id);
          notify(t("{name} en pausa", { name: target.name }), true);
          break;
        case "resume":
          s.resume(target.id);
          notify(t("Reanudando {name}", { name: target.name }), true);
          break;
        case "retry":
          s.resume(target.id);
          notify(t("Reintentando {name}", { name: target.name }), true);
          break;
        case "play":
          s.markPlayed(target.id);
          if (target.route) {
            notify(t("Iniciando {name}…", { name: target.name }), true);
            router.push(target.route);
          } else {
            notify(t("{name} no está disponible en esta compilación", { name: target.name }), false);
          }
          break;
        case "finalizing":
          break;
      }
    },
    [notify, router, store],
  );

  const confirmInstall = useCallback(
    (path: string) => {
      if (!installFor) return;
      store.getState().startDownload(installFor.game.id, path, installFor.kind);
      notify(
        `${installFor.kind === "update" ? t("Actualizando") : t("Instalando")} ${installFor.game.name}`,
        true,
      );
      setInstallFor(null);
    },
    [installFor, notify, store],
  );

  const cancelDownload = useCallback(
    (gameId: string) => {
      store.getState().cancel(gameId);
      const g = getGame(gameId);
      if (g) notify(t("Descarga de {name} cancelada", { name: g.name }), false);
    },
    [notify, store],
  );

  const uninstall = useCallback(
    (gameId: string) => {
      store.getState().uninstall(gameId);
      const g = getGame(gameId);
      if (g) notify(t("{name} desinstalado", { name: g.name }), true);
    },
    [notify, store],
  );

  /* ── Lienzo según el tema elegido ── */
  const canvas = THEME_CANVAS[settings.theme];

  return (
    <div
      className="relative flex h-screen w-full flex-col overflow-hidden text-white"
      style={{
        background:
          `radial-gradient(1100px 620px at 18% -8%, ${canvas.tintA}, transparent 62%),` +
          `radial-gradient(900px 520px at 92% 6%, ${canvas.tintB}, transparent 58%),` +
          canvas.base,
      }}
    >
      <TopBar
        view={view}
        onView={(v) => (v === "game" ? selectGame(game.id, "game") : setView(v))}
        user={user}
        version={info.version}
        channelLabel={channelInfo(up.channel).label}
        online={online}
        updateAvailable={up.state.phase === "available"}
        profileOpen={profileOpen}
        onProfileToggle={() => setProfileOpen((v) => !v)}
      >
        <ProfileMenu
          open={profileOpen}
          user={user}
          motionScale={motion$}
          onClose={() => setProfileOpen(false)}
          onPresence={(p) => setPresence(p)}
          onNavigate={(v) => {
            setProfileOpen(false);
            setView(v);
          }}
          onExit={() => void up.exit()}
        />
      </TopBar>

      <div className="flex min-h-0 flex-1">
        <div className="hidden min-h-0 lg:flex">
          <GameRail
            games={games}
            entries={entries}
            jobs={jobs}
            selectedId={game.id}
            motionScale={motion$}
            onSelect={(id) => selectGame(id, view === "home" ? "home" : "game")}
          />
        </div>

        <main ref={contentRef} className="nx-scroll min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, y: motion$ > 0 ? 10 : 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: motion$ > 0 ? -6 : 0 }}
              transition={{ duration: motion$ > 0 ? 0.24 : 0, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-full flex-col gap-6 p-4 lg:p-6"
            >
              {view === "home" && (
                <>
                  <HeroStage
                    game={game}
                    entry={entry}
                    job={job}
                    motionScale={motion$}
                    heavyEffects={heavy}
                    onAction={(a) => runAction(game, a)}
                    onDetails={() => selectGame(game.id, "game")}
                    onCancel={() => cancelDownload(game.id)}
                  />
                  <NewsSection motionScale={motion$} onOpen={setReading} onSeeAll={() => setView("news")} />
                </>
              )}

              {view === "game" && (
                <GameDetail
                  game={game}
                  entry={entry}
                  job={job}
                  motionScale={motion$}
                  onAction={(a) => runAction(game, a)}
                  onUninstall={() => uninstall(game.id)}
                  onOpenNews={setReading}
                />
              )}

              {view === "news" && <NewsView motionScale={motion$} onOpen={setReading} />}

              {view === "store" && (
                <StoreView
                  entries={entries}
                  jobs={jobs}
                  motionScale={motion$}
                  onOpen={(id) => selectGame(id, "game")}
                  onInstall={(g) => {
                    selectGame(g.id);
                    const a = primaryAction(g, entries[g.id] ?? initialEntry(g), jobs[g.id] ?? null);
                    runAction(g, a);
                  }}
                />
              )}

              {view === "settings" && (
                <SettingsView
                  settings={settings}
                  version={info.full}
                  up={up}
                  motionScale={motion$}
                  onChange={(patch) => store.getState().updateSettings(patch)}
                  onReset={() => {
                    store.getState().resetSettings();
                    notify(t("Ajustes restablecidos"), true);
                  }}
                  onResetLibrary={() => {
                    store.getState().resetLibrary();
                    notify(t("Biblioteca vaciada"), true);
                  }}
                />
              )}

              {view === "profile" && (
                <ProfileView
                  user={user}
                  entries={entries}
                  jobs={jobs}
                  motionScale={motion$}
                  onOpenGame={(id) => selectGame(id, "game")}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <div className="hidden min-h-0 xl:flex">
          <FriendsPanel motionScale={motion$} onOpenGame={(id) => selectGame(id, "game")} />
        </div>
      </div>

      <DownloadDock
        jobs={activeJobs}
        expanded={dockExpanded}
        motionScale={motion$}
        onToggleExpanded={() => setDockExpanded((v) => !v)}
        onPause={(id) => store.getState().pause(id)}
        onResume={(id) => store.getState().resume(id)}
        onCancel={cancelDownload}
        onSelect={(id) => selectGame(id, "game")}
      />

      <InstallModal
        game={installFor?.game ?? null}
        kind={installFor?.kind ?? "install"}
        defaultPath={settings.installPath}
        motionScale={motion$}
        onConfirm={confirmInstall}
        onClose={() => setInstallFor(null)}
      />

      <NewsReader item={reading} motionScale={motion$} onClose={() => setReading(null)} />

      <Toast toast={toast} />
    </div>
  );
}

/** El juego que el armazón muestra si no hay selección previa. */
export const LAUNCHER_DEFAULT_GAME = DEFAULT_GAME_ID;
