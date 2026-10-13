# FASE 36.1 — PACK OBJECTIVE COUNTER REBASE

Fecha: 2026-09-15 · Sin deploy, sin commit, sin push, sin Docker local, sin migración 0052 · Marketplace OFF.
Evidencia: `docs/product/qa/fase36-1/` (`preflight.md`, `counter-contract.md`, `rebase-matrix.md`, `db-evidence.md`,
`economy-safety.md`, `real-smoke.md`, `rollback-plan.md`, capturas `01`–`06`).

## Resultado

**GO.** Las misiones de sobres miden por fin sobres ABIERTOS de verdad, sin regalar progreso ni quitar lo ganado:

COMPRAR = +0 · RECIBIR = +0 · POSEER = +0 · ABRIR = +1 · REINTENTAR LA MISMA APERTURA = +0 (probado contra Postgres y en E2E real).

## Bug

`loadFacts` leía `packs_opened` de `profiles.packs_opened`, que ningún camino del servidor incrementa (0 en los 10 perfiles
reales; un trigger impide escribirlo al cliente). Las aperturas reales van a `user_game.packs_opened` dentro de
`app_apply_pack_open`. Consecuencia: «Abre un sobre» y «Abre 10 sobres» no avanzaban nunca online; los logros de sobres tampoco.

Cadena real: abrir → `app_apply_pack_open` (clave `economy_ops.ref` → consumir sobre `for update` → cartas → `user_game.packs_opened + 1` → fila `economy_ops` `open_pack`) → `loadFacts.metrics.packs_opened` → `missionProgress = valor − baseline` (acotado) → completa → reclamo explícito en `/logros` (`claimMission`, clave `mission:<temporada>:<id>:<assignedAt>:<baseline>`) → recompensa por `grantRewards`.

## Solución

1. **Fuente canónica** `user_game.packs_opened` (monótona, idéntica al nº de `economy_ops open_pack` en la BD real: 22 = 22).
2. **Versión mínima de la baseline** dentro del jsonb del pase: `ActiveMission.metricVersion`. Sin campo = baseline de la fuente
   antigua → se mide con `packs_opened@legacy` (nunca con la nueva). `2` = vigente. Misiones nuevas y reinicios de repetibles nacen en `2`.
3. **Rebase conservador explícito** (función pura `rebaseMission`): `baseline = contador vigente − progreso visible legacy`.
   Reclamadas y caducadas no se tocan. Nunca desde un GET.
4. **Aplicación** con preflight de solo lectura, plan determinista, backup verificado, sonda con ROLLBACK, COMMIT con guardas de
   deriva y postflight.

## Estado real y exposición

6 misiones de sobres (3 usuarios), todas baseline 0, ninguna completa ni reclamada. 2 vivas (cuenta QA, cuyas 5 aperturas fueron
ANTERIORES a la asignación) y 4 caducadas. Sin rebase, cambiar la fuente completaba `d-abrir-1` de la cuenta QA: **200 créditos +
150 XP del pase no ganados**, 6 unidades de progreso regaladas. Con rebase: 0.

## Escritura en la BD

Una transacción (COMMIT 17:13:44Z): QA `d-abrir-1` y `w-sobres-10` → baseline 5, `metricVersion` 2. Backup
`pre-0036-1/backup_pre_0036_1_20260915T170811Z.dump` (2.183.117 B, sha256 `dc51571b…`, `pg_restore -l` 1796). Libro mayor,
sobres, XP, resto de misiones y `schema_migrations` sin cambios. Rollback quirúrgico documentado.

## E2E real

Objetivos 0/1 · 0/10 → comprar (−750 créditos QA) → 0/1 · 0/10 → abrir en `/abrir/estandar` → **1/1 pendiente de recoger** ·
**1/10** → recargar: persiste. BD: user_game 5 → 5 → 6 · `open_pack` 5 → 5 → 6 · `mission_reward` 0 · otros usuarios intactos.

## Gates (túnel cerrado)

| gate | resultado |
|---|---|
| `npm test` | **2316 / 2316** (base 2270 · +46 nuevos) |
| typecheck web / scripts · ESLint | 0 · 0 · 0 |
| `next build` | exit 0 |
| security · pack · content · competitive · importer-vlr (69/69) · combat · deck · social · replay | pasan |
| distribution · season (21/4/4/4/4) · campaign (33/13/11/9) · daily-loop (47/22/25) | 0 ✗ |
| **pack-objective · pack-objective-rebase · pack-objective-security** (nuevos) | 31 · 11 · 8 ✓ / 0 ✗ |
| RLS / PostgREST reales | NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA (semántica RPC probada con sondas ROLLBACK en el VPS) |

## Archivos

- Nuevos: `src/battlepass/metricRebase.ts`, `src/battlepass/metricRebase.test.ts`, `src/server/services/progressionRebase.ts`,
  `src/server/services/packCounter.service.test.ts`, `scripts/pack-objective-verify.ts`, `scripts/_fase36-1-pack-rebase.ts`,
  `scripts/_fase36-1-pack-e2e.ts`, `docs/product/qa/fase36-1/*`, este informe.
- Modificados: `src/battlepass/types.ts` (`metricVersion`), `src/battlepass/missions.ts` (versión de fuente, `metricValue`,
  `assignMission`, `rebaselineForRepeat`), `src/battlepass/engine.ts` (reinicio de repetibles), `src/server/services/progression.ts`
  (`loadFacts`), `package.json` (3 verificadores), `docs/product/fase-36-daily-game-loop-2-report.md` (P1 cerrado).

## P2

1. `getMetaSnapshot` (`account.packsOpened`, FTUE del Meta Hub) y `playerIdentity` siguen mostrando `profiles.packs_opened` (0): solo
   presentación, sin progreso ni recompensas.
2. Concurrencia entre sesiones de la misma apertura argumentada por `for update` + PK de `economy_ops.ref` (sin `dblink` para sondearla).
3. Las 4 misiones caducadas de 9137ee57 y b2663c09 rotarán a v2 en su próxima lectura de `getProgression` (lectura con escritura
   preexistente, fuera de alcance).
4. `schema_migrations` sigue sin reflejar 0026–0051.
5. `d-abrir-1` de la cuenta QA queda pendiente de recoger (ganada con una apertura real); no se reclamó.
