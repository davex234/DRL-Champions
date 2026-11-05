"use client";

/**
 * `/jugador/[id]` — EL PERFIL DE JUGADOR (Fase 31 → F89). La ÚNICA ruta pública de identidad: no cambia. La pantalla
 * vive en `PlayerProfileScreen` (IA 2026-10-07), que también usa Mi cuenta → Perfil; `/jugador/me` resuelve al propio.
 */
import { use } from "react";
import { PlayerProfileScreen } from "@/components/player/PlayerProfileScreen";

export default function JugadorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PlayerProfileScreen id={id} />;
}
