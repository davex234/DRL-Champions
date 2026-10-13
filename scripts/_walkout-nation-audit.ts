/** PACK WALKOUT 0.4 · auditoría de nacionalidades del catálogo real (instrumento local, fuera de CI). */
import { CARDS, allPlayers } from "../src/data/catalog";
import { isNationalityFlag, hasLocalFlag, NON_NATIONALITY_CODES } from "../src/data/flags";
import { countryDisplayName } from "../src/lib/duel/hintVisuals";
const ps = allPlayers();
const byIso = new Map<string, { players: number; cards: number; top: string }>();
const issues: string[] = [];
for (const p of ps) {
  const raw = (p as { country?: unknown }).country;
  const iso = typeof raw === "string" ? raw.toUpperCase() : "";
  if (!iso) issues.push(`${p.id}: sin country`);
  else if (!/^[A-Z]{2}$/.test(iso)) issues.push(`${p.id}: country no ISO-2 «${raw}»`);
  else if (NON_NATIONALITY_CODES.has(iso)) issues.push(`${p.id}: ${iso} (no es nacionalidad)`);
  else if (!hasLocalFlag(iso)) issues.push(`${p.id}: ${iso} sin bandera local`);
  const cards = CARDS.filter((c) => c.playerId === p.id);
  const e = byIso.get(iso) ?? { players: 0, cards: 0, top: "" };
  e.players++; e.cards += cards.length;
  const best = cards.sort((a, b) => b.ovr - a.ovr)[0];
  if (best && (!e.top || Number(e.top.split(" ")[1]) < best.ovr)) e.top = `${best.id} ${best.ovr} ${best.team}`;
  byIso.set(iso, e);
}
console.log("jugadores", ps.length, "cartas", CARDS.length, "países", byIso.size);
for (const [iso, e] of [...byIso].sort((a, b) => b[1].cards - a[1].cards)) console.log(iso.padEnd(3), (countryDisplayName(iso) ?? "—").padEnd(18), String(e.players).padStart(3), "jug", String(e.cards).padStart(4), "cartas", isNationalityFlag(iso) ? "bandera" : "SIN-BANDERA", "·", e.top);
console.log("incidencias:", issues.length); issues.slice(0, 30).forEach((x) => console.log("  ", x));
