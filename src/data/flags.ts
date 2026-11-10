/**
 * F72.3 · BANDERAS LOCALES — la única fuente de banderas del juego (`public/flags/<iso>.svg`).
 *
 * Origen: flag-icons 7.5.0 (MIT, © Panayiotis Lipiridis), `flags/4x3`, copiadas sin modificar; licencia y hashes en
 * `public/flags/`. Solo los códigos de los jugadores de las 331 cartas (incluido `UN`, que la capa `Flag` de la carta ya
 * pintaba): el juego NO pide banderas a ningún host externo (antes, flagcdn.com en tiempo de ejecución). Un test compara
 * esta lista con la carpeta y con el catálogo.
 */
export const LOCAL_FLAGS: ReadonlySet<string> = new Set<string>([
  "AR", "AU", "BE", "BR", "CA", "CL", "CN", "CO", "CZ", "DE", "DO", "EG", "FI", "FR", "GB", "HK", "ID", "IT", "JP", "KG",
  "KH", "KR", "KZ", "LT", "MA", "MD", "MX", "MY", "PH", "PL", "RO", "RS", "RU", "SG", "TH", "TR", "TW", "UN", "US", "VN",
]);

/**
 * Códigos que NO son la nacionalidad de nadie. VLR usa `UN` (Naciones Unidas) para «sin nacionalidad conocida»: pintar esa
 * bandera como pista afirmaría algo falso (F72.3 lo corrige; en F72.2 salía como «Naciones Unidas»).
 */
export const NON_NATIONALITY_CODES: ReadonlySet<string> = new Set<string>(["UN", "EU", "ZZ", "XX"]);

export const FLAGS_DIR = "/flags";
export const FLAG_ICONS_SOURCE = Object.freeze({ package: "flag-icons", version: "7.5.0", license: "MIT", variant: "4x3" });

/** ¿Hay fichero local para este código? Es lo que usa la capa `Flag` de la carta (pinta lo que dice el dato). */
export const hasLocalFlag = (iso: string): boolean => LOCAL_FLAGS.has((iso ?? "").toUpperCase());

/** ¿Puede ser PISTA de país? Fichero local Y una nacionalidad real (`UN` no lo es: sin pista de país). */
export const isNationalityFlag = (iso: string): boolean => {
  const code = (iso ?? "").toUpperCase();
  return hasLocalFlag(code) && !NON_NATIONALITY_CODES.has(code);
};
