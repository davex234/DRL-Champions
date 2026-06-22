/** Convierte un código ISO de país (2 letras) en emoji de bandera. */
export function flagEmoji(iso: string): string {
  if (!iso || iso.length !== 2) return "🏳️";
  const base = 0x1f1e6;
  const code = iso.toUpperCase();
  return String.fromCodePoint(
    base + (code.charCodeAt(0) - 65),
    base + (code.charCodeAt(1) - 65),
  );
}

export const ROLE_ABBR: Record<string, string> = {
  Duelista: "DUE",
  Iniciador: "INI",
  Centinela: "CEN",
  Controlador: "CON",
  Flex: "FLX",
};
