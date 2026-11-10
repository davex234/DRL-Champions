# Fase 42 — Live Service & Retention 3.0 «Today. This week. This season.» · Informe

Fecha: 2026-09-16 · Rama `arch/stabilization` · sin commit, sin deploy, sin migración.
Contrato: [`live-service-contract.md`](live-service-contract.md) · QA: [`qa/fase42/README.md`](qa/fase42/README.md).

## Resumen

La home responde en segundos «esto es lo que importa hoy»: una acción con su razón, lo que caduca de verdad, hoy y esta semana por separado con su reset, la temporada, el directo real y, si vuelves, qué ha cambiado (sin recompensa ni racha). Después de jugar, «Qué sigue» cierra el bucle con el objetivo que avanzó, la siguiente acción y «Volver al lobby».

Cierres de fondo:

1. **P0 · lecturas con escrituras.** `GET /api/game/meta` y `/api/game/loop` rotaban misiones, abrían el carril competitivo y creaban la ficha de rating al leer. Ahora la rotación es una **función pura** (`resolvePassWindows`) y solo se materializa en mutaciones (`ensurePass`, concurrencia optimista). Probado con MemSupabase, en 16 lecturas reales y con la home abierta 70 s en navegador: **0 escrituras**.
2. **P0 · tope PvE por concurrencia.** El tope diario contaba y luego pagaba: N finales simultáneos cobraban todos. Ahora cada partida pagada ocupa un cupo atómico (`economy_ops` PK): 40 finales a la vez → 20 pagadas.
3. **P1 · Pick'em recorregido.** Una recorrección a un nivel superior pagaba el nivel completo encima del ya pagado. Ahora paga la diferencia (`pickemTierDelta`). El worker no se toca.
4. **Bug de QA real · directo falso.** El vestíbulo recomendaba «Ver en directo» de un evento DEMO terminado el 13-09 con un partido `live` residual, y su tarjeta decía «EN DIRECTO». Ahora la acción de directo exige un evento no demo, la tarjeta de un demo activo dice «DEMO» (sin pulso) y un evento real siempre pasa por delante.

## Verificación

| Prueba | Resultado |
|---|---|
| Tests (`npm test`) | **3.446 / 3.446** (base 3.241 · +205) |
| Matriz obligatoria L001–L100 (`liveService.matrix.test.ts`) | 100/100 |
| Fuzzer de prioridad | 100.000 combinaciones · 0 violaciones · mutaciones detectadas (79.544 / 100.000) |
| Fuzzer temporal (servicios reales, reloj controlado) | 100.000 secuencias · 1.149.590 acciones · 101.532 cobros · 105.956 resets · 0 violaciones |
| Simulación de vuelta (0 h … 30 d) | 100.000 estados · 0 violaciones · ≤ 3 hechos |
| QA real (cuenta 8c326e52) | lecturas 0 escrituras · reloj −26 ms · reclamo real único · rutas 400 · bug demo corregido |
| Capturas | 143 SYNTHETIC + 20 REAL · 0 desbordamientos · 0 errores · 0 controles < 44 px |

## Decisiones

- **`last_seen_at`:** sin migración. La vuelta usa el máximo de marcas reales ya existentes (libro mayor, aperturas, partidas, `last_seen_at` del latido social). El vestíbulo solo lee.
- **Draft eligiendo cartas** (rango 0,7): por encima de retos/recompensas, por debajo de cualquier partida abierta.
- **Caduca muy pronto** (rango 1,5): predicción/objetivo/reclamo con ≤ 2 h de fin real sube por encima del reclamo normal, nunca por encima de una partida o un reto.
- **«Termina pronto»** solo lista SOON/VERY_SOON (≤ 12 h) o la temporada en su última semana: un Pick'em a 7 días no es «pronto» (visto en QA real).
- **Economía:** 0 cambios de importes, precios o tablas. Los tres arreglos económicos cierran exploits demostrados, no reequilibran.

## Gates (ejecución final, código definitivo)

`npm test` 3.446/3.446 · `typecheck` (web + scripts) ✓ · `next build` ✓ · `eslint` (ficheros de la fase) ✓ · 56 verificadores ✓: live-service ×6, economy ×7, battlepass, security, pack, content, distribution, importer-vlr, combat, deck, social, replay, competitive, season ×5, campaign ×4, daily-loop ×3, pack-objective ×3, collection ×5, pack-opening ×3, draft-gauntlet ×5, player-journey ×4 · mutaciones del fuzzer de prioridad detectadas ×2.

Huella económica: `seasonBudget()` idéntico al final de la Fase 41 (pase 15.900/26.000 + 6/6 sobres, logros 67.500, campaña 1.350, diarias 850/día, semanales 3.300/semana, PvE 7.000/día), techo diario 11.150, `ECONOMY_VERSION` 3, precios de sobres sin cambios.

## P2 que quedan

- Dos liquidaciones simultáneas de **la misma** partida pueden gastar dos cupos del tope (el jugador pierde uno; nunca cobra de más).
- `GET /api/game/competitive` sigue llamando a `ensureRating` al leer (fuera del alcance de la home; documentado desde la Fase 34).
- Datos semilla: el evento demo «DRL Masters Madrid 2026» conserva un partido `live` en BD. Ya no se recomienda ni se anuncia «EN DIRECTO» (dice «DEMO»), pero las páginas de eventos (`/torneos`, fuera del vestíbulo) no se tocaron en esta fase. Limpiarlo es tarea de contenido/worker (prohibido tocar aquí).
- Telemetría del vestíbulo cerrada: las métricas de retención están definidas (contrato §11), no instrumentadas.
- La QA real no tenía partida activa, run de Draft, vuelta ≥ 1 día ni Pick'em a < 12 h: cubiertos con el arnés, la matriz y los fuzzers (marcados SYNTHETIC).
