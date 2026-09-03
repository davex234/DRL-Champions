# FASE 9.6 — NEXUS COMO PRODUCTO GAMING PREMIUM

> De «bien organizado, mal presentado» a «esto es un videojuego».
>
> Estado: **entregada y verificada**. `npm test` 374/374 · typecheck ✅ · build ✅ ·
> `security:verify` ✅ · `ux:verify` ✅ (606 comprobaciones × 5 anchos) ·
> `audit:stability` **P0 0 · P1 0** · `duel:e2e` ✅ (partida completa con clics reales).

---

## FASE A — AUDITORÍA VISUAL DE LA 9.5

Método: leer el informe de la 9.5, abrir las **40 capturas** de `docs/product/visual/after/`
(que son el ANTES de esta fase) y mirarlas con ojos de jugador, no de auditor.

### El diagnóstico en una frase

**La 9.5 arregló las piezas; faltaba arreglar la COMPOSICIÓN y la GEOMETRÍA.**

La carta ya tiene arte, el sobre ya es un objeto y los modos ya son puertas. Pero todo
NEXUS sigue construido con **rectángulos de esquina redondeada**, y la jerarquía de varias
pantallas sigue respondiendo a la pregunta equivocada. Un panel de administración y un menú
de videojuego se distinguen antes por su SILUETA que por su paleta, y la silueta de NEXUS
era la de una web.

### Lo que encontré, pantalla por pantalla

| Pantalla | Qué seguía pareciendo dashboard |
|---|---|
| **Inicio** | Lo más grande y lo único con luz propia era **un torneo con un botón de predicciones**. Duelos —lo único que se JUEGA aquí— era la primera de cuatro cajas por debajo del pliegue. Y al final, **cuatro celdas con cifras**. Eso es un cuadro de mando, con el color que sea |
| **Pase** | **Treinta celdas de tabla en fila.** Sin recorrido, sin hitos, sin saber dónde estás y —lo peor— sin destacar el próximo premio, que es lo único que mueve a seguir jugando |
| **Rangos** | El rango era **un recuadro con un «4» dentro** y el texto «PLATINO II» al lado. Un sistema de nueve escalones y tres divisiones presentado como una celda. Y no había forma de ver **qué hay por encima**: un rango que no se ve no se persigue |
| **Perfil** | Tarjeta de identidad + doce emoji de avatar desplegados + tarjeta de rango + **ocho celdas de una cifra cada una**. Ningún módulo más importante que otro. Ninguna respuesta a «¿quién soy en este juego?» |
| **Arena** | **Cuatro paneles grises apilados** (marcador, rival, mesa, mano), todos con el mismo borde y el mismo fondo. La mesa —donde ocurre el juego— era el mismo rectángulo que el resto, con una carta pequeña y mucho vacío. No había un «dentro» |
| **Sobre** | El objeto del momento más importante del bucle de recompensa era **un rectángulo azul oscuro con un cuadradito y la palabra NEXUS**. La 9.5 lo agrandó en la tienda pero no tocó el objeto |
| **Ceremonia** | Sobre en negro → fogonazo blanco → cartas → lista. Se abría un sobre; no se celebraba nada. Y las nueve rarezas se distinguían **solo en cuánto tardaba en girar la carta** |
| **Resultado** | Ganar 10 turnos y perderlos se veían **igual salvo por el color del texto** |
| **Entrenador** | Las cuatro pantallas (plantilla, mapas, pizarra, partido) existen y funcionan. Faltaba decir que son **un recorrido**: como seis tarjetas sueltas, parecía que faltaba algo que ya está |
| **Card3D** | El envoltorio «la carta es un objeto» estaba escrito… y **se usaba en un solo sitio**. La colección dibujaba a mano su hover, su candado (un emoji 🔒) y su contador de duplicados |

### Un hallazgo de herramienta

`07-arena-reveal.png`, `32-resultado.png` y `33-replay.png` del juego 9.5 son **la misma
imagen** que `06-arena-turno1.png` (pesan exactamente lo mismo). El guion de capturas
buscaba un botón «Confirmar» y unos botones «Stronghold / Gamesense / Entryfrag» que no
existen: el confirmar cambia de texto según el paso y las estadísticas se rotulan SH/GS/EF.
El bucle salía en la primera vuelta. **La pantalla de resultado nunca se había fotografiado.**

---

## FASE B — DIRECCIÓN: LA GEOMETRÍA Y EL MOVIMIENTO

### 1 · El chaflán

Un borde cortado en diagonal es la marca del género (visores, HUD, placas técnicas) y no
pertenece a nadie: es geometría. Se aplica con `clip-path`, que es composición pura y no
cuesta un fotograma. En `globals.css`: `.nx-clip`, `.nx-clip-sm`, `.nx-clip-tr`.

**Y se gasta.** Va en escenarios, puertas de modo y placas. Si lo lleva cada caja, vuelve a
no distinguir nada — el error que ya cometimos con el radio grande.

### 2 · Escenario, placa y dato

Tres primitivas nuevas que completan el vocabulario de la 9.5:

| Pieza | Qué es | Dónde |
|---|---|---|
| `.nx-stage` + `.nx-stage-grid` | Luz propia, retícula técnica y base que asienta | Héroe, mesa de la arena, ficha de perfil, cabecera del pase, ruta táctica, mazo |
| `.nx-plate` | Metal troquelado con filo de luz | Nodos del pase, medalla de nivel, avatar |
| `.nx-readout` | Una cifra de HUD: etiqueta encima, número grande, **sin caja** | Sustituye a 20 celdas de cuadro de mando |

### 3 · El sistema de movimiento

`src/design/motion.ts`. **Seis momentos y solo seis**: entrada, elección, revelación,
recompensa, impacto y ambiente. Todas las curvas del producto pasan ahora por `EASE` —antes
había ocho sitios con `[0.16, 1, 0.3, 1]` escrito a mano y uno con otra curva distinta—.

Reglas: nada por encima de 350 ms en interfaz (las revelaciones son la excepción y tienen su
escala); solo se anima `transform` y `opacity`; `prefers-reduced-motion` recibe una versión
**estática**, no una lenta.

---

## FASES C–I — LO IMPLEMENTADO

### 1 · EL VESTÍBULO — jerarquía real

| Antes | Ahora |
|---|---|
| El torneo ocupaba el héroe | **El escenario es DUELOS.** Titular a 88 px, dos llamadas, luz, retícula y el abanico de cartas |
| Duelos era la primera de cuatro cajas | Los otros tres modos son el SECUNDARIO; Colección/Tienda/Progreso/Mundo, una tira TERCIARIA de gestión |
| Cuatro celdas con cifras al final | **HUD del escenario**: emblema de rango, nivel, colección y créditos, sin una sola caja |
| «Jugar» sin saber si tienes mazo | El escenario dice **◆ MAZO LISTO · Mazo 1 · 10/10 · OVR 901** o te ofrece construirlo |
| El abanico solo a partir de `lg` | **También en móvil**: a 390 px ya se ve una carta |
| El torneo desaparecería | Baja entero a la banda «El circuito», con directo, partidos y predicciones |
| Navbar con enlaces de 34 px flotando | Menú a altura completa del cromo, con la sección activa teñida (`.nx-menu-item`) |

### 2 · LA CARTA — un solo envoltorio para todo el producto

`Card3D` pasa de usarse en un sitio a ser **el envoltorio de carta de NEXUS**:

- **`static` ya no monta framer-motion.** Ese era el motivo real por el que no se podía usar
  en rejillas: sesenta cartas suscritas a un motor de animación para no animar nada.
- **`status` separa lo que la carta ES de cómo se mueve**: `new` (cuño en diagonal) y
  `locked` (la carta se ve, con una placa grabada y un candado geométrico propio — antes era
  un emoji 🔒 del sistema encima del arte).
- **Filo de rareza**: una línea de luz interior que hace que la carta se lea como algo
  troquelado y no como una imagen pegada al fondo.
- **Un nodo por carta**, no dos: la colección gana ~60 nodos de margen.

### 3 · LA CEREMONIA DE APERTURA — cinco actos

Era lo que el encargo señaló como lo más importante.

**El sobre.** Cuerpo metalizado con tres degradados cruzados, bandas de foil diagonales,
troquel central con el sigilo de NEXUS, **costura perforada que existe antes de rasgar** y
carga luminosa que sube conforme arrastras.

**Los actos**, cada uno responde a una pregunta:

1. `intro` — *¿qué tengo delante?* El sobre llega desde el fondo del escenario, sobre un
   suelo en perspectiva con línea de horizonte.
2. `sealed` — *¿qué hago?* Respira, la costura se ve, y hay **botón además del arrastre**
   (una ceremonia que solo se puede empezar arrastrando el ratón deja fuera al teclado).
3. `rupture` — el sobre **se parte**: dos mitades salen de cuadro, una columna de luz sube
   por la costura y una onda de choque barre la sala.
4. `reveal` — carta a carta, con la ceremonia de su rareza.
5. `summary` — **la mejor carta grande** y el resto alrededor, no diez miniaturas iguales.

**La rareza ahora se anuncia** (`ceremony.ts`): un **anillo de carga** rodea el dorso y se
completa en exactamente el tiempo de tensión de esa rareza —por lo que tarda en cerrarse ya
se intuye qué viene— y las altas **cantan** su nombre («Legendaria», «Icónica») antes de
girar. Cinco palancas por escalón: tensión, rayos, onda, esquirlas y estallido. Nueve
recetas distintas, no nueve velocidades del mismo dibujo.

### 4 · LA ARENA — un escenario, no cuatro paneles

- **La mesa es un escenario**: suelo en perspectiva, luz cenital sobre el punto de choque y
  las dos cartas **grandes** enfrentadas con el **medallón del VS** en medio, que se enciende
  cuando la jugada está lista. El choque va en una caja acotada y centrada: separadas por
  medio metro, dos cartas dejan de leerse como un enfrentamiento.
- **El rival es el lado contrario**, no la sección de arriba: banda teñida con la luz
  entrando desde fuera.
- **Un solo marcador**, con las cifras a tamaño de marcador. Había dos con los mismos números.
- **El desenlace se celebra**: el titular entra un 35 % más grande y se cierra, la sala se
  tiñe y —**solo en victoria**— una corona radial se abre detrás. La derrota no lleva corona:
  celebrarla sería mentir.

**Ni una regla cambia.** Misma elección, misma confirmación, mismo resultado del servidor, y
los textos de botón y los `aria-label` se conservan literalmente porque `duel:e2e` juega la
partida entera buscándolos.

### 5 · LOS RANGOS — de celda a objeto

`RankEmblem`: **un emblema por escalón, con las mismas piezas y distinto reparto** — núcleo
(escudo → rombo → estrella), alas (0-3 pares), corona de púas, corona radial, facetas y
píldoras de división. Que compartan vocabulario es lo que los hace legibles como escalera:
se ve que Diamante viene después de Platino porque tiene lo de Platino **y algo más**.

- **SIN CLASIFICAR tiene su propia forma**: contorno hueco y punteado. No es un bronce
  apagado. Sigue sin haber rango falso para quien no ha puntuado.
- **`RankBadge` enseña el destino**: el emblema del siguiente rango, apagado, cierra la barra
  de progreso.
- **La escalera completa** en `/ranking`: los ocho rangos reales con su umbral y el tuyo
  marcado. Champion aparte, porque es posicional.
- El emblema entra en el HUD del vestíbulo, en las filas de la clasificación y en el perfil.

### 6 · EL PASE — un recorrido, no una tabla

`PassRail`: una **vía** que se ilumina hasta donde has llegado, con un **nodo por nivel**;
los hitos (sobre, cosmético, carta) son más grandes; el nodo reclamable late; «ESTÁS AQUÍ»
marca tu posición; y la vía **se desplaza sola** hasta tu nivel al abrir.

`NextReward` saca **el próximo premio fuera del carril**: qué es, en qué nivel y cuánto
falta. Un pase funciona porque siempre hay algo a un paso; entre veintinueve niveles
idénticos, eso no existe.

Los iconos de recompensa son **SVG propio**, no 🪙 y 🎟️ del sistema operativo.

### 7 · LOS OBJETIVOS — una lista que no se cierra

El encargo pedía que entren objetivos nuevos sin rediseñar la pantalla. Las misiones ya
llegan del servidor con su `kind` y ese eje **estaba sin usar**. Ahora la sección se agrupa
por lo que llega: los `kind` conocidos en su orden (diarias → semanales → evento → de
temporada → hitos…) y **cualquiera que aparezca mañana sale igual**, al final, con su nombre.
La extensibilidad no es un hueco reservado: es no cerrar la lista.

### 8 · EL PERFIL — una ficha de jugador

Identidad, rango y progreso en **un solo escenario teñido por el color del rango**, con el
emblema a 112 px. Las ocho celdas se convierten en una tira de datos de HUD. **Se enseñan
tus cuatro mejores cartas** —un perfil de un juego de cartas que no enseña ni una carta habla
de todo menos de lo que has conseguido— y avatar y región bajan a «Ajustes», que es lo que
son.

### 9 · EL CENTRO TÁCTICO — la ruta

No faltaba ninguna pantalla: faltaba decir que las cuatro son **un recorrido**. La tira de
arriba lo dice en cuatro pasos con su **estado real** — titulares del store de equipos,
estrategias guardadas de `/api/game/strats`. Ningún paso se marca como pendiente si su
pantalla existe.

### 10 · EL MAZO, LA COLECCIÓN Y EL MUNDO

- **Constructor**: el mazo pasa de `nx-panel` a escenario, los huecos vacíos **dicen qué rol
  les falta** y hay una banda de estado que se ve antes de leerse.
- **Colección**: usa `Card3D`; el candado emoji desaparece.
- **Mundo**: se declara su propósito —«el circuito que corre aunque tú no juegues»— y sus
  cinco contadores salen de sus cajas. Su peso baja donde tenía que bajar: **en el vestíbulo
  pasó de puerta de modo a destino de la tira de gestión**. La funcionalidad no se toca.
- **Colección vs Inventario**: el reparto ya estaba declarado en pantalla y con enlace
  cruzado desde la 9C. No se ha tocado: no había redundancia real que resolver.

---

## ARCHIVOS

**Nuevos (4 de producto + 1 de documentación):**
`src/design/motion.ts` · `src/components/progression/RankEmblem.tsx` ·
`src/components/progression/PassRail.tsx` · `src/components/packs/ceremony.ts` ·
`docs/product/visual/README.md`

**Modificados (21 de producto):**
`globals.css` · `design/nav.ts` · `app/page.tsx` · `app/coleccion` · `app/cuenta` ·
`app/logros` · `app/ranking` · `app/mundo` · `app/entrenador` · `layout/GameShell` ·
`layout/PageTransition` · `visual/Card3D` · `progression/RankBadge` · `packs/SealedPack` ·
`packs/CardReveal` · `packs/PackOpeningExperience` · `packs/PackStoreCard` ·
`duel/MatchBoard` · `duel/DeckBuilder` · `duel/ResultScreen`

**Herramientas (2):** `scripts/lib/cdp.ts` (`setMedia`) · `scripts/visual-shots.ts`
(selectores de la arena corregidos + capturas de ceremonia con movimiento)

---

## VERIFICACIÓN

| | |
|---|---|
| `npm test` | ✅ **374 / 374** |
| `npm run typecheck` | ✅ |
| `npm run build` | ✅ |
| `npm run security:verify` | ✅ |
| `npm run ux:verify` | ✅ **606 comprobaciones** · 22 pantallas × 5 anchos (390/768/1024/1440/1920) |
| `npm run audit:stability` | ✅ 105 comprobaciones · **P0 0 · P1 0** · P2 3 (401 de rutas `/admin` sin token, preexistente) |
| `npm run audit:interactions` | ✅ modales, menús, pestañas, sesión |
| `npm run duel:e2e` | ✅ partida completa con clics reales, victoria, repetición |
| `npm run duel-gameplay:verify` | ✅ |
| `npm run progression:verify` | ✅ |
| `npm run strats:verify` | ✅ |
| `npm run sw:verify` | ✅ |
| `npm run test:e2e` | ✅ (`E2E_BASE_URL=http://127.0.0.1:3001`) |

### Tres regresiones que causé y corregí

1. **`ux:verify`** — el enlace «construye tu mazo» del vestíbulo quedó a 194×18 px, bajo el
   suelo de 32. Pasó a ser un control con altura de control.
2. **`audit:stability`** — al hacer `/abrir` inmersiva, la ruta se quedó sin `data-context`
   (P1 «sin armazón») y la pantalla de sobre inexistente bajó a **28 caracteres** (P0
   «pantalla en blanco»). Se añadió el alias de sección `/abrir → tienda` y los tres estados
   límite se reescribieron con título, explicación y **dos salidas**.
3. **`audit:interactions`** — `Card3D` envolvía cada carta en un `div`, y la auditoría
   localiza la rejilla de la colección buscando el contenedor cuyos hijos son **todos**
   botones. No se relajó la auditoría: se quitó el envoltorio (un nodo menos por carta) y la
   carta bloqueada pasó a ser un `<button disabled>`.

---

## ANTES / DESPUÉS

- `docs/product/visual/after/` → **el antes de esta fase** (resultado de la 9.5)
- `docs/product/visual/96-despues/` → **el después** (43 capturas)

Mismos nombres, misma cuenta sembrada, mismos anchos (1440 y 390). `README.md` explica dos
cosas importantes: se toman con el movimiento **reducido** (Chrome sin cabeza lo declara), lo
que las hace comparables pero impide juzgar el movimiento; y **tres capturas del juego 9.5 no
son lo que dicen** (ver Fase A). Las tres capturas `34/35/36-ceremonia-*` se toman aparte
**con el movimiento activado**, porque de una ceremonia no se puede juzgar el reposo.

---

## LO QUE DELIBERADAMENTE NO SE TOCÓ

Motor de duelos · Combat Resolver · `CombatPlan` · orquestador · bots · RNG · balance ·
estadísticas · OVR · generación de cartas · reglas de empate · economía autoritativa ·
RLS · autenticación · APIs · sistema de replays · reglas de mazo · propiedad de cartas ·
service worker · seguridad · pasarela de pago (§12: sigue sin haberla) · sistema táctico
(dominio) · `domain/progression/rank.ts` (los umbrales, divisiones y cúspide son los de la 9D).

`duel:e2e`, `duel-gameplay:verify`, `progression:verify`, `strats:verify`, `sw:verify` y
`security:verify` pasan sin cambios en ninguno de esos ficheros.

---

## UN CAMBIO FUERA DEL ALCANCE VISUAL — Y ES REVERSIBLE

**`supabase/config.toml` y `.env.local`: puertos locales 543xx → 545xx.**

Windows tiene reservado en esta máquina el rango **54289–54488** (`netsh interface ipv4 show
excludedportrange`), que cubre los puertos por defecto de Supabase local (54321-54324). Los
contenedores arrancaban **sin publicar puerto**, así que no había base de datos: sin ella no
hay capturas, ni `ux:verify`, ni `duel:e2e`, ni `audit:stability` — es decir, ninguna de las
verificaciones que la fase pide.

Se desplazaron los puertos a 54520-54529, fuera del rango reservado. Es un arreglo de
entorno, no de producto, y se revierte con:

```bash
git checkout supabase/config.toml
sed -i 's/54521/54321/' .env.local
npx supabase stop && npx supabase start
```

(volviendo, eso sí, al estado en el que la base de datos local no arranca en esta máquina).

---

## LO QUE QUEDA

| Pendiente | Por qué |
|---|---|
| **Sonido** | La ceremonia tiene tres actos nuevos y sigue con los tres efectos de la Fase 7. El acto de la rotura pide su propio golpe y las rarezas altas, su propio anuncio |
| **Ascenso de rango** | `RankEmblem` acepta `ascending` y nadie lo usa: falta el MOMENTO —«has subido a Diamante»— que hoy no existe en ninguna pantalla |
| **Tienda, Mercado, Torneos, Pick'ems, Eventos, Carrera, Manager, Noticias** | Heredan las primitivas nuevas pero no se han recompuesto. La Tienda todavía tiene dos celdas de saldo en la cabecera |
| **Cosméticos del pase** | El carril de pago reparte cosméticos que en ninguna pantalla se pueden **ver ni equipar**. Hoy son un id con prefijo |
| **Repetición (`/duelos/replay`)** | Hereda la carta y el marcador nuevos, pero su composición no se ha replanteado |
| **El antes de tres pantallas** | `07-arena-reveal`, `32-resultado` y `33-replay` no tienen ANTES real: el guion de la 9.5 nunca las fotografió (corregido, pero no reconstruible) |
| **Retratos de jugador** | `PlayerSigil` sigue siendo arte de relleno de calidad. El día que haya fotos autorizadas, `PlayerPhoto` las prefiere y el emblema deja de dibujarse. Ese camino está probado |

## RIESGOS ABIERTOS

1. **El presupuesto de nodos sigue justo** en `/coleccion`. La 9.6 lo alivió (un nodo menos
   por carta) pero cualquier capa nueva en la carta lo vuelve a poner al límite.
2. **El chaflán clipa el borde.** `clip-path` recorta también el `border`, así que la
   diagonal de una pieza con borde de 1 px queda sin trazo. En fondos oscuros se lee como
   bisel y funciona; sobre un fondo claro no funcionaría. Si algún día hay tema claro, el
   chaflán necesita su propio trazo.
3. **Las capturas se toman con movimiento reducido.** Es una decisión (comparabilidad), pero
   significa que **el movimiento de NEXUS no está verificado por captura** salvo en las tres
   de la ceremonia. La verificación de que sigue siendo legible SIN movimiento sí es completa.
