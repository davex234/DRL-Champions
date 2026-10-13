/** `/copas/[slug]` — F86 · ficha pública de un torneo: cabecera, mi partida, campeón, cuadro, horario, reglas y participantes. */
import type { Metadata } from "next";
import { CupDetailScreen } from "@/components/cups/CupDetailScreen";

export const metadata: Metadata = { title: "Torneo" };

export default async function CupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CupDetailScreen slug={slug} />;
}
