/**
 * MATCH NARRATIVE ENGINE — Consulta.
 *
 * Responde, sobre un NarrativeState ya construido, las preguntas que importan:
 * ¿por qué ganó?, ¿cuándo cambió?, ¿quién fue el MVP real?, ¿quién desapareció?,
 * ¿qué decisión fue decisiva?, ¿cuál fue el momento más importante? Devuelve datos
 * estructurados + una verbalización determinista.
 */
import type { NarrativeState, TeamId } from "./types";
import { ns as i18nNs } from "@/i18n/runtime";

const tr = i18nNs("narrative");

export interface QueryAnswer<T> { value: T; text: string; }

export interface QueryAnswers {
  whyWon: QueryAnswer<{ winner: TeamId | null; factors: { kind: string; detail: string; weight: number }[] }>;
  whenItChanged: QueryAnswer<{ round: number | null; eventId: string | null }>;
  realMVP: QueryAnswer<{ name: string | null; score: number }>;
  whoDisappeared: QueryAnswer<{ names: string[] }>;
  decisiveDecision: QueryAnswer<{ eventId: string | null; round: number | null }>;
  biggestMoment: QueryAnswer<{ eventId: string | null; round: number | null; type: string | null }>;
}

const teamName = (ns: NarrativeState, t: TeamId | null) => (t ? ns.match.teams[t].name : "nadie");

export function answerQuestions(ns: NarrativeState): QueryAnswers {
  const winner = ns.match.winner;

  // — ¿Por qué ganó? — factores = aristas que culminan en el fin + forma + héroe.
  const end = ns.graph.nodes.find((n) => n.type === "match_end");
  const factors: { kind: string; detail: string; weight: number }[] = [];
  if (end) {
    const into = ns.graph.edges.filter((e) => e.to === end.id)
      .sort((a, b) => b.weight - a.weight).slice(0, 4);
    for (const e of into) {
      const src = ns.graph.nodes.find((n) => n.id === e.from);
      if (src) factors.push({ kind: src.type, detail: tr("{type} en r{round}", { type: src.type.replace(/_/g, " "), round: src.round }), weight: e.weight });
    }
  }
  factors.push({ kind: "shape", detail: ns.match.shape.descriptors[0] ?? ns.match.shape.id, weight: ns.match.shape.confidence });
  if (ns.heroes[0]) factors.push({ kind: "hero", detail: `${ns.heroes[0].name}: ${ns.heroes[0].reason}`, weight: 0.6 });
  const whyWon: QueryAnswers["whyWon"] = {
    value: { winner, factors },
    text: winner
      ? tr("{ns} ganó por {v}.", { ns: teamName(ns, winner), v: factors.slice(0, 3).map((f) => f.detail).join("; ") })
      : tr("Partido sin resolver."),
  };

  // — ¿Cuándo cambió? —
  const infl = ns.graph.nodes.find((n) => n.type === "inflection")
    ?? mostImportant(ns, ["momentum_shift"]);
  const whenItChanged: QueryAnswers["whenItChanged"] = {
    value: { round: infl?.round ?? null, eventId: infl?.id ?? null },
    text: infl ? tr("El partido cambió en la ronda {round}.", { round: infl.round }) : tr("No hubo un giro claro."),
  };

  // — MVP real (impacto agregado, no solo bajas) —
  const top = ns.players[0] ?? null;
  const realMVP: QueryAnswers["realMVP"] = {
    value: { name: top?.name ?? null, score: top?.impactScore ?? 0 },
    text: top ? tr("El MVP real fue {name} (impacto {impactScore}).", { name: top.name, impactScore: top.impactScore }) : tr("Sin datos."),
  };

  // — ¿Quién desapareció? —
  const gone = ns.players.filter((p) => p.states.includes("disappeared")).map((p) => p.name);
  const whoDisappeared: QueryAnswers["whoDisappeared"] = {
    value: { names: gone },
    text: gone.length ? tr("Se desvaneció: {gone}.", { gone: gone.join(", ") }) : tr("Nadie desapareció del todo."),
  };

  // — Decisión decisiva (timeout/cambio táctico con más peso saliente) —
  let decisive: { id: string; round: number; score: number } | null = null;
  for (const n of ns.graph.nodes) {
    if (n.type !== "timeout" && n.type !== "tactical_shift") continue;
    const out = ns.graph.edges.filter((e) => e.from === n.id).reduce((a, e) => a + e.weight, 0);
    const sc = out * n.importance;
    if (!decisive || sc > decisive.score) decisive = { id: n.id, round: n.round, score: sc };
  }
  const decisiveDecision: QueryAnswers["decisiveDecision"] = {
    value: { eventId: decisive?.id ?? null, round: decisive?.round ?? null },
    text: decisive ? tr("La decisión decisiva ocurrió en la ronda {round}.", { round: decisive.round }) : tr("Ninguna decisión de coach destacó."),
  };

  // — Momento más importante —
  const big = ns.keyMoments[0]?.event ?? null;
  const biggestMoment: QueryAnswers["biggestMoment"] = {
    value: { eventId: big?.id ?? null, round: big?.round ?? null, type: big?.type ?? null },
    text: big ? tr("El momento clave fue un {type} en la ronda {round}.", { type: big.type, round: big.round }) : tr("Sin momentos destacados."),
  };

  return { whyWon, whenItChanged, realMVP, whoDisappeared, decisiveDecision, biggestMoment };
}

function mostImportant(ns: NarrativeState, types: string[]) {
  return ns.graph.nodes.filter((n) => types.includes(n.type)).sort((a, b) => b.importance - a.importance)[0];
}
