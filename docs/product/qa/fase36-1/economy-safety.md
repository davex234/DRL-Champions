# FASE 36.1 · Seguridad económica

## Qué NO cambió

| elemento | estado | cómo se comprueba |
|---|---|---|
| Recompensas de misiones (`d-abrir-1` 200 créditos + 150 XP · `w-sobres-10` 1.500 + 900) | intactas | test ECONOMÍA + POOL |
| Precio y contenido de sobres, probabilidades, pity | intactos (no se tocó `packs.ts`, `domain/packs`, migraciones) | `pack:verify` |
| Alta (créditos + sobres de bienvenida) | intacta | sonda 1 |
| Recompensas PvE, campaña (primera victoria), pase, logros | intactas | `campaign-economy:verify`, `season-pass:verify` |
| RPC económicas | sin cambios (sin 0052) | ninguna migración nueva |
| Reclamo | explícito, servidor, idempotente (`mission:<temporada>:<id>:<assignedAt>:<baseline>`) | test MOTOR |
| Marketplace | OFF | `security:verify` |

## Qué habría pasado sin rebase

Cambiar la fuente a pelo completaba `d-abrir-1` de la cuenta QA con aperturas anteriores a su tanda: **200 créditos + 150 XP del pase
no ganados** y 6 unidades de progreso regaladas (1 diaria + 5 semanales). Ningún otro usuario tenía misiones de sobres vivas.

## Durante el rebase

Ninguna concesión, ningún reclamo, ninguna escritura en `credit_transactions`, `user_packs`, `user_cards`, XP ni logros (SQL
revisado por test: sin `insert`, sin `app_grant`). Libro mayor 52 → 52.

## Durante el E2E (cuenta QA)

- Compra real de 1 sobre estándar con créditos QA: −750 (`buy_pack:estandar`), el mismo precio de siempre.
- Apertura real: 5 cartas nuevas, 0 créditos.
- `d-abrir-1` quedó **pendiente de recoger** (ganada con una apertura real posterior). **No se reclamó**: 0 filas `mission_reward`.
- Ningún crédito, sobre o carta para otros usuarios.

## Recompensas ya ganadas

Ninguna recompensa pagada se revoca: las misiones reclamadas se excluyen del rebase y en la BD no había ninguna de sobres reclamada.
