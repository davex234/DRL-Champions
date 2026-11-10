/**
 * CALENDARIO DE TEMPORADAS DE NEXUS (Fase 34) — LA ÚNICA FUENTE.
 *
 * `CURRENT_SEASON` (`data/season.ts`) sigue siendo el CONTENIDO del pase (carriles, misiones). Este
 * fichero es el CONTRATO TEMPORAL: cuándo empieza y termina cada temporada. Qué temporada está activa
 * lo decide `resolveCalendar(SEASON_CALENDAR, serverNow)` en el servidor; nada más responde a esa
 * pregunta.
 *
 * ── DECISIÓN DE PRODUCTO (LOCAL, NO DESPLEGADA) ──
 * No existía ninguna fecha de temporada en código ni en docs: solo `durationDays: 84` y una tabla
 * `public.seasons` de Pick'ems (0012, usada por `seed-demo` con `s1`) que no es la temporada de NEXUS.
 * Se fijan aquí, explícitamente:
 *   · inicio `2026-09-07T00:00:00Z` — lunes 00:00 UTC, el inicio de la ventana semanal de misiones
 *     (`periods.ts`) de la semana en la que el pase ya estaba activo;
 *   · final  `2026-11-30T00:00:00Z` — exactamente `durationDays` (84 días = 12 semanas) después,
 *     también lunes 00:00 UTC, así la última rotación semanal cierra con la temporada.
 * No son fechas del circuito VCT. Mientras esto no se despliegue, producción no «está» en ningún calendario.
 *
 * No hay Temporada 2 porque no está decidida: no se inventa. Añadir una temporada = añadir una entrada
 * (el validador rechaza solapes, rangos invertidos y fechas sin zona).
 */
import type { SeasonCalendarEntry } from "@/domain/season/calendar";
import { CURRENT_SEASON } from "./season";

export const SEASON_CALENDAR: readonly SeasonCalendarEntry[] = [
  {
    id: CURRENT_SEASON.id,          // "nexus-s1": el mismo id que ya usan `user_pass` y el libro mayor
    slug: "temporada-1",
    number: 1,
    name: "Temporada 1",
    displayName: CURRENT_SEASON.name,
    startsAt: "2026-09-07T00:00:00.000Z",
    endsAt: "2026-11-30T00:00:00.000Z",
    passSeasonId: CURRENT_SEASON.id,
    themeKey: "ascenso",
  },
];
