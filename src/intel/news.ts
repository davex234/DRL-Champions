/**
 * LIVE INTEL — NOTICIAS AUTOMÁTICAS (pure builder).
 *
 * Cada carta generada produce una NOTICIA in-game ("Wo0t recibe una carta 96 tras
 * dominar Masters", "Derke entra en el Hall of Fame"). Plantillas rellenadas con datos
 * reales (sin frases a mano por jugador). El store/UI solo muestra estos NewsItem.
 */
import type { CardAction } from "./decide";
import { ns, td } from "@/i18n/runtime";

const t = ns("intel");

export type NewsKind = "card" | "special" | "record" | "transfer" | "event";

export interface NewsItem {
  id: string;
  at: number;
  kind: NewsKind;
  title: string;
  body: string;
  player?: string;
  tournament?: string;
  rarity?: string;
  tags: string[];
}

export interface CardNewsInput {
  playerNick: string;
  tournamentName: string;
  rating: number;
  tierLabel: string;
  action: CardAction;
  abilities: string[];
  family: string;
  won: boolean;
  mvp: boolean;
  at: number;
}

const titleFor = (i: CardNewsInput): string => {
  if (i.mvp) return t("{playerNick} se corona MVP de {tournamentName}", { playerNick: i.playerNick, tournamentName: td(i.tournamentName) });
  if (i.won) return t("{playerNick}, campeón de {tournamentName}", { playerNick: i.playerNick, tournamentName: td(i.tournamentName) });
  if (i.action === "improve") return t("{playerNick} sube a {rating} tras {tournamentName}", { playerNick: i.playerNick, rating: i.rating, tournamentName: td(i.tournamentName) });
  return t("{playerNick} estrena carta {tierLabel} ({rating})", { playerNick: i.playerNick, tierLabel: td(i.tierLabel), rating: i.rating });
};

/** Construye la noticia de una carta. Determinista (id derivado de los datos). */
export function buildCardNews(i: CardNewsInput): NewsItem {
  const kind: NewsKind = i.mvp || i.won ? "special" : "card";
  const abil = i.abilities.length ? t(" Destaca en {abilities}.", { abilities: i.abilities.join(", ") }) : "";
  return {
    id: `news:${i.family}:${i.playerNick}:${i.tournamentName}`.replace(/\s+/g, "_").toLowerCase(),
    at: i.at,
    kind,
    title: titleFor(i),
    body: t("Tras {tournamentName}, {playerNick} recibe una carta {tierLabel} de valoración {rating}.{abil}", { tournamentName: td(i.tournamentName), playerNick: i.playerNick, tierLabel: td(i.tierLabel), rating: i.rating, abil: td(abil) }),
    player: i.playerNick,
    tournament: i.tournamentName,
    rarity: i.tierLabel,
    tags: [i.family, i.tierLabel, ...i.abilities],
  };
}
