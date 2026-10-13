# F86.1 — Tournament UX Hardening & Regression Cleanup

Fecha: 2026-10-05 · Base: `drl-0.1.1-1-3c097efb` (F86) · Release: **`drl-0.1.1-1-a719bcd7`** (activa desde 16:50 UTC)
Migración: **ninguna** — la cabeza sigue en `0069_player_cups`.

Cierra cinco deudas reales de F86 sin ampliar el alcance: (A) la espera del rival, (B) avisar rápido cuando el cruce
está listo sin un sondeo global agresivo, (C) la guardia obsoleta de la QA de F84, (D) la semántica de carrera del
perfil para las partidas de torneo, (E) la auditoría del flujo real de dos jugadores en producción.

Evidencia: `docs/product/qa/cups/prod-861/prod-qa.json` (36/36, tiempos), `prod-861/shots/*`,
`docs/product/qa/cups/visual.json` (751/751), `docs/product/qa/cups/f84-guard-negative.txt`.

---

## 1. Qué fallaba en F86

| Deuda | Síntoma real |
|---|---|
| A | Tras pulsar JUGAR el jugador quedaba listo en el servidor, pero la pantalla apenas cambiaba: parecía que no había pasado nada. Un F5 perdía el «esperando». |
| B | El rival que ya esperaba solo se enteraba con la recarga del cuadro (20 s) o con el indicador del menú (60 s). Detectarlo podía tardar hasta ~60 s. |
| C | `_f84-prod-qa.mts` se quedaba en 51/52: la guardia buscaba el texto de una función que F86 cambió de forma legítima. |
| D | Un cruce de torneo es una `duel_matches` PVP_PRIVATE, así que el historial propio lo mostraba como «Duelo privado» y lo sumaba a los duelos privados. |

## 2. Diseño de F86.1

- **Estado ligero dictado por el servidor:** `GET /api/game/cups?status=1` (`?badge=1` se mantiene como alias). Devuelve
  solo el cruce del jugador (`CupLiveStatus`) y un **nivel de sondeo** que decide el servidor:
  - `hot` 3 s: cruce READY y alguien listo;
  - `warm` 5 s: READY sin nadie listo, o PENDING con el cruce que da el rival en juego;
  - `idle` 20 s;
  - `cold` 60 s: sin torneo activo.
- **Límite de ritmo propio:** `cup_status` permite 90/min. No compite con `cup_read` (cuadro y ficha).
- **Sondeo compartido adaptativo:** `sharedPoll` admite `intervalFor` opcional, que reprograma con el nivel del último
  valor. Ante fallos aplica retroceso (mínimo 10 s × 2^(f−1), techo 120 s). Hace una lectura inmediata al recuperar
  foco o red, o al volver a la pestaña (con 750 ms de hueco mínimo). Los sondeos que ya existían no cambian.
- **La ficha solo recarga el cuadro cuando cambia la firma del cruce** (ronda, slot, estado, listos, partida, rival),
  no en cada lectura.
- **Disponibilidad = presencia:** el «listo» dura 30 s (TTL de F86). El panel lo renueva cada 10 s solo con la
  pestaña visible, y en el acto al volver a ella. Si el jugador se va, deja de estar listo, de modo que el reloj de
  turno nunca corre para un ausente.
- **Entrada automática con guardas:** solo entra sola si se cumplen todas estas condiciones: el jugador pulsó JUGAR
  (espera explícita) del mismo cruce, sigue en `/copas/<slug>`, el cruce está ACTIVE con partida y la sesión es la
  misma. En cualquier otro caso no navega.
- **Aviso global en el armazón** (`CupLiveNotice`). Se calla en la ficha y en la arena, y **nunca navega solo**:
  - «Tu partida de torneo ha empezado · Entrar»;
  - «Tu rival te espera · Jugar»;
  - «Tu partida de torneo está lista · Jugar».
- **Carrera:** `duelKind(dbMode, isCupGame)` añade la categoría `TOURNAMENT` («Torneo»), solo en el historial propio.
  `ProfileIdentityCard` no cambia.

Sin WebSocket ni Realtime nuevos, sin migración y sin tablas nuevas.

## 3. Carga

| Situación | Antes (F86), por pestaña visible | F86.1, por pestaña visible |
|---|---|---|
| Sin torneo | 1/min indicador + ficha 3/min solo en `/copas/slug` | **1/min** (frío, 1 lectura de BD) |
| Cruce jugable, nadie listo | igual | 12/min (medido: 12/min) |
| Esperando / rival listo | igual | 20/min teórico (medido: 16/min, porque el intervalo se cuenta tras cada respuesta) |
| Torneo en curso sin cruce mío | igual | 3/min |

- En frío, el estado cuesta **1** consulta de BD. Con cruce, ≤ 5 consultas pequeñas y **nunca el cuadro** (test F861-S3).
- La pestaña oculta no renueva su «listo». El sondeo compartido es uno por pestaña: no hay uno por componente.

## 4. Pruebas en producción (dos o tres navegadores reales, solo cuentas QA, torneo QA no listado)

Tiempos reales de la 3.ª ejecución (36/36), medidos desde el clic de B en JUGAR con el reloj de este PC. La hora de la
BD se traduce con el desfase medido.

| Marca | Tiempo |
|---|---|
| A ve «✓ Listo · esperando a…» tras su clic | 438 ms |
| **T0** servidor confirma el listo de B (B navega a la partida) | 727 ms |
| **T1** partida creada en la BD | 87 ms |
| **T2** A la detecta y navega **sola** | 2.207 ms (2.120 ms tras crearse) |
| **T3** A en la arena | 3.695 ms |
| **T4** B en la arena | 3.698 ms |
| Aviso global en el otro dispositivo de A (`/coleccion`, 1024) | 3.576 ms tras crearse, sin navegar solo |
| Foco: pestaña oculta de verdad (`visibilityState=hidden`), rival listo, vuelve → entra | 694 ms |
| Resultado: abandono → cruce COMPLETED en BD | 1.314 ms |
| Resultado: el ganador ve «✓ Has avanzado a Final» en la arena | 1.317 ms |
| Plazo vencido mientras espera → deja de decir «esperando» y muestra «en revisión» | 3.675 ms |

La 2.ª ejecución dio T2 = 2.521 ms y quedó en 35/36. El único fallo era del instrumento: el aviso «está lista» ya
estaba visible antes de crearse la partida y la comprobación lo tomó por el de «ha empezado». Se corrigió la
comprobación, no el producto.

También comprobado en producción:
- F5 mantiene la espera.
- 20 «listo» simultáneos del mismo jugador → 20 WAITING y 0 partidas.
- Una sola partida por cruce.
- Logout y cambio de cuenta sin aviso ni navegación heredados.
- Ataques rechazados: listo ajeno 404, equipo ajeno 404, campos falsos 400, estado anónimo 401, resolver como
  usuario 401, #TAG falso 400, PATCH REST directo 403.
- Resolución admin con #TAG exacto → campeón, 1 auditoría y 1 trofeo.
- Aislamiento intacto: rating, créditos, XP, sobres, cartas, eventos de rating, misiones y amistades.
- La carrera propia muestra TOURNAMENT («Torneo»).
- Limpieza: QA sin admin, único admin = cuenta personal (#9KZAWPC) intacta, Open #1 en DRAFT, Temporada 2 en DRAFT.

## 5. F84: guardia vieja → nueva

- **Antes:** comprobaba el texto literal de una función. F86 lo cambió legítimamente y la guardia se quedó en 51/52.
- **Ahora:** comprueba la invariante. `duel_pvp_settle_match` solo referencia tablas de rating o competitivo
  (`regexp_matches(prosrc, 'public[.]([a-z_]+)')`), conserva `NOT_PVP` y no toca ninguna tabla de economía. Además, los
  servicios ranked (duelsRating, competitive, duelsMatchmaking) no importan módulos de economía.
- **Resultado:** 52/52 en producción, antes y después del despliegue.
- **Prueba negativa:** se inyectó una referencia a una tabla de economía y la guardia falla
  (`qa/cups/f84-guard-negative.txt`).

## 6. F85: arnés reproducible

`_f85-prod-qa.mts` respeta el anti-spam real (10 retos/h por pareja), que no se ha relajado:
- antes de empezar espera a que haya cupo para los 6 retos A→B que necesita;
- si aun así recibe `CHALLENGE_LIMIT`, falla con un mensaje claro.

Resultados: la 1.ª pasada dio 92/92 y la 2.ª, tras esperar ~18 min de enfriamiento, también 92/92. Es reproducible sin debilitar el límite.

## 7. Release

- **Contenido:** `drl-0.1.1-1-3c097efb` + F86.1. Montada en el VPS desde la fuente de producción más el overlay.
- **Frontera comprobada:** `BOUNDARY_OK`, 6 ficheros añadidos, 18 modificados, 0 borrados. Los ficheros F78 son
  idénticos a los de producción.
- **Añadidos:**
  - `CupLiveNotice.tsx`
  - `matchKind.ts`
  - `lib/cups/outcome.ts`
  - `lib/cups/poll.ts`
  - 2 tests
- **Modificados:**
  - `api/game/cups/route.ts`
  - arnés `design-system/cups` (fixtures y página)
  - `duelos/pvp/page.tsx`
  - `CupDetailScreen`
  - `CupMyMatchPanel`
  - `PvpOutcome`
  - `GameShell`
  - `f86.contract.test`
  - `career.ts`
  - `lib/cups/client.ts`
  - `sharedPoll.ts`
  - `cups.ts`
  - `f86.cups.service.test`
  - `playerIdentity.ts`
  - `rateLimit.ts`
  - `social.ts`
  - `memSupabase.ts`
- **Fuera de la release:** los instrumentos `_` (scripts/_f84, _f85, _f861, _cups-qa, ops/_f861-stage.sh) se quedan en
  local.
- **Rollback:** `bin/deploy.sh --activate drl-0.1.1-1-3c097efb`. Sin migración que revertir.

## 8. Puertas

| Puerta | Resultado |
|---|---|
| Suite completa | 6041/6041 (+14 de F86.1) |
| Tipos | 0 errores |
| Lint | 0 errores (26 avisos previos) |
| Build | OK |
| QA visual del arnés | 751/751: 1440/1024/390 × normal/reducido, escenas before-ready, waiting, deadline, review, advanced, next-playable, notice y champion |
| F86.1 prod | 36/36 |
| F81.2 | 72/72 |
| F83 | 40/40 |
| F84 | 52/52 |
| F85 | 1.ª pasada 92/92; 2.ª pasada 92/92 (esperó ~18 min de enfriamiento anti-spam real) |
| F82 | 64/71: los 7 fallos son del instrumento, no del producto (ver nota) |
| Smoke | 80/80 |
| production:check | 27 PASS · 1 WARN (F77, autoconfirmación) · 4 FAIL (F78 off-site, excluido); igual que la línea base |
| /api/ready | ready, `migrationHead` = 0069_player_cups |
| Logs de valorosters-app | 0 errores desde el despliegue |

**Nota F82.** `_f82-prod-qa.mts` es un E2E de un solo uso:
- 6 aserciones exigen que QA K **todavía no** haya reclamado Eternal Fire. El reclamo se hizo en F82
  (`granted_at` 2026-10-03 19:54 UTC) y sigue habiendo exactamente 1 insignia, así que el exactamente-una-vez se mantiene.
- La 7.ª fija la cabeza en `0062` (el mismo pin obsoleto que ya se corrigió en F83/F84).
- Las 64 comprobaciones restantes pasan: seguridad, borradores, campos falsos, destacar y aislamiento.
- No se ha reabierto el reclamo en producción para repetirlo: el instrumento queda como deuda documentada.

## 9. Riesgos que quedan

- **Disponibilidad = presencia.** Quien se va de la ficha deja de estar listo. El aviso global se lo explica
  («Tu rival te espera»), pero si ninguno de los dos se queda en la ficha, el cruce acaba en revisión por plazo. Es una
  decisión deliberada: no se juega por un ausente.
- **Tiempo de detección.** Depende del sondeo (3 s en caliente). El peor caso medido para el que espera es ~2,5 s tras
  crearse la partida. En el otro dispositivo, el aviso tarda hasta ~5 s (nivel `warm`).
- **Pestaña oculta.** Mientras está oculta no renueva el «listo», así que tras 30 s oculta deja de estar lista. Al
  volver, renueva y lee el estado en el acto (694 ms medidos).
- **Torneos QA en producción.** Los torneos QA no listados creados por esta QA siguen ahí, COMPLETED, como evidencia.
  No se borraron porque hacerlo saltaría invariantes.
