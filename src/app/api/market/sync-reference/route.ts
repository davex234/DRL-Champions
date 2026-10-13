/**
 * POST /api/market/sync-reference — puebla `card_reference` desde el catálogo TS.
 *
 * Calcula valor justo (`marketValue`), rareza (rank de variante), nick/equipo/
 * región/OVR de cada carta y hace upsert con el cliente service_role. La banda
 * de precio del antifraude y la analítica de mercado dependen de esta tabla, así
 * que conviene reejecutarlo tras cambios de roster/catálogo.
 *
 * Protegido por la misma cabecera `x-sync-secret` (env `SYNC_SECRET`).
 *
 * BLOQUE 8.1 — la proyección parte del catálogo PERSISTIDO, no del derivado en código. Es la
 * tabla contra la que el antifraude del mercado compara los precios: si su ancla saliera de
 * una fuente distinta de la que decide qué cartas existen, la banda podría calcularse sobre
 * una carta que el servidor ya no reconoce.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { serverCatalog } from "@/server/catalog";
import { getVariant } from "@/domain/cards/variants";
import { marketValue } from "@/domain/economy/pricing";
import { secretMatches } from "@/server/ops/secret";
import { internalError } from "@/server/ops/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secretMatches(req.headers.get("x-sync-secret"), secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurado" }, { status: 503 });

  const catalog = await serverCatalog(sb);
  const rows = catalog.cards.map((card) => {
    const player = catalog.player(card.playerId);
    return {
      card_id: card.id,
      player_id: card.playerId,
      nick: player?.nick ?? null,
      team: player?.team ?? null,
      region: player?.region ?? null,
      rank: getVariant(card.variantId).rank,
      ovr: card.ovr,
      fair_value: marketValue(card),
      updated_at: new Date().toISOString(),
    };
  });

  // Upsert por lotes para no exceder límites de payload.
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await sb.from("card_reference").upsert(chunk, { onConflict: "card_id" });
    if (error) return internalError("api/market/sync-reference", error, req, { written });
    written += chunk.length;
  }

  return NextResponse.json({ ok: true, cards: written });
}
