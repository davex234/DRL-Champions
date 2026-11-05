/**
 * `/api/game/progression` — PASE DE TEMPORADA, MISIONES Y LOGROS (Fase 9E).
 *
 *   POST { action: "state" }
 *   POST { action: "claimLevel",   level, track }      ← track: free | competitive | premium
 *   POST { action: "claimMission", missionId }
 *   POST { action: "claimAchievement", achievementId }
 *   POST { action: "refreshMissions" }
 *   POST { action: "equipCosmetic", family, cosmeticId }   ← `null` para retirar
 *
 * Todo ocurre en servidor. El cliente no envía progreso, ni cifras, ni recompensas: solo
 * dice QUÉ quiere reclamar, y el servicio comprueba contra la base de datos si le
 * corresponde. Las recompensas salen por `app_grant_reward`, con clave de idempotencia.
 *
 * No hay ninguna acción de pago: §12 de la Fase 9 prohíbe integrar una pasarela sin
 * infraestructura segura, así que sencillamente no existe el endpoint.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import {
  getProgression, claimPassLevel, claimMission, claimAchievement,
  refreshMissions, equipCosmetic,
} from "@/server/services/progression";
import type { PassTrack } from "@/battlepass";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Lista blanca de carriles. Un valor cualquiera del cliente no llega al servicio. */
const TRACKS = new Set<PassTrack>(["free", "competitive", "premium"]);

/** Los ids son nuestros y siempre son slugs; se acotan antes de tocar la base de datos. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // F67 · límite de frecuencia de las escrituras de esta ruta (cubeta en BD: vale con varios procesos).
  { const rate = await takeRate(session.admin, session.userId, "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500

  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "state": {
        const r = await getProgression(session.admin, session.userId);
        return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.status, headers: NO_STORE });
      }

      /*
       * Equipar un cosmético (Fase 11). La familia y el id se acotan aquí y la propiedad
       * la comprueba la RPC: dos puertas, y la de dentro es la que manda.
       */
      case "equipCosmetic": {
        const family = typeof body.family === "string" ? body.family : "";
        const cosmeticId = body.cosmeticId === null ? null
          : typeof body.cosmeticId === "string" ? body.cosmeticId : "";
        if (cosmeticId === "") {
          return NextResponse.json({ error: "Cosmético no válido" }, { status: 400, headers: NO_STORE });
        }
        const r = await equipCosmetic(session.admin, session.userId, family, cosmeticId);
        return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.status, headers: NO_STORE });
      }

      case "claimLevel": {
        const level = typeof body.level === "number" ? body.level : Number.NaN;
        const track = typeof body.track === "string" ? (body.track as PassTrack) : "free";
        if (!TRACKS.has(track)) {
          return NextResponse.json({ error: "Carril no válido" }, { status: 400, headers: NO_STORE });
        }
        const r = await claimPassLevel(session.admin, session.userId, level, track);
        return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.status, headers: NO_STORE });
      }

      case "claimMission": {
        const id = typeof body.missionId === "string" && SLUG.test(body.missionId) ? body.missionId : "";
        if (!id) return NextResponse.json({ error: "Misión no válida" }, { status: 400, headers: NO_STORE });
        const r = await claimMission(session.admin, session.userId, id);
        return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.status, headers: NO_STORE });
      }

      case "claimAchievement": {
        const id = typeof body.achievementId === "string" && SLUG.test(body.achievementId) ? body.achievementId : "";
        if (!id) return NextResponse.json({ error: "Logro no válido" }, { status: 400, headers: NO_STORE });
        const r = await claimAchievement(session.admin, session.userId, id);
        return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.status, headers: NO_STORE });
      }

      case "refreshMissions": {
        const r = await refreshMissions(session.admin, session.userId);
        return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.status, headers: NO_STORE });
      }

      default:
        return NextResponse.json({ error: "Acción no reconocida" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    // El detalle interno se queda en el servidor: al cliente le llega un mensaje neutro.
    console.error("[progression]", e);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500, headers: NO_STORE });
  }
}
