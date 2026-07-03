/**
 * LIVE INTEL — NOTICIAS AUTOMÁTICAS (pure builder).
 *
 * Cada carta generada produce una NOTICIA in-game ("Wo0t recibe una carta 96 tras
 * dominar Masters", "Derke entra en el Hall of Fame"). Plantillas rellenadas con datos
 * reales (sin frases a mano por jugador). El store/UI solo muestra estos NewsItem.
 */
import type { CardAction } from "./decide";

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
  if (i.mvp) return `${i.playerNick} se corona MVP de ${i.tournamentName}`;
  if (i.won) return `${i.playerNick}, campeón de ${i.tournamentName}`;
  if (i.action === "improve") return `${i.playerNick} sube a ${i.rating} tras ${i.tournamentName}`;
  return `${i.playerNick} estrena carta ${i.tierLabel} (${i.rating})`;
};

/** Construye la noticia de una carta. Determinista (id derivado de los datos). */
export function buildCardNews(i: CardNewsInput): NewsItem {
  const kind: NewsKind = i.mvp || i.won ? "special" : "card";
  const abil = i.abilities.length ? ` Destaca en ${i.abilities.join(", ")}.` : "";
  return {
    id: `news:${i.family}:${i.playerNick}:${i.tournamentName}`.replace(/\s+/g, "_").toLowerCase(),
    at: i.at,
    kind,
    title: titleFor(i),
    body: `Tras ${i.tournamentName}, ${i.playerNick} recibe una carta ${i.tierLabel} de valoración ${i.rating}.${abil}`,
    player: i.playerNick,
    tournament: i.tournamentName,
    rarity: i.tierLabel,
    tags: [i.family, i.tierLabel, ...i.abilities],
  };
}
