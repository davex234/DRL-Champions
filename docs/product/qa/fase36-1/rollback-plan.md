# FASE 36.1 · Plan de rollback

## Backup previo a la escritura

| campo | valor |
|---|---|
| Fichero | `/opt/nexus/backups/supabase-drlcards/pre-0036-1/backup_pre_0036_1_20260915T170811Z.dump` |
| Formato | `pg_dump -Fc` desde `supabase_db_DRLCards` (base `postgres` completa) |
| Tamaño | 2.183.117 B |
| sha256 | `dc51571b9ee7fccb64faa85ab4e73fb81c9b4538d03910698d4f9d98f7911a3e` · `sha256sum -c` OK |
| `pg_restore -l` | 1796 entradas · TABLE DATA de `user_pass` y `user_game` presentes |

## Qué se escribió

UNA transacción (COMMIT 17:13:44Z): dos elementos del array `missions` de `user_pass.state` de la cuenta QA 8c326e52
(`d-abrir-1` y `w-sobres-10`, `assignedAt` 1789478510200): `baseline` 0 → 5 y `metricVersion` = 2. Nada más.

## Rollback de datos (quirúrgico, preferido)

`f361_rollback.sql` (scratchpad de la sesión; reproducido aquí sin cambios de lógica):

1. En una transacción, devuelve esos dos elementos a `baseline` 0 y quita `metricVersion`, SOLO si siguen exactamente en el estado
   rebaseado (id, `assignedAt`, baseline 5, v2).
2. Aborta si no se actualiza exactamente una fila o si no quedan las dos misiones legacy.
3. Si alguna ya cambió (reclamada, rotada o reiniciada por un reclamo), NO se fuerza: se decide a mano con el backup.

Efecto del rollback: con el código de 36.1, las dos misiones vuelven a medirse con la fuente antigua (0 de progreso, sin regalo).

## Rollback de código

El código es local y no está desplegado. Revertir `src/battlepass/{types,missions,engine}.ts` y `src/server/services/progression.ts`
devuelve la métrica a `profiles.packs_opened`; las filas rebaseadas se medirían `0 − 5 → 0` (sin regalo, sin error).

## Restauración completa (solo emergencia real)

`pg_restore` del backup a una base temporal (`restore_check`), comparar y copiar filas concretas. No se restaura sobre la base viva
salvo emergencia real. No se ha ejecutado.
