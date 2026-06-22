import type { Player } from "@/domain/cards/types";
import type { RawPlayer } from "./types";
import { normalizeRawPlayer } from "./normalize";

export interface ImportResult {
  players: Player[];
  errors: string[];
}

/** Parsea un array JSON de jugadores (formato RawPlayer o Player). */
export function parseJsonPlayers(text: string): ImportResult {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { players: [], errors: [`JSON inválido: ${(e as Error).message}`] };
  }
  const arr = Array.isArray(data) ? data : [data];
  const players: Player[] = [];
  arr.forEach((row, i) => {
    try {
      const raw = row as RawPlayer;
      if (!raw.nick && !(row as { nombre?: string }).nombre) {
        errors.push(`Fila ${i + 1}: falta "nick"/"nombre"`);
        return;
      }
      players.push(normalizeRawPlayer(coerceRaw(row as Record<string, unknown>)));
    } catch (e) {
      errors.push(`Fila ${i + 1}: ${(e as Error).message}`);
    }
  });
  return { players, errors };
}

/** Parsea CSV (con cabecera) a jugadores. Soporta comillas básicas. */
export function parseCsv(text: string): ImportResult {
  const errors: string[] = [];
  const rows = csvRows(text);
  if (rows.length < 2) return { players: [], errors: ["CSV vacío o sin cabecera"] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const players: Player[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length === 1 && cells[0] === "") continue;
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => (obj[h] = (cells[idx] ?? "").trim()));
    try {
      players.push(normalizeRawPlayer(coerceRaw(obj)));
    } catch (e) {
      errors.push(`Fila ${i + 1}: ${(e as Error).message}`);
    }
  }
  return { players, errors };
}

/** Acepta claves en español o inglés y agrupa métricas. */
function coerceRaw(o: Record<string, unknown>): RawPlayer {
  const s = (k: string) => (o[k] != null ? String(o[k]) : undefined);
  const n = (k: string) => (o[k] != null && o[k] !== "" ? Number(o[k]) : undefined);

  const metricsKeys = ["acs", "adr", "kills", "deaths", "kd", "assists", "hspct", "hs%", "clutches", "kast"];
  const hasMetrics = metricsKeys.some((k) => o[k] != null && o[k] !== "");
  const metrics = hasMetrics
    ? {
        acs: n("acs"),
        adr: n("adr"),
        kills: n("kills"),
        deaths: n("deaths"),
        kd: n("kd"),
        assists: n("assists"),
        hsPct: n("hspct") ?? n("hs%"),
        clutches: n("clutches"),
        kast: n("kast"),
      }
    : undefined;

  // Stats directas (si las métricas no están presentes)
  const stats = {
    dmg: n("dmg"),
    scr: n("scr"),
    com: n("com"),
    hs: n("hs"),
    ast: n("ast"),
    clu: n("clu"),
  };

  const accoladesRaw = s("accolades") ?? s("palmares");
  const accolades = accoladesRaw
    ? accoladesRaw.split(/[;|]/).map((a) => a.trim()).filter(Boolean)
    : undefined;

  return {
    id: s("id"),
    nick: s("nick") ?? s("nombre") ?? s("name") ?? "",
    fullName: s("fullname") ?? s("nombrecompleto"),
    team: s("team") ?? s("equipo") ?? "",
    teamTag: s("teamtag") ?? s("tag"),
    region: s("region") ?? "",
    role: s("role") ?? s("rol"),
    country: s("country") ?? s("pais") ?? s("país") ?? "",
    status: s("status") === "inactive" || s("estado") === "inactivo" ? "inactive" : "active",
    image: s("image") ?? s("imagen") ?? s("foto"),
    metrics,
    stats,
    accolades,
  };
}

/** Divide CSV en filas/celdas respetando comillas dobles. */
function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}
