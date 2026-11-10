# FASE 36.1 · Preflight (solo lectura, BD real del VPS)

2026-09-15 · `supabase_db_DRLCards` (base `postgres`, esquema `public`) vía `ssh nexusadmin@212.95.40.144` + `docker exec … psql`.
Sin PII: ids truncados a 8, agregados.

## Esquema verificado

| objeto | hecho |
|---|---|
| `public.economy_ops` | `ref text` (PK), `user_id uuid`, `kind text`, `result jsonb`, `created_at timestamptz` |
| `public.user_game` | `user_id uuid`, `pity jsonb`, `packs_opened integer not null default 0`, `updated_at` |
| `app_apply_pack_open` | última definición en 0019 (ninguna migración posterior la redefine) |
| `supabase_migrations.schema_migrations` | 25 filas, máximo 0025 (no se toca) |

## Estado encontrado

| medida | valor |
|---|---|
| usuarios (`auth.users`) | 10 |
| `profiles.packs_opened` > 0 | **0 de 10** (suma 0) |
| `user_game.packs_opened` | suma **22** |
| `economy_ops` por tipo | `open_pack` 22 filas / 3 usuarios · `buy_pack` 9 / 3 · `market_buy` 3 / 3 · `market_list` 1 / 1 · `sandbox_purchase` 2 / 1 |
| `user_game` = `economy_ops open_pack` por usuario | igual en los 10 (2f86cbe8 12=12 · 7408368f 5=5 · 8c326e52 5=5 · resto 0=0) |
| filas `user_pass` | 4 (todas `nexus-s1`) |
| misiones por métrica (todas las filas) | packs_opened 6 · distinct_cards 9 · duels_played 9 · duels_won 5 · decks_saved 4 · points 4 · region_set 4 · picks_made 3 |
| misiones `packs_opened` | 6 en 3 usuarios, todas baseline 0, ninguna completa, ninguna reclamada |
| en ventana viva | 2 (cuenta QA 8c326e52, asignadas hoy 13:21:50Z) |
| caducadas | 4 (9137ee57 y b2663c09, asignadas el 11-sep) |
| recompensas de misión pagadas (`mission_reward`) | 9 filas, todas de 2f86cbe8 y de misiones de duelos/colección/temporada; **ninguna de sobres** |

## Matriz agregada

| métrica | activas | cero | parciales | completas | reclamadas | caducadas | usuarios |
|---|---|---|---|---|---|---|---|
| packs_opened (legacy) | 2 | 2 | 0 | 0 | 0 | 4 | 3 (1 con ventana viva) |

## Exposición económica máxima (cambiar la fuente SIN rebase)

| misión | usuario | falsa completitud | créditos | XP del pase | sobres |
|---|---|---|---|---|---|
| d-abrir-1 | 8c326e52 | sí (5 aperturas anteriores a la tanda) | 200 | 150 | 0 |
| w-sobres-10 | 8c326e52 | no (5/10 regalado) | 0 | 0 | 0 |
| **total** | | **1 misión · 6 unidades de progreso regaladas** | **200** | **150** | **0** |

Logros `sobres-100`/`sobres-1000`: máximo real 12 aperturas → ninguno alcanzable; exposición 0 (y son acumulados, sin baseline).

## Compatibilidad con versiones desplegadas

No hay app NEXUS desplegada en el VPS (memoria de topología 35.x; esta fase no despliega). Aun así, código antiguo leyendo filas
rebaseadas mediría `profiles.packs_opened (0) − 5` → 0: nunca regalaría progreso.

## Decisión

Sin migración 0052: la transición cabe en el esquema actual (campo opcional dentro del jsonb de `user_pass.state`) y se aplica
como una transacción de datos única, determinista y verificada fila a fila.
