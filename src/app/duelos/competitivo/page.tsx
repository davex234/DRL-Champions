/**
 * `/duelos/competitivo` — FASE 55: el centro competitivo vive en `/competitivo`. Esta ruta (la de la Fase 28)
 * se conserva como alias para enlaces y marcadores antiguos y redirige. Historial, detalle de partida y perfil
 * competitivo siguen bajo `/duelos/competitivo/*`.
 */
import { redirect } from "next/navigation";

export default function CompetitivoLegacyPage() {
  redirect("/competitivo");
}
