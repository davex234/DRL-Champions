# FASE 35.2 · Evidencia de base de datos (BD real del VPS, sin PII)

Consultas de solo lectura con `docker exec supabase_db_DRLCards psql` (ninguna escritura desde consola). Ids truncados a 8 caracteres. Cuenta QA = `QA-8c326e52`.

## Target

| Comprobación | Resultado |
|---|---|
| Config local | `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521` (solo host; claves ni mostradas ni copiadas) |
| Túnel | `ssh -N -L 54521:127.0.0.1:54521 -L 54522:127.0.0.1:54522` a `212.95.40.144` |
| Identidad | REST 200; GoTrue v2.196.0; `campaign_progress` existe (anon → 42501, no 404/PGRST205) |
| Stack | `supabase_db_DRLCards` (no sportcoach) |

## Línea base de la cuenta QA (13:23:54 UTC, antes de jugar)

| Campo | Valor |
|---|---|
| is_admin | false |
| credits | 5250 |
| user_cards | 25 (4 sobres de bienvenida + 1 sobre estándar) |
| equipo activo | 1 (`49ec83a7` «Equipo 1», 10 cartas, 2 por rol, READY_FOR_DUEL) |
| campaign_progress / campaign_attempts | 0 / 0 |
| duel_matches | 0 |
| duel_pvp_ratings | 1 (1000, 0 partidas; creada 13:21:50 por `loop.ts → ensureRating` al leer meta, comportamiento preexistente) |

## Cronología de intentos y partidas

| Intento | Nodo | Estado | result | first_clear | reward_granted | partida | Estado partida | winner |
|---|---|---|---|---|---|---|---|---|
| `02f84d32` | c1-n1 | SETTLED | WIN | **t** | **t** | `c22067c0` | COMPLETED (PVE, EASY, duel-combat-2, rival NAVI) | A |
| `d7dabceb` | c1-n1 | SETTLED | WIN | f | f | `ec074e24` | COMPLETED (PVE, EASY) — rejugar, lanzado con doble clic | A |
| `172cf8d4` | c1-n2 | ABANDONED | — | f | f | null (partida borrada por `abandon`) | — | — |

- Enlace real: `campaign_attempts.match_id` → `duel_matches.id`. Al borrarse la partida, la FK dejó `match_id = null` (0051).
- Doble clic en la UI: exactamente un intento y una partida.
- Dos pestañas (dos `start` en paralelo sobre c1-n2): 1 × 200 + 1 × 409 `ACTIVE_ATTEMPT` (índice `campaign_attempts_one_open`).
- Intentos STARTED al final (cualquier usuario): **0**.

## Progreso

| Momento | c1-n1 | c1-n2 | Resto |
|---|---|---|---|
| Antes de jugar | AVAILABLE (sin fila) | LOCKED | LOCKED |
| Tras la primera victoria | **COMPLETED** WIN, attempts 1, wins 1, first_cleared_at puesto, first_clear_match `c22067c0` | **AVAILABLE** | LOCKED |
| Tras rejugar | COMPLETED WIN, attempts 2, wins 2, first_clear_match sigue en `c22067c0` | AVAILABLE | LOCKED |
| Tras la prueba de dos pestañas + abandono | sin cambios (abandonar no cuenta intento) | AVAILABLE, sin fila | LOCKED |
| Tras reiniciar la app | igual (1/15) | AVAILABLE | LOCKED |

## Estado final (13:39:08 UTC)

| Medida | Valor |
|---|---|
| campaign_progress (QA) | 1 fila: c1-n1 COMPLETED |
| campaign_attempts (QA) | SETTLED 2 (first_clear 1, reward_granted 1) · ABANDONED 1 |
| Filas de libro mayor `campaign_first_clear` | 1 (+50) |
| Créditos QA | 5540 |
| Equipo activo | `f7739fa5` «Equipo 2» (cambiado desde la UI en la prueba de equipo activo) |
| player_profile_customization | 1 fila, `showcase` vacío, versión 2 (guardado + revertido del smoke) |
| duel_pvp_rating_events (global) | 0 |
| Rating QA | 1000 / 0 partidas |
| credit_transactions de otros usuarios | 47 (sin cambios) |
| campaign_progress de otros usuarios | 0 |
| duel_friendships / duel_challenges | 0 / 0 (sin mutación social) |
| `supabase_migrations.schema_migrations` | 25 filas, máximo 0025 (sin cambios) |

## Lo que no se hizo

Ningún `UPDATE` de `winner`, `status`, `first_clear` ni `reward_granted`; ningún `INSERT` en `user_cards`, `credit_transactions` ni tablas de campaña desde consola; ningún `app_grant_reward` manual. Todo cambio vino de la app local con el token de la cuenta QA.
