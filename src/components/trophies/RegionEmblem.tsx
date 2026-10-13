/**
 * EMBLEMA DE REGIÓN. Una silueta geométrica propia sobre una retícula: no es la marca de ninguna liga. Lo usan la
 * insignia regional de Colecciones y cualquier sitio que pinte esa insignia como una más (perfil, editor).
 */

/** Siluetas en una caja de 48 × 48. */
const EMBLEM: Record<string, string[]> = {
  Americas: [
    "M6 9 13 6 22 5 30 7 27 12 29 16 24 20 21 19 19 23 22 27 20 28 15 24 11 18 7 14Z",
    "M22 28 28 27 34 31 35 37 31 41 28 46 26 46 25 39 22 34Z",
    "M31 4 37 4 35 9 32 9Z",
  ],
  EMEA: [
    "M17 8 21 5 27 6 33 5 34 10 30 13 26 12 23 15 18 14 15 11Z",
    "M15 18 22 17 28 18 31 23 35 25 32 30 29 37 26 43 23 43 21 36 21 30 15 26 13 22Z",
    "M30 15 36 14 40 19 37 23 33 21Z",
  ],
  Pacific: [
    "M8 8 18 6 22 10 19 14 21 20 17 24 14 19 9 15Z",
    "M27 6 30 5 31 11 27 16 25 15 28 10Z",
    "M24 20 26 20 27 25 25 26Z",
    "M12 28 20 29 20 31 13 31Z",
    "M23 29 30 30 29 32 23 31Z",
    "M24 36 30 33 37 34 40 39 36 44 30 43 25 42Z",
    "M42 42 44 41 44 45 42 46Z",
  ],
  China: [
    "M5 19 11 14 17 16 22 13 28 14 33 9 39 6 43 10 39 14 41 18 36 21 39 27 36 33 31 38 26 39 22 36 17 36 13 31 8 29 4 24Z",
    "M27 41 30 41 29 44Z",
    "M40 31 42 30 42 34Z",
  ],
};

export function RegionEmblem({ region, size, color }: { region: string; size: number; color: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" width={size} height={size} className="relative">
      <circle cx="24" cy="24" r="22.5" fill="none" stroke={color} strokeOpacity="0.28" strokeWidth="1" />
      <path d="M1.5 24h45M24 1.5c-9 6-9 39 0 45M24 1.5c9 6 9 39 0 45" fill="none" stroke={color} strokeOpacity="0.16" strokeWidth="1" />
      {(EMBLEM[region] ?? []).map((d) => <path key={d} d={d} fill={color} stroke={color} strokeWidth="0.8" strokeLinejoin="round" />)}
    </svg>
  );
}
