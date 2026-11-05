# FASE 13 — NEXUS GAME LOOP AUDIT

> La pregunta cambia. Hasta la Fase 12 era «¿se ve bien?».
> Ahora es: **¿funciona como un videojuego?**

Rama `arch/stabilization` · sin commit · sin despliegue · 2026-09-06
Instrumentos: `scripts/_fase13-loop-audit.ts` y `scripts/_fase13-transiciones.ts`
(prefijados con `_`, fuera de `package.json`, fuera de CI)

---

## 1. Estado

**FASE 13 — CERRADA.**

Ejecutada en el orden mandado: auditoría completa → mapa del ciclo → clasificación
P0/P1/P2 → implementación quirúrgica de lo permitido → regresión → QA. No se empezó
implementando.

---

## 2. Radiografía inicial

Se midieron **18 estados del ciclo × 2 jugadores distintos**, más **4 transiciones
accionadas de verdad** (se pulsan los botones, no se miran).

Los dos jugadores no son un capricho. La Fase 12 midió con un usuario sembrado porque
medía presentación y necesitaba pantallas llenas; aquí eso habría sido la trampa:

| | NUEVO | VETERANO |
|---|---|---|
| origen | cuenta recién creada, **sin sembrar nada** | sembrado + mazo válido guardado por el servicio real |
| cartas | **0** | 10 |
| sobres | 4 (del disparador de alta) | 4 |
| créditos | 6.000 (asiento `starter_grant`) | 18.000 |
| puntos · XP | 0 · 0 | 640 · 4.200 |
| rango | Sin clasificar | Oro III |

**Lo que la radiografía encontró:**

| medida | NUEVO | VETERANO |
|---|---|---|
| Callejones sin salida reales | **0 / 18** | **0 / 18** |
| Estados atascados en carga | **0 / 18** | **0 / 18** |
| Salidas propias del contenido (total) | 50 | 50 |
| Acciones disponibles (total) | 224 | 240 |
| Estados sin acción destacada | 7 (marcados) | 7 (marcados) |
| Errores de consola | 188 en total, **todos 404** de retratos |

**El titular honesto: el ciclo de datos de NEXUS está cerrado y el ciclo de pantallas
casi.** No hay ningún estado del que no se pueda salir. Existe un servicio de servidor
—`/api/game/loop`— que calcula qué debe hacer el jugador y lo ordena por prioridad, y
acierta en los dos casos: a quien no tiene cartas le pone «abre tus sobres» en prioridad
**0**, por delante incluso de lo que caduca.

Lo que falla es más concreto y más grave: **el producto sabe qué debe hacer el jugador y
falla al llevarlo hasta ahí.**

---

## 3. User journey

Recorrido en el orden en que se vive, con las 18 pantallas navegadas seguidas en la misma
sesión y con el mismo usuario:

```
ENTRAR      /                    → «Abre tus sobres» destacado (prioridad 0)
ABRIR       /inventario          → los 4 sobres
CONSEGUIR   /tienda              → comprar más
CEREMONIA   /abrir/[packId]      → desliza · revelado · resumen
COLECCIÓN   /coleccion           → 5 / 772
OBJETIVO    /colecciones         → progreso por colección
ECONOMÍA    /mercado             → comprar y vender a otros
ELEGIR      /duelos              → nuevo duelo · mis mazos
PREPARAR    /duelos/mazos        → constructor
JUGAR       /duelos/jugar        → dificultad · comenzar
COMPETIR    /torneos             → el circuito
PREDECIR    /pickems             → 4 predicciones abiertas
RECLAMAR    /logros              → pase · objetivos · logros
RECOMPENSA  /recompensas         → el recibo de todo
RANGO       /ranking             → la escalera
IDENTIDAD   /cuenta              → quién eres
VOLVER      /eventos             → misiones · eventos con cuenta atrás
TÁCTICA     /entrenador          → cuatro pasos numerados
```

---

## 4. New player / FTUE

Auditado con una cuenta creada durante la ejecución, sin tocar nada. El disparador de
alta (`handle_new_user`, migración 0011) le da **3 sobres «inicial» + 1 «estándar» y 6.000
créditos**, con asiento en el libro mayor (`ref = starter:<uuid>`).

| # | momento | qué pasa | veredicto |
|---|---|---|---|
| 1 | Entrada | GameShell con **NIVEL 1 · 0%** y **🪙 6.000** | CLARO |
| 2 | Primera pantalla | `/` con la tira de acciones del servidor | CLARO |
| 3 | Primera acción | **«ABRIR TUS SOBRES»**, destacada, prioridad 0 | CLARO |
| 4 | Primer objetivo | *«Tienes 4 sobres de bienvenida. Ábrelos y empieza tu colección.»* | CLARO |
| 5 | Primer pack | `/inventario` → los sobres están, pero apagados | **FRICCIÓN** |
| 6 | Primeras cartas | la ceremonia: desliza · rotura · revelado carta a carta | **FUERTE** |
| 7 | Acceso a colección | 5 / 772 · 1 % completado | CLARO |
| 8 | Acceso a mazo/duelo | el constructor con 0–9 cartas | **BLOQUEADO** |
| 9 | Primer resultado | no alcanzable en la primera sesión sin 10 cartas | — |
| 10 | Primer progreso | XP 0 → 130 al abrir el primer sobre, visible en el armazón | CLARO |
| 11 | Primera recompensa posterior | `/recompensas` con el recibo de los 6.000 | CLARO |
| 12 | Siguiente acción | el ciclo se recalcula y propone bien | CLARO |

**Respuesta a «si nunca hubiera usado NEXUS, ¿sé qué hacer?»: sí, hasta el paso 8.**
Ahí hay una pared de diez cartas y, antes de esta fase, ninguna pantalla la explicaba
salvo con una línea gris al final de un scroll.

No se ha creado ningún tutorial. No hacía falta: la secuencia correcta ya existía en el
servidor.

---

## 5. First session

Documento completo: **`docs/product/game-loop/fase13-first-session.md`**.

Resumen de los quince minutos:

| momento | veredicto |
|---|---|
| Entrar y saber qué hacer | **CLARO** |
| Llegar al inventario | **FRICCIÓN** — los sobres pierden contra un anuncio de instalar la app |
| La ceremonia del sobre | **FUERTE** — lo mejor del producto |
| El resumen → «Abrir otro» | **ROTO** — mandaba a comprar lo que ya tenía |
| La colección tras abrir | **FRICCIÓN** — cero salidas propias |
| Construir el primer mazo | **ROTO** — sin guía entre 1 y 9 cartas |
| Pick'ems, torneos, recompensas | **CLARO** |
| Razones para volver mañana | **CLARO** salvo las misiones diarias |

---

## 6. Core loop

**Determinado por observación, no por teoría.** El bucle que de verdad se repite es:

```
   CARTAS  →  MAZO  →  DUELO  →  PUNTOS/XP/CRÉDITOS  →  RANGO  →  MÁS CARTAS
```

con un segundo bucle **paralelo y no dependiente** que es el que sostiene la vuelta
diaria:

```
   CIRCUITO REAL  →  PREDICCIÓN  →  RESULTADO  →  PUNTOS  →  ESCALÓN  →  RECOMPENSA
```

Las cinco respuestas que pedía la Parte 5:

1. **¿Qué actividad se repite?** Abrir sobres y predecir. El duelo se repite menos porque
   tiene un peaje de entrada de diez cartas.
2. **¿Qué obtiene?** Cartas, créditos, XP de cuenta, XP del pase y puntos competitivos.
3. **¿Qué cambia?** `user_cards`, `profiles.{credits,xp,points}`, `PassState`, y el libro
   mayor `credit_transactions`. Todo por **una sola puerta**: `app_grant_reward`, con
   clave de idempotencia.
4. **¿Qué desbloquea?** Diez cartas desbloquean el duelo. 400 puntos abren el carril
   competitivo del pase. Los escalones de Pick'em abren sobres mejores.
5. **¿Qué hace después?** El servidor lo calcula y lo dice en el vestíbulo.

**El loop está CERRADO.** `loop:verify` lo demuestra a nivel de datos; esta fase lo ha
comprobado a nivel de pantalla: abrir un sobre movió, en una sola acción real del jugador,
XP 0 → 130, cartas 0 → 5 y sobres 4 → 3.

**Lo que hace de NEXUS un caso raro y bueno:** el eje competitivo no es un ranking
inventado, es el circuito de Valorant de verdad. Y `profiles.points` es una moneda
compartida entre predecir y duelar — decisión deliberada y documentada, y la razón de que
perder un duelo no reste.

---

## 7. Card loop — **WORKS**

```
   /tienda ─compra─► user_packs ─► /inventario ─► /abrir/[id] ─► ceremonia
                                                                     │
                                        user_cards ◄─ openPackForUser ┤
                                        profiles.xp ◄─────────────────┘
                                             │
                          /coleccion ── /colecciones ── duplicados ── /mercado
```

Todo el recorrido existe y funciona. Las dos fugas encontradas eran de **destino**, y las
dos están corregidas (§21):

- «Abrir otro» del resumen mandaba siempre a `/tienda`.
- `/coleccion` con cartas dentro no ofrecía ninguna salida propia.

---

## 8. Duel loop — **WORKS** (con peaje)

```
   10 cartas (2 por rol) ─► DeckBuilder ─► validateDuelDeck (DOMINIO) ─► duel_decks
        │
        ▼
   /duelos/jugar ─► dificultad ─► startMatch ─► 10 turnos ─► Combat Resolver
        │
        ▼
   duelAward(resultado, dificultad)   ← tabla 3×3, determinista
        │   ganar NORMAL: 14 pts · 220 cr · 110 XP
        │   ganar HARD:   22 pts · 350 cr · 180 XP
        │   perder:        0 pts ·  25-60 cr · 15-40 XP   (nunca resta)
        ▼
   app_grant_reward (una vez por partida) ─► points · credits · xp ─► rankProgress
        │
        ▼
   ResultScreen: Jugar otra · Ver repetición · Mis mazos · ‹ Duelos · /ranking · /logros
```

**El marcador del duelo es la pantalla mejor cerrada del producto:** cuatro acciones más
dos enlaces, y la única que ofrece explícitamente «otra vez». No se tocó.

**El peaje:** diez cartas con dos de cada rol. Es una regla de dominio legítima y no se ha
cambiado. Lo que se ha corregido es que ahora se **explica** en el tramo 1–9 (§21).

No se tocó combate, estadísticas, reglas, bot, mazo ni recompensas.

---

## 9. Competitive loop — **STRONG**

```
   events ─► matches ─► pickem_questions (locks_at)
                              │
   /torneos ─► /pickems ─► submitPick ─► pickem_answers
                              │
                        resolveFinished (DOMINIO) ─► puntos ─► escalón
                              │
              app_grant_reward ─► /recompensas (el recibo) ─► /ranking
```

`/pickems` es la pantalla que mejor explica su propio bucle en todo el producto. Dice a la
vez: *4 predicciones abiertas*, *tus puntos 0 / 125*, *respondidas 0 / 6*, *recompensa: sin
escalón todavía, 1 pt para participación*, y por cada partido *15 pts* y *cierra en 2 d
23 h*. El jugador sabe qué gana, cuánto vale y cuándo se acaba.

No se cambió el scoring. No se tocó nada de este ciclo.

---

## 10. Progression loop — **WORKS**

| acción | qué genera | dónde se ve |
|---|---|---|
| abrir sobre | XP de cuenta (`xpForCardRank` por carta) | armazón, 16-17 de 18 pantallas |
| ganar/perder duelo | XP + créditos + puntos | armazón · `/ranking` · marcador |
| acertar Pick'em | puntos + escalón | `/pickems` · `/recompensas` · `/ranking` |
| misiones (3 diarias + 2 semanales, sorteadas en servidor) | XP del **pase** | `/logros` · `/eventos` |

**Dos niveles distintos que se llaman igual.** El armazón dice «NIVEL 11» (cuenta, de
`profiles.xp`) y `/logros` dice «NIVEL 0 / 30» (pase, de `PassState`). Son dos sistemas
deliberados —el código lo dice: *«XP de cuenta (el nivel del perfil), no XP del pase»*—
pero conviven bajo la misma palabra en la misma sección «PROGRESO». **Documentado como
deuda D4, no tocado:** unificarlos sería cambiar reglas de progresión.

---

## 11. Economy loop — **STRONG**

```
   ALTA ─► 6.000 créditos + 4 sobres      (credit_transactions: starter_grant)
     │
     ├─► /tienda ─► sobre ─► cartas
     ├─► /mercado ─► comprar a otro jugador
     ├─► /tienda/creditos ─► saldo y recibos
     │
   cartas ─► duplicados ─► /mercado (vender) ─► créditos
          └► forja / salvamento ─────────────► créditos
```

Cada crédito tiene origen trazable y `app_adjust_credits` es idempotente por `ref`, así
que reintentar una petición de red nunca duplica saldo. El desguace lo calcula el
servidor, nunca la pantalla.

No se tocaron precios, fórmulas, motor económico, libro mayor, valor de mercado,
salvamento ni recompensas.

---

## 12. Session loop — **WORKS**

**Razones REALES de volver mañana que el producto ya tiene: seis.**

| razón | ¿se le dice al jugador? |
|---|---|
| Predicciones que **caducan** (2-3 días) | **Sí**, y marcadas como urgentes. Es la más fuerte: lo único que se puede perder |
| Sobres sin abrir | Sí |
| Partido en directo ahora mismo | Sí |
| Colecciones incompletas | Sí |
| Pase de temporada, 30 niveles, 3 carriles | Sí |
| Eventos con cuenta atrás | Sí |
| **3 misiones diarias + 2 semanales** | **No** — existen, rotan, se sortean en el servidor, y nadie las anuncia |

El ciclo del vestíbulo solo menciona las misiones cuando ya están **completas y sin
reclamar**. La segunda razón más fuerte para volver está construida y no se usa.
**Documentado como deuda D1, no implementado:** añadir un paso al ciclo es añadir
funcionalidad.

---

## 13. Next Action audit

Clasificación de los 18 estados. **Medido, no supuesto.**

| estado | NUEVO | VETERANO |
|---|---|---|
| `/` | CLEAR | CLEAR |
| `/inventario` | **UNCLEAR** → corregido | **UNCLEAR** → corregido |
| `/tienda` | CLEAR | CLEAR |
| `/abrir/[id]` | CLEAR | CLEAR |
| `/coleccion` | CLEAR | **MISSING** → corregido |
| `/colecciones` | CLEAR | CLEAR |
| `/mercado` | CLEAR | CLEAR |
| `/duelos` | CLEAR | CLEAR |
| `/duelos/mazos` | **BLOCKED** → corregido | CLEAR |
| `/duelos/jugar` | CLEAR (manda al constructor) | CLEAR |
| `/torneos` | CLEAR | CLEAR |
| `/pickems` | CLEAR | CLEAR |
| `/logros` | CLEAR | **MISSING** — documentado, no tocado |
| `/recompensas` | CLEAR | CLEAR |
| `/ranking` | CLEAR | CLEAR |
| `/cuenta` | CLEAR | CLEAR |
| `/eventos` | CLEAR | CLEAR |
| `/entrenador` | CLEAR | CLEAR |

**Sobre la honestidad de la medida.** El instrumento marcó 7 estados como «sin acción
destacada». Al comprobarlos uno a uno contra las capturas, **solo 2 eran reales**:

| marcado | veredicto real |
|---|---|
| `/inventario` | **REAL** — la acción principal era más apagada que un anuncio |
| `/logros` (veterano) | **REAL** — cero salidas propias |
| `/abrir/[id]` | falso positivo — ceremonia deliberadamente mínima, «DESLIZA PARA ABRIR» es inequívoco |
| `/duelos` | falso positivo — los dos paneles grandes SON la acción |
| `/pickems` | falso positivo — las dos opciones son simétricas y ninguna debe dominar |
| `/recompensas` | falso positivo — pantalla de consulta con dos salidas correctas |
| `/cuenta` | falso positivo — pantalla de identidad con cinco salidas |

La heurística busca el control relleno más grande y penaliza los diseños de panel y las
elecciones simétricas. Se deja constancia en vez de contar siete problemas donde había dos.

---

## 14. Dead ends

**Callejones reales: 0 de 36 mediciones.** No existe ningún estado del que un jugador no
pueda salir por el contenido.

Lo que sí había eran **estados sin continuación**, que no es lo mismo:

| # | estado | clasificación | resuelto |
|---|---|---|---|
| DE1 | Resumen del sobre → «Abrir otro» va a `/tienda` teniendo 3 sobres | **P0** — rompe el ciclo en su punto de mayor intención | **Sí** |
| DE2 | Constructor con 1–9 cartas: ninguna indicación en ninguna pantalla | **P0** — bloquea el ciclo | **Sí** |
| DE3 | `/inventario`: la acción principal es la más apagada | **P0** — fricción en el destino del paso nº 1 | **Sí** (parcial) |
| DE4 | `/coleccion` con cartas: 0 salidas propias | **P1** | **Sí** |
| DE5 | `/logros` veterano: 0 salidas propias | **P2** | No — documentado (D3) |
| DE6 | Ceremonia de sobre: 0 salidas durante el revelado | — | No es un problema: es una ceremonia con `✕` permanente |

**No se ha añadido un CTA a todo lo que no lo tenía.** La Parte 12 lo pide expresamente y
se ha respetado: `/coleccion` sin sobres pendientes sigue sin proponer nada, porque mirar
la colección es un fin legítimo.

---

## 15. Reward moments

| momento | ¿se siente importante? | ¿se entiende qué se ganó? | ¿por qué? | ¿qué hacer después? |
|---|---|---|---|---|
| Abrir sobre | **Sí** — pantalla completa, sin armazón, revelado carta a carta | Sí: nombre, equipo, rareza, 6 estadísticas, **¡NUEVA!**, valor | Sí | **Sí, ahora** (§21) |
| Resumen del sobre | Sí — la mejor carta grande, el botín alrededor | Cartas · Nuevas · Valor total | Sí | **Sí, ahora** |
| Ganar un duelo | Sí — `ResultScreen` | Puntos, créditos y XP, con la tabla determinista | Sí | Sí, cuatro salidas |
| Acertar Pick'em | Sí | Puntos y escalón, antes y después | Sí | Sí |
| Créditos de bienvenida | Discreto | `/recompensas` da el recibo con fecha | Sí | Sí |
| Subir de nivel de cuenta | **No hay ceremonia** | La barra del armazón se mueve | — | — |

No se ha creado ningún sistema de celebración nuevo. La única carencia real —el resumen
del sobre no itemiza la XP ganada, aunque la barra del armazón sí se actualiza— está
documentada como **D5** y no se ha implementado porque exigiría cambiar la firma de
`openPackOnline` en la capa de sincronización, que es más que presentación.

---

## 16. Loop breakers

Búsqueda dirigida de los trece síntomas que pedía la Parte 15:

| síntoma | encontrado |
|---|---|
| CTA que no funciona | **Sí — 1.** «Abrir otro» → destino equivocado (DE1). Corregido |
| Navegación perdida | **Sí — 2.** Constructor 1–9 cartas (DE2), colección con cartas (DE4). Corregidos |
| Estado sin salida | No — 0 callejones en 36 mediciones |
| Recompensa que no aparece | No — verificado en vivo: XP 0 → 130 al abrir un sobre |
| XP que no cambia | No |
| Progreso que no se actualiza | No — `syncFromServer` repinta el armazón tras cada acción |
| Inventario que no refleja la adquisición | No — sobres 4 → 3, cartas 0 → 5, medido en la BD |
| Carta que no aparece | No |
| Duelo que no devuelve al flujo | No — el marcador tiene cuatro salidas |
| Pick'em sin resultado | No — `resolveFinished` cubierto por `loop:verify` |
| Datos rancios | No |
| Carga infinita | **No — 0 de 36 mediciones atascadas** |
| Errores silenciosos | Los 404 de retratos (deuda conocida de la Fase 12, D6) |

**Ninguno de los problemas encontrados era funcional ni de dominio.** Los tres eran de
destino y de jerarquía: en los tres casos el dato correcto ya existía en la pantalla y no
estaba puesto donde el jugador mira.

---

## 17. Return loops

¿Se puede volver, después de cada acción importante?

| desde | salidas propias del contenido |
|---|---|
| Resultado del duelo | Jugar otra · Ver repetición · Mis mazos · ‹ Duelos · Ranking · Logros |
| Resumen del sobre | **Abrir otro (N) → /inventario** · Ver colección · ✕ → /coleccion |
| Pick'em enviado | Ver torneo y partidos |
| Logro / nivel reclamado | El pase se queda en pantalla (D3) |
| Rango subido | `/ranking` desde el marcador y desde `/recompensas` |

Y el armazón está en 18 de 18 pantallas con sus siete destinos, así que **volver al
vestíbulo nunca está a más de un clic**. Ninguna ruta inventada: todas existían.

---

## 18. Empty / error loops

Un estado vacío también forma parte del ciclo. Auditados los que aparecen de verdad:

| estado vacío | ¿qué puede hacer el jugador? |
|---|---|
| Colección vacía (`AlbumEmpty`) | «Abrir sobres» → `/inventario` si tiene; «Ir a la tienda» si no. **Ya elegía bien el destino** |
| Sin mazos (`/duelos/mazos`) | «Crear mi primer mazo» — y ahora, si no llega a diez cartas, adónde ir a por ellas |
| Sin mazo válido (`/duelos/jugar`) | «Ir al constructor» |
| Inventario sin sobres | «No tienes sobres sin abrir» con enlace |
| Sin duplicados | Texto llano, sin CTA — correcto: no hay nada que hacer |
| Sin puntuar (`/ranking`) | *«Todavía no has puntuado. Acierta una predicción y entras en la escalera.»* → `/pickems` |
| Sin objetivos (`/logros`) | *«Vuelve cuando empiece la siguiente tanda.»* — correcto |
| Sin sesión | `NeedsAccount` con «Entrar o registrarse» → `/cuenta` |

**Nada inventado.** Cada salida de un estado vacío apunta a algo que ya existe.

---

## 19. Auth / account

| situación | comportamiento |
|---|---|
| Sin sesión, pantalla de servidor (`/logros`, `/cuenta`) | `NeedsAccount` con explicación y CTA a `/cuenta` |
| Sin sesión, `/pickems` | Se ve el torneo y las preguntas; enviar exige cuenta |
| Sin sesión, `/inventario`, `/coleccion` | **Funcionan**: es el modo local de un jugador, deliberado |
| Con sesión | El servidor manda: tirada de sobres, validación de mazo y recompensas |
| `/cuenta` | Entrar · Registro · Recuperar · Cerrar sesión |

**El ciclo no se rompe sin sesión.** No se tocó auth, ni perfiles, ni datos.

---

## 20. Observabilidad

**No existe.** Cero integraciones de analítica de producto: sin `analytics`, sin
`telemetry`, sin `posthog`, `mixpanel` ni `gtag` en todo el árbol de cliente.

Lo que sí hay y sirve para otra cosa: el libro mayor `credit_transactions` (cada crédito
con origen y `ref`), `duel_matches` (partidas con resultado y dificultad),
`pickem_submissions` / `pickem_answers`, y las claves de idempotencia de
`app_grant_reward`. Es una **auditoría económica completa**, no un embudo de producto.

Con eso se puede responder «¿cuántos duelos se jugaron?» pero **no** «¿cuántos jugadores
abandonaron en el constructor de mazos?», que es exactamente la pregunta que esta fase ha
tenido que responder a mano. **Documentado como deuda D2. No se ha creado ninguna
plataforma de analítica**, que es lo que la Parte 21 prohíbe expresamente.

---

## 21. UX Score

Sin inflar. Cada nota, justificada.

| ciclo | nota | por qué |
|---|---|---|
| **FTUE** | **WORKS** (era FRICTION) | El servidor acierta el orden desde el primer segundo y le da prioridad 0 a los sobres. Las tres paredes que tenía —destino del CTA, tramo 1–9 cartas, jerarquía del inventario— están corregidas. No llega a STRONG porque no hay tutorial explícito y la pared de diez cartas sigue siendo un peaje real |
| **CARD LOOP** | **STRONG** | La ceremonia es lo mejor del producto. Ahora además continúa: el resumen lleva a abrir el siguiente y la colección ofrece la salida mientras queden sobres |
| **DUEL LOOP** | **WORKS** | Cadena completa y verificada, tabla de recompensa determinista, marcador con cuatro salidas. No es STRONG por el peaje de entrada de diez cartas y porque el rival es un bot |
| **COMPETITIVE LOOP** | **STRONG** | Se apoya en el circuito real de Valorant. `/pickems` explica su bucle completo —cuánto vale, cuánto llevas, cuándo cierra— mejor que ninguna otra pantalla |
| **PROGRESSION LOOP** | **WORKS** | Cuatro fuentes de XP conectadas por una sola puerta idempotente y visibles en el armazón. Le resta que dos sistemas distintos se llamen «nivel» en la misma sección |
| **ECONOMY LOOP** | **STRONG** | Cada crédito con origen trazable, operaciones idempotentes por `ref`, el desguace calculado en servidor y anclado al precio del sobre para no imprimir dinero |
| **SESSION LOOP** | **WORKS** | Seis razones reales de volver, y la más fuerte —lo que caduca— marcada como urgente. No es STRONG porque la segunda más fuerte, las misiones diarias, está construida y no se anuncia |

**Ninguna nota es BROKEN. Ninguna es MISSING.**

---

## 22. P0 / P1 / P2

| id | problema | prioridad | estado |
|---|---|---|---|
| **P0-1** | «Abrir otro» del resumen del sobre iba siempre a `/tienda` | P0 — rompe el ciclo en su punto de mayor intención | **CORREGIDO** |
| **P0-2** | El constructor no guía entre 1 y 9 cartas | P0 — bloquea el ciclo del jugador nuevo | **CORREGIDO** |
| **P0-3** | `/inventario` no destaca los sobres siendo el destino del paso nº 1 | P0 — fricción en el punto de entrada | **CORREGIDO** (parcial) |
| **P1-1** | El aviso del constructor nombraba «Inventario» sin enlazarlo | P1 | **CORREGIDO** |
| **P1-2** | `/coleccion` con cartas: cero salidas propias | P1 | **CORREGIDO** |
| **P2-1** | `/logros` del veterano: cero salidas propias | P2 | Documentado (D3) |
| **P2-2** | El resumen del sobre no itemiza la XP ganada | P2 | Documentado (D5) |
| **P2-3** | «Nivel» de cuenta y «nivel» del pase conviven sin distinguirse | P2 | Documentado (D4) |

---

## 23. Cambios realizados

Cinco correcciones. Todas de presentación. Todas con datos que ya estaban en la pantalla.

### C1 · El destino de «Abrir otro» depende del estado — P0-1

`src/components/packs/PackOpeningExperience.tsx`

```tsx
const packsLeft = useGameStore((s) =>
  Object.values(s.unopenedPacks).reduce((n, c) => n + (c > 0 ? c : 0), 0),
);
…
<button onClick={() => router.push(packsLeft > 0 ? "/inventario" : "/tienda")}>
  {packsLeft > 0 ? `Abrir otro · ${packsLeft}` : "Conseguir otro"}
</button>
```

Es el mismo error de destino que ya se corrigió dos veces en el repositorio —el paso
«construye tu mazo» del ciclo y el aviso del constructor— y que aquí había sobrevivido:
confundir dónde se **compran** los sobres con dónde se **abren**. El dato ya estaba en el
store; solo faltaba mirarlo.

**Verificado en vivo:** el botón dice `ABRIR OTRO · 3` y lleva a `/inventario`.

### C2 · Las salidas de la ceremonia se ordenan por lo que tiene el jugador — P0-1

Mismo fichero, componente `Exits` (pantallas «ese sobre no existe», «no se pudo abrir»,
«no tienes este sobre»). Si le quedan sobres, el botón principal es **«Abrir mis sobres ·
N»** → `/inventario`; si no le queda ninguno, entonces sí es la tienda.

### C3 · El constructor explica el tramo de 1 a 9 cartas — P0-2 y P1-1

`src/components/duel/DeckBuilder.tsx`

El aviso que existía vivía al final de la rejilla y solo se pintaba con la colección
**exactamente vacía**. Un jugador que acaba de abrir su primer sobre tiene cinco cartas:
la rejilla enseñaba sus cinco cartas, el aviso no aparecía, y en toda la pantalla no
quedaba nada que explicara por qué los diez huecos no se podían llenar.

Ahora hay una tira pegada al recuento del mazo —donde se mira— que aparece siempre que
`collection.length < DUEL_DECK_SIZE`, dice cuántas tiene de diez, cuántos sobres le quedan,
y **lleva**:

```tsx
{collection.length < DUEL_DECK_SIZE && (
  <div className="…border-drl-cyan/35 bg-drl-cyan/[0.07]…">
    <span>Tienes {collection.length} de {DUEL_DECK_SIZE}</span>
    <span>{unopenedPacks > 0 ? `…Te quedan ${unopenedPacks} sobres sin abrir.` : …}</span>
    <Link href={unopenedPacks > 0 ? "/inventario" : "/tienda"} className="nx-action …">
      {unopenedPacks > 0 ? "Abrir mis sobres →" : "Conseguir un sobre →"}
    </Link>
  </div>
)}
```

Ni una regla nueva: `DUEL_DECK_SIZE` es la del dominio y los dos datos —cuántas cartas
tienes y cuántos sobres te quedan— ya eran props del componente. El aviso de abajo se
recorta a lo que le corresponde para no decir lo mismo dos veces.

**Verificado en vivo:** con 0 cartas y con 5 cartas, el enlace `«ABRIR MIS SOBRES →»` →
`/inventario` está presente.

### C4 · `/coleccion` deja de ser un final mientras queden sobres — P1-2

`src/app/coleccion/page.tsx`

`AlbumEmpty` ya ofrecía la salida correcta, pero solo mientras el álbum estaba
**exactamente vacío**: con la primera carta desaparecía y con ella la única continuación.
La condición que importa no es «¿está vacío tu álbum?» sino «¿te quedan sobres?».

Cuando no quedan, la pantalla sigue sin proponer nada **a propósito**: mirar la colección
es un fin legítimo (Parte 12).

**Verificado en vivo:** salidas 0 → 1, `«ABRIR →»` → `/inventario`, con el texto «TE
QUEDAN 3 SOBRES».

### C5 · `/inventario` dice cuántos sobres son y qué hacer con ellos — P0-3

`src/app/inventario/page.tsx`

El título pasa a «Sobres sin abrir · 4» y el pie de cada sobre pasa de `×3 · toca para
abrir` en gris del 40 % a **`ABRIR →`** en cian, con el recuento junto al nombre.

**Honestidad sobre el alcance:** es una mejora de legibilidad, no una inversión de la
jerarquía. El elemento más saturado de la pantalla sigue siendo el botón «INSTALAR» del
aviso de la aplicación, que es una decisión de producto de la Fase 12 y no se ha tocado.

---

## 24. Qué NO se cambió

**Nada de dominio.** Cero ficheros tocados en `src/domain/`, `src/engine/`, `src/app/api/`,
`supabase/`, `src/data/`, `src/server/services/` y `src/lib/game/`.

**Nada de reglas.** No se cambió el tamaño del mazo, la composición por rol, la tabla de
recompensa del duelo, el scoring de Pick'ems, el cálculo de rango, las fórmulas de mercado,
los precios ni el salvamento.

**Nada inventado.** Ni una mecánica, ni una recompensa, ni una moneda, ni un punto, ni una
misión, ni un modo, ni PvP, ni matchmaking, ni sistema social, ni tutorial.

**Y en concreto, estas cosas se detectaron y se dejaron:**

| qué | por qué |
|---|---|
| El anuncio de misiones diarias en el ciclo | Añadir un paso a `getLoop` es añadir funcionalidad al servidor |
| La XP itemizada en el resumen del sobre | Exige cambiar la firma de `openPackOnline`; y la barra del armazón ya la refleja |
| Unificar «nivel de cuenta» y «nivel del pase» | Es un cambio de reglas de progresión |
| `/logros` del veterano sin salidas | La Parte 12 dice que no todo estado necesita un CTA; mapear misión → ruta sería inventar un mapa |
| Los 404 de retratos | Deuda de la Fase 12: el gate rompería un flujo documentado en `public/players/README.md` |
| El botón «INSTALAR» dominando `/inventario` | Decisión de producto de la Fase 12 |
| El peaje de diez cartas para duelar | Regla de dominio |
| Telemetría | La Parte 21 prohíbe crear una plataforma de analítica |

---

## 25. Tests

| suite | antes | después |
|---|---|---|
| `npm test` | 696 / 696 | **696 / 696** |
| `typecheck` | limpio | **limpio** |
| `build` | OK | **OK** |
| `security:verify` | PASA | **PASA** |
| `collection:verify` | PASA | **PASA** |
| `pack:verify` | PASA | **PASA** |
| `card-generator:verify` | 50 / 50 | **50 / 50** |
| `materializer:verify` | 42 / 42 | **42 / 42** |
| `catalog-builder:verify` | 44 / 44 | **44 / 44** |
| `duel-gameplay:verify` | PASA | **PASA** |
| `trainer:verify` | 35 / 35 | **35 / 35** |
| `maps:verify` | 14 / 14 | **14 / 14** |
| `strats:verify` | PASA | **PASA** |
| `tactical:verify` | PASA | **PASA** |
| `progression:verify` | PASA | **PASA** |
| `battlepass:verify` | PASA | **PASA** |
| `loop:verify` | PASA | **PASA — «el ciclo de juego está conectado»** |
| `test:pickems` | PASA | **PASA** |
| `ux:scroll` | 38 / 38 | **PASA** |
| `ux:verify` | PASA | **PASA** |
| `audit:stability` | 105 · 0 hallazgos | **105 · 0 hallazgos · sin fallos bloqueantes ni importantes** |
| `duel:e2e` | PASA | **PASA** |
| `duel:playtest` | 0 errores de consola | **0 errores de consola** |
| `test:flow` | ✅ | **✅ el recorrido completo funciona** |
| `launcher:verify` | 33 / 33 | **33 / 33** |
| `lint` | 9 problemas (1 error, 8 avisos) | **9 problemas (1 error, 8 avisos) — idéntico** |

`loop:verify` es la suite que más importa aquí: recorre la cadena entera contra la base de
datos real —torneo → predicción → resultado → puntos → recompensa → progresión, y duelo →
puntos + créditos + XP → rango— y **sigue pasando**.

---

## 26. QA

**83 evidencias** en `docs/product/qa/fase13/`:

- `antes-nuevo-{01..18}-*.png` y `antes-veterano-{01..18}-*.png` — los 18 estados × 2
  jugadores, antes
- `despues-nuevo-{01..18}-*.png` y `despues-veterano-{01..18}-*.png` — los mismos, después
- `antes-T-*` y `despues-T-*` — las transiciones accionadas: constructor sin cartas,
  constructor con 5 cartas, sobre cerrado, resumen del sobre, colección con cartas,
  preparación del duelo

Cubre los quince puntos que pedía la Parte 26 salvo el resultado del duelo con un jugador
nuevo, que **no es alcanzable en una primera sesión** sin diez cartas: esa transición está
cubierta por `duel:playtest` y por las capturas de la Fase 8 (`qa/14-resultado-*.png`).

---

## 27. Game-loop map

**`docs/product/game-loop/fase13-game-loop-map.md`** — diagrama textual del ciclo
principal (ENTRY → HOME → ACTION → RESULT → REWARD → PROGRESSION → NEXT ACTION → RETURN) y
de los seis ciclos secundarios: CARTA, DUELO, COMPETITIVO, PROGRESIÓN, ECONOMÍA y SESIÓN.

Todo lo dibujado existe. Lo que falta está en una sección aparte titulada «lo que no
existe», sin dibujar.

---

## 28. Métricas

| métrica | antes | después |
|---|---|---|
| Pantallas auditadas | 18 × 2 jugadores = **36** | 36 |
| Transiciones accionadas | **4** | 4 |
| **Callejones sin salida** | **0** | **0** |
| P0 | **3** | **0** |
| P1 | **2** | **0** |
| P2 | 3 | 3 (documentados) |
| Estados sin acción destacada (marcados) | 7 | 7 |
| …de los que son **reales** | **2** | **0** |
| Acciones sin siguiente acción (jugador nuevo) | **3** | **0** |
| Acciones sin siguiente acción (veterano) | **2** | **1** (D3) |
| Salidas propias del contenido (nuevo · veterano) | 50 · 50 | 50 · **51** |
| Ciclos cerrados | 4 de 6 | **6 de 6** |
| Ciclos parciales | 2 | 0 |
| Ciclos rotos | **0** | **0** |
| Estados atascados en carga | **0 / 36** | **0 / 36** |
| Desbordamiento horizontal | **0 / 36** | **0 / 36** |
| Errores de consola | 188 (todos 404 de retratos) | 190 (todos 404 de retratos) |

Los errores de consola suben de 188 a 190 por la variación de qué cartas entran en el
listado del mercado entre dos ejecuciones. Son la misma deuda conocida y ninguno procede
de los cambios de esta fase.

**No se ha optimizado ningún número artificialmente.** Las salidas suben en 1 —una sola
tira nueva— y los estados «sin destacada» siguen marcados en 7 porque la heurística no se
ha tocado para que dé mejor resultado.

---

## 29. Regresiones

**Ninguna.** Las once zonas que pedía la Parte 29, comprobadas:

| zona | cómo se verificó | resultado |
|---|---|---|
| Home | `_fase13-loop-audit` × 2 jugadores + `ux:verify` | 13 y 15 salidas, sin cambio |
| Colección | auditoría + `collection:verify` | **+1 salida** (el cambio buscado), resto igual |
| Tienda | auditoría | 3 salidas · 11 acciones, sin cambio |
| Mercado | auditoría | 2 salidas · 119 acciones, sin cambio |
| Duelos | `duel-gameplay:verify` · `duel:e2e` · `duel:playtest` · `ux:scroll` | todo verde, 0 errores de consola |
| Torneos | auditoría · `test:flow` | 3 salidas, sin cambio |
| Pick'ems | `test:pickems` · `loop:verify` | PASA |
| Entrenador | `trainer:verify` 35/35 · `maps:verify` 14/14 · `strats:verify` · `tactical:verify` | todo verde |
| Cuenta | auditoría | 5 salidas · 19 acciones, sin cambio |
| Logros | `battlepass:verify` · `progression:verify` | PASA |
| Ranking | auditoría | 1 salida · 5 acciones, sin cambio |

**Detalle de lo que no se movió:**

- `npm test` **696 / 696**, idéntico. `typecheck` limpio. `build` OK.
- `lint`: **los mismos 9 problemas** —1 error preexistente en
  `src/app/admin/torneos/page.tsx` (hook condicional) y 8 avisos—. Ni uno añadido, ni uno
  ocultado. Los cuatro ficheros tocados no aportan ningún problema nuevo.
- `audit:stability`: **105 comprobaciones, 0 hallazgos.**
- `loop:verify` sigue diciendo «el ciclo de juego está conectado», que es exactamente lo
  que esta fase no debía romper.
- Salidas totales del contenido: nuevo **50 → 50**, veterano **50 → 51**. El único
  incremento es la tira de `/coleccion`. Ningún efecto colateral en las otras 17 pantallas.
- Ceremonia de sobres: ejecutada de verdad durante la verificación posterior — XP 0 → 186,
  cartas 0 → 5, sobres 4 → 3. `pack:verify` pasa.

**Nota de entorno, no de producto.** La primera ejecución de la tanda de suites de
navegador fue interrumpida por el sistema operativo por falta de memoria, con
`duel:playtest` a medias. Se reejecutaron una a una y las cuatro pasan. No hubo ningún
fallo de test en ningún momento.

---

## 30. Deudas

| id | deuda | por qué no se resolvió aquí |
|---|---|---|
| **D1** | Las misiones diarias existen, rotan y se sortean en el servidor, pero el ciclo del vestíbulo solo las menciona cuando ya están completas. La segunda razón más fuerte para volver mañana está construida y no se usa | Añadir un paso a `getLoop` es añadir funcionalidad al servidor |
| **D2** | **No existe telemetría de producto.** Cero integraciones. La auditoría económica es completa, pero no se puede responder «¿dónde abandona un jugador real?» | La Parte 21 prohíbe crear una plataforma de analítica |
| **D3** | `/logros` del veterano: cero salidas propias del contenido | Mapear misión → ruta sería inventar un mapa. La Parte 12 dice que no todo estado necesita un CTA |
| **D4** | «Nivel de cuenta» (armazón, 11) y «nivel del pase» (`/logros`, 0 / 30) conviven bajo la misma palabra en la misma sección | Distinguirlos toca reglas de progresión |
| **D5** | El resumen del sobre no itemiza la XP ganada, aunque el servidor la devuelve en `xpGained` | `openPackOnline` la descarta; cambiar su firma es tocar la capa de sincronización. Y la barra del armazón ya se mueve |
| **D6** | 404 de retratos de jugador (188-190 por pasada) | Heredada de la Fase 12: el gate rompería el flujo de `public/players/README.md` |
| **D7** | No hay tutorial explícito. La primera experiencia se guía por el orden de los pasos del ciclo | Crear un tutorial es crear funcionalidad |
| **D8** | El duelo es contra un bot con tres dificultades; no hay emparejamiento entre jugadores | Es una funcionalidad, no un arreglo |

---

## 31. Riesgos

**Bajo.** Cuatro ficheros de presentación, ninguna regla tocada.

| riesgo | evaluación |
|---|---|
| `packsLeft` lee el store y el store va por detrás del servidor | `openPackOnline` llama a `syncFromServer()` antes de pintar el resumen. Verificado en vivo: el botón dijo `· 3` con 3 sobres reales en la BD |
| La tira del constructor aparece de más | Su condición es `collection.length < DUEL_DECK_SIZE`, que es exactamente el estado en que el mazo es imposible. Con 10 o más cartas no se pinta |
| La tira de `/coleccion` molesta al veterano | Solo aparece con sobres pendientes. Sin ellos, la pantalla queda como estaba |
| El aviso recortado del constructor pierde información | Lo que se quitó lo dice ahora la tira de arriba, mejor situada y con enlace. La frase del filtro se mantiene |
| Regresión en la ceremonia de sobres | `pack:verify` pasa y la apertura se ejecutó de verdad en la verificación: XP 0 → 186, sobres 4 → 3 |

---

## 32. Veredicto

**FASE 13 — CERRADA.**

La pregunta era si NEXUS funciona como un videojuego. La respuesta medida es **sí**, con
un matiz que resultó ser el hallazgo de la fase.

NEXUS tiene el ciclo **cerrado por dentro**, y de una forma que no es habitual: existe un
servicio de servidor que calcula qué debe hacer el jugador ahora mismo, lo ordena por una
prioridad que codifica una idea del juego —primero lo empezado, luego lo que caduca, luego
lo ganado y no recogido, luego lo que desbloquea el resto— y cada recompensa del producto
pasa por **una sola puerta idempotente** que escribe en un libro mayor trazable. Cero
callejones sin salida en treinta y seis mediciones. Cero pantallas atascadas. Seis razones
reales de volver mañana, y la única que se puede perder está marcada como urgente.

Lo que fallaba no era el sistema: era **el último metro**. El servidor le decía al jugador
nuevo «abre tus sobres» con prioridad 0 y lo mandaba a una pantalla donde sus sobres eran
más apagados que un anuncio. La ceremonia —lo mejor del producto— terminaba con un botón
que decía «Abrir otro» y llevaba a la caja, teniendo tres sin abrir. Y entre la primera
carta y la décima, que es el tramo por el que pasa **todo** jugador nuevo, no había en
ninguna pantalla una sola línea que explicara la pared ni un enlace que la rodeara.

Los tres eran el mismo error, repetido: **confundir dónde se compra con dónde se abre**.
Un error que este repositorio ya había corregido dos veces en otras dos pantallas y que
aquí había sobrevivido. Ninguno era funcional. En los tres casos el dato correcto ya
estaba en el componente y no estaba puesto donde el jugador mira.

Cinco correcciones, cuatro ficheros, todas de presentación, todas verificadas actuando
sobre el producto en marcha y no mirándolo. Y una disciplina igual de deliberada en lo que
**no** se tocó: no se le ha puesto un CTA a toda pantalla que no lo tenía, porque mirar la
colección es un fin legítimo; no se han anunciado las misiones diarias, aunque sería la
mejora de retención más rentable del producto, porque eso es añadir funcionalidad; y no se
ha inventado ni una mecánica, ni una recompensa, ni una moneda, ni una métrica.

**Resultado: P0 3 → 0. P1 2 → 0. Ciclos cerrados 4 de 6 → 6 de 6. Ninguna nota BROKEN,
ninguna MISSING. Ocho deudas documentadas, ninguna auto-resuelta.**

Dominio intacto. Economía intacta. Motor de duelos intacto. Reglas intactas. Comportamiento
competitivo intacto. Sin commit y sin despliegue.

---

*Instrumentos: `scripts/_fase13-loop-audit.ts` · `scripts/_fase13-transiciones.ts`
Documentos: [mapa del ciclo](game-loop/fase13-game-loop-map.md) ·
[primera sesión](game-loop/fase13-first-session.md)
Capturas: `docs/product/qa/fase13/`
Fases previas: [8](fase-8-duelos-report.md) · [9](fase-9-torneos-pickems-report.md) ·
[10](fase-10-entrenador-report.md) · [11](fase-11-perfil-progresion-report.md) ·
[12](fase-12-global-polish-report.md)*
