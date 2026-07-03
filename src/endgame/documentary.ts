/**
 * DOCUMENTAL — reconstruye la carrera con datos REALES (Career Fase 7/7).
 *
 * Narrado de forma DETERMINISTA (plantillas sobre el Timeline/career.history/world — nunca
 * texto aleatorio, nunca cinemáticas falsas): inicio, primer fichaje, primer título, mayor
 * derrota, mayor remontada, mayor rivalidad, jugador/entrenador favorito, último partido y
 * retirada. PURO. Reutiliza el patrón de Narrative (plantillas sobre eventos reales).
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";
import { clubLegacy, rivalriesOf } from "@/legacy";
import type { Documentary, DocumentaryChapter, ChapterId } from "./types";
import { clubIdOf } from "./util";

export function buildDocumentary(career: ManagerCareer, world: WorldState): Documentary {
  const name = career.coach.name;
  const clubId = clubIdOf(career, world);
  const legacy = clubId ? clubLegacy(world, clubId) : null;
  const chapters: DocumentaryChapter[] = [];
  const ch = (id: ChapterId, title: string, narration: string, season: number | null) => chapters.push({ id, title, narration, season });

  // 1) Inicio.
  const firstSpell = career.history.spells[0];
  ch("start", "El comienzo", `${name} inició su camino como entrenador${firstSpell ? ` en ${firstSpell.team} (T${firstSpell.fromSeason})` : ""}. Un sueño: ${career.personalGoal}.`, firstSpell?.fromSeason ?? 1);

  // 2) Primer fichaje.
  const firstSigning = clubId ? world.transfers.filter((t) => t.to === clubId && t.fee > 0).sort((a, b) => a.season - b.season)[0] : null;
  if (firstSigning) ch("first_signing", "El primer fichaje", `La primera gran apuesta de ${name}: ${firstSigning.nick} (${firstSigning.fee}). El principio de un proyecto.`, firstSigning.season);

  // 3) Primer título.
  const firstTitle = career.history.titles[0];
  if (firstTitle) ch("first_title", "El primer título", `En la T${firstTitle.season}, ${name} levantó su primer trofeo con ${firstTitle.team}: ${firstTitle.competition}. Nada volvería a ser igual.`, firstTitle.season);

  // 4) Mayor derrota.
  const defeat = career.history.results.filter((r) => r.kind === "defeat").sort((a, b) => a.season - b.season)[0];
  if (defeat) ch("worst_defeat", "La derrota que marcó", `No todo fue gloria. La caída en ${defeat.competition} (T${defeat.season}) con ${defeat.team} dejó cicatriz — y lecciones.`, defeat.season);

  // 5) Mayor remontada.
  const comeback = clubId ? world.events.find((e) => e.type === "historic_comeback" && e.subject === world.teams[clubId]?.name) : null;
  if (comeback) ch("greatest_comeback", "La gran remontada", `${comeback.detail}. La afición todavía lo recuerda.`, comeback.season);

  // 6) Mayor rivalidad.
  const rival = clubId ? rivalriesOf(world, clubId)[0] : null;
  if (rival) ch("greatest_rivalry", "El gran rival", `La rivalidad con ${rival.bName} (${rival.note}) definió una época. Cada duelo, una final.`, career.season);

  // 7) Jugador favorito.
  const fav = legacy?.legends.find((l) => l.kind === "player");
  if (fav) ch("favourite_player", "El jugador de su vida", `${fav.name} fue el estandarte de ${name}: ${fav.note}. Un vínculo que trascendió el juego.`, null);

  // 8) Entrenador/mentor favorito (asistente o coach histórico del club).
  const favCoach = legacy?.legends.find((l) => l.kind === "coach");
  if (favCoach) ch("favourite_coach", "La mano derecha", `${favCoach.name} fue clave en el banquillo: ${favCoach.note}.`, null);

  // 9) Último partido.
  const lastSeason = career.history.seasons[career.history.seasons.length - 1];
  if (lastSeason) ch("last_match", "El último baile", `La última temporada de ${name} con ${lastSeason.team} (T${lastSeason.season}): ${lastSeason.wins}V-${lastSeason.losses}D. El telón empezaba a caer.`, lastSeason.season);

  // 10) Retirada.
  ch("retirement", "La retirada", `Tras ${career.stats.seasonsCoached} temporadas, ${career.stats.titles} títulos y una vida en los banquillos, ${name} se retira dejando un legado imborrable.`, career.season);

  return {
    title: `${name}: una vida en los banquillos`,
    subtitle: `${career.stats.seasonsCoached} temporadas · ${career.stats.titles} títulos · ${career.history.spells.length} clubes`,
    chapters,
    epilogue: `El circuito seguirá girando, pero el nombre de ${name} ya forma parte de su historia. ${career.personalGoal} — cumplido a su manera.`,
  };
}
