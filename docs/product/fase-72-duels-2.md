# F72 · DUELS 2.0 — Instant Play + Competitive Inline + Draft Gauntlet Rework

Fecha: 2026-09-29 · Build servida: `drl-0.1.1-1-e50cbbb1` · Cabeza de migraciones: `0058_hardening_grants` (sin migración nueva) ·
Sin commit, sin push, sin deploy público.

## Resultado

| Gate | Resultado |
|---|---|
| Suite completa (`npm test`) | 5.517 / 5.517 |
| `tsc` web + scripts | 0 errores |
| Lint | 0 errores (warnings previos, ninguno en ficheros tocados) |
| Build | OK (155/155 páginas) |
| `smoke:production` | 74/74 |
| `production:check` | 17 PASS · 0 WARN · 0 FAIL (331 cartas, 29 agentes, mercado y pagos OFF, 0058) |
| `gate:browser` (ampliado con F72) | 55/55 (dos veces + final) |
| QA real F72 (`scripts/_f72-qa.ts`) | shots 31/31 · dbl 2/2 · tabs 1/1 · retry 2/2 · poor 2/2 · reward 3/3 · reconcile 9/9 |
| `/api/health` · `/api/ready` | ok · ready (head 0058, catálogo 331/331, privacy 0058) |

## /duelos: selector de modo

- Cuatro tarjetas de la misma familia (arte, título enorme). Pulsar SELECCIONA (no navega): la elegida ocupa 2 de 5 columnas en escritorio
  y se despliega en móvil (una columna). Solo la elegida enseña lo mínimo y UN CTA grande (60 px, rosa): JUGAR / JUGAR / RETAR /
  ENTRAR · 2.000 (o CONTINUAR con una run activa).
- COMPETITIVO: rango y rating REALES (`GET /api/game/competitive` → `ladderStanding`, emblema F55) y JUGAR = `rankedGate` de F55 →
  `/duelos/pvp?buscar=<equipo>` → cola ranked directa. `/competitivo` sigue como detalle («Ver clasificación ›»). El gate registra la
  navegación: `/jugar → /duelos → /duelos/pvp`, nunca `/competitivo`.
- `?modo=` preselecciona; con una partida abierta se preselecciona ese modo.

## Draft Gauntlet: economía (aislada, server-authoritative, sin migración)

| Victorias | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| Créditos | 0 | 200 | 500 | 1.000 | 1.600 | 2.100 + Sobre Masters (1.ª completada de la semana ISO) + título «Campeón del Gauntlet» (una vez) |

Entrada: **2.000 créditos**. Abandonar paga lo mismo que caer en esa etapa; la entrada nunca se devuelve. Empate = fin (regla F39).

### Por qué (simulación con el motor real, 5.000 runs por perfil — `_f72-draft-winrates.ts`, `_f72-draft-economy.ts`)

| Perfil | Victorias medias | Completa | EV base | EV 1.ª de la semana (sobre a precio de tienda) |
|---|---|---|---|---|
| CASUAL (elige y juega al azar) | 0,78 | 0 % | −1.827 (−91 %) | −1.827 |
| REGULAR (OVR + bot NORMAL) | 2,45 | 5,5 % | −1.194 (−60 %) | −918 |
| SKILLED (pico de stat + heurística SMART) | 4,42 | 66,8 % | −204 (−10 %) | +3.134 |
| ORACLE (ve el mazo rival: imposible) | 4,70 | 82,1 % | −58 (−3 %) | +4.046 |

- La tabla base tiene EV negativo para TODOS, incluida la cota imposible: repetir runs (bots, reintentos) no imprime créditos.
- El premio «tocho» (Sobre Masters, 5.000 en tienda) está topado por la clave del libro mayor `draft:jackpot:<uid>:<semana ISO>`:
  como mucho un sobre por semana (≈ 714/día equivalentes, en sobres, no en créditos líquidos).
- Descartadas: 5 V = 3.000 sin tope (SKILLED +397/run) y 5 V = Sobre Champions cada vez (SKILLED +3.735/run): imprentas.
- Referencias intactas: 5 partidas PvE NORMAL ≈ 689 créditos; tope PvE 20/día; techo recurrente F41 11.150/día.
- Cuenta nueva (6.000): CASUAL/REGULAR pueden entrar 3–4 veces antes de quedarse sin saldo; entrar exige 2.000 (402 si no).
- Run real (QA H, heurística simple): 5/5 → −2.000 +2.100 + Masters + título (el modo es superable por un jugador bueno; el EV base sigue
  siendo negativo y el sobre es semanal).

### Autoridad y concurrencia

- Entrada: `startDraftRun` comprueba saldo, crea la run (índice único parcial 0053 = una activa) y cobra con
  `app_adjust_credits(-2000, ref=draft:entry:<runId>)` (`_ledger_apply`, suelo 0, `credit_tx_ref_uniq`). Saldo insuficiente ⇒ la run se
  borra: ni run ni asiento. Cobro caído ⇒ run pendiente (no admite elecciones, 402 ENTRY_PENDING); volver a ENTRAR la completa con la
  misma clave. Nunca dos cargos (probado: doble clic real, 2 navegadores, 3 reintentos + 3 paralelos, fallo a medias).
- Recompensa: se FIJA en `state.reward` en la misma escritura que cierra la run y se concede con `award()` (`draft:reward:<runId>`,
  `draft:jackpot:<uid>:<semana>`). Si falla, la siguiente lectura/entrada la concede (idempotente). El cliente no manda cantidades
  (lista cerrada de claves; 400 FIELD_NOT_ALLOWED probado en real).
- Runs anteriores a F72 (sin `state.entry`): gratis y sin recompensa.
- Sin migración: `state` jsonb de 0053 + RPC existentes (sondeadas en la BD real sin escribir).

## Draft: presentación

- Escenario con foco de luz, entrada escalonada (muelle), elevación al pasar, la elegida avanza (y centrada en el carrusel móvil), las
  otras bajan de énfasis; incorporación corta al equipo (destello en el hueco). Presencia por la rareza REAL de la edición
  (`bucketForRank(variant.rank)`): aura elíptica, pulso y chispas DETRÁS — nada encima de la carta, ninguna silueta rectangular.
- Movimiento reducido: `MotionConfig reducedMotion="user"`, sin chispas, sin desplazamientos (fundidos).

## Defectos encontrados y corregidos en la QA real

1. **Transición de página con movimiento reducido (previo, F44):** el `translateY(14px)` inicial se quedaba para siempre (el objetivo
   pasaba a ser solo opacidad) y todo `position: fixed` interior (la barra CONFIRMAR del draft) caía fuera de pantalla en el Chrome del
   usuario (que reporta `reduce`). `PageTransition` devuelve las transformaciones a la identidad en reducido (pin F72 FX3).
2. **Arquitectura «triptych» del draft (F44.1):** tres huecos de carta vacíos se leían como marcos descuadrados alrededor de las cartas
   reales. Quedan solo los focos.
3. **Pulso de rareza rectangular:** `box-shadow` sobre un rectángulo dibujaba una caja tras la carta legendaria → elipse (pin FX4).
4. Escalera de premios recortada en 390 / arte del sobre cortado por el `clip-path` → gran premio a lo ancho con el arte real.
5. Emblema ranked diminuto → tamaño medio y rango/rating grandes.

## Deuda / fuera de alcance (no tocado)

- `draft-gauntlet:verify`: 61 OK · 3 fallos PREVIOS a F72 (pins de la Fase 39 caducados: comparación de `\n` sobre `duels.ts` CRLF,
  «0053 es la última migración» con 0054–0058 existentes, y la comprobación de pool contra catálogo). F72 actualizó su sección de economía.
- Coste de la QA en cuentas QA: cada `gate:browser` completo cuesta 1.000 (Bronce) + 2.000 (entrada) a la persona del gate.

## Ficheros

Nuevos: `src/domain/draft/economy.ts`, `src/server/services/draftEconomy.ts`, `src/server/services/draftEconomy.f72.service.test.ts`,
`src/server/services/testing/ledgerRpc.ts`, `src/lib/duels/selector.ts`, `src/components/draft/DraftEntry.tsx`,
`src/components/draft/f72.draftFx.render.test.tsx`, `scripts/_f72-draft-winrates.ts`, `scripts/_f72-draft-economy.ts`,
`scripts/_f72-qa.ts`, `scripts/_f72-rpc-probe.ts`, `docs/product/qa/fase72/*`.

Modificados: `src/app/duelos/page.tsx`, `src/components/modes/DuelModesHub.tsx`, `src/components/draft/{DraftCards,DraftGauntletScreen}.tsx`,
`src/app/jugar/draft-gauntlet/page.tsx`, `src/domain/draft/{rules,run,snapshot}.ts`, `src/server/services/draftGauntlet.ts`,
`src/lib/campaign/presentation.ts`, `src/lib/draft/presentation.ts`, `src/domain/economy/catalog.ts`, `src/domain/cosmetics/catalog.ts`,
`src/components/layout/PageTransition.tsx`, `src/components/visual/GameEnvironment.tsx`, `scripts/ops/browser-gate.ts`,
`scripts/draft-gauntlet-verify.ts` y sus pruebas (`draft.test.ts`, `draftGauntlet.{service,contract}.test.ts`, `f71.playHub.render.test.tsx`,
`draftScreen.render.test.tsx`, `presentation.test.ts`, `catalog.test.ts`, `gameExperience.render.test.tsx`, `competitive.contract.test.ts`).

FASE 72 — CERRADA (GO)
