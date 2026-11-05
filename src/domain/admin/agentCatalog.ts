/**
 * F59.1 · SALUD DEL CATÁLOGO DE AGENTES DE ESPORTS — compara el ESTADO REAL de `public.agents` con el canónico.
 *
 * Por qué existe: la sonda de esquema de 0055 (`app_admin_schema_probe`) no sabe nada de 0056, y la constante
 * `MIGRATION_HEAD` es sólo lo que dice el código. Sin esto, crear 0056 en el repo pintaba «Cabeza 0056» en verde
 * aunque no se hubiera aplicado. Aquí manda la BD: Miks (controller), Veto (sentinel) y los 29 ids/roles.
 *
 * Puro: recibe las filas leídas; `overview.ts` hace la lectura.
 */
import type { HealthLevel } from "./packAdmin";

export interface AgentRow { id: string; name?: string | null; role: string }

export interface AgentCatalogHealth {
  level: HealthLevel;
  detail: string;
  /** Marcador de 0056 aplicada de verdad: Miks controller y Veto sentinel, una fila cada uno. */
  applied0056: boolean;
  missing: string[];
  extra: string[];
  roleMismatch: { id: string; db: string; expected: string }[];
}

export function agentCatalogHealth(rows: AgentRow[] | null, canonical: readonly AgentRow[]): AgentCatalogHealth {
  if (!rows) return { level: "WARNING", detail: "No se pudo leer public.agents", applied0056: false, missing: [], extra: [], roleMismatch: [] };
  const one = (id: string, role: string) => rows.filter((r) => r.id === id).length === 1 && rows.find((r) => r.id === id)!.role === role;
  const applied0056 = one("miks", "controller") && one("veto", "sentinel");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const canon = new Set(canonical.map((a) => a.id));
  const missing = canonical.filter((a) => !byId.has(a.id)).map((a) => a.id);
  const extra = rows.filter((r) => !canon.has(r.id)).map((r) => r.id).sort();
  const roleMismatch = canonical.filter((a) => byId.has(a.id) && byId.get(a.id)!.role !== a.role).map((a) => ({ id: a.id, db: byId.get(a.id)!.role, expected: a.role }));
  const dup = rows.length !== byId.size;
  const ok = !missing.length && !extra.length && !roleMismatch.length && !dup && applied0056;
  const parts = [
    missing.length ? `faltan ${missing.join(", ")}` : "",
    extra.length ? `sobran ${extra.join(", ")}` : "",
    roleMismatch.length ? `rol distinto: ${roleMismatch.map((m) => `${m.id} ${m.db}≠${m.expected}`).join(", ")}` : "",
    dup ? "ids duplicados" : "",
  ].filter(Boolean);
  return {
    level: ok ? "HEALTHY" : "CRITICAL",
    detail: ok ? `${rows.length} agentes en BD = ${canonical.length} canónicos (Miks controller, Veto sentinel)` : `${rows.length} en BD / ${canonical.length} canónicos · ${parts.join(" · ") || "0056 sin aplicar"}`,
    applied0056, missing, extra, roleMismatch,
  };
}
