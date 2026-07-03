"use client";

/**
 * UPDATE WATCHER (app-wide) — montado en el AppShell, vigila actualizaciones MIENTRAS se
 * juega (rutas del juego, no el launcher). Si aparece una versión nueva muestra una
 * notificación elegante. Detección de "partido en curso" por ruta (`/entrenador`): nunca
 * interrumpe un partido — solo avisa y deja "Actualizar ahora / Más tarde".
 *
 * Reutiliza el controlador singleton (vía useUpdateWatcher) y el flujo oficial de Tauri
 * (al pulsar Actualizar se navega al launcher, que ejecuta la actualización firmada).
 */
import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useUpdateWatcher } from "./useUpdateWatcher";
import { UpdateNotification } from "./UpdateNotification";

export function UpdateWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { state, available } = useUpdateWatcher();
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Si llega una versión distinta a la descartada, vuelve a mostrarse.
  useEffect(() => {
    if (available && state.available && dismissed && dismissed !== state.available) {
      setDismissed(null);
    }
  }, [available, state.available, dismissed]);

  const inMatch = pathname?.startsWith("/entrenador") ?? false;
  const show = available && state.available != null && dismissed !== state.available;

  return (
    <AnimatePresence>
      {show && (
        <UpdateNotification
          version={state.available!}
          inMatch={inMatch}
          onUpdate={() => router.push("/launcher")}
          onDismiss={() => setDismissed(state.available)}
        />
      )}
    </AnimatePresence>
  );
}
