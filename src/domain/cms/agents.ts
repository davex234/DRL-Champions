/**
 * F60 · AGENTES — reglas puras del gestor de agentes (/admin/agents). Las mismas que aplica la RPC de 0057 (segunda red),
 * aquí para dar el error EN EL FORMULARIO antes de mandar nada y para que las pruebas las fijen.
 */
import { isLegacyAgentId, type AbilitySlot, type TacticalRole } from "@/domain/tactics/roster";
import { ns } from "@/i18n/runtime";

const t = ns("admin");

export const AGENT_ROLES: readonly TacticalRole[] = ["duelist", "initiator", "controller", "sentinel"];
export const ABILITY_SLOTS: readonly AbilitySlot[] = ["C", "Q", "E", "X"];
export type AgentLifecycle = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface AgentDraftInput {
  id?: string;
  name?: string;
  role?: string;
  code?: string;
  abilities?: { slot: string; name: string }[];
}

export type FieldErrors = Partial<Record<"id" | "name" | "role" | "code" | "abilities", string>>;

/** El id canónico: minúsculas y cifras, 2–24 (el mismo slug que usa VLR: «kayo», «gekko»). */
export const AGENT_ID = /^[a-z0-9]{2,24}$/;
export const AGENT_CODE = /^[A-Z0-9/]{2,4}$/;

/** Código por defecto: tres primeras letras del nombre (la regla con la que se generó el roster). */
export const defaultAgentCode = (name: string): string => name.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();

/** Id sugerido a partir del nombre («KAY/O» → «kayo»). */
export const suggestAgentId = (name: string): string => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);

/**
 * Valida el borrador. `creating` exige id (nuevo, formato, no reservado por el legado). Los textos se recortan y no se
 * interpretan: React los pinta como texto, nunca como HTML.
 */
export function validateAgentDraft(input: AgentDraftInput, opts: { creating: boolean; existingIds?: ReadonlySet<string> }): FieldErrors {
  const e: FieldErrors = {};
  if (opts.creating) {
    const id = input.id ?? "";
    if (!AGENT_ID.test(id)) e.id = t("Id: minúsculas y cifras, de 2 a 24 (p. ej. «kayo»)");
    else if (isLegacyAgentId(id)) e.id = t("Ese id pertenece a un agente del modelo anterior");
    else if (opts.existingIds?.has(id)) e.id = t("Ya existe un agente con ese id");
  }
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (n.length < 2 || n.length > 24) e.name = t("Nombre de 2 a 24 caracteres");
    else if (/[<>]/.test(n)) e.name = t("El nombre no puede contener < ni >");
  } else if (opts.creating) e.name = t("El nombre es obligatorio");
  if (input.role !== undefined) {
    if (!(AGENT_ROLES as string[]).includes(input.role)) e.role = t("Rol: duelista, iniciador, controlador o centinela");
  } else if (opts.creating) e.role = t("El rol es obligatorio");
  if (input.code !== undefined && input.code !== "" && !AGENT_CODE.test(input.code)) e.code = t("Código de 2 a 4 mayúsculas o cifras");
  if (input.abilities !== undefined) {
    const ab = input.abilities;
    if (!Array.isArray(ab) || ab.length !== 4) e.abilities = t("Cuatro habilidades: C, Q, E y X");
    else if (ab.some((a, i) => a.slot !== ABILITY_SLOTS[i])) e.abilities = t("Las habilidades van en orden C, Q, E, X");
    else if (ab.some((a) => typeof a.name !== "string" || a.name.trim().length < 2 || a.name.trim().length > 48 || /[<>]/.test(a.name))) {
      e.abilities = t("Cada habilidad necesita un nombre de 2 a 48 caracteres");
    }
  }
  return e;
}

export interface AgentRecord {
  id: string; name: string; role: string; code: string | null; abilities: { slot: string; name: string }[];
  lifecycle: AgentLifecycle; origin: "seed" | "admin"; faceAssetId: string | null; fullAssetId: string | null; version: number;
}

/** Lista de lo que falta para PUBLICAR (la RPC comprueba lo mismo; aquí se enseña antes). */
export function agentPublishChecklist(a: AgentRecord): { key: string; label: string; ok: boolean }[] {
  const needsArt = a.origin === "admin";
  return [
    { key: "name", label: t("Nombre"), ok: a.name.trim().length >= 2 },
    { key: "role", label: t("Rol"), ok: (AGENT_ROLES as string[]).includes(a.role) },
    { key: "code", label: t("Código de ficha"), ok: !!a.code && AGENT_CODE.test(a.code) },
    { key: "abilities", label: t("Cuatro habilidades C/Q/E/X"), ok: a.abilities.length === 4 && a.abilities.every((x, i) => x.slot === ABILITY_SLOTS[i] && x.name.trim().length >= 2) },
    { key: "face", label: t("Cara (retrato)"), ok: !needsArt || !!a.faceAssetId },
    { key: "full", label: t("Cuerpo entero"), ok: !needsArt || !!a.fullAssetId },
  ];
}

/** Transiciones permitidas (las mismas que la RPC). */
export const AGENT_TRANSITIONS: Record<AgentLifecycle, AgentLifecycle[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["RETIRED"],
  RETIRED: ["PUBLISHED"],
};
