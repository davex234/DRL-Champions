/**
 * PRE-F70 · BACKUP OFF-SITE — veredicto de production:check (puro) y contratos de los scripts de ops.
 * La lógica de transferencia/verificación se prueba DE VERDAD en el arnés del VPS (scripts/ops/offsite-harness.sh,
 * evidencia en docs/product/qa/pre-f70-offsite-backup/); aquí se fija lo que no debe volver a romperse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBackupStatus, offsiteVerdict, OFFSITE_MAX_AGE_H, type BackupStatus } from "./backup";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const TODAY = [
  "DAILY 7", "STORAGE 7", "DAILY_COUNT 15", "VERIFIED /opt/nexus/backups/supabase-drlcards/pre-0058/20260928T115532Z/",
  "VERIFIED_AGE_H 3", "VERIFIED_COUNT 3", "SUMS_OK 1", "LOGFAILS 1", "LAST [x] fin. fallos=0", "FREE_MB 471000", "BACKUPS_MB 80",
].join("\n");
const status = (extra: string) => parseBackupStatus(`${TODAY}\n${extra}`);

test("PRE-F70 offsite · SIN configuración (hoy): FAIL NOT_CONFIGURED — nunca un falso verde", () => {
  const s = status("OFFSITE_CONFIG NOT_CONFIGURED\nOFFSITE_VERIFIED \nOFFSITE_LAST_RUN ");
  const v = offsiteVerdict(s);
  assert.equal(v.level, "FAIL"); assert.equal(v.code, "NOT_CONFIGURED");
  assert.match(v.detail, /OFFSITE BACKUP NOT CONFIGURED/);
});

test("PRE-F70 offsite · salida antigua o vacía del script (sin líneas OFFSITE_*) también es NOT_CONFIGURED", () => {
  assert.equal(offsiteVerdict(parseBackupStatus(TODAY)).code, "NOT_CONFIGURED");
  assert.equal(offsiteVerdict(parseBackupStatus("")).code, "NOT_CONFIGURED");
});

test("PRE-F70 offsite · configuración presente pero desactivada: FAIL DISABLED", () => {
  assert.deepEqual(offsiteVerdict(status("OFFSITE_CONFIG DISABLED")).code, "DISABLED");
});

test("PRE-F70 offsite · activado sin ninguna copia remota verificada: FAIL NEVER_VERIFIED (un upload que devolvió 0 no cuenta)", () => {
  const v = offsiteVerdict(status("OFFSITE_CONFIG ENABLED\nOFFSITE_VERIFIED \nOFFSITE_LAST_RUN failed 20260929T051000Z 2026-09-29T05:11:02Z verify"));
  assert.equal(v.level, "FAIL"); assert.equal(v.code, "NEVER_VERIFIED"); assert.match(v.detail, /verify/);
});

test("PRE-F70 offsite · copia verificada reciente: PASS; más vieja que el máximo: FAIL STALE", () => {
  const ok = offsiteVerdict(status("OFFSITE_CONFIG ENABLED\nOFFSITE_VERIFIED 20260929T051000Z 2\nOFFSITE_LAST_RUN verified 20260929T051000Z 2026-09-29T05:12:00Z"));
  assert.equal(ok.level, "PASS"); assert.equal(ok.code, "OK");
  const stale = offsiteVerdict(status(`OFFSITE_CONFIG ENABLED\nOFFSITE_VERIFIED 20260920T051000Z ${OFFSITE_MAX_AGE_H + 1}`));
  assert.equal(stale.level, "FAIL"); assert.equal(stale.code, "STALE");
  assert.equal(offsiteVerdict(status(`OFFSITE_CONFIG ENABLED\nOFFSITE_VERIFIED 20260929T051000Z ${OFFSITE_MAX_AGE_H}`)).level, "PASS", "el límite es inclusivo");
});

test("PRE-F70 offsite · hay verificada reciente pero el ÚLTIMO envío falló: WARN (alertable, no oculto)", () => {
  const v = offsiteVerdict(status("OFFSITE_CONFIG ENABLED\nOFFSITE_VERIFIED 20260929T051000Z 5\nOFFSITE_LAST_RUN failed 20260929T101000Z 2026-09-29T10:11:00Z upload"));
  assert.equal(v.level, "WARN"); assert.equal(v.code, "LAST_RUN_FAILED");
});

test("PRE-F70 offsite · identificadores basura no cuentan como unidad verificada", () => {
  const s: BackupStatus = status("OFFSITE_CONFIG ENABLED\nOFFSITE_VERIFIED ../../etc 1");
  assert.equal(s.offsiteVerifiedUnit, null);
  assert.equal(offsiteVerdict(s).code, "NEVER_VERIFIED");
});

test("PRE-F70 backup-status · parseo de lo local: edad, recuento y SHA256SUMS", () => {
  const s = parseBackupStatus(TODAY);
  assert.equal(s.verifiedAgeH, 3); assert.equal(s.verifiedCount, 3); assert.equal(s.sumsOk, true); assert.equal(s.dailyAgeH, 7);
  assert.match(s.verifiedPath, /pre-0058/);
});

test("PRE-F70 production:check · el off-site sale de offsiteVerdict (sin FAIL fijo en el código) y lee backup-status.sh", () => {
  const pc = read("scripts/ops/production-check.ts");
  assert.match(pc, /const off = offsiteVerdict\(bs\);/);
  // F70 · en modo público (DRL_PUBLIC_RELEASE=1) un off-site no verificado BLOQUEA; en local, el veredicto tal cual.
  assert.match(pc, /add\("backup-offsite", (isPublic && off\.code !== "OK" \? "FAIL" : )?off\.level/);
  assert.ok(!/add\("backup-offsite", "FAIL"/.test(pc), "sin veredicto fijo");
  const st = read("scripts/ops/backup-status.sh");
  assert.match(st, /OFFSITE_CONFIG NOT_CONFIGURED/);
  assert.ok(!/cat "\$cfg"|source "\$cfg"|\. "\$cfg"/.test(st), "backup-status no vuelca la configuración");
});

test("PRE-F70 /api/ready NO depende del off-site (una caída del proveedor no tumba el juego)", () => {
  const h = read("src/server/ops/health.ts");
  assert.ok(!/offsite|backup/i.test(h));
});

test("PRE-F70 backup-offsite.sh · seguridad: sin source/eval, imagen fijada por digest, cifrado CMS, marcador el ÚLTIMO", () => {
  const s = read("scripts/ops/backup-offsite.sh");
  assert.ok(!/^\s*(source|\.|eval)\s/m.test(s), "la configuración se parsea, no se ejecuta");
  assert.match(s, /DEFAULT_IMAGE="rclone\/rclone@sha256:[0-9a-f]{64}"/);
  assert.match(s, /@sha256:\[0-9a-f\]\{64\}\$ \]\] \|\| cfg_fail/, "no se acepta una etiqueta mutable");
  assert.match(s, /openssl cms -encrypt -binary -stream -aes-256-gcm/);
  assert.match(s, /FTP sin TLS no está permitido/); assert.match(s, /http:\/\/\) no permitido/); assert.match(s, /sftp exige known_hosts_file/);
  // Orden: subida → verificación leyendo de vuelta → marcador remoto → verificación del marcador → registro local.
  const iUp = s.indexOf('STAGE="upload"'), iVer = s.indexOf('STAGE="verify"\n    verify_remote "$TS" "$CMS_SHA" 0'), iMark = s.indexOf('STAGE="marker"'), iVm = s.indexOf('STAGE="verify-marker"'), iRec = s.indexOf('STAGE="record"');
  assert.ok(iUp > 0 && iUp < iVer && iVer < iMark && iMark < iVm && iVm < iRec, "REMOTE_VERIFIED solo tras verificar");
  assert.match(s, /rc copy "\$\(remote_path "\$ts"\)" "\/work\/verify-\$ts"/, "la verificación DESCARGA la copia");
  // Solo unidades COMPLETE, con SHA256SUMS válido, sin enlaces, dentro de la raíz.
  for (const m of ["la unidad no está COMPLETE", "SHA256SUMS no cuadra", "la unidad contiene enlaces o directorios", "la unidad está fuera de", "fichero ajeno a SHA256SUMS"]) assert.ok(s.includes(m), m);
  // Por defecto el VPS NO borra en el destino (credencial sin borrado posible; retención del proveedor).
  assert.match(s, /DRL_OFFSITE_RETENTION="provider"/);
  // Los ganchos de fallo solo existen con el destino de PRUEBA montado.
  assert.match(s, /fault\(\) \{ \[ -n "\$TEST_REMOTE_DIR\$TEST_REMOTE_TMPFS" \] && \[ "\$TEST_FAULT" = "\$1" \]; \}/);
});

test("PRE-F70 backup-drlcards.sh · un solo flujo: candado, retención local desactivada por defecto, off-site tras BACKUP_OK", () => {
  const s = read("scripts/ops/backup-drlcards.sh");
  assert.match(s, /flock -n 9 \|\| \{ echo "\[backup-drlcards\] otra copia en curso \(candado ocupado\)"; exit 75; \}/);
  assert.match(s, /LOCAL_KEEP="\$\{LOCAL_KEEP:-0\}"/, "hoy no borra nada");
  const iOk = s.indexOf('echo "BACKUP_OK $OUT"'), iOff = s.indexOf("# 6 · Off-site");
  assert.ok(iOk > 0 && iOff > iOk, "el off-site va DESPUÉS de una unidad local COMPLETE");
  assert.match(s, /echo "OFFSITE_NOT_CONFIGURED"/);
  assert.match(s, /exit 3/, "local OK + off-site KO → código distinto (alertable)");
  assert.match(s, /DRL_BACKUP_LOCK_HELD=1/, "el paso off-site hereda el candado (sin deadlock)");
});
