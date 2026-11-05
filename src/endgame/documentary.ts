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
import { ns, td } from "@/i18n/runtime";

const tr = ns("endgame");

export function buildDocumentary(career: ManagerCareer, world: WorldState): Documentary {
  const name = career.coach.name;
  const clubId = clubIdOf(career, world);
  const legacy = clubId ? clubLegacy(world, clubId) : null;
  const chapters: DocumentaryChapter[] = [];
  const ch = (id: ChapterId, title: string, narration: string, season: number | null) => chapters.push({ id, title, narration, season });

  // 1) Inicio.
  const firstSpell = career.history.spells[0];
  ch("start", tr("El comienzo"), tr("{name} inició su camino como entrenador{v}. Un sueño: {personalGoal}.", { name, v: firstSpell ? tr(" en {team} (T{fromSeason})", { team: firstSpell.team, fromSeason: firstSpell.fromSeason }) : "", personalGoal: td(career.personalGoal) }), firstSpell?.fromSeason ?? 1);

  // 2) Primer fichaje.
  const firstSigning = clubId ? world.transfers.filter((t) => t.to === clubId && t.fee > 0).sort((a, b) => a.season - b.season)[0] : null;
  if (firstSigning) ch("first_signing", tr("El primer fichaje"), tr("La primera gran apuesta de {name}: {nick} ({fee}). El principio de un proyecto.", { name, nick: firstSigning.nick, fee: firstSigning.fee }), firstSigning.season);

  // 3) Primer título.
  const firstTitle = career.history.titles[0];
  if (firstTitle) ch("first_title", tr("El primer título"), tr("En la T{season}, {name} levantó su primer trofeo con {team}: {competition}. Nada volvería a ser igual.", { season: firstTitle.season, name, team: firstTitle.team, competition: td(firstTitle.competition) }), firstTitle.season);

  // 4) Mayor derrota.
  const defeat = career.history.results.filter((r) => r.kind === "defeat").sort((a, b) => a.season - b.season)[0];
  if (defeat) ch("worst_defeat", tr("La derrota que marcó"), tr("No todo fue gloria. La caída en {competition} (T{season}) con {team} dejó cicatriz — y lecciones.", { competition: td(defeat.competition), season: defeat.season, team: defeat.team }), defeat.season);

  // 5) Mayor remontada.
  const comeback = clubId ? world.events.find((e) => e.type === "historic_comeback" && e.subject === world.teams[clubId]?.name) : null;
  if (comeback) ch("greatest_comeback", tr("La gran remontada"), tr("{detail}. La afición todavía lo recuerda.", { detail: td(comeback.detail) }), comeback.season);

  // 6) Mayor rivalidad.
  const rival = clubId ? rivalriesOf(world, clubId)[0] : null;
  if (rival) ch("greatest_rivalry", tr("El gran rival"), tr("La rivalidad con {bName} ({note}) definió una época. Cada duelo, una final.", { bName: td(rival.bName), note: td(rival.note) }), career.season);

  // 7) Jugador favorito.
  const fav = legacy?.legends.find((l) => l.kind === "player");
  if (fav) ch("favourite_player", tr("El jugador de su vida"), tr("{name} fue el estandarte de {name2}: {note}. Un vínculo que trascendió el juego.", { name: fav.name, name2: name, note: td(fav.note) }), null);

  // 8) Entrenador/mentor favorito (asistente o coach histórico del club).
  const favCoach = legacy?.legends.find((l) => l.kind === "coach");
  if (favCoach) ch("favourite_coach", tr("La mano derecha"), tr("{name} fue clave en el banquillo: {note}.", { name: favCoach.name, note: td(favCoach.note) }), null);

  // 9) Último partido.
  const lastSeason = career.history.seasons[career.history.seasons.length - 1];
  if (lastSeason) ch("last_match", tr("El último baile"), tr("La última temporada de {name} con {team} (T{season}): {wins}V-{losses}D. El telón empezaba a caer.", { name, team: lastSeason.team, season: lastSeason.season, wins: lastSeason.wins, losses: lastSeason.losses }), lastSeason.season);

  // 10) Retirada.
  ch("retirement", tr("La retirada"), tr("Tras {seasonsCoached} temporadas, {titles} títulos y una vida en los banquillos, {name} se retira dejando un legado imborrable.", { seasonsCoached: career.stats.seasonsCoached, titles: career.stats.titles, name }), career.season);

  return {
    title: tr("{name}: una vida en los banquillos", { name }),
    subtitle: tr("{seasonsCoached} temporadas · {titles} títulos · {length} clubes", { seasonsCoached: career.stats.seasonsCoached, titles: career.stats.titles, length: career.history.spells.length }),
    chapters,
    epilogue: tr("El circuito seguirá girando, pero el nombre de {name} ya forma parte de su historia. {personalGoal} — cumplido a su manera.", { name, personalGoal: td(career.personalGoal) }),
  };
}
