# FASE 35.1 · Postflight

Sin secretos: solo estructura, conteos y códigos de resultado.

## Backup (antes de la primera escritura)

| Campo | Valor |
|---|---|
| UTC | 2026-09-15T11:54:55Z (duración 1 s) |
| Ruta | `/opt/nexus/backups/supabase-drlcards/pre-0046-0051/backup_pre_0046_0051_20260915T115455Z.dump` (+ `.sha256`, permisos 600, dir 700) |
| Formato | `pg_dump -Fc` desde `supabase_db_DRLCards` |
| Tamaño | 2.113.830 bytes |
| sha256 | `c7e5dbf1fb521891144ea02f7d7850df2514af64b95d95441bc95a96e6fcb530` · `sha256sum -c` OK |
| `pg_restore -l` | **PASS** · 1698 entradas (pre-0045: 1697) · TABLE DATA de profiles/duel_matches/telemetry_events/user_cards presentes |
| Backups antiguos | intactos (no se borró ni limpió nada) |

## Objetos finales

| Área | Objeto | Estado |
|---|---|---|
| Telemetría | `telemetry_events_flow_check` (13 flows, cerrado, validado) | PRESENT · VERIFIED |
| PvP | `duel_pvp_ratings_ladder_idx`, `duel_matches_pvp_a_recent_idx`, `duel_matches_pvp_b_recent_idx` | PRESENT · VERIFIED |
| Social | `profiles.last_seen_at`, `duel_friendships`, `duel_challenges`, 9 índices, trigger `duel_friendships_touch` | PRESENT · VERIFIED |
| Social | 11 RPC `social_*` + `_duel_pvp_has_active_match`, `duel_pvp_expired_candidates`, `duel_pvp_expire_turn` (con `PVP_PRIVATE`, semántica 0035) | PRESENT · VERIFIED |
| Duelos | `duel_matches_mode_check` (PVE, PVP, PVP_PRIVATE), `duel_matches_mode_shape` | PRESENT · VERIFIED |
| Perfil | `player_profile_customization` (6 CHECK), `player_profile_set`, `_uuid_array_is_unique`, `_text_array_is_unique` | PRESENT · VERIFIED |
| Equipo activo | `duel_active_deck` (PK user, único deck, FK cascade), `duel_deck_activate` | PRESENT · VERIFIED |
| Campaña | `campaign_progress` (PK usuario/campaña/nodo, 9 CHECK), `campaign_attempts` (`match_id` único, `one_open`, `first_clear_once`, 7 CHECK) | PRESENT · VERIFIED |
| Registro | `supabase_migrations.schema_migrations` | SIN CAMBIOS (25 filas, 0025) — no se falsificó historial |

## Seguridad tras migrar

- 6 tablas nuevas: `relrowsecurity = true`, 0 políticas, **ningún** grant a anon/authenticated/PUBLIC; `service_role` con todos los privilegios.
- 18 funciones: 16 SECURITY DEFINER, todas propiedad de `postgres`, con `search_path=public`, EXECUTE solo `postgres` + `service_role`; los 2 ayudantes puros (`_*_array_is_unique`) no son SECURITY DEFINER y también solo `service_role`.
- Las RPC con `p_user` no las puede llamar un cliente (42501 verificado): el `userId` solo lo pone el servidor desde el token.
- 17 índices nuevos: `indisvalid` e `indisready` = true. 0 restricciones sin validar en `public`.
- Hallazgos PREEXISTENTES (no tocados, P2): `profiles` concede SELECT a nivel tabla a anon/authenticated (la nueva `last_seen_at` también es legible por REST) y TRUNCATE/DELETE a nivel tabla.

## Probes transaccionales (siempre `BEGIN … ROLLBACK`, usuarios sintéticos `…0000000f35xx`)

| Bloque | Resultado |
|---|---|
| 0046 · 13 flows válidos admitidos, flow inventado rechazado | 13/13 + 1/1 · filas después: 642 |
| 0048 · amistad canónica, duplicados, estados, retos, PVP_PRIVATE, no liquidación ranked, permisos | 19/19 + permisos |
| 0049 · TOO_MANY, DUPLICATE, NOT_OWNED, SAVED, UNCHANGED, CONFLICT, LOCKED, BAD_USER, CHECK directo, permisos | 9/9 + permisos |
| **Total 0048 + 0049** | **34 PASS / 0 FAIL** |
| 0050 · activar propio, uno por usuario, ajeno NOT_FOUND, versión CONFLICT/OK, únicos, cascada sin inventar | 9/9 |
| 0051 · progreso único, estados, COMPLETED⇔fecha, wins≤attempts, node_id, un intento abierto, match_id único, liquidación condicional 1→0 filas, primera victoria única, reward sin first_clear rechazado, FK set null, permisos, app_grant_reward no ejecutable por cliente, 0 movimiento de créditos | 26/26 |
| **Total 0050 + 0051** | **35 PASS / 0 FAIL** |

Conteos tras cada bloque de probes idénticos a los previos (usuarios 9, perfiles 9, cartas 100, créditos 47, partidas 5, mazos 1, tablas nuevas 0). `app_grant_reward` **no** se ejecutó sobre ningún usuario.

## Conteos antes / después

| Tabla | Antes (11:54Z) | Después (12:04Z y final) |
|---|---|---|
| profiles | 9 | 9 |
| auth.users | 9 | 9 |
| duel_matches | 5 | 5 |
| duel_decks | 1 | 1 |
| user_cards | 100 | 100 |
| user_pass | 3 | 3 |
| user_achievements | 4 | 4 |
| duel_pvp_ratings | 1 | 1 |
| duel_pvp_rating_events | 0 | 0 |
| telemetry_events | 642 | 642 |
| credit_transactions | 47 | 47 |
| user_packs | 22 | 22 |
| tablas nuevas (6) | — | 0 filas cada una |

## Salud

- `supabase_db_DRLCards` healthy; `pg_isready` accepting connections; REST (`:54521/rest/v1/`) 200; 0 locks bloqueados.
- Log de Postgres desde 11:50Z: un único ERROR, el del primer ensayo con el envoltorio mal entrecomillado (11:56:22Z), sin efecto.
- `edge_runtime` y `vector` (DRLCards y sportcoach) en bucle de reinicio **antes y después**: estado previo, no causado ni tocado.
- Worker de esports: crontab intacto; ejecuciones posteriores con `exit=0`.
- No se reinició, recreó ni actualizó ningún contenedor.

## Tests locales (sin túnel a la BD: ninguna suite tocó producción)

| Gate | Resultado |
|---|---|
| `npm test` | 2111/2111 · exit 0 |
| `tsc --noEmit` (web) | 0 |
| `tsc -p tsconfig.scripts.json` | 0 |
| `next build` | exit 0 |
| ESLint (ficheros cambiados) | 0 |
| pack · security · content · distribution · competitive · importer-vlr · combat · deck · social · replay | 42/0 · 201/0 · 21/0 · 30/0 · 27/0 · 69/0 · 5/0 · 34/0 · 33/0 · 25/0 |
| season · season-time · season-pass · season-security · season-recap | 21/0 · 4/0 · 4/0 · 4/0 · 4/0 |
| campaign · campaign-content · campaign-security · campaign-economy | 33/0 · 9/0 · 13/0 · 11/0 |
| Suites que requieren BD de pruebas aislada | **NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA** |
