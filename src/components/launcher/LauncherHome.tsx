"use client";

/**
 * DRL LAUNCHER — pantalla principal (post-arranque, ya actualizado).
 *
 * A partir de la revisión del cliente, la pantalla principal es el ARMAZÓN del launcher
 * (`shell/LauncherShell`): biblioteca, hero cinematográfico, gestor de descargas, amigos,
 * novedades, tienda, perfil y configuración.
 *
 * Lo anterior no se pierde: el actualizador del cliente —canal, comprobación, verificación de
 * archivos y reparación— sigue siendo el MISMO `UpdaterApi` (singleton compartido con el
 * BootGate) y vive ahora en Configuración → Cliente, más el aviso de la barra superior. La
 * comprobación periódica sigue corriendo aquí mientras la ventana está abierta.
 */
import type { UpdaterApi } from "./useUpdater";
import { useUpdateWatcher } from "./useUpdateWatcher";
import { LauncherShell } from "./shell/LauncherShell";

export function LauncherHome({ up }: { up: UpdaterApi }) {
  // Detecta actualizaciones aunque el cliente lleve horas abierto (no secuestra la pantalla).
  useUpdateWatcher();
  return <LauncherShell up={up} />;
}
