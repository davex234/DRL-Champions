/**
 * IMPORT ENGINE — orquesta el flujo ÚNICO: Parse → Normalize → Validate.
 *
 * PURO salvo lo inyectado en `ctx` (reloj, identidad). No hace red: recibe un `RawSnapshot` ya
 * obtenido (en Fase 2 lo traerá un `ImportProvider`). Acumula issues; `ok` = sin errores.
 */
import { parseSnapshot } from "./parse";
import { normalizeSnapshot } from "./normalize";
import { validateModel } from "./validate";
import type { RawSnapshot, ImportCtx, ImportResult } from "./types";
import type { ImportProvider } from "./provider/types";

/** Importa un snapshot crudo → modelo canónico validado. Determinista. */
export function importSnapshot(raw: RawSnapshot, ctx: ImportCtx): ImportResult {
  const parsed = parseSnapshot(raw);
  const { model, issues: normIssues } = normalizeSnapshot(parsed.snapshot, ctx);
  const issues = [...parsed.issues, ...normIssues, ...validateModel(model)];
  return { ok: !issues.some((i) => i.severity === "error"), model, issues };
}

/** Envoltura para Fase 2: obtiene el snapshot del provider y lo importa. (No se usa en Fase 1.) */
export async function importFromProvider(provider: ImportProvider, tournamentId: string, ctx: ImportCtx): Promise<ImportResult> {
  const raw = await provider.fetchTournament(tournamentId);
  return importSnapshot(raw, ctx);
}
