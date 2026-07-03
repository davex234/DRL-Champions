/**
 * POST /api/market/sync-reference — puebla `card_reference` desde el catálogo TS.
 *
 * Calcula valor justo (`marketValue`), rareza (rank de variante), nick/equipo/
 * región/OVR de cada carta y hace upsert con el cliente service_role. La banda
 * de precio del antifraude y la analítica de mercado dependen de esta tabla, así
 * que conviene reejecutarlo tras cambios de roster/catálogo.
 *
 * Protegido por la misma cabecera `x-sync-secret` (env `SYNC_SECRET`).
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { marketValue } from "@/domain/economy/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secret || req.headers.get("x-sync-secret") !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurado" }, { status: 503 });

  const rows = CARDS.map((card) => {
    const player = getPlayer(card.playerId);
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
    if (error) return NextResponse.json({ error: error.message, written }, { status: 500 });
    written += chunk.length;
  }

  return NextResponse.json({ ok: true, cards: written });
}
