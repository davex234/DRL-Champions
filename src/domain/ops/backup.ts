/**
 * PRE-F70 · ESTADO DE BACKUPS — la lectura PURA de `scripts/ops/backup-status.sh` y el veredicto off-site que usa
 * `npm run production:check -- --vps`. Una sola fuente para la regla; el script de shell solo recoge hechos.
 *
 * Semántica del off-site (honesta por construcción: nunca un PASS sin una copia REMOTA VERIFICADA reciente):
 *   · NOT_CONFIGURED  no hay configuración off-site en el VPS                         → FAIL (bloqueo externo)
 *   · DISABLED        hay configuración pero DRL_OFFSITE_ENABLED≠1                    → FAIL
 *   · NEVER_VERIFIED  activado, pero ninguna unidad tiene OFFSITE_VERIFIED            → FAIL
 *   · STALE           la última copia verificada tiene más de `maxAgeH` horas         → FAIL
 *   · LAST_RUN_FAILED hay una verificada reciente, pero el ÚLTIMO envío falló         → WARN (alertable, no ciego)
 *   · OK              copia remota verificada (leída de vuelta y comparada) reciente   → PASS
 * `REMOTE_VERIFIED`/`OFFSITE_VERIFIED` solo existen tras descargar la copia y comparar su sha256: un upload que
 * «devolvió 0» no basta. La readiness del juego (`/api/ready`) NO depende de nada de esto.
 */

export type OffsiteConfig = "NOT_CONFIGURED" | "DISABLED" | "ENABLED";
export type OffsiteCode = "NOT_CONFIGURED" | "DISABLED" | "NEVER_VERIFIED" | "STALE" | "LAST_RUN_FAILED" | "OK";

export interface BackupStatus {
  dailyAgeH: number;
  storageAgeH: number;
  verifiedPath: string;
  verifiedAgeH: number;
  verifiedCount: number;
  sumsOk: boolean;
  offsiteConfig: OffsiteConfig;
  offsiteVerifiedUnit: string | null;
  offsiteVerifiedAgeH: number | null;
  offsiteLastRun: string;
}

/** Máximo de horas de la última copia off-site verificada: backup diario (24 h) + holgura de ejecución. */
export const OFFSITE_MAX_AGE_H = 26;

const num = (s: string | undefined, dflt: number) => { const n = Number((s ?? "").trim()); return s !== undefined && s.trim() !== "" && Number.isFinite(n) ? n : dflt; };

export function parseBackupStatus(out: string): BackupStatus {
  const v = (k: string): string | undefined => { const m = out.match(new RegExp(`^${k}(?: (.*))?$`, "m")); return m ? (m[1] ?? "") : undefined; };
  const cfg = (v("OFFSITE_CONFIG") ?? "").trim();
  const off = (v("OFFSITE_VERIFIED") ?? "").trim().split(/\s+/).filter(Boolean);
  const unitOk = !!off[0] && /^\d{8}T\d{6}Z$/.test(off[0]);
  return {
    dailyAgeH: num(v("DAILY"), 9999),
    storageAgeH: num(v("STORAGE"), 9999),
    verifiedPath: (v("VERIFIED") ?? "").trim(),
    verifiedAgeH: num(v("VERIFIED_AGE_H"), 9999),
    verifiedCount: num(v("VERIFIED_COUNT"), 0),
    sumsOk: /^SUMS_OK 1$/m.test(out),
    offsiteConfig: cfg === "ENABLED" || cfg === "DISABLED" ? cfg : "NOT_CONFIGURED",
    offsiteVerifiedUnit: unitOk ? off[0] : null,
    offsiteVerifiedAgeH: unitOk ? num(off[1], 9999) : null,
    offsiteLastRun: (v("OFFSITE_LAST_RUN") ?? "").trim(),
  };
}

export function offsiteVerdict(s: BackupStatus, maxAgeH = OFFSITE_MAX_AGE_H): { level: "PASS" | "WARN" | "FAIL"; code: OffsiteCode; detail: string } {
  if (s.offsiteConfig === "NOT_CONFIGURED") return { level: "FAIL", code: "NOT_CONFIGURED", detail: "OFFSITE BACKUP NOT CONFIGURED: las copias viven en el MISMO disco del VPS (BLOCKED externo: falta destino + credenciales)" };
  if (s.offsiteConfig === "DISABLED") return { level: "FAIL", code: "DISABLED", detail: "configuración off-site presente pero DESACTIVADA (DRL_OFFSITE_ENABLED≠1)" };
  if (!s.offsiteVerifiedUnit || s.offsiteVerifiedAgeH === null) return { level: "FAIL", code: "NEVER_VERIFIED", detail: `activado, pero ninguna unidad tiene copia remota VERIFICADA${s.offsiteLastRun ? ` · último envío: ${s.offsiteLastRun}` : ""}` };
  if (s.offsiteVerifiedAgeH > maxAgeH) return { level: "FAIL", code: "STALE", detail: `última copia off-site verificada ${s.offsiteVerifiedUnit} hace ${s.offsiteVerifiedAgeH} h (máximo ${maxAgeH} h)` };
  if (/^failed /.test(s.offsiteLastRun)) return { level: "WARN", code: "LAST_RUN_FAILED", detail: `hay copia verificada reciente (${s.offsiteVerifiedUnit}, ${s.offsiteVerifiedAgeH} h) pero el ÚLTIMO envío falló: ${s.offsiteLastRun}` };
  return { level: "PASS", code: "OK", detail: `copia off-site verificada ${s.offsiteVerifiedUnit} hace ${s.offsiteVerifiedAgeH} h (leída de vuelta y comparada)` };
}
