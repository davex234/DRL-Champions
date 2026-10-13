# FASE 36.1 · Evidencia de base de datos (VPS real, sin PII)

`supabase_db_DRLCards` · consultas de lectura con `docker exec … psql` salvo las marcadas como escritura. Ids truncados.

## 1. Sondas de semántica RPC (usuario sintético `…0f3611`, BEGIN … ROLLBACK)

| # | acción | esperado | real | ok |
|---|---|---|---|---|
| 1 | alta (`handle_new_user`) | sobres RECIBIDOS, 0 abiertos | user_game=0 · owned=4 · ops_open=0 | ✓ |
| 2 | `app_buy_pack` | +1 poseído, +0 abiertos | user_game=0 · owned=5 | ✓ |
| 3 | misma compra otra vez (misma clave) | ni sobre ni apertura | user_game=0 · owned=5 | ✓ |
| 4 | `app_grant_pack(2)` | +0 abiertos | user_game=0 | ✓ |
| 5 | `app_grant_reward(pack)` | +0 abiertos | user_game=0 · owned=8 | ✓ |
| 6 | `app_apply_pack_open` | +1 abierto, −1 poseído, +1 `open_pack` | user_game=1 · owned=7 · ops_open=1 | ✓ |
| 7 | misma apertura (misma clave) | +0, resultado `repeated` | user_game=1 · owned=7 · repeated=true | ✓ |
| 8 | 3 aperturas más (claves distintas) | +3 (total 4) | user_game=4 · ops_open=4 | ✓ |
| 9 | abrir sin sobres | rechazo, +0 | `P0001 No tienes ese sobre` · user_game=4 | ✓ |
| 10 | contador = nº `open_pack` | igual | 4 = 4 | ✓ |
| 11 | fuente antigua tras 4 aperturas | sigue 0 | profiles=0 | ✓ |
| 12 | `economy_ops.ref` | clave primaria | sí | ✓ |

Antes/después de la sonda: `auth.users` 10/10 · `economy_ops` 37/37 · Σ`user_game` 22/22. `dblink` no instalado (concurrencia real
entre sesiones argumentada por `for update` + PK, no sondeada).

## 2. Sonda del rebase (misma SQL que el apply, terminando en ROLLBACK)

Dentro de la transacción: QA `d-abrir-1` y `w-sobres-10` → baseline 5, `metricVersion` 2; las 4 caducadas intactas. Tras el
ROLLBACK: las 6 misiones seguían con baseline 0 y sin versión.

## 3. Escritura real (única)

| hecho | valor |
|---|---|
| Backup previo | `pre-0036-1/backup_pre_0036_1_20260915T170811Z.dump` · 2.183.117 B · sha256 `dc51571b…a3e` OK · `pg_restore -l` 1796 |
| Exportación del plan | 17:06:42Z (`clock_timestamp()` del servidor) |
| Apply | COMMIT 17:13:44Z · guardas de deriva OK · 1 fila · 2 misiones verificadas |
| Postflight | QA `d-abrir-1` y `w-sobres-10`: baseline 5 · v2 · claimed=false. 9137ee57 y b2663c09: baseline 0 · sin versión (caducadas) |
| Resto sin cambios | md5 de misiones no-sobres `7581b331…`, XP/misiones completadas por usuario idénticas, libro mayor 52 filas, Σ`user_packs` 33, Σ`user_game` 22, `schema_migrations` 25 (0025) |

Aperturas de la cuenta QA frente a la asignación de sus misiones: **5 antes / 0 después** (13:19:29–13:20:27Z frente a 13:21:50Z).

## 4. E2E real con la cuenta QA (app local → API → BD)

| momento | user_game | `open_pack` | `buy_pack` | user_packs | d-abrir-1 (baseline/v/claimed) | créditos | libro mayor | `mission_reward` | user_cards |
|---|---|---|---|---|---|---|---|---|---|
| antes (17:19:00) | 5 | 5 | 1 | estandar=0 | 5 / 2 / false | 5540 | 5 filas | 0 | 25 |
| tras COMPRAR (17:19:28) | **5** | 5 | **2** | estandar=**1** | 5 / 2 / false | **4790** | 6 (+`buy_pack:estandar`) | 0 | 25 |
| tras ABRIR (17:19:59) | **6** | **6** | 2 | estandar=**0** | 5 / 2 / false | 4790 | 6 | **0** | **30** |

Progreso derivado (servidor): antes 0/1 y 0/10 · tras comprar 0/1 y 0/10 · tras abrir **1/1** (pendiente de recoger) y **1/10** ·
tras recargar igual. Otros usuarios: libro mayor 47 → 47 · Σ`user_game` 17 → 17.
