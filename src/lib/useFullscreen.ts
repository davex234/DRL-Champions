"use client";

/**
 * PANTALLA COMPLETA — hook sobre la Fullscreen API (Fase 22.2, §20).
 *
 * Presentación pura: pide/sale de pantalla completa del navegador para que la Arena ocupe TODO
 * el monitor. No toca el estado del duelo ni ninguna regla. Degrada con elegancia —si la API no
 * está (o el navegador la bloquea), `supported` es `false` y el botón que lo usa se oculta—, y no
 * obliga a nadie a entrar en pantalla completa.
 */
import { useCallback, useEffect, useState } from "react";

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

function fsElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FsDocument;
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

function fsSupported(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FsElement;
  return typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function";
}

export interface FullscreenApi {
  /** ¿El navegador ofrece la Fullscreen API aquí? Si no, ocultar el botón. */
  supported: boolean;
  /** ¿Estamos en pantalla completa ahora mismo? */
  active: boolean;
  /** Entra o sale de pantalla completa. `target` opcional; por defecto todo el documento. */
  toggle: (target?: HTMLElement | null) => void;
  enter: (target?: HTMLElement | null) => void;
  exit: () => void;
}

export function useFullscreen(): FullscreenApi {
  const [supported] = useState<boolean>(() => fsSupported());
  const [active, setActive] = useState<boolean>(() => fsElement() != null);

  useEffect(() => {
    if (!supported) return;
    const onChange = () => setActive(fsElement() != null);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [supported]);

  const enter = useCallback((target?: HTMLElement | null) => {
    if (!supported) return;
    const el = (target ?? document.documentElement) as FsElement;
    // La promesa puede rechazarse (gesto no confiable, permiso denegado): no debe romper nada.
    Promise.resolve(el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.()).catch(() => { /* degradación silenciosa */ });
  }, [supported]);

  const exit = useCallback(() => {
    if (!supported || fsElement() == null) return;
    const d = document as FsDocument;
    Promise.resolve(document.exitFullscreen?.() ?? d.webkitExitFullscreen?.()).catch(() => { /* no-op */ });
  }, [supported]);

  const toggle = useCallback((target?: HTMLElement | null) => {
    if (fsElement() != null) exit();
    else enter(target);
  }, [enter, exit]);

  return { supported, active, toggle, enter, exit };
}
