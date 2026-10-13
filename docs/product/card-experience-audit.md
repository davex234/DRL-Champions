# Auditoría de la experiencia de CARTA — NEXUS

**Fecha:** 2026-09-04 · **Alcance:** solo lectura. No se ha modificado ni una línea de producto.
**Método:** lectura de los 11 componentes que dibujan cartas + captura y medición de las 9
pantallas donde aparecen, en 1440×900 y 390×844 (`scripts/card-audit-shots.ts`, herramienta
nueva de auditoría; no toca catálogo, economía ni datos reales).

---

## 1 · Resumen ejecutivo

> **Si un usuario consigue una Icon Series ahora mismo, ¿parece que ha conseguido un objeto?**
>
> No. Parece que ha desbloqueado una fila coloreada.

Y hay una prueba visual que lo resume mejor que cualquier argumento: **el sobre sellado es un
objeto físico y la carta que sale de él no lo es.** El sobre tiene chaflán, troquel, emblema
grabado, luz de rareza y suelo en perspectiva. La carta es un `rounded-2xl` con `border-2`.

*Comparar `docs/product/visual/96-despues/15-sobre-revelacion.png` con
`docs/product/qa/card-audit/1440-01-coleccion.png`: el envoltorio está más trabajado que el premio.*

Los tres problemas de raíz:

1. **La rareza es un cambio de tono.** Hay 37 variantes → 12 paletas → 9 animaciones → pero
   solo **4 tratamientos visuales efectivos**, y uno de ellos (`special`) **no aplica ningún
   efecto**: Prime (/300) y Clutch King (/120) se dibujan con menos tratamiento que una Plata.
2. **La carta no habla el idioma de NEXUS.** Todo el producto está hecho de placas chaflanadas
   (`nx-clip`), filos metálicos y superficies hundidas. La carta es una tarjeta con esquinas
   redondeadas y un borde de 2 px. Es el único objeto del juego que no parece de este juego.
3. **La variante solo se distingue leyendo.** Las 8 variantes reales se diferencian por una
   etiqueta de 10 px en la base. Sin leer, un Champion Edition y un Top Kills son la misma carta.

Y un cuarto, de intendencia: **hay tres representaciones independientes de la misma carta**
(`CardRenderer`, `DuelCard`, `CardThumb`), con composiciones, tamaños y hasta **conjuntos de
estadísticas distintos**.

---

## 2 · Recorrido de una carta

Seguí a `aspas__icon-series` (Icon Series, rank 14, serie /100 — de las más raras del juego):

| Pantalla | Componente | Ancho | Stats | Serial | Rareza se percibe |
|---|---|---|---|---|---|
| Vestíbulo | `Card3D`→`PlayerCard` sm | 150 px | 6 barras | sí | halo + tono |
| Colección | `Card3D static`→`PlayerCard` sm | 150 px | 6 barras | sí | solo tono |
| Inventario | `PlayerCard` sm | 150 px | 6 barras | sí | solo tono |
| Mercado | `Card3D static`→`PlayerCard` sm | 150 px | 6 barras | sí | solo tono |
| Detalle | `CardRenderer` **xl** | 360 px | 6 cifras | sí | holo + rayos |
| Sobre (mejor) | `Card3D showcase`→`PlayerCard` lg | 300 px | 6 cifras | sí | holo + rayos |
| Sobre (resto) | `Card3D static`→`PlayerCard` sm | 150 px | 6 barras | sí | solo tono |
| Perfil | `Card3D`→`PlayerCard` sm | 132–150 px | 6 barras | sí | halo + tono |
| **Duelos** | **`DuelCard`** xs–lg | **54–168 px** | **3 cifras de combate** | **no** | **solo tono** |
| Mercado (fila) | **`CardThumb`** | **44 px** | **ninguna** | **no** | **solo borde** |

**La identidad se mantiene en 8 de 10 contextos.** Las dos excepciones son reales y las trato en §14 y §18.

---

## 3 · Estado actual de la carta individual

Composición de `CardRenderer` (el motor real), de arriba abajo:

```
┌─────────────────────────┐  aspect 5:7 · rounded-2xl · border-2 (color de rareza)
│ 92        [serial /100] │  ← columna izquierda: OVR grande, rol, bandera, logo
│ DUE                     │
│ 🇧🇷                     │
│ MIBR      ╭─────────╮   │
│           │  SIGILO  │  │  ← ~55 % del alto: emblema geométrico + monograma
│           ╰─────────╯   │
│ ───────────────────     │
│        ASPAS            │  ← nick
│      ICON SERIES        │  ← variante, 10 px
│      ▁▃▅▆▇▅             │  ← 6 barras (sm) o 6 cifras (md+)
└─────────────────────────┘
```

**¿Qué llama primero la atención?** El **campo de color**, no el jugador. El sigilo es oscuro y
de bajo contraste; el nick mide 14 px. La jerarquía real medida es:

> tono de rareza → OVR → sigilo → nick → etiqueta de variante → barras

**¿Es la correcta para un juego de colección?** No del todo. En un objeto coleccionable el
protagonista debe ser **quién es** (el jugador) y **qué es** (la variante). Aquí el jugador es la
tercera cosa que se ve y la variante la quinta. El OVR sí está bien jerarquizado (§10).

---

## 4 · Problemas P0

> *La carta no funciona correctamente.*

**P0-1 · La animación `special` no aplica NINGÚN efecto.**
`CardEffects.tsx` decide con cinco banderas (`sweep`, `aura`, `rays`, `particles`, `legendary`) y
`special` no está en ninguna lista. Resultado medido:

| animación | efectos | variantes afectadas |
|---|---|---|
| `basic` | 0/5 | bronze |
| `metallic` | 1/5 | silver |
| `premium` | 1/5 | gold, emea, masters, champions, ewc |
| `winner` | 2/5 | *-winner, rookie |
| `extended` | 1/5 | *-mvp, game-changers, top-hs, top-kills, top-assist |
| `cinematic` | 2/5 | masters-mvp, ewc-mvp, **top-acs** |
| `legendary` | 3/5 | champions-mvp, hall-of-fame, **champion-edition**, **top-rating** |
| `icon` | 4/5 | icon-series, **mythic** |
| **`special`** | **0/5** | **prime (rank 10, /300), clutch (rank 12, /120)** |

**Clutch King —una de las 8 variantes reales, serie de 120— se dibuja con el mismo tratamiento
que un Bronce común, y con menos que una Plata.** Es un fallo, no una decisión.

**P0-2 · La carta más rara del juego es la menos legible.**
En el detalle (`1440-07-detalle.png`), la Icon Series de ASPAS es prácticamente ilegible: la paleta
`icon` es casi blanca, y encima se apilan el brillo del puntero (`opacity-50`, blanco) y el holo
`legendary` (`opacity-30`, overlay). El nick y las seis cifras quedan en gris claro sobre crema.
**A mayor rareza, peor legibilidad** — exactamente al revés de lo que debe pasar.

**P0-3 · Tres representaciones independientes de la misma carta.**

| | `CardRenderer` | `DuelCard` | `CardThumb` |
|---|---|---|---|
| líneas | 221 | 205 | 31 |
| tamaños | 150/230/300/360 | 54/84/116/168 | 44 |
| esquinas | `rounded-2xl` | `rounded-xl` | `rounded-md` |
| estadísticas | **6 de colección** | **3 de combate** | ninguna |
| serial | sí | **no** | no |
| efectos de rareza | `CardEffects` | ninguno | ninguno |

Que Duelos enseñe el trío de combate está **justificado** —es lo que decide el turno—. Lo que no
lo está es que **la carta de colección no insinúe en ningún sitio ese trío**: el jugador colecciona
mirando seis estadísticas y juega con tres que nunca ha visto en la carta.

**P0-4 · La variante solo se identifica leyendo.**
Las 8 variantes reales no tienen marca, icono, forma de marco ni tratamiento propio. Solo la
etiqueta de 10 px bajo el nick. Sin leerla, MVP, Top ACS, Top Kills, Champion Edition y Clutch
King son la misma carta con distinto tono.

---

## 5 · Problemas P1

> *Reducen mucho la percepción de calidad y deseabilidad.*

**P1-1 · La carta no usa el lenguaje visual de NEXUS.** Ver §17.

**P1-2 · 37 variantes, 4 tratamientos.** Ver §7.

**P1-3 · El sigilo domina la carta y se repite.** Ocupa ~55 % del alto. Es determinista por
jugador y **sí varía** (número de lados del polígono, rotación del destello), pero el andamiaje
compartido —anillo discontinuo + destello de cuatro puntas + polígono oscuro + monograma de dos
letras— es tan dominante que a tamaño de rejilla **el ojo lee «el mismo emblema repetido»**. Es
el mayor obstáculo para que dos cartas se distingan a un metro.

**P1-4 · Doble inclinación en el vestíbulo.** `src/app/page.tsx:412` monta
`<PlayerCard card={…} serial={…} />` dentro de un `Card3D mode="hover"` **sin `interactive={false}`**.
`CardRenderer` monta entonces su propio `rotX`/`rotY` y su propia capa de brillo, encima de las de
`Card3D`: dos muelles distintos y dos brillos sobre la misma carta. Las otras cuatro llamadas del
producto sí pasan `interactive={false}`.

**P1-5 · El detalle es un cuadro de mando.** A la izquierda la carta; a la derecha ocho campos en
caja (equipo, nacionalidad, rol, región, colección, temporada, agente, estado), las seis
estadísticas **repetidas** en barras, el kit, el historial y el mercado. El panel gana en área a
la carta. Es el sitio del producto donde más debería sentirse el objeto y es donde más se siente
la aplicación.

**P1-6 · El duplicado se marca FUERA de la carta.** Un chip «×2» flotando en el hueco superior
derecho, separado del objeto que califica.

**P1-7 · 44 capas de efecto en bucle infinito en `/mercado`.** Ver §17 y §16.

---

## 6 · Problemas P2

- **P2-1 · Riesgo de hidratación en `InnerParticles`.** `Math.random()` dentro de `useMemo` en un
  componente cliente: Next lo renderiza también en servidor, así que los valores difieren entre
  servidor y cliente. Hoy no salta porque las partículas exigen `rich` (solo lg/xl) y las páginas
  con cartas grandes no se han probado con SSR, pero es una bomba de relojería.
- **P2-2 · `CardThumb` no comunica rareza** más que por el color del borde. Sin OVR grande, sin
  variante, sin serial.
- **P2-3 · El chip «Serie limitada» aparece sin número** cuando la instancia no trae serial.
- **P2-4 · `CardEffects` recorta con `rounded-2xl` escrito a mano**, desacoplado del radio del
  marco: si cambia uno, el otro no.

---

## 7 · Rarezas

**37 variantes → 12 paletas → 9 animaciones → 4 tratamientos efectivos.**

La progresión existe sobre el papel (rank 1→16, statBoost 0→7, series /500→/25) pero **no se ve**.
Entre una EMEA (rank 4) y una EMEA MVP (rank 7) el ojo solo registra un cambio de color. Entre una
Champions MVP (13) y una Mythic (16), un holo algo más marcado.

Lo que **no** distingue hoy a una rareza de otra: el marco (idéntico), la forma (idéntica), el
material (ninguno), la profundidad (ninguna), la iconografía (ninguna), el troquelado (ninguno).
Lo único que cambia: **el tono, y a veces un barrido o un holo**.

Además hay dos inversiones de jerarquía medidas:
- `special` (rank 10–12) recibe **menos** tratamiento que `metallic` (rank 2).
- `extended` (rank 7–11, cinco variantes reales) recibe **lo mismo** que `premium` (rank 3–5): un
  efecto de cinco.

---

## 8 · Variantes

Las 8 reales y lo que las distingue hoy **sin leer**:

| Variante | Paleta | Animación | Distinguible sin leer |
|---|---|---|---|
| Mythic MVP | mythic (carmesí) | icon | **sí** — es la única carmesí+holo |
| Champion Edition | champion (oro pálido) | legendary | no — igual que Top Rating salvo tono |
| Top Rating | legendary (oro) | legendary | no |
| Top ACS | cinematic (naranja) | cinematic | no |
| Top Kills | mvp (rosa) | extended | no |
| Top Assist | prime (violeta) | extended | no |
| Top HS% | winner (verde) | extended | no |
| Clutch King | mvp (rosa) | **special → sin efectos** | no — **y además parece común** |

**Top Kills y Clutch King comparten paleta** (`mvp`), y Clutch no tiene efectos: en una rejilla
son indistinguibles salvo por la etiqueta. Champion Edition, la carta que corona un torneo, no
tiene nada que diga «campeón»: ni corona, ni trofeo, ni marca de equipo campeón.

---

## 9 · Card3D

**Es el componente mejor resuelto de todo el sistema de cartas.** Está bien documentado, separa
`mode` (cómo se mueve) de `status` (qué es), degrada correctamente en táctil y en
`prefers-reduced-motion`, y su modo `static` evita montar framer-motion en rejillas largas — la
decisión que mantiene el presupuesto de nodos de `/coleccion`.

**¿La carta parece objeto físico, tarjeta web o elemento UI?**
Con `Card3D`: **tarjeta web con volumen**. Se inclina, tiene sombra y halo, pero sigue siendo una
lámina de grosor cero con esquinas redondeadas. El volumen está en el envoltorio; **el objeto
sigue sin tener materia**. Card3D no puede arreglar eso: lo que le falta es al dibujo de dentro.

Deuda concreta: el doble tilt de P1-4, y que `CardRenderer` duplique la inclinación y el brillo
que `Card3D` ya sabe hacer.

---

## 10 · Apertura de sobres

El flujo (`PackOpeningExperience` + `CardReveal`) está **bien construido**: sobre sellado
troquelado, deslizar para abrir, sonido sintetizado por rareza (`playReveal(rank)`), la mejor
carta en `Card3D mode="showcase"` a tamaño `lg`, el resto en rejilla estática.

Lo que falla es el **contraste de calidad**: el sobre parece un objeto NEXUS y la carta no. El
momento culminante del juego entrega un rectángulo redondeado. Además la revelación usa `size="lg"`
(300 px) mientras el detalle usa `xl` (360 px): la carta se ve **más grande cuando la consultas
que cuando la ganas**.

---

## 11–13 · Colección · Inventario · Mazos

**Colección** (48 cartas, 3.085 nodos): la rejilla funciona. Enseña las que no tienes en gris con
candado —bien: se ven y por eso se quieren— y el progreso («8 de 772 · 1 %»). Problemas: el
duplicado va fuera de la carta (P1-6) y ninguna carta nueva se marca como nueva en la propia
rejilla; `Card3D` tiene `status="new"` y la colección **no lo usa**.

**Inventario** (4 cartas, 436 nodos): correcto y sin identidad propia. No añade nada que la
colección no haga mejor.

**Mazos**: la ruta `/duelos/mazos` no llegó a montar cartas en la captura (147 nodos, estado vacío
para un usuario sin mazo). El constructor usa `DuelCard`, así que hereda §14: se construye el mazo
mirando el trío de combate, que es lo correcto, pero **la carta del constructor y la de la
colección no se parecen**.

---

## 14 · Duelos

Duelos acaba de recibir su pasada visual y **no propongo tocarlo**. La observación es solo de
pertenencia: `DuelCard` y `CardRenderer` son dos dibujos distintos del mismo objeto. Comparten la
proporción 5:7 y la paleta de la variante; **no** comparten marco, radio, composición, jerarquía
ni estadísticas.

El veredicto honesto: **parecen del mismo universo, pero no la misma carta.** Un jugador reconoce
que es «su Alfajer», pero la carta que sostiene en el duelo es una versión reducida y distinta de
la que colecciona. Con el trío de combate presente en las dos, esa distancia se cerraría sin tocar
el tablero.

---

## 15 · Perfil

Cuatro cartas en `Card3D`, la mejor con halo continuo y las demás en `hover`. Bien resuelto y bien
razonado en el propio código (cuatro halos pulsando se funden en una mancha). Sin problemas propios.

---

## 16 · Móvil y responsive

Medido en 390×844 y 1440×900; el resto de anchos se cubren con la misma rejilla fluida.

| Pantalla | overflowX 1440 | overflowX 390 | nodos | cartas |
|---|---|---|---|---|
| Vestíbulo | 0 | 0 | 650 | 3 |
| Colección | 0 | 0 | 3.085 | 48 |
| Inventario | 0 | 0 | 436 | 4 |
| Mercado | 0 | 0 | 3.256 | 54 |
| Perfil | 0 | 0 | 442 | 4 |
| Detalle | 0 | 0 | 3.346 | 49 |

**Cero desbordamiento horizontal en todas.** (Los `-10` del informe crudo son la barra de scroll.)

En 390 la colección va a 2 columnas con cartas de ~150 px: legible, el OVR se lee, la variante se
lee, las barras se ven. **Funciona.** Lo que no funciona en táctil es que **toda la percepción de
objeto vive en el hover**: `Card3D` desactiva la inclinación con el dedo (correcto — el dedo tapa
la carta), y el brillo del puntero no existe. **En móvil la carta es una imagen plana y nada más.**
Es el contexto donde más falta hace que el objeto sea físico *en el dibujo*, no en el movimiento.

---

## 17 · Rendimiento y sistema visual

**Capas de efecto con `mix-blend-mode` medidas por pantalla:**

| Pantalla | cartas | capas de efecto |
|---|---|---|
| Colección | 48 | 7 |
| **Mercado** | **54** | **44** |
| Detalle | 49 | 9 |
| Perfil | 4 | 1 |

`/mercado` monta **44 capas con `mix-blend-mode` y bucle infinito de framer-motion** a la vez
(barridos de 3,4 s y holos de 5 s). El holo anima `background-position`, que **repinta cada
fotograma**. Y `aura` y `legendary` **no están limitados por `rich`**, así que se ejecutan también
en las rejillas — solo `rays` y `particles` lo están.

La diferencia colección (7) vs mercado (44) se explica porque en la colección la mayoría de cartas
están bloqueadas; **en cuanto un jugador posea una colección de rarezas altas, `/coleccion`
tenderá a las cifras del mercado**. Es la deuda de rendimiento a vigilar antes de añadir nada.

**Sistema visual:** el producto entero está hecho de `nx-clip` (chaflán de 18 px), placas hundidas,
filos de luz, tornillos y retículas técnicas — el tablero de Duelos y el sobre sellado son los
mejores ejemplos. **La carta no usa ni uno de esos recursos.** Usa `rounded-2xl`, `border-2` y
sombra genérica. Respuesta a la pregunta de §17: **todavía parece un componente UI genérico al que
se le ha puesto la paleta de NEXUS encima.**

---

## 18 · Consistencia

Lo que **sí** se mantiene: proporción 5:7 en todas las representaciones, paleta por variante, OVR
arriba a la izquierda, nick abajo.

Lo que **no**:

| | Colección | Duelos | Miniatura |
|---|---|---|---|
| radio | 16 px | 12 px | 6 px |
| estadísticas | 6 de colección | 3 de combate | — |
| serial | sí | no | no |
| efectos de rareza | sí | no | no |
| variante escrita | sí | no | no |

---

## 19 · Mapa de componentes

```
CardDef (domain/cards/types) · VariantDef (domain/cards/variants) · Player (data/catalog)
        │
        ├── PlayerCard ────► CardRenderer ──┬── layers/PlayerPhoto ──► layers/PlayerSigil
        │   (adaptador)      (motor real)   ├── layers/TeamLogo
        │                                   ├── layers/Flag
        │                                   ├── layers/SerialBadge
        │                                   └── CardEffects  ← rareza
        │
        ├── DuelCard ──────► (dibujo propio, 205 líneas, sin capas ni efectos)
        └── CardThumb ─────► (dibujo propio, 31 líneas)

Card3D (envoltorio: tilt · halo · sombra · candado · contador) envuelve a PlayerCard en:
   page.tsx (vestíbulo) · coleccion · cuenta · PlayerMarket · PackOpeningExperience

CardViewer (detalle, 410 líneas) ──► CardRenderer size="xl" + panel de datos
CardReveal (packs, 323 líneas)   ──► revelación por rareza + playReveal(rank)
```

**Duplicación real:** 3 dibujos de carta; la inclinación y el brillo existen dos veces
(`CardRenderer` y `Card3D`); el recorte redondeado está escrito en tres sitios.

---

## 20 · Propuesta de intervención

### FASE A — imprescindible

| # | Problema | Impacto | Componente | Solución propuesta | Riesgo | Coste | Responsive | Perf |
|---|---|---|---|---|---|---|---|---|
| A1 | `special` sin efectos (P0-1) | Dos variantes reales parecen comunes | `CardEffects.tsx` | Dar a `special` su tratamiento (sweep + aura) y **derivar los efectos de `rank`, no de una lista de nombres**, para que no vuelva a haber huecos | Bajo | XS | No | Neutro |
| A2 | Rareza alta ilegible (P0-2) | La mejor carta se lee peor | `CardRenderer`, `CardEffects` | Bajar el brillo del puntero, poner los efectos **bajo** el texto y dar contraste garantizado al nick y a las cifras | Bajo | S | No | Mejora |
| A3 | Variante indistinguible (P0-4) | No se percibe qué se ha ganado | `CardRenderer` | Marca de variante propia (forma + emblema) en una posición fija, legible a tamaño de rejilla | Medio | M | Sí | +1 nodo/carta |
| A4 | Doble tilt (P1-4) | Movimiento inconsistente | `app/page.tsx` | Pasar `interactive={false}` | Nulo | XS | No | Mejora |

### FASE B — importante

| # | Problema | Impacto | Componente | Solución propuesta | Riesgo | Coste | Responsive | Perf |
|---|---|---|---|---|---|---|---|---|
| B1 | La carta no es NEXUS (P1-1) | Es el objeto central y no parece del juego | `CardRenderer` | Chaflán `nx-clip`, canto con filo de luz y placa hundida para el bloque inferior — el mismo vocabulario del sobre y del tablero | Medio | M | Sí | Neutro |
| B2 | Rareza = tono (P1-2, §7) | La progresión no se ve | `CardEffects`, `variants.ts` | Escalonar por rank: marco liso → metal → troquel → foil → holo. Sin tocar `variants.ts` como dato: solo su presentación | Medio | L | No | **Vigilar** |
| B3 | El sigilo se repite (P1-3) | Dos cartas no se distinguen a un metro | `PlayerSigil` | Subir la varianza de la silueta y reducir el andamiaje común | Medio | M | No | Neutro |
| B4 | 44 bucles en mercado (P1-7) | Riesgo en cuanto suba la rareza media | `CardEffects` | Limitar `aura` y `legendary` con `rich`, como ya se hace con `rays` y `particles` | Bajo | S | No | **Mejora grande** |
| B5 | Duelos ≠ colección (§14) | La carta no se reconoce como la misma | `CardRenderer` | Insinuar el trío de combate en la carta de colección. **Sin tocar `DuelCard` ni el tablero** | Bajo | S | Sí | Neutro |

### FASE C — polish

| # | Problema | Componente | Riesgo | Coste |
|---|---|---|---|---|
| C1 | Duplicado fuera de la carta (P1-6) | `Card3D` | Bajo | XS |
| C2 | Detalle como cuadro de mando (P1-5) | `CardViewer` | Medio | M |
| C3 | Carta más pequeña al ganarla que al consultarla (§10) | `PackOpeningExperience` | Bajo | XS |
| C4 | `status="new"` sin usar en colección | `app/coleccion` | Bajo | S |
| C5 | Riesgo de hidratación (P2-1) | `CardEffects` | Bajo | XS |
| C6 | `CardThumb` sin rareza (P2-2) | `CardThumb` | Bajo | S |

---

## 21 · Riesgos

1. **Rendimiento.** B2 es la propuesta que puede estropear lo que hoy funciona: añadir materia a la
   carta sin tocar el número de capas exige `box-shadow`/gradientes, no nodos nuevos. **B4 debe ir
   antes que B2**, para entrar con margen.
2. **Legibilidad.** Todo lo que se añada compite con el nick y las cifras. A2 debe ir primero.
3. **Duelos.** B5 toca `CardRenderer`, que Duelos **no** usa. El tablero no se toca.
4. **Móvil.** A3 y B1 añaden elementos a una carta de 150 px. Cualquier marca nueva tiene que
   probarse primero a 390.
5. **Datos.** Nada de lo propuesto toca `variants.ts` como dato, ni OVR, ni seriales, ni economía.

---

## 22 · Conclusión

Las cartas de NEXUS **no están rotas**: son legibles, consistentes en 8 de 10 pantallas, responsive
sin desbordamiento y con un envoltorio 3D bien pensado. El trabajo hecho es sólido.

Pero **no son objetos**. Son fichas de datos bien maquetadas. Lo que falta no es efecto: es
**materia** (chaflán, canto, troquel, profundidad de material) y **jerarquía de rareza** que se vea
antes de leer. Hoy la mejor carta del juego se distingue de la peor por el tono, y una de las ocho
variantes reales se dibuja como una común por un fallo de cinco líneas.

La intervención de mayor retorno por coste es **A1 + A2 + A4**: dos son de tamaño XS, corrigen dos
fallos objetivos y la mejor carta del juego pasa a leerse. Después, **B4 antes que B2**.

**Auditoría terminada. No se ha modificado ningún componente de producto.**

*Capturas: `docs/product/qa/card-audit/` (18 PNG, 1440 y 390) · métricas: `metricas.json` ·
herramienta: `scripts/card-audit-shots.ts`.*
