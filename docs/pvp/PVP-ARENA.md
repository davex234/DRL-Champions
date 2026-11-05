# NEXUS — PvP Arena

> BLOQUE 7.5. La experiencia jugable: puerta desde Duelos, elección de mazo, búsqueda de rival,
> arena, resultado y rating. **Sin WebSocket, sin Realtime, sin SSE, sin backend nuevo.**
> 2026-09-08 · rama `arch/stabilization`

Resuelve **D-PVP-8**: *«no existe Arena/UI PvP»* — el bloque 7.3 dejó `usePvpSync` escrito y
**sin montar en ninguna pantalla**, y así siguió durante cuatro bloques.

---

## 1. Lo que ya existía y lo que faltaba

El backend competitivo estaba **entero**: cola persistente (7.4), rating por habilidad (7.4.1),
liquidación automática (7.4.2), vencimiento de turno (7.4.3), y antes de eso el modelo (7.2) y la
sincronización (7.3). Lo único que faltaba era que **alguien lo consumiera**.

Este bloque no añade reglas. Añade la pantalla.

---

## 2. Rutas y componentes

| fichero | qué es |
|---|---|
| `src/app/duelos/pvp/page.tsx` | La ruta. Antes era la superficie de depuración del 7.3; ahora orquesta antesala → arena → resultado. |
| `src/components/duel/pvp/PvpLobby.tsx` | Elegir mazo y buscar rival. |
| `src/components/duel/pvp/PvpArena.tsx` | Reloj, turno, abandono — y **`MatchBoard`**, el tablero del PvE. |
| `src/components/duel/pvp/PvpOutcome.tsx` | Victoria/derrota/empate, causa y rating. |
| `src/lib/duel/usePvpQueue.ts` | Cliente de la cola. Un solo bucle, se apaga al emparejar. |
| `src/lib/duel/matchView.ts` | **Proyección compartida** partida → vista, parametrizada por bando. |
| `src/app/duelos/page.tsx` | La puerta: una tercera tarjeta, «Competir · Duelo PvP». |

**No se construyó un tablero nuevo.** La arena usa `MatchBoard`, la misma mesa, cartas, choque y
animaciones del duelo contra el bot. Un segundo tablero habría sido dos tableros envejeciendo por
separado.

---

## 3. La UI no es autoridad

Todo lo que decide el juego llega resuelto del servidor:

| pregunta | quién contesta |
|---|---|
| ¿me toca? | `snapshot.isYourTurn` — **no** se deduce comparando ids |
| ¿qué veo del rival? | el `match` ya viene REDACTADO por `projectMatchFor` (7.2): las cartas ocultas **no están en los datos** |
| ¿cuánto queda? | `turnDeadlineAt` del servidor; la cuenta atrás solo lo pinta |
| ¿ha terminado? | `lifecycle` (FINISHED/ABANDONED/EXPIRED) |
| ¿he ganado? | `result.winner` vs `yourSide`; si no hay resultado del motor, `outcome.result` |
| ¿cuánto rating? | `duel_pvp_rating_events` vía `?outcome=1` — **el «+20» no se resta en el cliente** |

**Cuando la cuenta atrás llega a cero la pantalla no declara nada**: espera a que el servidor
cierre la partida (7.4.3) y enseña el resultado que ese cierre produzca.

Estos invariantes están **probados**, no prometidos: `duel.test.ts` tiene dos tests nuevos
(«la pantalla no decide el turno, el final ni el rating» y «un solo bucle de red y sin estado de
partida en el navegador») y la arena entró en la lista `UI_FILES` que ya cubría el PvE.

---

## 4. Un solo bucle de sondeo

Hay dos hooks porque hay dos recursos, pero **nunca sondean a la vez**:

```
sin partida  →  usePvpQueue   (/api/game/duel/matchmaking, 2 s · 6 s oculto)
con partida  →  usePvpSync    (/api/game/duel/pvp, el poller del 7.3)
```

La cola se apaga sola en cuanto devuelve `MATCHED` (`sondeando = false`) y la página la desactiva
por `enabled`. El bucle de la cola es un `setTimeout` **reprogramado tras cada respuesta**, no un
`setInterval`: una respuesta lenta no acumula peticiones encima de la anterior.

Medido en navegador: **17 peticiones** a `/duel/pvp` en una sesión completa de QA. Sin tormenta.

---

## 5. Reconexión

**No hay estado de partida en `localStorage`, y no hace falta.** Al entrar, la pantalla pregunta a
la cola; si la última entrada está `MATCHED`, ahí está el `matchId` y se entra directo. Recargar,
cerrar la pestaña o volver mañana dan lo mismo: la verdad está en el servidor.

`?match=<uuid>` sigue funcionando como enlace directo — es lo que hacía la superficie del 7.3.

Una partida ya vista se puede **descartar** («Buscar otro rival») para volver a la antesala: la
entrada de cola sigue en `MATCHED` apuntando a la partida terminada —es su historia— así que sin
eso no había forma de salir del resultado. Es memoria de pantalla, no de partida: se pierde al
recargar, y debe perderse.

---

## 6. Acciones y errores

Cada jugada envía `actionId` nuevo (idempotencia del 7.2) y `expectedVersion` (la versión que el
jugador está viendo). Ante `409 STALE_VERSION` la pantalla **sincroniza y lo explica en
castellano** —«La partida avanzó mientras decidías»—; no reintenta sola ni enseña el código.

Estados cubiertos: cargando · sin cuenta (`NeedsAccount`) · error con reintento (`ErrorState`) ·
sin mazos legales (`EmptyState` hacia Mis mazos) · cola con `ACTIVE_MATCH` y `DECK_NOT_OWNED`
traducidos.

---

## 7. Abandono y vencimiento — se distinguen

| final | qué enseña |
|---|---|
| jugado | **Victoria / Derrota / Empate** |
| abandono | + «Por abandono» |
| vencimiento | + «Tiempo agotado» |

El abandono pide confirmación en la propia barra («¿Abandonar? Cuenta como derrota») y **no
navega**: espera a que el servidor confirme el cierre.

---

## 8. Cambios fuera de la interfaz (y por qué)

El bloque pedía no tocar el backend salvo dependencia real. Hubo tres, todas auditadas:

| fichero | motivo | riesgo | prueba |
|---|---|---|---|
| `src/lib/duel/matchView.ts` (nuevo) + `duels.ts` | `toPublicView` tenía el bando **cableado a `A`** (deuda **R11**). En PvP el humano puede ser `B`. Se **extrajo** la proyección a un módulo puro con `side`; `toPublicView` la llama con `"A"`. La alternativa era duplicar el mapeo en React, que el propio encargo prohíbe. | PvE cambia de comportamiento | `duel.test.ts` (7 llamadas) + `npm test` 766/766 |
| `usePvpSync.ts` | **Bug real encontrado en QA**: `subscribe` tenía `[]`, y en la arena el primer render ocurre **sin** `matchId`, así que `ref.current` era `null`, React no se suscribía nunca y `snapshot` se quedaba en `null` para siempre. No se había visto porque el único consumidor previo sacaba el id de la URL. | ninguno: solo añade `matchId` a las dependencias | QA de navegador: la pantalla pasó de «Recuperando la partida…» eterno a mostrar el resultado |
| `MatchBoard.tsx` | El marcador decía **«Bot»** para el rival. En PvP es otra persona. Se añadió `rivalLabel`/`etiqueta`, con el valor de siempre por defecto. | ninguno en PvE (valor por defecto) | QA de navegador: `diceBot: false` |
| `/api/game/duel/pvp` | `?outcome=1` **opt-in** adjunta el movimiento de rating del solicitante. Sin el parámetro la respuesta es la del 7.3 byte a byte, así que el sondeo de cada 2 s no paga nada. | contrato del 7.3 | `pvp-arena:verify`: el sondeo normal no trae `outcome`; un tercero recibe 404 |

**No se tocó**: matchmaking, rating, liquidación, vencimiento, motor de combate, reglas, economía,
Pick'ems ni recompensas.

---

## 9. Diseño

Se usa el sistema existente: `Stage`, `Plate`, `nx-clip`/chaflanes, `nx-label`, `nx-readout`,
`NxButton`, `EmptyState`/`ErrorState`/`NeedsAccount`, y el tablero con sus `ArenaSurface`,
`HandFan`, `PlayedRow` y `ClashBanner`. Ni un color fuera del sistema, ni glassmorphism, ni
cápsulas, ni dashboards.

---

## 10. Accesibilidad

- Controles de mazo con **52 px** de alto y `aria-pressed`; foco visible (`focus-visible:outline`).
- El cambio de turno se anuncia (`aria-live="polite"`).
- **El reloj NO spamea**: `aria-live` pasa a `assertive` solo en los últimos 15 s y solo si te
  toca a ti. Un anuncio por segundo sería ruido inservible.
- Medido en navegador a 390/768/1440: **0 controles por debajo de 44 px**.

---

## 11. QA de navegador

Chrome sin cabeza por CDP con viewport real (`Emulation.setDeviceMetricsOverride`), dos cuentas
reales, sesión de A inyectada y B jugando por HTTP.

```
antesala 390 / 768 / 1440   lobby=true · sin scroll horizontal · 0 controles <44px
buscando 1440               «Buscando rival…» con reloj de cola
arena 1440/768/390          TU TURNO · 01:21 · sin scroll horizontal · el rival NO es «Bot»
jugar desde la interfaz     carta → estadística → confirmar ⇒ «TURNO DEL RIVAL»
higiene                     17 peticiones a /duel/pvp · 0 errores de JavaScript
```

Capturas en `docs/product/qa/`: `pvp-lobby-{390,768,1440}.png`, `pvp-buscando-1440.png`,
`pvp-arena-{390,768,1440}.png`.

---

## 12. Deudas

| id | deuda | prioridad |
|---|---|---|
| **D-ARENA-1** *(nueva)* | Sin sonido propio de PvP. El tablero reutiliza los `playCue` del PvE; no se añadió nada nuevo para no duplicar listeners. | P3 |
| **D-ARENA-2** *(nueva)* | El historial de rating (`getRatingHistory`) existe en el servicio y **no tiene pantalla**: el resultado enseña el movimiento de ESA partida, no la trayectoria. | P3 |
| ~~**D-PVP-9**~~ *(heredada)* | Sin rate limiting. Ahora hay una pantalla que sondea de verdad, así que sube de importancia antes de abrir esto a usuarios. — **RESUELTA en el BLOQUE 7.6**. Los dos bucles de esta pantalla aflojan ante un 429 en vez de romperse. Ver `PVP-RATE-LIMIT.md`. | ~~P1~~ |
| **D-RAT-3, D-MM-4, D-RAT-2, D-PVP-5, D-PVP-3, R11** | R11 **resuelta** en este bloque (ver §8). El resto sin cambios. | — |

---

## 13. Lo que este bloque NO implementa

WebSocket · Realtime · SSE · chat · emotes · espectadores · leaderboard visual · temporadas ·
recompensas PvP · historial competitivo · rate limiting · sonido nuevo.
