# QA · Fase 41 — Economy & Progression 3.0

| Evidencia | Fichero | Resultado |
|---|---|---|
| Línea base (reglas anteriores), 1.000.000 trayectorias | `baseline-economy.json` | salud con fallos: fuente recurrente sin tope y Sobre Inicial sin tope |
| Final (reglas Fase 41), 1.000.000 trayectorias | `final-economy.json` | salud 12/12 |
| Starter A–F, 100.000 cuentas por alternativa, motor real | `starter-simulation.json` | C2 elegida: P50 4 · P90 5 · P99 5 · máx 6 · 0 atrapadas |
| Fuzzer hostil, 100.000 secuencias (851.178 acciones) | `exploit-fuzzer.json` | 0 violaciones |
| Sensibilidad del fuzzer (P0 reintroducidos a propósito) | `exploit-fuzzer-mutation-check.json` | 486 violaciones detectadas |
| QA real (cuenta QA existente 8c326e52, BD del VPS) | `real/real-qa.json`, `real/real-qa.log` | 30/30 |
| Sonda real de misiones periódicas | `real/real-missions.json`, `real/real-missions.log` | 7/7 |
| Arnés visual `/design-system/fase41` | `synthetic/` (76 capturas, `index.json`) | 31 escenas · desbordamiento 0 · errores 0 · botones < 44 px 0 |

## Simulación
Ver `economy-simulation.md` (método, supuestos, percentiles y comparación antes/después).

## QA real
App local `next start -p 3005` → túnel SSH → PostgreSQL del VPS. Cliente público con la cuenta QA **8c326e52** (Fase
35.2). La cuenta de la Fase 40 (`64ee0e54`) **no se tocó**. Credenciales fuera del repo. Evidencia en BD por SSH en
**solo lectura** (`default_transaction_read_only = on`). Instrumento: `scripts/_fase41-real-qa.ts` (y modo `missions`).

| Paso | Resultado |
|---|---|
| 0 · BD real (agregados sin PII) | 11 cuentas · 0 saldos negativos · saldo = Σ libro mayor en todas · 0 claves duplicadas · máx. duelos pagados en un día 2 · Sobres Iniciales gratis máx. 3 por cuenta (histórico, no se reescribe) · 2 compras sandbox históricas · 0 re-cobros de misión en la misma tanda |
| B · `GET /api/game/starter` | 200, `DECK_READY`, no elegible · 0 escrituras |
| C · sonda de granja del Sobre Inicial | `buy` 409 · ráfaga ×5 `buy_and_open` 409 ×5 · 0 escrituras |
| D · tienda de créditos de prueba | 403 · `purchasesOpen=false` · 0 escrituras |
| E · `GET /api/game/competitive` ×2 + posición | 200 · 0 escrituras (rating y pase intactos) |
| F · «actualizar misiones» | 200 · pase intacto |
| G · comprar Estándar + reintento | −750 exactos · reintento +0 |
| H · abrir Estándar + reintento | 5 cartas · reintento mismas uids, `repeated`, +0 |
| I · partida PvE real (Fácil, 10 turnos) | `duel_win` +120, un asiento `duel:<id>` · jugada repetida 409, +0 |
| J · misión `s-mazo` | +1.000 · re-reclamar 409, +0 |
| Misiones periódicas (modo `missions`) | `d-duelo-1` +250, `d-duelo-win` +400, `d-abrir-1` +200; tras OTRA partida real cada re-reclamo → 409, +0 (antes de la Fase 41 volvían a pagar) |
| K · huella final | 4.040 → 4.410 (−750 + 120 + 1.000) · saldo = Σ libro mayor |

## Arnés visual
`npx tsx scripts/_fase41-visual-qa.ts` con `next start -p 3005` (sin túnel). Escenas: starter (claim, muchos roles,
comprobando, error, sin sesión, poseído, sin abrir, ya no necesario, tope, teclado), sobres (comprable, sin saldo,
Premium, Icon sin saldo, evento, poseído), tienda cerrada, recompensa (concedida, topada, no disponible, Draft),
objetivos (recoger, cobrada, progreso, tanda cobrada, mixta), vestíbulo (colecciona con copia nueva, bienvenida,
plantilla posible, servidor caído), textos largos. 1440 · 1024 · 390 y `prefers-reduced-motion`. Los 404 son fotos de
jugador/escudo ausentes (fallback canónico), contados aparte.
