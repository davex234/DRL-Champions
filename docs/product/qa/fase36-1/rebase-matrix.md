# FASE 36.1 · Matriz de transición (rebase conservador)

Función pura `rebaseMission(m, { packs_opened: { legacy, current } }, serverNow)` en `src/battlepass/metricRebase.ts`.
Tests: `src/battlepass/metricRebase.test.ts` · verificador `npm run pack-objective-rebase:verify`.

`carried = clamp(legacy − baseline, 0, goal)` · `nuevaBaseline = current − carried` · progreso futuro = `carried + (current' − current)`.

| caso | condición | resultado | progreso al aplicar | futuro | por qué |
|---|---|---|---|---|---|
| Progreso cero | legacy − baseline ≤ 0 | REBASED | 0 | +1 por apertura real | no se regalan aperturas anteriores |
| Parcial | 0 < visible < goal | REBASED | visible | visible + aperturas nuevas | se conserva lo que el jugador veía |
| Casi completa | visible = goal − 1 | REBASED | goal − 1 | una apertura la completa | idem |
| Completa sin reclamar | visible = goal | REBASED | goal (completa) | reclamable igual que antes, sin reclamo automático | no se quita lo ganado |
| Reclamada | `claimed = true` | SKIPPED_CLAIMED | intacta | — | recompensa pagada: no se revoca ni reinterpreta |
| Caducada | `rotationDue(kind, assignedAt, serverNow)` | SKIPPED_EXPIRED | intacta (legacy) | la rotación la sustituye por una misión v2 | no se revive |
| Ya vigente | `metricVersion = 2` | ALREADY_CURRENT | intacta | — | idempotente |
| Métrica sin cambio de fuente | `duels_won`… | NOT_VERSIONED | intacta | — | fuera de alcance |
| Contador nuevo < progreso legacy | current < carried | REBASED (baseline negativa) | carried | carried + nuevas | nunca negativo |
| Contador nuevo muy alto | current ≫ | REBASED | carried | sin salto | no se reinterpreta |
| Objetivo 1 / objetivo N | — | igual | acotado a [0, goal] | — | — |
| Contadores inválidos | negativos, no enteros, ausentes | error (aborta el plan) | — | — | no se inventa un valor |
| Frontera diaria | asignada 23:59:59Z ayer / 00:00:00Z hoy | EXPIRED / REBASED | — | — | reloj del servidor |
| Frontera semanal | asignada domingo / lunes 00:00Z | EXPIRED / REBASED | — | — | idem |

## Aplicación real (2026-09-15, `serverNow` 17:06:42Z de la exportación)

| usuario | legacy | current | misión | ventana | resultado | baseline | conserva | reinterpretación evitada |
|---|---|---|---|---|---|---|---|---|
| 8c326e52 (QA) | 0 | 5 | d-abrir-1 | viva (hoy 13:21:50Z) | REBASED | 0 → 5 | 0 | 1/1 **completa** (200 créditos + 150 XP) |
| 8c326e52 (QA) | 0 | 5 | w-sobres-10 | viva (semana del 14) | REBASED | 0 → 5 | 0 | 5/10 |
| 9137ee57 | 0 | 0 | d-abrir-1 | caducada (11-sep) | SKIPPED_EXPIRED | 0 | — | — |
| 9137ee57 | 0 | 0 | w-sobres-10 | caducada (semana anterior) | SKIPPED_EXPIRED | 0 | — | — |
| b2663c09 | 0 | 0 | d-abrir-1 | caducada (11-sep) | SKIPPED_EXPIRED | 0 | — | — |
| b2663c09 | 0 | 0 | w-sobres-10 | caducada (semana anterior) | SKIPPED_EXPIRED | 0 | — | — |

Ninguna misión de sobres estaba completa ni reclamada en la BD real. Las 5 aperturas de la cuenta QA ocurrieron ANTES de que
se asignaran sus misiones (13:17–13:20Z frente a 13:21:50Z): con la fuente cambiada a pelo, `d-abrir-1` habría quedado
completa por aperturas que no pertenecen a su tanda.
