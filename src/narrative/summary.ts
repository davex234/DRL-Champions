/**
 * MATCH NARRATIVE ENGINE — Resumen estructurado + verbalizador.
 *
 * El "cerebro" es estructurado (beats con datos y refs). El texto es una capa fina,
 * por PLANTILLA rellenada con datos — no hay frases escritas a mano por partido, así
 * que cada resumen es distinto porque sus datos lo son.
 */
import type {
  MatchShape, MatchSummary, NarrativeEvent, PlayerArc, Standout, StoryBeat, TeamId, TeamRef,
} from "./types";
import { ns, td } from "@/i18n/runtime";

const tr = ns("narrative");

export interface SummaryInput {
  teams: Record<TeamId, TeamRef>;
  score: Record<TeamId, number>;
  winner: TeamId | null;
  shape: MatchShape;
  arcs: PlayerArc[];
  heroes: Standout[];
  villains: Standout[];
  keyMoments: NarrativeEvent[];
  derived: NarrativeEvent[];
  inflectionRound: number | null;
}

const nameOf = (teams: Record<TeamId, TeamRef>, t: TeamId) => teams[t].name;

const HEADLINES: Record<MatchShape["id"], string> = {
  blowout: "Paliza", dominance: "Dominio", snowball: "Bola de nieve",
  comeback: "Remontada", collapse: "Colapso", nail_biter: "Al filo",
  trading_blows: "Intercambio de golpes", miracle: "Milagro", one_sided: "Partido controlado",
};

export function buildSummary(s: SummaryInput): MatchSummary {
  const beats: StoryBeat[] = [];
  const { teams, score, winner } = s;
  if (!winner) {
    return { headline: tr("Sin resolver"), shape: s.shape.id, beats, mvp: null, turningPoint: null };
  }
  const loser: TeamId = winner === "A" ? "B" : "A";

  // 1. Resultado.
  beats.push({
    kind: "result", round: null, subjects: [nameOf(teams, winner)], magnitude: 100,
    refs: s.keyMoments.filter((e) => e.type === "match_end").map((e) => e.id),
    text: tr("{teams} venció a {teams2} {v}-{v2}", { teams: nameOf(teams, winner), teams2: nameOf(teams, loser), v: score[winner], v2: score[loser] })
      + (s.shape.descriptors.length ? ` (${s.shape.descriptors[0]})` : "") + ".",
  });

  // 2. Punto de inflexión.
  if (s.inflectionRound != null) {
    const cb = s.derived.find((e) => e.type === "comeback_started");
    const detail = cb ? tr("le dieron la vuelta al marcador") : tr("cambió el control del mapa");
    beats.push({
      kind: "turning_point", round: s.inflectionRound, subjects: [nameOf(teams, winner)], magnitude: 80,
      refs: s.derived.filter((e) => e.type === "inflection").map((e) => e.id),
      text: tr("El partido giró en la ronda {inflectionRound}: {teams} {detail}.", { inflectionRound: s.inflectionRound, teams: nameOf(teams, winner), detail: td(detail) }),
    });
  }

  // 3. MVP / héroe.
  const mvp = s.heroes[0] ?? null;
  if (mvp) {
    beats.push({
      kind: "mvp", round: null, subjects: [mvp.name], magnitude: 70, refs: [],
      text: tr("{name} fue el jugador del partido ({reason}).", { name: mvp.name, reason: td(mvp.reason) }),
    });
  }

  // 4. Dominio / racha.
  const dom = s.derived.find((e) => e.type === "dominance") ?? s.derived.find((e) => e.type === "streak");
  if (dom && dom.favors) {
    beats.push({
      kind: "control", round: dom.round, subjects: [nameOf(teams, dom.favors)], magnitude: 60, refs: [dom.id],
      text: tr("Desde la ronda {round}, {teams} tomó el control del mapa.", { round: dom.round, teams: nameOf(teams, dom.favors) }),
    });
  }

  // 5. Villano / desaparecido.
  const vil = s.villains[0] ?? null;
  if (vil) {
    beats.push({
      kind: "villain", round: null, subjects: [vil.name], magnitude: 45, refs: [],
      text: `${vil.name} ${vil.reason}.`,
    });
  }

  // 6. Highlight (clutch/ace mayor).
  const hi = s.keyMoments.find((e) => e.type === "ace" || e.type === "clutch");
  if (hi) {
    const who = String(hi.data.byName ?? hi.participants[0]?.name ?? "Alguien");
    const what = hi.type === "ace" ? tr("un ACE") : tr("un clutch 1v{clutchSize}", { clutchSize: hi.data.clutchSize });
    beats.push({
      kind: "highlight", round: hi.round, subjects: [who], magnitude: hi.importance, refs: [hi.id],
      text: tr("{who} firmó {what} en la ronda {round}.", { who: td(who), what: td(what), round: hi.round }),
    });
  }

  // 7. Timeout decisivo.
  const to = s.derived.find((e) => e.type === "tactical_shift" && e.data.afterTimeout);
  if (to && to.favors) {
    beats.push({
      kind: "timeout", round: to.round, subjects: [nameOf(teams, to.favors)], magnitude: 50, refs: [to.id],
      text: tr("El timeout de {teams} (ronda {round}) cambió su plan.", { teams: nameOf(teams, to.favors), round: to.round }),
    });
  }

  return {
    headline: HEADLINES[s.shape.id],
    shape: s.shape.id,
    beats,
    mvp: mvp?.name ?? null,
    turningPoint: s.inflectionRound,
  };
}
