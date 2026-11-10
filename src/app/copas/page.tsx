/** `/copas` — F86 · TORNEOS de jugadores (en la interfaz, «Torneos»; `/torneos` es la capa esports «Eventos»). */
import type { Metadata } from "next";
import { CupsHubScreen } from "@/components/cups/CupsHubScreen";

export const metadata: Metadata = { title: "Torneos" };

export default function CupsPage() {
  return <CupsHubScreen />;
}
