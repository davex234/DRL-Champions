"use client";

/**
 * RESULTADO ÚNICO · «PRIMERA SESIÓN COMPLETADA» EN EL LOBBY.
 *
 * Antes salía al pie del resultado de la primera partida; el resultado ya no la enseña. Aquí la decide la MISMA foto del
 * vestíbulo que ya recibe `MainMenu` (`snap.journey`, hecho del servidor: exactamente una partida terminada →
 * `homeJourneyMode === "discovery"`), sin peticiones nuevas, y los destinos son los de siempre (`discoveryItems`).
 *
 * Una vez por cuenta y navegador (`drl:first-session:<usuario>`): el servidor la mantiene «recién completada» hasta la
 * segunda partida, así que sin esta marca saldría en cada visita al lobby. Se marca al enseñarla. Capa de juego con el
 * contrato común (`useDialogLayer`: foco, Escape, tabulador atrapado), que no tapa nada mientras no se enseña.
 */
import { useEffect, useRef, useState } from "react";
import type { DailyLoopSnapshot } from "@/domain/dailyLoop";
import { JourneyDiscovery } from "@/components/journey/JourneyDiscovery";
import { useDialogLayer } from "@/components/ui/game/GameOverlay";
import { discoveryItems, homeJourneyMode } from "@/lib/journey/presentation";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("home");
const KEY = (userKey: string) => `drl:first-session:${userKey}`;

/** Pura: ¿toca enseñarla? Solo con sesión, con la foto diciendo «primera sesión recién completada» y sin marca. */
export function shouldShowFirstSession(snap: DailyLoopSnapshot, userKey: string | null, seen: (userKey: string) => boolean): boolean {
  if (!userKey || !snap.signedIn) return false;
  return homeJourneyMode(snap, { dismissed: false }) === "discovery" && !seen(userKey);
}

export function firstSessionSeen(userKey: string): boolean {
  try { return typeof window !== "undefined" && window.localStorage.getItem(KEY(userKey)) === "1"; } catch { return false; }
}
export function markFirstSessionSeen(userKey: string): void {
  try { window.localStorage.setItem(KEY(userKey), "1"); } catch { /* sin almacenamiento: se volverá a enseñar */ }
}

export function FirstSessionDiscovery({ snap, userKey, offline = false }: { snap: DailyLoopSnapshot; userKey: string | null; offline?: boolean }) {
  useLocale();
  /* Abierta PARA una cuenta: si la sesión cambia de cuenta, la capa de la anterior no sigue en pantalla. */
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor !== null && openFor === userKey;
  const panel = useRef<HTMLDivElement>(null);

  /*
   * Al cambiar de cuenta, durante un render la foto puede ser aún la de la cuenta anterior (el vestíbulo la vacía en su
   * efecto). Esa misma foto no decide nada para la cuenta nueva: se espera a la suya.
   */
  const seenWith = useRef<{ userKey: string | null; snap: DailyLoopSnapshot } | null>(null);

  // En el navegador, tras montar: en servidor no hay marca que leer y no se pinta nada.
  useEffect(() => {
    const prev = seenWith.current;
    seenWith.current = { userKey, snap };
    if (prev && prev.userKey !== userKey && prev.snap === snap) return;
    if (!userKey || !shouldShowFirstSession(snap, userKey, firstSessionSeen)) return;
    setOpenFor(userKey);
    markFirstSessionSeen(userKey);
  }, [snap, userKey]);

  useDialogLayer(open, () => setOpenFor(null), true, panel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4" data-testid="home-first-session">
      <button type="button" aria-label={t("Cerrar")} tabIndex={-1} className="nx-scrim absolute inset-0 cursor-default" onClick={() => setOpenFor(null)} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="journey-discovery-title" tabIndex={-1}
        className="relative w-full max-w-4xl outline-none" style={{ maxHeight: "calc(100dvh - 2rem)", overflowY: "auto" }}>
        <JourneyDiscovery items={discoveryItems(snap)} offline={offline} />
        <button type="button" data-autofocus onClick={() => setOpenFor(null)} aria-label={t("Cerrar")} data-testid="home-first-session-close"
          className="nx-focus absolute right-2 top-2 grid h-11 w-11 place-items-center text-[18px] text-white/70 hover:text-white">
          ✕
        </button>
      </div>
    </div>
  );
}
