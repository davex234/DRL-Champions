"use client";

import { useEffect, useState } from "react";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { BrandMark } from "@/branding/Logo";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "drl-install-dismissed";

/** Banner para instalar la PWA (con instrucciones específicas para iOS). */
export function InstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return; // ya instalada
    if (localStorage.getItem(DISMISS_KEY)) return;

    const ua = window.navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua);
    if (ios) {
      setIsIOS(true);
      setShow(true);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setShow(false);
  }

  return (
    /* F64 · placa de la casa (chaflán, filo de color), no la caja redondeada de web; el icono es la MARCA real, no una «D». */
    <div className="nx-f63-coach mb-4 flex items-center gap-3 px-4 py-2.5" data-testid="install-banner">
      <BrandMark size={34} className="shrink-0 drop-shadow-[0_0_10px_rgba(255,46,99,0.35)]" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold uppercase tracking-wide text-white">
          Instalar NEXUS
        </p>
        {isIOS && !deferred ? (
          <p className="text-xs text-white/55">
            Pulsa <span className="text-white">Compartir</span> y luego{" "}
            <span className="text-white">«Añadir a pantalla de inicio»</span>.
          </p>
        ) : (
          <p className="text-xs text-white/55">Juega como una app, también sin conexión.</p>
        )}
      </div>
      {deferred && (
        <button
          onClick={install}
          /*
            FASE 12 · 44 px y chaflán. Este aviso se pinta en LAS DIECISIETE zonas del
            producto, así que sus dos controles eran 34 de los 57 objetivos táctiles por
            debajo del mínimo en toda la aplicación: una sola pieza, arreglada una vez.
          */
          className="nx-focus nx-clip-sm nx-press min-h-[44px] shrink-0 bg-drl px-4 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110"
        >
          Instalar
        </button>
      )}
      {/* 44x44 no: pero por debajo de 32 el pulgar falla, y este aspa está en casi todas
          las pantallas del producto. */}
      <button
        onClick={dismiss}
        className="nx-focus nx-clip-sm grid h-11 w-11 shrink-0 place-items-center text-white/40 transition duration-fast hover:bg-white/[0.08] hover:text-white"
        aria-label="Cerrar"
      >
        <GameGlyph name="close" className="h-4 w-4" />
      </button>
    </div>
  );
}
