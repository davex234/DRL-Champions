# FASE 35.2 · Evidencia económica (cuenta QA `QA-8c326e52`)

Solo la cuenta QA (sintética, `@example.invalid`). Ningún crédito concedido a mano y ninguna llamada a `app_grant_reward` fuera del flujo real. Fuente: `public.credit_transactions` y `public.profiles.credits` de la BD real, leídas con `docker exec … psql` en el VPS.

## Libro mayor completo de la cuenta QA

| # | reason | delta | balance_after | ref (truncada) | UTC | origen |
|---|---|---|---|---|---|---|
| 1 | `starter_grant` | +6000 | 6000 | `starter:8c326e52…` | 13:17:45 | trigger de alta `handle_new_user` |
| 2 | `buy_pack:estandar` | −750 | 5250 | `pack:buy:8c326e52…` | 13:20:27 | sobre estándar comprado por `/api/game/packs` (faltaba un segundo Flex) |
| 3 | `duel_win` | +120 | 5370 | `duel:c22067c0…` | 13:30:57.499 | pago PvE canónico, partida 1 (victoria EASY) |
| 4 | `campaign_first_clear` | **+50** | 5420 | `campaign:road-to-champions:c1-n1` | 13:30:57.739 | **primera victoria c1-n1** |
| 5 | `duel_win` | +120 | 5540 | `duel:ec074e24…` | 13:34:38 | pago PvE canónico, partida 2 (rejugar) |

## Deltas

| Medida | Valor |
|---|---|
| Créditos antes de la campaña (tras cartas y equipo, 13:23:54) | **5250** |
| Recompensa de primera victoria esperada (código real, nodo MATCH) | +50 |
| Recompensa de campaña real | **+50** (1 fila) |
| Recompensa PvE de la partida 1 (otro sistema canónico) | +120 (`duel_win`, tabla EASY) |
| Créditos tras la primera victoria | **5420** = 5250 + 120 + 50 |
| Rejugar: recompensa de campaña | **0** |
| Rejugar: recompensa PvE (otro sistema canónico) | +120 |
| Créditos tras rejugar | **5540** = 5420 + 120 |
| Filas `campaign_first_clear` antes / tras primera victoria / tras rejugar / tras 2 `sync` / final | 0 / 1 / 1 / 1 / 1 |
| `profiles.credits` = último `balance_after` | 5540 = 5540 |

Los créditos sumados tras la primera partida son exactamente `duel_win` (120) + `campaign_first_clear` (50). Ni doble cómputo, ni movimientos compensados, ni filas de más. Rejugar solo añade el pago normal de una partida PvE, legítimo y aplicable a cualquier partida rápida con el tope diario de siempre: no es un exploit de primera victoria.

## Idempotencia

- Clave única de recompensa: `campaign:road-to-champions:c1-n1` (sin versión), más el índice único parcial `campaign_attempts_first_clear_once` (0051).
- Rejugar: el intento `d7dabceb` se liquidó con `first_clear=false`, `reward_granted=false`.
- Reintento real de liquidación: `POST /api/game/campaign {"action":"sync"}` dos veces → ninguna fila nueva, créditos sin cambios.
- Rechazado en el contrato: `reward: 999999` → 400 FIELD_NOT_ALLOWED.

## Otros usuarios

`credit_transactions` de otros usuarios: 47 antes y 47 después. Ninguna cuenta real tocada.
