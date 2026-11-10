"use client";

/**
 * FASE 44 · ERROR DE PANTALLA. Si una pantalla revienta al pintar, el jugador NO ve una traza: ve «No se ha podido
 * cargar» con REINTENTAR (vuelve a montar la pantalla) y VOLVER AL LOBBY. El detalle va a la consola, con el `digest`
 * de Next para poder cruzarlo con el log del servidor.
 */
import { useEffect } from "react";
import { GameError } from "@/components/ui/game/GameStates";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[nexus] pantalla", error.digest ?? "", error.message);
  }, [error]);
  return <GameError onRetry={reset} className="mx-auto mt-4 max-w-3xl" />;
}
