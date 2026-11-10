/**
 * COLECCIONES POR EQUIPO · IDENTIDAD DE LOS EQUIPOS NUEVOS DESDE EL PANEL (0076) — solo servidor.
 *
 * El registro de código (`teamIdentities.ts`) sigue mandando para los equipos que conoce: aquí no se edita ninguno de
 * ellos. Lo que se da de alta es un equipo IMPRESO que ese registro no resuelve (una carta publicada desde el CMS con un
 * equipo nuevo): clave estable, nombre, etiqueta y región. Hasta entonces ese equipo no es una colección del jugador.
 *
 * La escritura es UNA llamada a `app_team_identity_save`, que vuelve a comprobar que el actor es admin, la revisión
 * (dos admins no se pisan), que la clave no cambia nunca y deja la auditoría en la misma transacción. Aquí se valida lo
 * mismo antes, para dar errores claros, y lo que la base no puede saber: que la clave no es de un equipo del código y
 * que el texto impreso existe de verdad en el catálogo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import { fail, ok, type AdminResult } from "@/server/admin/http";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { BADGE_REGIONS, CODE_TEAM_IDS, MANAGED_TEAM_ID, TEAM_TAG, type ManagedTeamIdentity } from "@/domain/teamCollections/model";
import { cmsTeamLogoAssets, managedTeamIdentities } from "@/server/services/teamCollections";
import { isMissingRelation } from "@/server/services/f73Config";

const CONTROL = /[\u0000-\u001f\u007f]/;

/** Textos impresos que hoy no resuelve el registro de código, con cuántas cartas (de cualquier estado) los llevan. */
export async function unknownPrintedTeams(sb: SupabaseClient): Promise<Map<string, number>> {
  const cat = await serverCatalog(sb);
  const out = new Map<string, number>();
  for (const c of cat.cards) {
    const k = canonicalCardTeam(c, cat.player(c.playerId)).key;
    if (k.startsWith("raw:") && k !== "raw:?") out.set(k.slice(4), (out.get(k.slice(4)) ?? 0) + 1);
  }
  return out;
}

export interface TeamIdentityInput { printedTeam: string; teamId: string; name: string; tag: string; region: string; expectedRev: number }

/** Validación pura (la misma que las restricciones de 0076, más la reserva de las claves del código). */
export function validateTeamIdentity(b: Record<string, unknown>): { ok: true; value: TeamIdentityInput } | { ok: false; error: string } {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const printedTeam = s(b.printedTeam), teamId = s(b.teamId), name = s(b.name), tag = s(b.tag), region = s(b.region);
  if (!printedTeam || printedTeam.length > 48 || CONTROL.test(printedTeam) || printedTeam === "?") return { ok: false, error: "Equipo impreso no válido" };
  if (!MANAGED_TEAM_ID.test(teamId)) return { ok: false, error: "Clave no válida: 2–32 caracteres en minúsculas, números y guiones" };
  if (CODE_TEAM_IDS.has(teamId)) return { ok: false, error: "Esa clave ya es de un equipo del registro" };
  if (name.length < 2 || name.length > 48 || CONTROL.test(name)) return { ok: false, error: "El nombre debe tener entre 2 y 48 caracteres" };
  if (!TEAM_TAG.test(tag)) return { ok: false, error: "La etiqueta debe tener de 1 a 6 letras, números o puntos" };
  if (!(BADGE_REGIONS as readonly string[]).includes(region)) return { ok: false, error: "Elige una región: Americas, EMEA, Pacific o China" };
  const rev = b.expectedRev == null ? 0 : Number(b.expectedRev);
  if (!Number.isInteger(rev) || rev < 0) return { ok: false, error: "Revisión no válida" };
  return { ok: true, value: { printedTeam, teamId, name, tag, region, expectedRev: rev } };
}

export interface TeamIdentitiesAdminView {
  /** 0076 aplicada. Sin ella el panel lo dice y no deja guardar. */
  available: boolean;
  managed: (ManagedTeamIdentity & { cards: number; logo: string | null; logoAssetId: string | null })[];
  /** Textos impresos sin identidad todavía: sus cartas no forman colección hasta que se den de alta. */
  pending: { printedTeam: string; cards: number }[];
}

export async function listTeamIdentities(sb: SupabaseClient): Promise<AdminResult<TeamIdentitiesAdminView>> {
  const [managed, unknown, logos] = await Promise.all([managedTeamIdentities(sb), unknownPrintedTeams(sb), cmsTeamLogoAssets(sb)]);
  const done = new Set(managed.rows.map((m) => m.printedTeam));
  return ok({
    available: managed.available,
    managed: managed.rows.map((m) => ({ ...m, cards: unknown.get(m.printedTeam) ?? 0, logo: logos.get(m.teamId)?.url ?? null, logoAssetId: logos.get(m.teamId)?.id ?? null })).sort((a, b) => a.name.localeCompare(b.name, "es")),
    pending: [...unknown].filter(([p]) => !done.has(p)).map(([printedTeam, cards]) => ({ printedTeam, cards })).sort((a, b) => a.printedTeam.localeCompare(b.printedTeam, "es")),
  });
}

const CODES: Record<string, [number, string]> = {
  NOT_ADMIN: [403, "No autorizado"],
  CONFLICT: [409, "Otro admin cambió este equipo: recarga antes de guardar"],
  TEAM_ID_LOCKED: [409, "La clave de un equipo no se puede cambiar una vez creada"],
  TEAM_ID_TAKEN: [409, "Esa clave ya la usa otro equipo"],
  INVALID: [400, "Datos del equipo no válidos"],
};

export async function saveTeamIdentity(sb: SupabaseClient, actor: string, b: Record<string, unknown>): Promise<AdminResult<{ teamId: string; rev: number }>> {
  const v = validateTeamIdentity(b);
  if (!v.ok) return fail(400, v.error);
  const x = v.value;
  const [managed, unknown] = await Promise.all([managedTeamIdentities(sb), unknownPrintedTeams(sb)]);
  if (!managed.available) return fail(503, "Falta la migración 0076: todavía no se pueden dar de alta equipos");
  // Solo equipos impresos que existen y que el código no conoce (o que ya tienen identidad del panel).
  if (!unknown.has(x.printedTeam) && !managed.rows.some((m) => m.printedTeam === x.printedTeam)) return fail(404, "Ningún equipo impreso del catálogo sin identidad se llama así");
  const { data, error } = await sb.rpc("app_team_identity_save", {
    p_actor: actor, p_printed: x.printedTeam, p_team_id: x.teamId, p_name: x.name, p_tag: x.tag, p_region: x.region, p_expected_rev: x.expectedRev,
  });
  if (error) {
    if (isMissingRelation(error) || /app_team_identity_save/i.test(error.message ?? "")) return fail(503, "Falta la migración 0076: todavía no se pueden dar de alta equipos");
    return fail(500, "No se pudo guardar el equipo");
  }
  const r = (data ?? {}) as { code?: string; rev?: number; teamId?: string };
  if (r.code === "OK") return ok({ teamId: r.teamId ?? x.teamId, rev: r.rev ?? 1 });
  const [status, msg] = CODES[r.code ?? ""] ?? [500, "No se pudo guardar el equipo"];
  return fail(status, msg);
}
