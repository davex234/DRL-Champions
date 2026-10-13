/**
 * F86 · TORNEOS EN EL PANEL (`/admin/copas`, `/api/admin/cups`). Usa el admin EXISTENTE: `runAdmin` → `verifyAdmin`
 * (profiles.is_admin), límites admin_read/admin_write, lista blanca del cuerpo y auditoría en `content_audit_log`.
 * Ningún rol nuevo: las RPC de 0069 vuelven a comprobar en la BD que el actor es admin.
 *
 *   · Crear y editar BORRADORES (todo el formulario) — escritura directa (la guardia de 0069 solo deja borradores).
 *   · Publicado / en curso: solo texto (nombre, descripción, reglas). Lo que decide la competición queda congelado.
 *   · Publicar (`cup_admin_publish`, con versión), cancelar (`cup_admin_cancel`, motivo; en curso además escribir el
 *     identificador), generar el cuadro tras el cierre (`cup_generate`) y resolver un cruce retenido o con el plazo
 *     vencido (`cup_admin_resolve`: A / B avanza confirmando su #TAG, o los dos fuera). Todo auditado en la BD.
 *   · No hay edición libre del cuadro ni de ganadores: solo esas acciones concretas, con motivo.
 * Las cuentas se identifican por su #TAG y nombre público; nunca por un UUID escrito a mano ni por correo.
 */
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, json, ok, readBody, respond, rpcFailure, runAdmin, type AdminDeps, type AdminResult } from "./http";
import { writeAudit } from "./audit";
import { validateCupDraft, CUP_SAFE_FIELDS, CUP_DRAFT_KEYS, type CupFieldError } from "@/domain/cups/validation";
import { cupPhase, displayState, roundWindow, type MatchDisplayState } from "@/domain/cups/lifecycle";
import { bracketSize, roundName, roundsFor } from "@/domain/cups/bracket";
import type { CupPhase, CupPlacement, CupResolution, CupStatus, CupMatchStatus } from "@/domain/cups/types";
import { normalizeTag, formatTag } from "@/domain/account/tag";
import { CUP_COLS, type CupRow } from "@/server/services/cups";
import { isUuid } from "@/domain/admin/sanctions";

export interface AdminCupRow {
  id: string; slug: string; name: string; status: CupStatus; phase: CupPhase; visibility: string;
  participants: number; max: number; min: number; startsAt: string; registrationOpenAt: string; registrationCloseAt: string;
  problems: number; version: number; updatedAt?: string;
}
export interface AdminCupPlayer { username: string; tag: string | null; seed: number | null; seedRating: number | null; placement: CupPlacement | null; eliminatedRound: number | null }
export interface AdminCupMatch {
  round: number; slot: number; roundName: string; status: CupMatchStatus; state: MatchDisplayState;
  a: AdminCupPlayer | null; b: AdminCupPlayer | null; aEmpty: boolean; bEmpty: boolean; winner: "A" | "B" | null; resolution: CupResolution | null;
  availableAt: string; deadlineAt: string; resolvable: boolean; hasGame: boolean; reason: string | null;
}
export interface AdminCupDetail {
  cup: AdminCupRow & { description: string; rules: string; roundWindowMinutes: number; rounds: number | null; bracketSize: number | null; cancelReason: string | null; championTag: string | null; championName: string | null };
  registrations: AdminCupPlayer[];
  matches: AdminCupMatch[];
  problems: AdminCupMatch[];
  audit: { at: string; action: string; actorName: string | null; detail: Record<string, unknown> }[];
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
const iso = (n: number) => new Date(n).toISOString();
const timing = (c: CupRow) => ({ status: c.status, registrationOpenAt: Date.parse(c.registration_open_at), registrationCloseAt: Date.parse(c.registration_close_at), startsAt: Date.parse(c.starts_at), startedAt: c.started_at ? Date.parse(c.started_at) : null });

function rowOf(c: CupRow, now: number, problems = 0): AdminCupRow {
  return {
    id: c.id, slug: c.slug, name: c.name, status: c.status, phase: cupPhase(timing(c), now), visibility: c.visibility,
    participants: c.participant_count, max: c.max_participants, min: c.min_participants, startsAt: c.starts_at,
    registrationOpenAt: c.registration_open_at, registrationCloseAt: c.registration_close_at, problems, version: c.version,
  };
}

export async function listCups(sb: SupabaseClient, now = Date.now()): Promise<AdminResult<{ cups: AdminCupRow[] }>> {
  const { data, error } = await sb.from("cups").select(CUP_COLS).order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (/cups|does not exist|PGRST205/i.test(error.message)) return fail(503, "Los torneos aún no están disponibles (falta la migración 0069)");
    return fail(500, "No se pudieron leer los torneos");
  }
  const cups = (data ?? []) as unknown as CupRow[];
  const live = cups.filter((c) => c.status === "IN_PROGRESS").map((c) => c.id);
  const problems = new Map<string, number>();
  if (live.length) {
    const { data: ms } = await sb.from("cup_matches").select("cup_id, status, deadline_at, game_match_id").in("cup_id", live).in("status", ["ACTION_REQUIRED", "READY"]);
    for (const m of (ms ?? []) as { cup_id: string; status: string; deadline_at: string; game_match_id: string | null }[]) {
      if (m.status === "ACTION_REQUIRED" || (Date.parse(m.deadline_at) <= now && !m.game_match_id)) problems.set(m.cup_id, (problems.get(m.cup_id) ?? 0) + 1);
    }
  }
  return ok({ cups: cups.map((c) => rowOf(c, now, problems.get(c.id) ?? 0)) });
}

export async function cupDetail(sb: SupabaseClient, id: unknown, now = Date.now()): Promise<AdminResult<AdminCupDetail>> {
  if (!isUuid(id)) return fail(400, "Torneo inválido");
  const { data, error } = await sb.from("cups").select(CUP_COLS).eq("id", id).maybeSingle();
  if (error) return fail(500, "No se pudo leer el torneo");
  if (!data) return fail(404, "Torneo no encontrado");
  const c = data as unknown as CupRow;
  const [regsRes, msRes, auditRes] = await Promise.all([
    sb.from("cup_registrations").select("user_id, seed, seed_rating, placement, eliminated_round, username_snapshot, tag_snapshot, registered_at").eq("cup_id", c.id).eq("status", "REGISTERED").order("registered_at", { ascending: true }).limit(64),
    sb.from("cup_matches").select("round, slot, player_a, player_b, a_empty, b_empty, status, winner_id, resolution, available_at, deadline_at, game_match_id, resolution_reason").eq("cup_id", c.id).order("round").order("slot").limit(63),
    sb.from("content_audit_log").select("at, action, actor, detail").eq("entity_type", "cup").eq("entity_id", c.id).order("at", { ascending: false }).limit(50),
  ]);
  if (regsRes.error || msRes.error) return fail(500, "No se pudo leer el torneo");
  const regs = (regsRes.data ?? []) as { user_id: string; seed: number | null; seed_rating: number | null; placement: CupPlacement | null; eliminated_round: number | null; username_snapshot: string | null; tag_snapshot: string | null }[];
  const ids = [...new Set([...regs.map((r) => r.user_id), c.champion_id, ...((auditRes.data ?? []) as { actor: string | null }[]).map((a) => a.actor)].filter((x): x is string => !!x))];
  const names = new Map<string, { username: string; tag: string | null }>();
  if (ids.length) {
    const { data: ps } = await sb.from("profiles").select("id, username, public_tag").in("id", ids);
    for (const p of (ps ?? []) as { id: string; username: string; public_tag: string | null }[]) names.set(p.id, { username: p.username, tag: normalizeTag(p.public_tag) });
  }
  const regBy = new Map(regs.map((r) => [r.user_id, r]));
  const player = (uid: string | null): AdminCupPlayer | null => {
    if (!uid) return null;
    const r = regBy.get(uid); const n = names.get(uid);
    return { username: n?.username ?? r?.username_snapshot ?? "Jugador", tag: n?.tag ?? normalizeTag(r?.tag_snapshot ?? null), seed: r?.seed ?? null, seedRating: r?.seed_rating ?? null, placement: r?.placement ?? null, eliminatedRound: r?.eliminated_round ?? null };
  };
  const rounds = c.rounds ?? 0;
  const matches: AdminCupMatch[] = ((msRes.data ?? []) as { round: number; slot: number; player_a: string | null; player_b: string | null; a_empty: boolean; b_empty: boolean; status: CupMatchStatus; winner_id: string | null; resolution: CupResolution | null; available_at: string; deadline_at: string; game_match_id: string | null; resolution_reason: string | null }[]).map((m) => {
    const state = displayState(m.status, Date.parse(m.available_at), Date.parse(m.deadline_at), now);
    return {
      round: m.round, slot: m.slot, roundName: roundName(m.round, rounds || m.round), status: m.status, state,
      a: player(m.player_a), b: player(m.player_b), aEmpty: m.a_empty, bEmpty: m.b_empty,
      winner: m.winner_id === null ? null : m.winner_id === m.player_a ? "A" : "B", resolution: m.resolution,
      availableAt: m.available_at, deadlineAt: m.deadline_at, hasGame: !!m.game_match_id, reason: m.resolution_reason,
      resolvable: c.status === "IN_PROGRESS" && (m.status === "ACTION_REQUIRED" || (m.status === "READY" && !m.game_match_id && Date.parse(m.deadline_at) <= now)),
    };
  });
  const problems = matches.filter((m) => m.resolvable || m.status === "ACTIVE" && Date.parse(m.deadlineAt) <= now);
  const champ = c.champion_id ? names.get(c.champion_id) : undefined;
  return ok({
    cup: {
      ...rowOf(c, now, matches.filter((m) => m.resolvable).length), description: c.description, rules: c.rules, roundWindowMinutes: c.round_window_minutes,
      rounds: c.rounds, bracketSize: c.bracket_size, cancelReason: c.cancel_reason, championTag: champ?.tag ?? null, championName: champ?.username ?? null,
    },
    registrations: [...regs].sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99)).map((r) => player(r.user_id)!),
    matches, problems,
    audit: ((auditRes.data ?? []) as { at: string; action: string; actor: string | null; detail: Record<string, unknown> | null }[]).map((a) => ({
      at: a.at, action: a.action, actorName: a.actor ? names.get(a.actor)?.username ?? "admin" : "sistema", detail: a.detail ?? {},
    })),
  });
}

/** Vista previa SIN guardar: validación, rondas y horario si se llenase, y tamaños de cuadro posibles. */
export function previewCup(fields: unknown, now = Date.now()): AdminResult<{ valid: boolean; publishable: boolean; errors: CupFieldError[]; schedule: { round: number; name: string; availableAt: string; deadlineAt: string }[]; bracketForMax: number | null; byesAtMin: number | null }> {
  const f = (fields && typeof fields === "object" ? fields : {}) as Record<string, unknown>;
  const draft = validateCupDraft(f, now);
  const pub = validateCupDraft(f, now, { forPublish: true });
  if (!draft.ok) return ok({ valid: false, publishable: false, errors: draft.errors, schedule: [], bracketForMax: null, byesAtMin: null });
  const v = draft.value;
  const size = bracketSize(v.maxParticipants)!;
  const rounds = roundsFor(size);
  const schedule = Array.from({ length: rounds }, (_, i) => { const w = roundWindow(v.startsAt, v.roundWindowMinutes, i + 1); return { round: i + 1, name: roundName(i + 1, rounds), availableAt: iso(w.availableAt), deadlineAt: iso(w.deadlineAt) }; });
  const minSize = bracketSize(v.minParticipants)!;
  return ok({ valid: true, publishable: pub.ok, errors: pub.ok ? [] : pub.errors, schedule, bracketForMax: size, byesAtMin: minSize - v.minParticipants });
}

const DRAFT_ROW = (v: ReturnType<typeof validateCupDraft> & { ok: true }) => ({
  slug: v.value.slug, name: v.value.name, description: v.value.description, rules: v.value.rules,
  registration_open_at: iso(v.value.registrationOpenAt), registration_close_at: iso(v.value.registrationCloseAt), starts_at: iso(v.value.startsAt),
  min_participants: v.value.minParticipants, max_participants: v.value.maxParticipants, round_window_minutes: v.value.roundWindowMinutes, visibility: v.value.visibility,
});

export async function createCup(sb: SupabaseClient, actor: string, fields: unknown, now = Date.now()): Promise<AdminResult<{ id: string; slug: string; version: number }>> {
  const v = validateCupDraft((fields && typeof fields === "object" ? fields : {}) as Record<string, unknown>, now);
  if (!v.ok) return fail(400, v.errors.map((e) => e.message).join(" · "));
  const { data, error } = await sb.from("cups").insert({ ...DRAFT_ROW(v), created_by: actor }).select("id, slug, version").maybeSingle();
  if (error) {
    if (error.code === "23505" || /duplicate key/i.test(error.message)) return fail(409, "Ya existe un torneo con ese identificador");
    return rpcFailure(error.message);
  }
  const row = data as { id: string; slug: string; version: number };
  const audit = await writeAudit(sb, actor, "cup_draft_created", "cup", row.id, { slug: row.slug, name: v.value.name, max: v.value.maxParticipants, min: v.value.minParticipants, visibility: v.value.visibility });
  if (!audit.ok) return audit;
  console.info(`[admin] cup_draft_created ${row.slug} actor=${actor.slice(0, 8)}`);
  return ok({ id: row.id, slug: row.slug, version: row.version });
}

export async function updateCup(sb: SupabaseClient, actor: string, id: unknown, version: unknown, fields: unknown, now = Date.now()): Promise<AdminResult<{ id: string; version: number; textOnly: boolean }>> {
  if (!isUuid(id)) return fail(400, "Torneo inválido");
  if (typeof version !== "number" || !Number.isInteger(version)) return fail(400, "Falta la versión que estás editando");
  const { data, error } = await sb.from("cups").select(CUP_COLS).eq("id", id).maybeSingle();
  if (error) return fail(500, "No se pudo leer el torneo");
  if (!data) return fail(404, "Torneo no encontrado");
  const c = data as unknown as CupRow;
  if (c.status === "COMPLETED" || c.status === "CANCELLED") return fail(409, "Un torneo terminado o cancelado no se edita");
  const f = (fields && typeof fields === "object" ? fields : {}) as Record<string, unknown>;
  let patch: Record<string, unknown>;
  let textOnly = false;
  if (c.status === "DRAFT") {
    const v = validateCupDraft(f, now);
    if (!v.ok) return fail(400, v.errors.map((e) => e.message).join(" · "));
    patch = DRAFT_ROW(v);
  } else {
    // Publicado: SOLO texto. Cualquier otro campo en el cuerpo se rechaza (no se ignora en silencio).
    const other = Object.keys(f).filter((k) => !(CUP_SAFE_FIELDS as readonly string[]).includes(k));
    if (other.length) return fail(409, `Con el torneo publicado solo se corrige texto (nombre, descripción, reglas); no «${other[0]}»`);
    const merged = { ...{ slug: c.slug, name: c.name, description: c.description, rules: c.rules, registrationOpenAt: c.registration_open_at, registrationCloseAt: c.registration_close_at, startsAt: c.starts_at, minParticipants: c.min_participants, maxParticipants: c.max_participants, roundWindowMinutes: c.round_window_minutes, visibility: c.visibility }, ...f };
    const v = validateCupDraft(merged, now);
    if (!v.ok) return fail(400, v.errors.map((e) => e.message).join(" · "));
    patch = { name: v.value.name, description: v.value.description, rules: v.value.rules };
    textOnly = true;
  }
  const { data: up, error: upErr } = await sb.from("cups").update(patch).eq("id", c.id).eq("version", version).select("id, version").maybeSingle();
  if (upErr) {
    if (upErr.code === "23505" || /duplicate key/i.test(upErr.message)) return fail(409, "Ya existe un torneo con ese identificador");
    return rpcFailure(upErr.message);
  }
  if (!up) return fail(409, "Otro administrador cambió este torneo. Recarga y revisa antes de guardar.");
  const changed = Object.keys(patch).filter((k) => String((c as unknown as Record<string, unknown>)[k]) !== String(patch[k]));
  const audit = await writeAudit(sb, actor, textOnly ? "cup_text_updated" : "cup_draft_updated", "cup", c.id, { slug: c.slug, fields: changed });
  if (!audit.ok) return audit;
  return ok({ id: c.id, version: (up as { version: number }).version, textOnly });
}

async function rpcCode(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<AdminResult<Record<string, unknown>>> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) { console.error(`[admin] ${fn}: ${error.message.slice(0, 160)}`); return rpcFailure(error.message); }
  return ok((data ?? {}) as Record<string, unknown>);
}

export async function publishCup(sb: SupabaseClient, actor: string, id: unknown, version: unknown, now = Date.now()): Promise<AdminResult<Record<string, unknown>>> {
  if (!isUuid(id) || typeof version !== "number") return fail(400, "Torneo o versión inválidos");
  const { data } = await sb.from("cups").select(CUP_COLS).eq("id", id).maybeSingle();
  const c = data as unknown as CupRow | null;
  if (!c) return fail(404, "Torneo no encontrado");
  // El panel avisa con detalle; la BD vuelve a decidir (fechas, reglas, versión, que sea borrador).
  const pre = validateCupDraft({ slug: c.slug, name: c.name, description: c.description, rules: c.rules, registrationOpenAt: c.registration_open_at, registrationCloseAt: c.registration_close_at, startsAt: c.starts_at, minParticipants: c.min_participants, maxParticipants: c.max_participants, roundWindowMinutes: c.round_window_minutes, visibility: c.visibility as "PUBLIC" | "UNLISTED" }, now, { forPublish: true });
  if (!pre.ok) return fail(409, pre.errors.map((e) => e.message).join(" · "));
  const r = await rpcCode(sb, "cup_admin_publish", { p_actor: actor, p_cup: c.id, p_version: version });
  if (r.ok) console.info(`[admin] cup_published ${c.slug} actor=${actor.slice(0, 8)}`);
  return r;
}

export async function cancelCup(sb: SupabaseClient, actor: string, id: unknown, reason: unknown, confirm: unknown): Promise<AdminResult<Record<string, unknown>>> {
  if (!isUuid(id)) return fail(400, "Torneo inválido");
  const r = await rpcCode(sb, "cup_admin_cancel", { p_actor: actor, p_cup: id, p_reason: typeof reason === "string" ? reason : null, p_confirm: typeof confirm === "string" ? confirm : null });
  if (r.ok) console.info(`[admin] cup_cancelled ${String(id).slice(0, 8)} actor=${actor.slice(0, 8)}`);
  return r;
}

export async function generateCup(sb: SupabaseClient, actor: string, id: unknown): Promise<AdminResult<Record<string, unknown>>> {
  if (!isUuid(id)) return fail(400, "Torneo inválido");
  const r = await rpcCode(sb, "cup_generate", { p_cup: id, p_actor: actor });
  if (!r.ok) return r;
  const code = String(r.data.code ?? "");
  if (code === "REGISTRATION_OPEN") return fail(409, "La inscripción sigue abierta: el cuadro se genera al cerrarse");
  if (code === "NOT_PUBLISHED") return fail(409, "Solo se genera el cuadro de un torneo publicado");
  if (code === "CANCELLED") return fail(409, "El torneo está cancelado");
  if (code === "NOT_FOUND") return fail(404, "Torneo no encontrado");
  return r;
}

export async function resolveCupMatch(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<Record<string, unknown>>> {
  if (!isUuid(body.id)) return fail(400, "Torneo inválido");
  const round = Number(body.round), slot = Number(body.slot);
  if (!Number.isInteger(round) || !Number.isInteger(slot)) return fail(400, "Cruce inválido");
  if (body.decision !== "A" && body.decision !== "B" && body.decision !== "NONE") return fail(400, "Decisión inválida");
  const { data } = await sb.from("cup_matches").select("id").eq("cup_id", body.id).eq("round", round).eq("slot", slot).maybeSingle();
  if (!data) return fail(404, "Cruce no encontrado");
  const confirm = typeof body.confirm === "string" ? body.confirm : "";
  // El #TAG se normaliza (mayúsculas, «#» opcional); la BD lo vuelve a comparar con el tag real de quien avanza.
  const normalized = body.decision === "NONE" ? confirm : (normalizeTag(confirm) ? formatTag(normalizeTag(confirm)!) : confirm);
  const r = await rpcCode(sb, "cup_admin_resolve", { p_actor: actor, p_match: (data as { id: string }).id, p_decision: body.decision, p_reason: typeof body.reason === "string" ? body.reason : null, p_confirm: normalized });
  if (r.ok) console.info(`[admin] cup_match_resolved ${round}:${slot} ${String(body.decision)} actor=${actor.slice(0, 8)}`);
  return r;
}

type H = (req: Request) => Promise<NextResponse>;

/** `/api/admin/cups` — GET: lista · ?id= ficha · POST { action, … } (create · update · preview · publish · cancel · generate · resolve). */
export function cupsAdminHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = new URL(req.url).searchParams.get("id");
      return id !== null ? respond(await cupDetail(sb, id)) : respond(await listCups(sb));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "id", "version", "fields", "reason", "confirm", "round", "slot", "decision"]);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.fields !== undefined) {
        if (!b.fields || typeof b.fields !== "object" || Array.isArray(b.fields)) return json({ error: "Campos inválidos" }, 400);
        const extra = Object.keys(b.fields).find((k) => !(CUP_DRAFT_KEYS as readonly string[]).includes(k));
        if (extra) return json({ error: `Campo no permitido: ${extra.slice(0, 40)}` }, 400);
      }
      switch (b.action) {
        case "preview": return respond(previewCup(b.fields));
        case "create": return respond(await createCup(sb, userId, b.fields));
        case "update": return respond(await updateCup(sb, userId, b.id, b.version, b.fields));
        case "publish": return respond(await publishCup(sb, userId, b.id, b.version));
        case "cancel": return respond(await cancelCup(sb, userId, b.id, b.reason, b.confirm));
        case "generate": return respond(await generateCup(sb, userId, b.id));
        case "resolve": return respond(await resolveCupMatch(sb, userId, b));
        default: return json({ error: "Acción desconocida" }, 400);
      }
    }),
  };
}

export { SLUG as CUP_SLUG };
