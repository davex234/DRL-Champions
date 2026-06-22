"use client";

import { useEffect, useState } from "react";

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
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-drl/30 bg-gradient-to-r from-drl/15 to-transparent px-4 py-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-drl to-[#7b1733] font-display text-lg font-bold text-white shadow-glow">
        D
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold uppercase tracking-wide text-white">
          Instalar DRL Champions
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
          className="shrink-0 rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-4 py-2 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110"
        >
          Instalar
        </button>
      )}
      <button onClick={dismiss} className="shrink-0 px-1 text-white/40 hover:text-white" aria-label="Cerrar">
        ✕
      </button>
    </div>
  );
}
