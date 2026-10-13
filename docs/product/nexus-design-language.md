# NEXUS — Auditoría visual global y Lenguaje de Diseño

**Fases 1 y 2 del encargo. Ni una línea de producto modificada.**
Método: recorrido de las 20 pantallas de jugador (de 41 rutas reales; admin queda fuera —
no forma parte de la identidad del juego), captura en los seis anchos, y **medición del
vocabulario visual** de cada pantalla con `scripts/design-audit.ts`.

---

## FASE 1 · AUDITORÍA

### 1.1 · La pregunta de §2, respondida con números

> *«Si elimino todos los textos y logos, ¿sigue pareciendo que todas estas pantallas
> pertenecen al mismo videojuego?»*

**No.** Y no es una impresión: se puede contar. NEXUS tiene una geometría propia —el
**chaflán**, el corte a 45° que llevan la carta, el sobre y el tablero— y una geometría
genérica —el `border-radius`—. Medí cuántos elementos con superficie real usa cada pantalla
de cada una:

| pantalla | chaflán | redondeado | fondos distintos | sombras | tamaños de letra |
|---|---:|---:|---:|---:|---:|
| `/logros` (pase) | **93** | 3 | 14 | 3 | 6 |
| `/coleccion` | **148** | 55 | 39 | 22 | 6 |
| `/mercado` | **113** | 80 | 29 | 13 | 5 |
| `/ranking` | 19 | 9 | 16 | 2 | 8 |
| `/tienda` | 16 | **61** | 35 | 4 | 8 |
| `/cuenta` (perfil) | 14 | 30 | 30 | 18 | 8 |
| `/eventos` | 4 | **55** | 29 | 4 | 10 |
| `/entrenador` | **1** | 28 | 18 | 4 | 9 |
| `/manager` | **0** | 48 | 12 | 1 | 5 |
| `/mundo` | **0** | 27 | 12 | 2 | 5 |

**Hay dos productos aquí.** Uno construido con placas chaflanadas —el pase, la colección, el
mercado— y otro construido con tarjetas redondeadas —la tienda, eventos, entrenador, manager,
mundo—. Comparten la tipografía y la barra superior, y ahí se acaba el parecido.

### 1.2 · El patrón que lo explica

Es más preciso que «unas pantallas están mejor que otras»:

> **Los OBJETOS de NEXUS son NEXUS. Los CONTENEDORES y los CONTROLES son Bootstrap.**

La tienda es la demostración perfecta. El sobre sellado es una pieza magnífica —chaflán,
troquel, emblema grabado, foil, luz de rareza— y está **dentro de una tarjeta redondeada, con
una barra de probabilidad redondeada y un botón píldora rojo**. El objeto pertenece al juego;
la caja en la que va, a una landing de SaaS. Lo mismo en `/entrenador`: los mapas están bien
dibujados y viven en cuatro `rounded-2xl` con un botón píldora «CREAR EQUIPO».

Y el producto ya contiene su propia respuesta: **`/logros`** —el pase de temporada— es 93
chaflanes contra 3 redondeados. Cabecera chaflanada, medallón de nivel hundido, nodos de
recompensa troquelados, raíles con etiqueta incrustada. Se lee como un HUD de competición. **El
idioma no hay que inventarlo: hay que extraerlo de ahí y llevarlo al resto.**

### 1.3 · Dispersión: cada componente inventa su superficie

Medido en elementos con superficie real (≥40×24 px, visibles):

- **39 fondos distintos** en el lobby, 39 en la colección, 35 en la tienda, 30 en el perfil.
- **22 sombras distintas** en la colección, 19 en el lobby, 18 en el perfil.
- **14 tamaños de letra distintos** en el lobby, 10 en eventos, 10 en recompensas.

No es que los valores sean feos: es que **no hay ramp**. Catorce tamaños de letra en una
pantalla significa que nadie eligió una escala; se eligió catorce veces.

### 1.4 · Mobile: no está roto, está sin componer

**0 desbordamiento horizontal en las seis pantallas medidas a 390 px.** Eso ya está resuelto.
Lo que no está resuelto es la composición:

| pantalla | alto a 1440 | alto a 390 | pantallas de scroll |
|---|---:|---:|---:|
| lobby | 2.229 px | **4.079 px** | 4,8 |
| colección | 3.560 px | **8.001 px** | 9,5 |
| tienda | 2.829 px | **6.917 px** | 8,2 |
| entrenador | 2.352 px | **4.068 px** | 4,8 |

Nada se recompone: todo se apila. El lobby de escritorio cabe en ~2,2 pantallas y en el móvil
son 4,8 de scroll vertical. Eso es *responsive*, no *diseñado para móvil* — que es exactamente
la distinción de tu §24.

### 1.5 · Media docena de pantallas no existen todavía

Siete rutas rinden entre 38 y 50 superficies (147-182 nodos): `/duelos`, `/duelos/mazos`,
`/colecciones`, `/torneos`, `/pickems`, `/carrera`, `/noticias`. Son **cascarones o estados
vacíos** para un usuario nuevo. No es un problema de estética: es que un jugador recién llegado
entra en siete secciones y no encuentra nada. Cualquier trabajo visual sobre ellas empieza por
diseñar su estado vacío, no su estado lleno.

### 1.6 · Otros hallazgos concretos

- **Barra de scroll nativa dentro del HUD.** El raíl de recompensas del pase la enseña: un
  control del sistema operativo cruzando una pantalla de competición.
- **La fila de widgets de igual peso.** «QUÉ HACER AHORA» en el lobby son cuatro tarjetas
  idénticas con cuatro acentos distintos (cian, naranja, morado, verde). Cuatro cosas del mismo
  tamaño no son una jerarquía: son un menú.
- **Cuatro llamadas a la acción compitiendo** en el héroe del lobby en móvil (JUGAR AHORA, MIS
  MAZOS, SIN MAZO, CONSTRUYE EL TUYO).
- **El botón píldora** (`border-radius: 9999px`) aparece en tienda, entrenador y perfil. Es el
  elemento más genérico del producto y está en los CTA principales.

---

## FASE 2 · EL LENGUAJE VISUAL NEXUS

No se inventa: **se extrae de las cuatro piezas que ya son NEXUS** —la carta, el sobre sellado,
la mesa de duelo y el pase— y se convierte en sistema.

### 2.1 · La gramática (lo que esas cuatro piezas ya comparten)

| | qué es | dónde ya vive |
|---|---|---|
| **CHAFLÁN** | corte a 45° en dos esquinas opuestas | carta, sobre, mesa, pase |
| **CANTO** | filo metálico claro que encierra una superficie más oscura | carta, mesa |
| **HUNDIDO** | sombra interior arriba + filo de luz abajo | posiciones del tablero, placa de datos |
| **RAÍL** | línea de dos filos con una etiqueta incrustada, que separa zonas | mesa de duelo, pase |
| **MEDALLÓN** | placa pequeña troquelada con un símbolo o una cifra | sello de variante, nivel del pase |
| **LECTURA HUD** | versalitas espaciadas encima, cifra grande tabular debajo | marcador, OVR, créditos |

**Regla:** una superficie de NEXUS se define por su **corte y su canto**, nunca por su radio.

### 2.2 · La anti-gramática (lo que sale del producto)

- `border-radius` como contenedor por defecto → lo sustituye el chaflán.
- El **botón píldora** → no existe en NEXUS.
- La **tarjeta flotante con sombra difusa** → la sustituye la placa asentada.
- La **fila de widgets de igual peso** → la sustituye una jerarquía con protagonista.
- La **barra de scroll nativa** dentro de un HUD → raíl con sus propios controles.

### 2.3 · Superficies — cinco, y solo cinco

| nombre | qué es | tratamiento |
|---|---|---|
| `fondo` | la sala | el más oscuro, sin borde |
| `escenario` | la zona donde ocurre algo (héroe, arena, vitrina) | fondo + luz ambiental propia |
| `placa` | la unidad de contenido | chaflán + canto + fondo un escalón más claro |
| `hundida` | un hueco practicado en una placa | más oscura que su contenedor, filo superior negro y filo inferior claro |
| `objeto` | carta, sobre, medallón | canto completo + material de rareza |

Prohibido que un componente invente un sexto fondo.

### 2.4 · Botones — seis roles, una geometría

Todos chaflanados (`nx-clip-sm`), ninguno redondo:

`primary` (relleno DRL, el único rojo pleno por pantalla) · `secondary` (canto, fondo hundido)
· `tertiary` (solo texto con filo inferior) · `danger` (canto rojo, relleno solo al pulsar) ·
`ghost` (sin superficie hasta el hover) · `icon` (placa cuadrada chaflanada).

**Una acción primaria por pantalla.** Hoy el lobby tiene cuatro.

### 2.5 · Tipografía — cinco papeles

`display` (títulos de sección, versalitas anchas) · `heading` · `body` · `label` (versalitas
espaciadas, el conector de todo el HUD) · **`readout`** (la cifra: tabular, apretada, con su
`label` encima).

**Los números competitivos son un papel tipográfico, no un tamaño.** OVR, XP, créditos, rango,
marcador, puntos y serial se leen con `readout` en todas partes o en ninguna. Escala fija de
7 pasos; catorce tamaños en una pantalla es lo que hay que eliminar.

### 2.6 · Color

Base fría casi neutra (ya existe). **Un solo color de acción**: el rojo DRL — si algo es rojo
pleno, se pulsa. Los acentos de dominio que ya existen (verde jugador, rojo rival, oro
económico, cian progreso) se conservan **como semántica, no como decoración**: nada es cian
porque quede bien, es cian porque habla de progreso.

### 2.7 · Movimiento e iconografía

El sistema de movimiento **ya existe y es bueno** (`src/design/motion.ts`: seis momentos,
nada por encima de 350 ms, solo `transform`/`opacity`, `prefers-reduced-motion` a estático).
No se reemplaza: se aplica donde todavía no llega.

La iconografía se generaliza desde el sello de variante de A3: **SVG en línea, trazo, rejilla
de 24, ángulos rectos y diagonales de 45°**. Cero emoji como icono de producto — hoy los hay en
las pestañas de la colección (`📚`, `⚒️`).

### 2.8 · Jerarquía por pantalla

Cada pantalla declara su **protagonista** y todo lo demás se subordina:

| pantalla | protagonista |
|---|---|
| Lobby | la siguiente acción del jugador |
| Colección | la carta |
| Tienda | el sobre como objeto |
| Duelos | el tablero *(ya resuelto)* |
| Pase | el raíl de recompensas |
| Perfil | la identidad (rango + cartas destacadas) |
| Torneos / Pick'ems | el torneo activo |

---

## Plan de implementación (fases 3-14)

Con el formato de tu §32 — problema, decisión, resultado esperado — para las tres primeras:

**Fase 3 · Tokens.** *Problema:* 39 fondos y 14 tamaños de letra por pantalla; `globals.css`
tiene primitivas (`nx-clip`, `nx-panel`, `nx-label`, `nx-readout`) pero conviven con utilidades
sueltas. *Decisión:* extender lo que ya hay —no crear un segundo sistema— con las 5 superficies,
la escala tipográfica de 7 pasos y la de chaflán. *Resultado:* fondos y tamaños distintos por
pantalla bajan a un dígito.

**Fase 4 · Shell y navegación.** *Problema:* la barra superior es correcta pero no dice «dónde
estoy»; en móvil hay pestañas inferiores y encima cabeceras que repiten. *Decisión:* cabecera de
sección como raíl con etiqueta incrustada, una sola fuente de «dónde estoy». *Resultado:* la
navegación se lee igual en las 20 pantallas.

**Fase 5 · Lobby.** *Problema:* cuatro CTA compitiendo y una fila de cuatro widgets iguales.
*Decisión:* un protagonista (la siguiente acción), el resto como escenario y raíl. *Resultado:*
el móvil baja de 4,8 pantallas de scroll a ~2,5.

Después: 6 Colección/Detalle · 7 Tienda/Apertura · 8 Duelos *(solo integración; el tablero no se
toca)* · 9 Torneos/Pick'ems/Progresión · 10 Perfil/Mundo/Trainer · 11 Estados · 12 Responsive ·
13 Performance · 14 QA.

**Presupuesto que no se negocia** (heredado de las fases cerradas): `mix-blend` sigue en 0 en
colección, mercado e inventario; sin bucles infinitos en rejillas; 0 overflow en los seis
anchos; nodos comparados antes/después en Home, Colección, Mercado e Inventario.

---

## Qué NO se ha tocado

Nada. Esta entrega es auditoría y especificación. Los únicos ficheros nuevos son
`scripts/design-audit.ts` (herramienta de medición, solo lectura), este documento y 48 capturas
en `docs/product/qa/design-audit/`.
