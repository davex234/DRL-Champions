# FASE 35.1 — DATABASE INTEGRATION GATE (0046 → 0051)

Fecha: 2026-09-15 · BD: VPS `212.95.40.144`, contenedor `supabase_db_DRLCards`, base `postgres`, esquema `public` · Sin deploy, sin commit, sin push.
Evidencia detallada: `docs/product/qa/fase35-1/{preflight,migration-matrix,postflight,rollback-plan}.md`.

## Resultado

**GO.** Las seis migraciones están **APPLIED + VERIFIED**, cada una en su transacción, con backup verificado previo, sin pérdida de datos, RLS/grants correctos, 69 probes transaccionales en verde (todas con ROLLBACK), 2111/2111 tests y todos los verificadores en verde. Ninguna bloqueada, ninguna parcial. `schema_migrations` no se falsificó. Las funciones desbloqueadas quedan **DATABASE READY**; ninguna está «live» porque la app no está desplegada contra esta BD en esta fase.

## Línea temporal (UTC)

| Hora | Paso |
|---|---|
| 11:53:30 | Identidad del host y contenedores (solo lectura) |
| 11:54:06 | Identidad de BD, inventario, preflight de datos, conteos base (solo lectura) |
| 11:54:55 | **Backup** `pre-0046-0051/backup_pre_0046_0051_20260915T115455Z.dump` · 2.113.830 B · `pg_restore -l` 1698 · sha256 OK |
| — | Corrección local de 0048 (`duel_pvp_expire_turn`) y endurecimiento de 0049 |
| 11:56 | Ensayo completo 0046–0051 en una transacción con **ROLLBACK** · exit 0 · estado previo confirmado |
| 11:57:37 | 0046 aplicada (1016 ms) + verificación + probe |
| 11:57:38 | 0047 aplicada (677 ms) + verificación |
| 11:58:24 | 0048 aplicada (1193 ms) + verificación |
| 11:59:00 | 0049 aplicada (647 ms) + verificación |
| 12:00:10 | 0050 aplicada (1210 ms) + verificación |
| 12:02:13 | 0051 aplicada (1177 ms) + verificación |
| 12:03–12:04 | Probes 0048/0049 (34/34) y 0050/0051 (35/35), seguridad, conteos, salud |
| 12:18:20 | Comprobación final: salud, conteos, contrato del servicio de campaña |

## Bugs reales encontrados y corregidos (antes de aplicar)

1. **0048 regresaba el cierre por tiempo del PvP ranked.** Su `duel_pvp_expire_turn` decidía NOT_DUE/LOST_RACE por `state_version`; la función viva (0035) lo decide por «sigue abierta y el plazo no vence». Corregido en el fichero local: cuerpo idéntico al vivo, solo cambia `mode in ('PVP','PVP_PRIVATE')`. Verificado en la BD tras aplicar.
2. **0049 dejaba RPC públicas innecesarias.** Los privilegios por defecto de `public` dan EXECUTE a anon/authenticated; los dos ayudantes de unicidad no se revocaban. Corregido: solo `service_role`.

## Diferencias

- **Código ↔ BD:** coinciden tablas, columnas, estados, índices y RPC que usan `services/campaign.ts`, `deckTeams.ts`, social y perfil (comprobado columna a columna para campaña). `FLOWS` del código sigue en 4 aunque la BD admite 13: los flows nuevos siguen siendo no-op hasta un cambio de código (no hecho: sin cambios de producto).
- **Brief ↔ código:** la tabla de equipo activo es `duel_active_deck` (singular), no `duel_active_decks`. El flujo de Match Experience usa `duel_play` (no existe `match_experience`).
- **Informe FASE 35 ↔ código:** sin discrepancias en 0051 (tablas, estados, índices, recompensas 50/100/200, total 1.350, empate no completa). La afirmación «0051 no aplicada» deja de ser cierta y se corrigió en cabeceras y contratos.

## Archivos locales modificados

- `supabase/migrations/0048_social_friends_private_duels.sql` (corrección de `duel_pvp_expire_turn`; cabecera APLICADA)
- `supabase/migrations/0049_player_profile_customization.sql` (revoke de ayudantes; cabecera APLICADA)
- `supabase/migrations/0046_…sql`, `0047_…sql`, `0050_…sql`, `0051_…sql` (solo cabecera y línea de estado: APLICADA)
- Contratos que fijaban «NO APLICADA» → fijan la cabecera aplicada: `src/domain/campaign/campaign.contract.test.ts`, `src/domain/deckBuilder/deckBuilder.contract.test.ts`, `src/domain/liveEvents/liveEvents.contract.test.ts`, `src/domain/profile/profile.contract.test.ts`, `src/domain/progression/meta.contract.test.ts`, `src/domain/pvpLadder/competitive.contract.test.ts`, `src/domain/season/season.contract.test.ts`, `src/domain/social/social.contract.test.ts`, `src/lib/duel/experience.contract.test.ts`, `scripts/campaign-verify.ts`
- Nuevos: `docs/product/qa/fase35-1/{preflight,migration-matrix,postflight,rollback-plan}.md`, este informe.

## Infraestructura no tocada

Sin Docker local. En el VPS solo `docker exec` sobre el Postgres existente y `pg_dump`/`pg_restore -l` hacia el directorio de backups nuevo. No se tocó: cron del worker, worker de Pick'ems/esports, autosync, importer VLR, Caddy, Cloudflare, Kong, Auth, Storage, Realtime, vector, edge runtime, firewall, SSH, compose, contenedores (sin restart/up/down/pull/rebuild), backups antiguos. Sin deploy de Next.js. Marketplace OFF (`GLOBAL_MARKET_ENABLED = false`).

## P2 restantes

1. Abrir `FLOWS` (13) en el código en un cambio aparte para que la telemetría de las fases 27–35 deje de ser no-op.
2. Registro de migraciones: decidir cómo reflejar 0026–0051 en `schema_migrations` sin falsificar (hoy 0001–0025).
3. `profiles` concede SELECT/TRUNCATE/DELETE a nivel tabla a anon/authenticated (preexistente): `last_seen_at` legible por REST; revisar grants por columnas.
4. `duel_matches_pvp_a_recent_idx` solapa parcialmente con `duel_matches_user_recent_idx` (tablas diminutas hoy; revisar con volumen).
5. `edge_runtime` y `vector` en bucle de reinicio en ambos stacks (previo a esta fase).
6. Suites que requieren BD de pruebas aislada: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
7. Desplegar/conectar la app a esta BD para pasar de DATABASE READY a producto vivo (fuera de alcance).
