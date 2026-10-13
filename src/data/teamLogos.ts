/**
 * FASE 64 · LOGOS DE EQUIPO QUE EXISTEN DE VERDAD en `public/teams/`.
 *
 * `TeamLogo` pedía SIEMPRE `/teams/<slug>.png` y caía al monograma al recibir el 404. Hoy `public/teams/` solo tiene su
 * README (no hay ni un logo oficial en el repositorio), así que cada pantalla con equipos —Pick'ems, cuadro, colección
 * por equipo— dejaba decenas de 404 en la consola (17 solo en /pickems). Mismo patrón que `PACK_ART_AVAILABLE`: añadir un
 * logo son dos gestos, dejar el fichero y añadir su slug aquí. Un test compara esta lista con la carpeta.
 */
export const TEAM_LOGOS_AVAILABLE: ReadonlySet<string> = new Set<string>([]);

export const hasTeamLogo = (slug: string): boolean => TEAM_LOGOS_AVAILABLE.has(slug);

/**
 * F72.3 · LOGOS DE EQUIPO PARA LAS PISTAS de cartas ocultas, por IDENTIDAD CANÓNICA (`canonicalId` de `teamIdentities`):
 * TH y «Team Heretics» → `team-heretics`. Ficheros en `public/hints/teams/<canonicalId>.png`, copiados sin modificar de la
 * biblioteca de trabajo NEXUSFICHAJES (procedencia y hashes en su README). Un test compara esta lista con la carpeta y con
 * las identidades de las 331 cartas.
 *
 * Integración técnica APROBADA · derechos de marca para release pública SIN RESOLVER (release checklist).
 * No sustituye a `TEAM_LOGOS_AVAILABLE` (monogramas de `TeamLogo`, por slug), que sigue vacío y sin cambios.
 */
export const HINT_TEAM_LOGOS: ReadonlySet<string> = new Set<string>([
  "100t", "bbl", "c9", "dragon-ranger-gaming", "eg", "envy", "eternal-fire", "fnatic", "furia", "g2", "kru", "leviatan", "loud",
  "mibr", "nrg", "sentinels", "team-heretics", "team-liquid", "vitality", "fut", "giantx", "karmine-corp", "m8", "navi", "pcific",
]);
export const HINT_TEAM_LOGO_DIR = "/hints/teams";
export const hintTeamLogoSrc = (canonicalId: string): string | null =>
  HINT_TEAM_LOGOS.has(canonicalId) ? `${HINT_TEAM_LOGO_DIR}/${canonicalId}.png` : null;
