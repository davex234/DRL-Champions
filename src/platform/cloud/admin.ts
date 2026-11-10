/**
 * ADMIN TOOLS · AUDIT (Online Fase 7/7).
 *
 * Autorización por rol + registro de AUDITORÍA inmutable para toda acción administrativa (live /
 * tournament / spectator / content). NO reimplementa la administración del Tournament (pause/DQ/
 * walkover ya viven en el Tournament Engine): esta capa AUTORIZA, DELEGA y AUDITA de forma uniforme.
 * Determinista (ids/hash encadenado sobre reloj lógico).
 */
import { fnv1a, idFrom, hasRank, type Principal, type PlatformRole } from "./types";

export type AdminAction =
  | "match.force_end" | "match.pause" | "match.resume" | "match.kick_spectator"
  | "tournament.pause" | "tournament.resume" | "tournament.disqualify" | "tournament.walkover" | "tournament.reseed"
  | "spectator.mute" | "spectator.remove" | "content.takedown"
  | "role.grant" | "role.revoke";

/** Rol mínimo requerido por acción. */
const MIN_ROLE: Record<AdminAction, PlatformRole> = {
  "match.force_end": "referee", "match.pause": "referee", "match.resume": "referee", "match.kick_spectator": "moderator",
  "tournament.pause": "referee", "tournament.resume": "referee", "tournament.disqualify": "admin",
  "tournament.walkover": "referee", "tournament.reseed": "admin",
  "spectator.mute": "moderator", "spectator.remove": "moderator", "content.takedown": "moderator",
  "role.grant": "admin", "role.revoke": "admin",
};

export interface AuditEntry {
  id: string; seq: number; action: AdminAction; by: string; role: PlatformRole;
  target: string; at: number; ok: boolean; reason: string; prevHash: string; hash: string;
}

/** Registro de auditoría con hash encadenado (tamper-evident, determinista). */
export class AuditLog {
  private entries: AuditEntry[] = [];
  private last = "GENESIS";
  append(action: AdminAction, by: Principal, target: string, at: number, ok: boolean, reason = ""): AuditEntry {
    const seq = this.entries.length;
    const body = `${seq}|${action}|${by.id}|${target}|${at}|${ok}|${this.last}`;
    const hash = fnv1a(body).toString(36);
    const e: AuditEntry = { id: idFrom("audit", seq), seq, action, by: by.id, role: by.role, target, at, ok, reason, prevHash: this.last, hash };
    this.entries.push(e); this.last = hash;
    return e;
  }
  /** Verifica la cadena de hashes (detecta manipulación). */
  verify(): boolean {
    let prev = "GENESIS";
    for (const e of this.entries) {
      const body = `${e.seq}|${e.action}|${e.by}|${e.target}|${e.at}|${e.ok}|${prev}`;
      if (e.prevHash !== prev || e.hash !== fnv1a(body).toString(36)) return false;
      prev = e.hash;
    }
    return true;
  }
  all(): AuditEntry[] { return this.entries.slice(); }
  count(): number { return this.entries.length; }
}

export interface AdminResult { ok: boolean; reason: string; audit: AuditEntry }

/** Fachada administrativa uniforme: autoriza → (delega, hecho por el caller) → audita. */
export class AdminTools {
  readonly audit = new AuditLog();
  /** Autoriza y audita una acción. El caller ejecuta el efecto real solo si `ok`. */
  authorize(action: AdminAction, by: Principal, target: string, at: number): AdminResult {
    const min = MIN_ROLE[action];
    const ok = hasRank(by.role, min);
    const reason = ok ? "" : `requiere ${min}`;
    const audit = this.audit.append(action, by, target, at, ok, reason);
    return { ok, reason, audit };
  }
}
