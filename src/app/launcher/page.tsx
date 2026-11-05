"use client";

/**
 * DRL LAUNCHER — punto de entrada de la ventana de escritorio (Tauri abre /launcher).
 *
 * Toda la experiencia (splash → init → conexión → auto-update → launcher/juego) la
 * orquesta BootGate. El juego nunca se actualiza a sí mismo: solo se entra cuando el
 * cliente está al día. Sin chrome de juego (GameShell se salta esta ruta).
 */
import { BootGate } from "@/components/launcher/BootGate";

export default function LauncherPage() {
  return <BootGate />;
}
