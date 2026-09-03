# FASE 15 — PRODUCT POLISH, LIVE VALIDATION & COMMERCIAL READINESS

> Dos frases y un enlace. Eso es todo lo que se ha cambiado, y es lo que separaba a un
> jugador nuevo de encontrar sus cartas.
>
> Estado: **entregada y verificada**. `npm test` **480/480** · typecheck ✅ · build ✅ ·
> `security:verify` ✅ · `economy:verify` ✅ · `events:verify` ✅ · `loop:verify` ✅ (**+5**) ·
> `progression:verify` ✅ · `content:verify` ✅ · `ux:verify` ✅ · `audit:interactions` ✅ ·
> `audit:stability` **P0 0 · P1 0** · `duel:e2e` ✅ · `duel-gameplay` ✅ · `strats` ✅ ·
> `sw:verify` ✅ · `test:integration` ✅ · `test:pickems` ✅ · `test:e2e` ✅ ·
> `economy:simulate` ✅ · `economy:model` ✅ · `content:audit` ✅ ·
> **`ftue:audit` ✅ (nuevo) — P0 0 · P1 0 · P2 0**.

---

## 1 · AUDITORÍA INICIAL

### El problema de método, antes que el de producto

Catorce fases de verificaciones y **ninguna** medía la primera experiencia. El motivo es
concreto y estaba a la vista: `ux:verify`, `audit:interactions`, `audit:stability` y
`visual-shots` usan todas una **cuenta sembrada** con 86 cartas, 5 sobres y 940 puntos.

Con esa cuenta, NEXUS se ve muy bien y **no se detecta ni uno** de los problemas de primera
vez, porque el jugador sembrado ya los ha superado todos.

Lo primero de esta fase fue construir la herramienta que faltaba: **`npm run ftue:audit`**.
Crea una cuenta **real y recién registrada** —lo que concede `handle_new_user` y nada más:
6.000 créditos, 3 Sobres Iniciales, 1 Estándar, cero cartas—, la recorre con un navegador y
la borra. Mide una sola cosa: **qué le propone el juego y si lo que encuentra encaja**.

### Con qué empieza un jugador nuevo (medido)

```
perfil: {"credits":6000,"level":1,"points":0,"distinct_cards":0}
sobres: [{"pack_id":"inicial","qty":3},{"pack_id":"estandar","qty":1}]
cartas: 0
```

---

## 2 · ESTADO DEL PRODUCTO

Los sistemas están. Lo que falla no es ninguno de ellos: es **la conversación** entre el
juego y quien entra por primera vez.

Y el fallo era coherente, no disperso. **El producto no sabía que el jugador ya tenía
sobres.**

---

## 3 · FIRST TIME USER EXPERIENCE

### Lo que le decía el juego, medido

```
1. HAZ TUS PREDICCIONES · CADUCA  →  /pickems
2. ABRE TUS SOBRES                →  /inventario
3. CONSTRUYE TU MAZO              →  /tienda
4. HAY PARTIDO EN DIRECTO         →  /torneos/…
```

**Dos problemas reales:**

**P1-A · Lo primero que se le proponía era predecir un torneo de Valorant** — antes de haber
visto una sola carta. Para quien vuelve está bien (caduca, es urgente); para quien entra es
desconcertante.

**P1-B · «Construye tu mazo» decía «Empieza abriendo un sobre» y enlazaba a `/tienda`**, que
es donde se **compran**. El jugador tiene cuatro sin abrir. El texto y el destino decían
cosas distintas.

**P1-C · El constructor de mazos repetía el error.** Con cero cartas mostraba «Todavía no
tienes cartas. Abre un sobre **en la Tienda** para empezar», mientras el ciclo del vestíbulo
apuntaba a `/inventario` para la misma acción. Dos destinos para lo mismo.

Los tres son el mismo fallo: **mandar a comprar lo que ya se tiene.** Y es exactamente el
punto donde alguien tiene que estar al lado diciendo *«no, primero abre los tuyos»* — que es
la definición de problema de UX que la Regla 2 pedía buscar.

### Lo que ya estaba bien

| Pantalla | Veredicto |
|---|---|
| `/inventario` | **Ejemplar.** «SOBRES 4», los dos tipos, «×3 · toca para abrir» |
| `/coleccion` vacía | Dice cómo conseguir la primera carta |
| `/duelos/jugar` sin mazo | Explica que hace falta un mazo y ofrece el camino |
| `/duelos/mazos` sin mazos | Explica la regla de composición y da una sola salida clara |
| Móvil 390 | **0 px** de desbordamiento |

---

## 4–11 · EL RESTO DE LOS SISTEMAS

**Duelos** — la presentación ya explica el resultado (banda «Has ganado» con puntos,
créditos y XP desde la Fase 10). El motor no se ha tocado, como exige la Regla 18.
**Colección** — genera objetivos desde la Fase 13 (77 conjuntos) y la 14 (prestigio).
**Packs** — desde la Fase 13 la tienda dice el reparto **medido** y para qué sirve cada
sobre, con su advertencia. Ni precios ni probabilidades tocados.
**Economía** — calibrada en la 12, con sumidero desde la 14. Sin cambios.
**Retención** — «Qué hacer ahora» (diario), pase y misiones (semanal), evento y Pick'ems
(torneo), maestría y prestigio (largo plazo). No hacía falta una plataforma de misiones.
**Live world** — el pipeline VLR está intacto y no se ha duplicado.
**Perfil** — identidad completa desde la 14 (rango, nivel, título, marco, banderín, insignia,
vitrina de prestigio, cartas destacadas).
**Cosméticos** — desbloquear → equipar → ver, cerrado desde la 12, con 231 ids derivados.

**Ninguno necesitaba cambios en esta fase**, y no se han hecho.

---

## 12–13 · MARKETPLACE Y PAYMENTS

`GLOBAL_MARKET_ENABLED = false` · `PAYMENTS_ENABLED = false`. **Ninguno tocado.** Los
criterios de apertura y las nueve cifras a medir siguen escritos en `marketplace.md`.

---

## 14 · DEUDAS CONOCIDAS

| # | Deuda | ¿Sigue? | ¿Se puede resolver ya? | Decisión |
|---|---|---|---|---|
| 1 | 8 jugadores con galardón y sin carta | Sí | **No** — hace falta autoría editorial de una persona | No hacer. En trinquete en `content:verify` |
| 2 | `americas-mvp` sin portador | Sí | **No** — no consta el premio en los datos | No hacer |
| 3 | Rareza alta de China | Sí | **No** — depende del palmarés real | No hacer. La tienda ya lo advierte |
| 4 | Devolver Prime al escaparate | Sí | **No** — el catálogo sigue sin sostener un cuarto sobre | No hacer |
| 5 | Mapa/MVP en Match Challenges | Sí | **No** — `matches` no guarda mapa ni MVP | No hacer |
| 6 | Maestría por temporada | Sí | **No** — el catálogo no marca cartas por temporada | No hacer |
| 7 | Marketplace | Sí | **No** — falta masa de jugadores | No hacer |
| 8 | Validación con torneo real | Sí | **No** — hace falta un torneo real en el pipeline | No hacer |

**Ocho deudas, cero resueltas, y ninguna por pereza:** las ocho necesitan datos reales o
decisiones humanas que un programa no puede tomar. La Regla 14 lo prohíbe expresamente y la
Regla 15 pedía justamente esta comprobación.

---

## 15–16 · PROBLEMAS Y PRIORIZACIÓN

| # | Problema | Nivel | Decisión |
|---|---|---|---|
| 1 | Lo primero que se propone son Pick'ems, sin tener cartas | **P1** | **Corregido** |
| 2 | «Construye tu mazo» manda a comprar teniendo 4 sobres | **P1** | **Corregido** |
| 3 | El constructor manda a la Tienda en vez de al Inventario | **P1** | **Corregido** |
| 4 | 404 de fotos de jugador (`/players/*.png`) | P3 | **No hacer** — `public/players/` está vacío en este entorno; `PlayerPhoto` tiene respaldo y memoriza las que faltan. Lo resuelve el pipeline de artwork, no la interfaz |
| 5 | Ninguna verificación medía la primera experiencia | **P1 de método** | **Corregido** con `ftue:audit` |

### Dos falsos positivos que descarté (y que la herramienta ya no produce)

**A · «`/duelos/jugar` y `/duelos/mazos` son callejones sin salida: 0 acciones».** Falso: son
**rutas inmersivas** que se renderizan sin `<main>`, y mi selector exigía `main`. Corregido
el selector.

**B · «esas dos pantallas tienen 1 sola acción».** También falso, y era mi umbral: **un
estado vacío que ofrece exactamente una salida clara es buen diseño**, no un callejón. El
umbral pasó de `<= 1` a `=== 0`.

Los dejo escritos porque señalarlos habría sido inventar defectos, que es justo lo que esta
fase no debía hacer.

---

## 17 · CAMBIOS REALIZADOS

**Tres, todos de guía. Ni un sistema nuevo.**

**1 · `services/loop.ts` — prioridad de primera vez.** Cuando el jugador tiene **cero cartas
y sobres sin abrir**, «Abre tus sobres» pasa a ser el primer paso, con su propio texto
(«Tienes 4 sobres de bienvenida. Ábrelos y empieza tu colección»). No es un caso especial
para un usuario: es una **condición sobre el estado**, y deja de cumplirse en cuanto abre el
primer sobre.

**2 · `services/loop.ts` — a dónde manda «Construye tu mazo».** Con sobres sin abrir apunta
a `/inventario`; solo cuando no hay ni cartas ni sobres apunta a `/tienda`. El texto
acompaña al destino.

**3 · `DeckBuilder.tsx` — la frase de la rejilla vacía.** Pasa de «Abre un sobre en la
Tienda» a «Todavía no tienes cartas, pero tienes **4 sobres sin abrir en Inventario**».

### Resultado, medido

```
ANTES                                  DESPUÉS
1. HAZ TUS PREDICCIONES → /pickems     1. ABRE TUS SOBRES     → /inventario
2. ABRE TUS SOBRES      → /inventario  2. HAZ TUS PREDICCIONES→ /pickems
3. CONSTRUYE TU MAZO    → /tienda      3. CONSTRUYE TU MAZO   → /inventario
4. HAY PARTIDO EN DIRECTO              4. HAY PARTIDO EN DIRECTO

P0 0 · P1 2 · P2 0                     P0 0 · P1 0 · P2 0
```

---

## 18 · CAMBIOS **NO** REALIZADOS

| Se podría haber hecho | Por qué no |
|---|---|
| Tutorial guiado | La Regla 3 pide UX contextual antes que tutorial. El ciclo ya existía: bastaba con arreglar su orden y sus destinos |
| Rediseñar la ceremonia de sobres | La Regla 6 lo condiciona a un problema real. No lo hay |
| Tocar precios o probabilidades | La Regla 7 exige análisis, simulación y justificación. Nada lo pedía |
| Descargar/generar fotos de jugador | Es el pipeline de artwork, y la Regla 14 prohíbe rellenar contenido |
| Resolver las ocho deudas | Las ocho necesitan datos reales o una decisión humana |
| Nuevas pantallas | La Regla 1: impacto en jugabilidad antes que features |

---

## 19 · TESTS

**480 / 480.** No se han añadido pruebas unitarias: el cambio vive en un servicio que
necesita base de datos, así que la regresión va donde puede comprobarse de verdad —
**`loop:verify`, +5 comprobaciones** con una cuenta recién registrada:

- un jugador recién registrado tiene cero cartas y sobres de bienvenida
- lo **primero** que se le propone es abrir sus sobres
- y le lleva al inventario, que es donde se abren
- «construye tu mazo» **no** le manda a comprar teniendo sobres sin abrir
- **con cartas, abrir sobres vuelve a su prioridad normal** — la regla es de estado, no un
  caso especial

### Un invariante que rompí y que la suite cazó

Para saber cuántos sobres tiene el constructor, primero leí `useGameStore`. `duel.test.ts`
falló al instante: **«ningún componente de duelo usa el almacén local para el inventario»**.
Es correcto —en Duelos la propiedad la manda `user_cards`— así que la cifra se pide al
servidor con `fetchMyPacks()`. El invariante se queda como estaba.

---

## 20 · SEGURIDAD

**Sin superficie nueva.** El cambio del ciclo es una lectura `GET` que ya existía, sin
parámetros nuevos; el del constructor es una frase. No hay endpoint nuevo, ni escritura, ni
entrada del cliente. `security:verify` pasa sin tocarlo.

---

## 21 · PERFORMANCE

`audit:stability`: **105 comprobaciones, P0 0 · P1 0**, P2 3 (los 401 preexistentes de
`/admin`). Sin nodos nuevos, sin animaciones nuevas, sin imágenes nuevas: los tres cambios
son texto y un `href`. Móvil 390 sin desbordamiento.

---

## 22 · CAPTURAS

`fase15-antes/` → `fase15-despues/`, **dos ficheros cada una**: el vestíbulo del primer día y
el constructor con cero cartas. Es la primera fase con su propio «antes», porque ninguna
captura anterior enseñaba una cuenta recién registrada.

---

## 23 · ESTADO FINAL

La prueba que pedía el encargo, medida por `ftue:audit` sobre una cuenta real:

| Pregunta | Respuesta |
|---|---|
| ¿Sabe qué hacer? | **Sí** — «Abre tus sobres» es lo primero |
| ¿Consigue su primera carta? | **Sí** — un toque desde el vestíbulo |
| ¿Entiende la colección? | **Sí** — vacía, dice cómo llenarla |
| ¿Entiende el mazo? | **Sí** — reglas y, sin cartas, dónde están |
| ¿Sabe por qué no puede jugar aún? | **Sí** — con el camino para arreglarlo |
| ¿Descubre Pick'ems y eventos? | **Sí** — en el ciclo, en su turno |
| ¿Ve su perfil? | **Sí** |
| ¿Encuentra un objetivo? | **Sí** — maestría, prestigio, rango |
| ¿Sabe qué hacer mañana? | **Sí** — el ciclo se recalcula |

**P0 = 0 · P1 = 0 · P2 = 0.**

---

## 24 · RECOMENDACIÓN PARA LA FASE 16

**No más sistemas.** El producto está completo para lo que puede validarse en local.

1. **Personas reales.** Todo lo que queda por saber exige jugadores: si el prestigio absorbe,
   cuántos se saturan, si el mercado tiene liquidez, si la primera sesión retiene. Ninguna
   de esas preguntas se responde escribiendo código.
2. **Un torneo real por el pipeline.** Es la única deuda que se desbloquea sola en cuanto
   haya contenido: llenaría las nueve variantes de galardón vacías.
3. **El artwork.** `public/players/` está vacío; hay respaldo visual, pero las fotos reales
   cambiarían la percepción del producto más que cualquier feature.
4. **Y la decisión editorial de los ocho jugadores**, que lleva dos fases esperando a una
   persona.
