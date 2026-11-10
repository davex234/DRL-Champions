/**
 * TEXTO DE EQUIPOS Y JUGADORES — reparación de codificación (2026-09-21).
 *
 * La descarga de VLR (`vlr/players-vct-2026.json`, y con ella `content_players`) trae algunos textos
 * en «mojibake»: UTF-8 leído como Windows-1252 y vuelto a guardar. Medido sobre las 371 filas: 13
 * campos — el equipo y la etiqueta de los 6 jugadores de KRÜ («KRÃœ») y el nick de Rosé («RosÃ©»).
 *
 * `repairMojibake` deshace exactamente esa transformación y NADA más: vuelve a codificar el texto como
 * Windows-1252 y lo decodifica como UTF-8; si el resultado no es UTF-8 válido, o el texto no tenía
 * ninguna secuencia sospechosa, devuelve la entrada intacta. Así un nombre correcto con tildes
 * («Leviatán», «KRÜ») nunca se toca. No cambia la carta impresa: solo el texto que se enseña y con el
 * que se agrupa.
 */

/** Windows-1252 0x80–0x9F → punto de código Unicode (los huecos no existen en el juego de caracteres). */
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Primer byte de una secuencia UTF-8 de 2–4 bytes, visto como Windows-1252 (Â, Ã, Ä…, ð…). */
const SUSPECT = /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€™]/;

export function repairMojibake(text: string): string {
  if (!text || !SUSPECT.test(text)) return text;
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252_HIGH[cp] !== undefined) bytes.push(CP1252_HIGH[cp]);
    else return text; // no es texto Windows-1252: no se puede ser mojibake de esta clase
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return text;
  }
}

/**
 * Etiqueta de equipo IMPRESA en una carta del catálogo diseñado: el prefijo del nombre de fichero de
 * `Cartas\` («FNATIC VEQAJ (Future Star).png» → «FNATIC»). Los ficheros se nombraron con el equipo de la
 * carta; es el mismo dato que el logo impreso. `undefined` si no hay fichero o no tiene prefijo.
 */
export function printedTeamTag(sourceFile: string | null | undefined): string | undefined {
  const tag = (sourceFile ?? "").trim().split(/\s+/)[0];
  return tag && tag !== (sourceFile ?? "").trim() ? repairMojibake(tag) : undefined;
}
