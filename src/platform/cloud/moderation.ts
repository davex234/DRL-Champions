/**
 * MODERATION ENGINE (Online Fase 7/7).
 *
 * Reports → acciones (mute/kick/ban/suspension) con caducidad por reloj lógico → appeals → resolución.
 * + moderación de contenido (filtro determinista de texto). Toda acción exige rol autorizado
 * (referee/moderator/admin). Determinista, sin estados imposibles (una sanción activa no expira antes
 * de emitirse; un appeal solo sobre una sanción existente).
 */
import { idFrom, hasRank, type Principal } from "./types";

export type SanctionType = "mute" | "kick" | "ban" | "suspension";
export type ReportReason = "cheating" | "toxicity" | "griefing" | "afk" | "smurfing" | "other";

export interface Report { id: string; reporter: string; target: string; reason: ReportReason; note: string; at: number; resolved: boolean }

export interface Sanction {
  id: string; type: SanctionType; target: string; by: string; reason: ReportReason;
  issuedAt: number; expiresAt: number | null; // null = permanente
  reverted: boolean; reportId: string | null;
}

export type AppealStatus = "pending" | "upheld" | "overturned";
export interface Appeal { id: string; sanctionId: string; by: string; note: string; at: number; status: AppealStatus }

export class ModerationEngine {
  private reports = new Map<string, Report>();
  private sanctions = new Map<string, Sanction>();
  private appeals = new Map<string, Appeal>();
  private seq = 0;

  /** Cualquier jugador puede reportar. */
  report(reporter: string, target: string, reason: ReportReason, note: string, at: number): Report {
    const r: Report = { id: idFrom("rep", reporter, target, this.seq++), reporter, target, reason, note, at, resolved: false };
    this.reports.set(r.id, r);
    return r;
  }

  /** Emite una sanción (autorizada). `duration` en ticks (null = permanente). */
  sanction(by: Principal, target: string, type: SanctionType, reason: ReportReason, at: number, duration: number | null, reportId: string | null = null): Sanction | null {
    if (!hasRank(by.role, "referee")) return null;                 // autorización
    if (type === "ban" && !hasRank(by.role, "moderator")) return null; // ban exige moderador+
    const s: Sanction = {
      id: idFrom("san", target, type, this.seq++), type, target, by: by.id, reason,
      issuedAt: at, expiresAt: duration == null ? null : at + Math.max(1, duration),
      reverted: false, reportId,
    };
    this.sanctions.set(s.id, s);
    if (reportId) { const r = this.reports.get(reportId); if (r) r.resolved = true; }
    return s;
  }

  /** ¿Está el usuario sancionado (de un tipo) y activo en `now`? */
  isActive(target: string, type: SanctionType, now: number): boolean {
    return [...this.sanctions.values()].some((s) =>
      s.target === target && s.type === type && !s.reverted && (s.expiresAt == null || s.expiresAt > now));
  }
  activeSanctions(target: string, now: number): Sanction[] {
    return [...this.sanctions.values()].filter((s) => s.target === target && !s.reverted && (s.expiresAt == null || s.expiresAt > now));
  }

  /** El sancionado apela. */
  appeal(sanctionId: string, by: string, note: string, at: number): Appeal | null {
    const s = this.sanctions.get(sanctionId);
    if (!s || s.target !== by) return null;         // solo el sancionado apela su sanción
    const a: Appeal = { id: idFrom("app", sanctionId, this.seq++), sanctionId, by, note, at, status: "pending" };
    this.appeals.set(a.id, a);
    return a;
  }

  /** Resuelve un appeal (autorizado). `overturn` revierte la sanción. */
  resolveAppeal(by: Principal, appealId: string, overturn: boolean): boolean {
    if (!hasRank(by.role, "moderator")) return false;
    const a = this.appeals.get(appealId);
    if (!a || a.status !== "pending") return false;
    a.status = overturn ? "overturned" : "upheld";
    if (overturn) { const s = this.sanctions.get(a.sanctionId); if (s) s.reverted = true; }
    return true;
  }

  // ── Moderación de contenido (filtro determinista) ──
  private banned = ["slur1", "slur2"]; // marcadores; el catálogo real se inyecta en producción
  setWordlist(words: string[]): void { this.banned = words.map((w) => w.toLowerCase()); }
  filterContent(text: string): { clean: string; flagged: boolean } {
    let flagged = false;
    const clean = text.split(/(\s+)/).map((tok) => {
      if (this.banned.includes(tok.toLowerCase())) { flagged = true; return "*".repeat(tok.length); }
      return tok;
    }).join("");
    return { clean, flagged };
  }

  openReports(): Report[] { return [...this.reports.values()].filter((r) => !r.resolved); }
  pendingAppeals(): Appeal[] { return [...this.appeals.values()].filter((a) => a.status === "pending"); }
  sanction_(id: string): Sanction | null { return this.sanctions.get(id) ?? null; }
}
