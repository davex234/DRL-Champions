"use client";

/**
 * LAUNCHER — hook React sobre el controlador de actualización (capa plataforma).
 *
 * Suscribe el componente al estado observable del `UpdateController` y expone acciones
 * (comprobar, descargar/instalar/reiniciar granular, cambiar canal, verificar/reparar,
 * salir) + preferencias. NO contiene lógica de negocio (vive en `src/platform/`). El
 * controlador es un singleton: el BootGate ya hizo el check inicial; este hook NO vuelve a
 * comprobar al montar (evita dobles comprobaciones).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getUpdateController, loadChannel, saveChannel, type Channel, type UpdateState, type StartOptions,
  verifyInstallation, type VerifyReport,
  loadUpdatePrefs, saveUpdatePrefs, type UpdatePrefs, DEFAULT_UPDATE_PREFS,
  exitApp,
} from "@/platform";

const UPDATE_BASE = "https://update.drlchampions.com";

export interface UpdaterApi {
  state: UpdateState;
  channel: Channel;
  prefs: UpdatePrefs;
  busy: boolean;
  verifyReport: VerifyReport | null;
  check: () => Promise<void>;
  start: (opts?: StartOptions) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  changeChannel: (c: Channel) => Promise<void>;
  setPrefs: (patch: Partial<UpdatePrefs>) => Promise<void>;
  verify: () => Promise<void>;
  repair: () => Promise<void>;
  exit: () => Promise<void>;
}

const ACTIVE = new Set<UpdateState["phase"]>(["checking", "downloading", "verifying", "installing", "finalizing", "restarting"]);

export function useUpdater(): UpdaterApi {
  const ctrlRef = useRef(getUpdateController());
  const [state, setState] = useState<UpdateState>(() => ctrlRef.current.getState());
  const [channel, setChannel] = useState<Channel>(state.channel);
  const [prefs, setPrefsState] = useState<UpdatePrefs>(DEFAULT_UPDATE_PREFS);
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null);
  const busy = ACTIVE.has(state.phase);

  useEffect(() => {
    const unsub = ctrlRef.current.subscribe(setState);
    let alive = true;
    void loadChannel().then((c) => alive && setChannel(c));
    void loadUpdatePrefs().then((p) => alive && setPrefsState(p));
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const check = useCallback(async () => {
    try {
      await ctrlRef.current.check();
    } catch {
      /* offline lo gestiona el BootGate; aquí no rompemos */
    }
  }, []);

  const start = useCallback(async (opts?: StartOptions) => {
    await ctrlRef.current.start(opts);
  }, []);
  const install = useCallback(async () => {
    await ctrlRef.current.install(true);
  }, []);
  const restart = useCallback(async () => {
    await ctrlRef.current.restart();
  }, []);

  const changeChannel = useCallback(async (c: Channel) => {
    const saved = await saveChannel(c);
    setChannel(saved);
    ctrlRef.current.setChannel(saved);
    setVerifyReport(null);
    await check();
  }, [check]);

  const setPrefs = useCallback(async (patch: Partial<UpdatePrefs>) => {
    setPrefsState(await saveUpdatePrefs(patch));
  }, []);

  const verify = useCallback(async () => {
    setVerifyReport(await verifyInstallation(UPDATE_BASE, channel));
  }, [channel]);

  const repair = useCallback(async () => {
    const rep = await verifyInstallation(UPDATE_BASE, channel);
    setVerifyReport(rep);
    if (!rep.ok) {
      // Tauri no permite descarga delta por-archivo: reparar = reinstalar vía updater oficial.
      await check();
      await ctrlRef.current.start({ autoInstall: true, autoRestart: true });
    }
  }, [channel, check]);

  const exit = useCallback(async () => {
    await exitApp(0);
  }, []);

  return { state, channel, prefs, busy, verifyReport, check, start, install, restart, changeChannel, setPrefs, verify, repair, exit };
}
