/**
 * `/duelos/competitivo/jugador/[id]` — RUTA ANTIGUA (Fase 28). Desde la Fase 31 el perfil de jugador
 * tiene UNA ruta canónica, `/jugador/[id]`: esta redirige para que ningún enlace guardado se rompa
 * y no existan dos perfiles públicos compitiendo.
 */
import { redirect } from "next/navigation";
import { playerHref } from "@/lib/player/href";

export default async function LegacyJugadorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(playerHref(id));
}
