# FASE 37.1 — Collection Favorites · Database Activation

Estado: **0052 APLICADA en el VPS** (2026-09-15 19:32:53–54Z) con backup verificado, ensayo transaccional, sondas de seguridad, postflight y E2E real de favoritos. Sin deploy, sin commit, sin push. `schema_migrations` intacta. Marketplace sigue OFF.

Evidencia detallada: `docs/product/qa/fase37-1/` (`01-preflight` … `08-rollback`, capturas `01…10`, `regression/`).

## Secuencia
1. **Baseline local** (antes de tocar el VPS): `npm test` 2468/2468; `collection` 53 ✓ · `collection-room` 53 ✓ · `collection-content` 23 ✓ · `collection-security` 21 ✓ · `collection-performance` 9 ✓.
2. **Contrato SQL ↔ código** revisado sobre los ficheros reales: coincide (PK para idempotencia, CHECK de formato, lectura propia para `authenticated`, escrituras solo del servidor con service_role, tope 200). **Bug corregido antes de aplicar**: el disparador del tope contaba sin cerrojo (carrera 199+199 → 201) → `pg_advisory_xact_lock` por usuario + `search_path = pg_catalog, public`.
3. **Identidad**: VPS `nexusadmin@212.95.40.144` (host `VM-4b2a…`), contenedor `supabase_db_DRLCards` healthy, `postgres/public/postgres`, PostgreSQL 17.6, no en recuperación.
4. **Precheck**: 0052 totalmente ausente (tabla, políticas, disparador, función, índices, restricciones), sin estado parcial; `schema_migrations` 25 filas (máx. 0025). Privilegios por defecto de `public` dan `arwdDxtm` a anon/authenticated para tablas nuevas → 0052 los revoca (verificado).
5. **Backup**: `/opt/nexus/backups/supabase-drlcards/pre-0052/supabase-drlcards-pre0052-20260915T193049Z.dump` · 2 184 596 bytes · sha256 `6c7ebb5a…0013d` · `sha256sum -c` OK · `pg_restore -l` 1 796 entradas.
6. **Rollback** documentado antes de aplicar (DROP trigger → función → tabla; 0 favoritos reales que perder).
7. **Ensayo** BEGIN → 0052 → sondas → ROLLBACK: primer intento cortado por un fallo de la propia sonda (`text || "char"`), sin residuos; segundo intento PASS y todo ausente tras ROLLBACK.
8. **Seguridad** (usuarios sintéticos, BEGIN … ROLLBACK): A lee solo lo suyo · A no puede insertar/actualizar/borrar (tampoco para B) · anon sin acceso · PUBLIC sin privilegios · 199 → 200 permitido → 201 `P0001 FAVORITES_LIMIT` · duplicado 23505 (1 fila) · borrar repetido 0 filas sin error · CHECK/FK/cascada correctos.
9. **Apply** en una transacción con `ON_ERROR_STOP`: exit 0, COMMIT, 0 filas.
10. **Postflight**: esquema, restricciones, índices, disparador, RLS, política y grants idénticos al fichero; sondas de seguridad repetidas sobre la tabla real → PASS.
11. **Huella** PRE vs POST: solo cambian los objetos de 0052; todos los datos (usuarios, cartas, créditos, sobres, contador, pase, equipos, logros, partidas, rating, vitrina, campaña) idénticos.
12. **Salud**: `pg_isready` OK, postmaster sin reinicio desde 2026-09-12, DB/Auth/Kong healthy y REST up; `pgrst_ddl_watch` recarga el esquema de PostgREST sin reinicios.
13. **E2E real** (Chrome → app local → API → servidor → BD del VPS, cuenta QA `8c326e52…`): 34/34 PASS — marcar → BD 1 → recarga persiste → duplicado por API sigue 1 → filtro Favoritas muestra exactamente la carta → quitar → BD 0 → recarga confirma → quitar repetido 0 → carta no poseída favorita y desmarcada sin crear propiedad ni serial (`user_cards` 30 → 30) → huella QA idéntica.
14. **Regresión** (smoke de la Fase 37, solo lectura): Collection, búsqueda, filtros/URL, ficha, seriales, giro, Compare, sets, uso en equipos, vitrina (lectura), no poseída, id inválido, anónimo y contador de sobres (Meta y perfil = 6) → OK; 0 errores de consola. Huella global tras E2E + regresión = POST (0 cambios de datos).

## Cambios de código
- `supabase/migrations/0052_collection_favorites.sql`: cerrojo consultivo en el disparador + `search_path` endurecido (**antes** del ensayo y del apply); cabecera «APLICADA (VPS 2026-09-15 19:32Z, Fase 37.1)» con la ruta del backup (**después**, solo comentario, igual que 0051).
- `src/components/collectionRoom/collectionRoom.contract.test.tsx`: el pin de 0052 pasa de «PENDIENTE» a «APLICADA» y exige el cerrojo, `search_path` y ausencia de SECURITY DEFINER.
- `src/server/services/collection.service.test.ts`: +4 tests (persistencia, quitar repetido, 409 desde el disparador de BD, favorita no poseída sin propiedad).
- `scripts/_fase37-1-favorites-e2e.ts` (nuevo instrumento `_`); `scripts/_fase37-live-smoke.ts`: salida configurable (`SMOKE_OUT`).
- Sin cambios en la app, la API, la UI ni en ningún otro sistema. Sin 0053.

## Gates finales (túnel cerrado, app parada)
| gate | resultado |
|---|---|
| `npm test` | **2472 / 2472** (baseline 2468 + 4) |
| `tsc` web · `tsc` scripts · `next build` | 0 · 0 · OK |
| eslint (ficheros tocados en 37.1) | 0 problemas |
| security 201 · pack 42 · content 21 · distribution 30 · importer-vlr 69 · combat 5 · deck 34 · social 33 · replay 25 · competitive 27 | OK |
| season 21 · season-time 4 · season-pass 4 · season-security 4 · season-recap 4 | OK |
| campaign 33 · campaign-security 13 · campaign-economy 11 · campaign-content 9 | OK |
| daily-loop 47 · daily-loop-priority 22 · daily-loop-security 25 | OK |
| pack-objective 31 · pack-objective-rebase 11 · pack-objective-security 8 | OK |
| collection (Core Engine + 53) · collection-room 53 · collection-content 23 · collection-security 21 · collection-performance 9 | OK |
| suites destructivas de BD | NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA |

Confirmación final solo lectura en el VPS: tabla presente, 0 filas, 1 política, 1 disparador, función con cerrojo, `schema_migrations` 25 filas.

**GO.**

## P2 restantes
- `schema_migrations` sigue sin registrar 0026–0052 (fuera de alcance, histórico).
- Concurrencia del tope probada por diseño (cerrojo) y por el mapeo 409, no con dos sesiones simultáneas reales.
- Sin política de escritura para clientes a propósito: si algún día el cliente escribiera directo, haría falta `WITH CHECK (auth.uid() = user_id)`.
- Cara canónica de carta con stats de origen (heredado de la Fase 37).
- RLS/PostgREST contra BD aislada y suites destructivas: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
