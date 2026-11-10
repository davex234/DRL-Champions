/**
 * GET /api/game/state — estado de juego REAL del usuario autenticado.
 *
 * Fuente de verdad: tablas `user_cards`, `user_packs`, `user_game`, `profiles`
 * (migración 0011). Sustituye a `localStorage` como autoridad; el cliente lo usa
 * como caché de UI.
 *
 * Requiere `Authorization: Bearer <access_token>` de Supabase Auth. El `userId`
 * se deriva del token, nunca del cuerpo.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { loadGameState } from "@/server/services/inventory";
import { serverCatalog } from "@/server/catalog";
import { getCard } from "@/data/catalog";
import { artworkDeInstancias } from "@/server/services/cardArtworkUpload";
import type { CardDef, Player } from "@/domain/cards/types";
import { internalError } from "@/server/ops/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LAS DEFINICIONES QUE EL CLIENTE NO PUEDE DERIVAR POR SU CUENTA.
 *
 * El catálogo del navegador se construye con el roster COMPILADO. Una carta creada desde el
 * panel de administración (8.4.2) no está ahí, así que el jugador que la obtiene no la ve:
 * ni en el revelado del sobre, ni en la colección, ni en el inventario.
 *
 * Aquí se acompaña el estado con la definición de las cartas que el jugador POSEE y que el
 * cliente no puede conocer. No es un catálogo paralelo: es exactamente el subconjunto que
 * hace falta para pintar lo que ya tiene, y sale del catálogo persistido, que es la
 * autoridad. Un catálogo sin cartas nuevas devuelve dos listas vacías.
 */
async function catalogPatch(
  admin: Parameters<typeof loadGameState>[0], cardIds: string[],
): Promise<{ cards: CardDef[]; players: Player[] }> {
  const desconocidas = [...new Set(cardIds)].filter((id) => !getCard(id));
  if (desconocidas.length === 0) return { cards: [], players: [] };

  const cat = await serverCatalog(admin);
  const cards: CardDef[] = [];
  const players = new Map<string, Player>();
  for (const id of desconocidas) {
    const def = cat.card(id);
    if (!def) continue;
    cards.push(def);
    const p = cat.player(def.playerId);
    if (p) players.set(p.id, p);
  }
  return { cards, players: [...players.values()] };
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const state = await loadGameState(session.admin, session.userId);
    /*
     * EL ARTWORK VIAJA CON EL ESTADO, y en una sola consulta.
     *
     * La colección pinta cientos de cartas de golpe: preguntar el artwork carta a carta
     * serían cientos de peticiones para dibujar una pantalla. Se resuelve en lote aquí,
     * donde ya se sabe qué ejemplares tiene el jugador y con qué versión se acuñó cada uno.
     *
     * El mapa va indexado por `uid` DE EJEMPLAR. Es lo que hace imposible el cruce entre
     * versiones: el cliente no elige artwork por carta, lo recibe ya resuelto por ejemplar.
     */
    const [patch, artworks] = await Promise.all([
      catalogPatch(session.admin, state.ownedCards.map((c) => c.cardId)),
      artworkDeInstancias(session.admin, state.ownedCards),
    ]);
    return NextResponse.json({ ...state, catalogPatch: patch, artworks },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return internalError("api/game/state", e, req);
  }
}
