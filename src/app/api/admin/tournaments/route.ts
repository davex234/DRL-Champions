/**
 * POST /api/admin/tournaments — operaciones del sistema de torneos (servidor).
 *
 * Requiere sesión de administrador (Bearer token de Supabase Auth + profiles.is_admin,
 * vía `verifyAdmin`). Escribe con service_role. Cuerpo: { action, ... }.
 *
 * Acciones: create_tournament | update_tournament | add_team | add_player |
 * import_from_event | set_rule | finish_tournament | eliminate_team |
 * run_pickem_lifecycle.
 * Las generaciones devuelven `specs` para que el cliente aplique las accolades al
 * roster local (cartas jugables).
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyAdmin } from "@/lib/supabase/adminAuth";
import { allPlayers } from "@/data/catalog";
import {
  generateForFinish, generateForTeamElimination, persistGeneration, persistCollection,
} from "@/lib/tournaments/engine";
import { runPickemLifecycle } from "@/server/services/pickemLifecycle";
import type {
  Tournament, TournamentPlayer, RarityRule, CardPhoto, GenerationResult,
} from "@/domain/tournaments/types";
import { internalError } from "@/server/ops/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (n: number | null): number | undefined => (n == null ? undefined : Number(n));

async function loadGenInput(sb: SupabaseClient, tournamentId: string) {
  const { data: tRow } = await sb.from("tournaments").select("*").eq("id", tournamentId).maybeSingle();
  if (!tRow) return null;
  const t = tRow as Record<string, unknown>;
  const tournament: Tournament = {
    id: t.id as string, name: t.name as string, region: (t.region as string) ?? undefined,
    tier: (t.tier as string) ?? undefined, status: t.status as Tournament["status"],
    eventId: (t.event_id as string) ?? undefined, winnerTeamId: (t.winner_team_id as string) ?? undefined,
  };

  const { data: pRows } = await sb.from("tournament_players").select("*").eq("tournament_id", tournamentId);
  const players: TournamentPlayer[] = ((pRows as Record<string, unknown>[]) ?? []).map((r) => ({
    tournamentId, teamId: (r.team_id as string) ?? undefined, playerId: r.player_id as string,
    nick: (r.nick as string) ?? undefined, rating: num(r.rating as number | null), isMvp: Boolean(r.is_mvp),
    acs: num(r.acs as number | null), kills: num(r.kills as number | null),
    assists: num(r.assists as number | null), hsPct: num(r.hs_pct as number | null),
    clutch: num(r.clutch as number | null), isRookie: Boolean(r.is_rookie),
  }));

  const { data: rRows } = await sb.from("card_generation_rules").select("*").order("priority", { ascending: false });
  const rules: RarityRule[] = ((rRows as Record<string, unknown>[]) ?? []).map((r) => ({
    id: r.id as string, kind: r.kind as RarityRule["kind"], tier: r.tier as string, label: r.label as string,
    minRating: num(r.min_rating as number | null), accolade: (r.accolade as string) ?? undefined,
    priority: r.priority as number, active: Boolean(r.active),
  }));

  // Fotos aprobadas de los jugadores implicados (arquitectura de fotos).
  const ids = players.map((p) => p.playerId);
  const photosByPlayer: Record<string, CardPhoto[]> = {};
  if (ids.length) {
    const { data: phRows } = await sb.from("card_photos").select("*").in("player_id", ids).eq("approval_status", "approved");
    for (const r of (phRows as Record<string, unknown>[]) ?? []) {
      const pid = r.player_id as string;
      (photosByPlayer[pid] ??= []).push({
        id: r.id as string, playerId: pid, url: r.url as string, source: r.source as CardPhoto["source"],
        quality: num(r.quality as number | null), approvalStatus: "approved", priority: r.priority as number,
      });
    }
  }
  return { tournament, players, rules, photosByPlayer };
}

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "No autorizado (admin requerido)" }, { status: 401 });
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Supabase admin no configurado" }, { status: 503 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const action = body.action as string;

  try {
    switch (action) {
      case "create_tournament":
      case "update_tournament": {
        const row = {
          id: body.id, name: body.name, region: body.region ?? null, tier: body.tier ?? null,
          status: body.status ?? "upcoming", event_id: body.eventId ?? null,
          winner_team_id: body.winnerTeamId ?? null,
          start_date: body.startDate ?? null, end_date: body.endDate ?? null,
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from("tournaments").upsert(row, { onConflict: "id" });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case "add_team": {
        const { error } = await sb.from("tournament_teams").upsert({
          tournament_id: body.tournamentId, team_id: body.teamId, team_name: body.teamName ?? null,
          placement: body.placement ?? null, status: body.status ?? "active",
        }, { onConflict: "tournament_id,team_id" });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case "add_player": {
        const { error } = await sb.from("tournament_players").upsert({
          tournament_id: body.tournamentId, team_id: body.teamId ?? null, player_id: body.playerId,
          nick: body.nick ?? null, rating: body.rating ?? null, acs: body.acs ?? null,
          kd: body.kd ?? null, kast: body.kast ?? null, maps: body.maps ?? null,
          kills: body.kills ?? null, assists: body.assists ?? null, hs_pct: body.hsPct ?? null,
          clutch: body.clutch ?? null, is_rookie: Boolean(body.isRookie),
          is_mvp: Boolean(body.isMvp), stats: body.stats ?? {},
        }, { onConflict: "tournament_id,player_id" });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case "set_rule": {
        const { error } = await sb.from("card_generation_rules").upsert({
          kind: body.kind ?? "rating", tier: body.tier, label: body.label,
          min_rating: body.minRating ?? null, accolade: body.accolade ?? null,
          color: body.color ?? null, priority: body.priority ?? 0, active: body.active ?? true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "tier" });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case "import_from_event": {
        const eventId = body.eventId as string;
        const tournamentId = body.tournamentId as string;
        const { data: stats } = await sb.from("player_event_stats")
          .select("player_id, rating").eq("event_id", eventId);
        const { data: pl } = await sb.from("players").select("id, nick, team_id");
        const nickById = new Map((pl as { id: string; nick: string; team_id: string | null }[] ?? [])
          .map((p) => [p.id, p]));
        const byNick = new Map(allPlayers().map((g) => [g.nick.toLowerCase(), g]));
        const rows = ((stats as { player_id: string; rating: number | null }[]) ?? []).map((s) => {
          const esp = nickById.get(s.player_id);
          const game = esp ? byNick.get(esp.nick.toLowerCase()) : undefined;
          return {
            tournament_id: tournamentId, team_id: game?.team ?? esp?.team_id ?? null,
            player_id: game?.id ?? s.player_id, nick: esp?.nick ?? game?.nick ?? null,
            rating: s.rating, is_mvp: false,
          };
        });
        if (rows.length) {
          const { error } = await sb.from("tournament_players").upsert(rows, { onConflict: "tournament_id,player_id" });
          if (error) throw new Error(error.message);
        }
        return NextResponse.json({ ok: true, imported: rows.length });
      }
      case "finish_tournament": {
        const input = await loadGenInput(sb, body.tournamentId as string);
        if (!input) return NextResponse.json({ error: "Torneo inexistente" }, { status: 404 });
        const result: GenerationResult = generateForFinish(input);
        await persistGeneration(sb, result, admin.userId);
        // Collection Engine: el torneo genera su colección (jugadores + premios) + recompensa.
        const collReward = { credits: 12000, packId: "prime", packCount: 2 };
        const coll = await persistCollection(sb, input.tournament, result.specs, collReward);
        await sb.from("tournaments").update({
          status: "finished", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", input.tournament.id);
        if (input.tournament.winnerTeamId) {
          await sb.from("tournament_teams").update({ status: "champion" })
            .eq("tournament_id", input.tournament.id).eq("team_id", input.tournament.winnerTeamId);
        }
        return NextResponse.json({ ok: true, result, collection: coll });
      }
      /*
       * CICLO DE PICK'EMS (Fase 10).
       *
       * Abre las predicciones de los partidos que faltan, fija el resultado de los que ya
       * acabaron y reparte puntos y recompensas. En producción esto corre solo dentro de
       * la sincronización competitiva; esta acción existe para forzarlo desde el panel
       * cuando el origen publica un resultado tarde.
       *
       * Es idempotente, así que pulsarlo dos veces no duplica nada.
       */
      case "run_pickem_lifecycle": {
        const eventId = typeof body.eventId === "string" ? body.eventId : "";
        if (!eventId) return NextResponse.json({ error: "Falta eventId" }, { status: 400 });
        const result = await runPickemLifecycle(sb, eventId);
        return NextResponse.json({ ok: true, result });
      }
      case "eliminate_team": {
        const input = await loadGenInput(sb, body.tournamentId as string);
        if (!input) return NextResponse.json({ error: "Torneo inexistente" }, { status: 404 });
        const teamId = body.teamId as string;
        const result = generateForTeamElimination(input, teamId);
        await persistGeneration(sb, result, admin.userId);
        await sb.from("tournament_teams").update({ status: "eliminated", eliminated_at: new Date().toISOString() })
          .eq("tournament_id", input.tournament.id).eq("team_id", teamId);
        return NextResponse.json({ ok: true, result });
      }
      default:
        return NextResponse.json({ error: `Acción desconocida: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return internalError("api/admin/tournaments", e, req);
  }
}
