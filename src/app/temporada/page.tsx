/**
 * `/temporada` — HUB DE TEMPORADA (IA 2026-10-07): PASE DE BATALLA · OBJETIVOS · CRAFTEO.
 *
 * Antes esta ruta era directamente el pase (Fase 34 + F83). Ahora es la entrada de la sección, con el mismo lenguaje
 * que el selector de JUGAR; el pase canónico vive en `/temporada/pase` sin cambios de comportamiento.
 */
import { SeasonModesHub } from "@/components/season/SeasonModesHub";

export default function TemporadaHubPage() {
  return <SeasonModesHub />;
}
