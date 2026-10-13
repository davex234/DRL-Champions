/**
 * CUERPO ESTRICTO DE `/api/game/duels` (Fase 32). PURO.
 *
 * Cada acción declara sus claves; una clave desconocida, un UUID mal formado o una carta que no es un
 * UUID ⇒ 400. Antes, las cartas no-UUID se descartaban en silencio: ahora se rechazan. El usuario NUNCA
 * viaja en el cuerpo: sale del token en la ruta.
 */
import { DUEL_DECK_SIZE } from "@/domain/cardgame";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** La versión es el `updated_at` exacto que devolvió el servidor (marca de tiempo ISO con zona). */
export const VERSION_RE = /^\d{4}-\d{2}-\d{2}T\d{2}.\d{2}.\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}.?\d{2})$/;

export type DeckRequest =
  | { action: "save"; id?: string; name: string; cardUids: string[] }
  | { action: "save_composition"; id: string; name: string; cardUids: string[]; expectedVersion: string }
  | { action: "create"; name: string | null; cardUids: string[] }
  | { action: "rename"; id: string; name: string; expectedVersion: string }
  | { action: "duplicate"; id: string }
  | { action: "delete"; id: string; expectedVersion: string | null; confirmActive: boolean }
  | { action: "set_active"; id: string; expectedVersion: string | null };

export type DeckAction = DeckRequest["action"];

export const DECK_SCHEMA: Record<DeckAction, { allowed: readonly string[]; required: readonly string[] }> = {
  save: { allowed: ["action", "id", "name", "cardUids"], required: ["action", "name", "cardUids"] },
  save_composition: { allowed: ["action", "id", "name", "cardUids", "baseVersion"], required: ["action", "id", "name", "cardUids", "baseVersion"] },
  create: { allowed: ["action", "name", "cardUids"], required: ["action"] },
  rename: { allowed: ["action", "id", "name", "baseVersion"], required: ["action", "id", "name", "baseVersion"] },
  duplicate: { allowed: ["action", "id"], required: ["action", "id"] },
  delete: { allowed: ["action", "id", "baseVersion", "confirmActive"], required: ["action", "id"] },
  set_active: { allowed: ["action", "id", "baseVersion"], required: ["action", "id"] },
};

export type ParsedRequest = { ok: true; req: DeckRequest } | { ok: false; error: string; code: "BAD_REQUEST" };

const bad = (error: string): ParsedRequest => ({ ok: false, error, code: "BAD_REQUEST" });

function parseUids(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > DUEL_DECK_SIZE) return null;
  return v.every((u) => typeof u === "string" && UUID_RE.test(u)) ? (v as string[]).map((u) => u.toLowerCase()) : null;
}

/** `null`/ausente ⇒ sin versión; cadena válida ⇒ la versión; cualquier otra cosa ⇒ `undefined` (inválida). */
function parseVersion(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === "string" && v.length <= 40 && VERSION_RE.test(v) ? v : undefined;
}

export function parseDeckRequest(body: unknown): ParsedRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Cuerpo no válido");
  const b = body as Record<string, unknown>;
  const action = b.action;
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(DECK_SCHEMA, action)) return bad("Acción inválida");
  const schema = DECK_SCHEMA[action as DeckAction];
  const extra = Object.keys(b).find((k) => !schema.allowed.includes(k));
  if (extra) return bad("Campo no permitido");
  const missing = schema.required.find((k) => b[k] === undefined);
  if (missing) return bad(`Falta el campo: ${missing}`);

  let id: string | undefined;
  if (b.id !== undefined) {
    if (typeof b.id !== "string" || !UUID_RE.test(b.id)) return bad("Equipo no válido");
    id = b.id.toLowerCase();
  }
  let name: string | undefined;
  if (b.name !== undefined) {
    if (typeof b.name !== "string" || b.name.length > 200) return bad("Nombre de equipo no válido");
    name = b.name;
  }
  let cards: string[] | undefined;
  if (b.cardUids !== undefined) {
    const parsed = parseUids(b.cardUids);
    if (!parsed) return bad("Cartas no válidas");
    cards = parsed;
  }
  // En el cable se llama `baseVersion` (la versión sobre la que se editó); dentro, `expectedVersion`.
  const expected = parseVersion(b.baseVersion);
  if (expected === undefined) return bad("Versión no válida");
  if (b.confirmActive !== undefined && typeof b.confirmActive !== "boolean") return bad("Confirmación no válida");

  switch (action as DeckAction) {
    case "save":
      return { ok: true, req: { action: "save", id, name: name!, cardUids: cards! } };
    case "save_composition":
      if (!expected) return bad("Versión no válida");
      return { ok: true, req: { action: "save_composition", id: id!, name: name!, cardUids: cards!, expectedVersion: expected } };
    case "create":
      return { ok: true, req: { action: "create", name: name ?? null, cardUids: cards ?? [] } };
    case "rename":
      if (!expected) return bad("Versión no válida");
      return { ok: true, req: { action: "rename", id: id!, name: name!, expectedVersion: expected } };
    case "duplicate":
      return { ok: true, req: { action: "duplicate", id: id! } };
    case "delete":
      return { ok: true, req: { action: "delete", id: id!, expectedVersion: expected, confirmActive: b.confirmActive === true } };
    case "set_active":
      return { ok: true, req: { action: "set_active", id: id!, expectedVersion: expected } };
  }
}
