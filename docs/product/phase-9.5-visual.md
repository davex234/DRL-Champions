# FASE 9.5 — TRANSFORMACIÓN VISUAL DE NEXUS

> De «web de cartas» a «videojuego de cartas competitivo».
>
> Estado: **primera pasada completa y verificada.** No es la transformación entera —lo que
> queda está listado y explicado en «LO QUE FALTA»—, pero lo entregado está probado en
> navegador real y no rompe nada.

---

## FASE A — AUDITORÍA VISUAL

Método: 40 capturas reales en Chrome (`npm run visual:shots -- before`), con una cuenta
**sembrada** (70 cartas, 5 sobres, 80.000 créditos, 940 puntos, un mazo guardado y una
partida jugada). Una pantalla vacía no dice nada sobre el diseño.

Se han examinado a ojo, no por código.

### El diagnóstico en una frase

**NEXUS está bien organizado y mal presentado.** La información está donde tiene que estar,
la jerarquía es correcta y nada se rompe — pero **todo se dibuja con la misma pieza**: un
rectángulo oscuro con borde de 1 px, radio grande y un poco de texto dentro. Da igual que
sea el torneo en directo, un modo de juego, un sobre o una herramienta táctica: **la misma
caja**. Eso es lo que hace que parezca un panel de administración.

### El hallazgo que más pesa

**Las cartas —que son EL producto— se dibujan como rectángulos de color con dos iniciales.**

En `08-coleccion` se ve claro: `92 DUE 🇧🇷 AS · ASPAS · ICON SERIES`. El retrato del jugador
es **una silueta gris abstracta**. No hay marco, ni foil, ni textura, ni relieve, ni
diferencia real entre una carta base y una Icon Series más allá del color de fondo.

Y esa carta aparece en **ocho pantallas**: Inicio, Colección, Inventario, Tienda,
Constructor, Duelos, Resultado y Repetición. Arreglar la carta arregla ocho pantallas.

### Pantalla por pantalla

| Pantalla | Qué funciona | Qué parece web | Prioridad |
|---|---|---|---|
| **Inicio** | Barra superior, cartera, jerarquía correcta | **Ni una carta sobre la línea de flotación.** El héroe es un rectángulo vacío de 420 px con el 60 % derecho en negro. Los 4 modos son 4 cajas idénticas con una rayita de 9 px. El aviso de instalación ocupa el primer sitio. Los partidos son una tabla de texto sin escudos | **P0** |
| **Colección** | Cartas con color por rareza, filtros ricos | **640 px de cromo antes de ver una carta**: banner, cabecera, progreso, pestañas, 4 tarjetas de región, buscador y **dos filas de píldoras**. Las cartas son planas | **P0** |
| **Tienda** | Arte de sobre presente, barra de probabilidades | **El sobre mide 100×150 px dentro de una tarjeta de 450.** Inicial/Estándar/Premium se distinguen solo por un tinte. Sin relieve, sin foil, sin hover | **P0** |
| **Arena (duelo)** | Ya es pantalla completa, marcador, salida visible | **Cuatro paneles grises apilados.** No hay mesa ni zona de choque: el rival arriba, tú abajo y nada en medio. La columna derecha son 400 px de «HISTORIAL: aún no se ha jugado ningún turno» | **P0** |
| **Constructor** | **La mejor pantalla.** Mazo arriba, 10 huecos, colección debajo | Solo le falta que las cartas tengan cuerpo y algo de movimiento al colocar | P2 |
| **Entrenador** | Estructura correcta, honestidad sobre lo pendiente | **Seis rectángulos de texto.** Párrafos largos, cero imagen, ningún mapa visible. Es un índice, no un centro táctico | **P1** |
| **Pase / Progreso** | Tres carriles claros, estados correctos | Los niveles son celdas de tabla. Sin línea temporal, sin sensación de recorrido | **P1** |
| **Perfil · Ranking · Recompensas · Mundo** | Datos correctos | Listas y tarjetas. Sin insignia de rango con presencia | P2 |
| **Modal de carta** | Abre y cierra bien | Es una ficha de datos, no una vitrina | P2 |

### Lo que sobra o está duplicado

1. **El aviso de instalación** se lleva el mejor sitio de todas las pantallas.
2. **Cuatro tarjetas de progreso por región** en Colección: información administrativa por
   delante de las cartas.
3. **La columna «Historial» de la arena**: un tercio de la pantalla para un registro vacío.
4. **Dos filas de píldoras de filtro** en Colección, siempre desplegadas.
5. **Colección vs Inventario** siguen siendo dos superficies; el reparto actual (catálogo /
   sobres+duplicados) es defendible pero la Fase 9C lo dejó a medias.

### Lo que debería ser protagonista y no lo es

- **Las cartas.** Hoy son el elemento más pequeño y plano de casi todas las pantallas.
- **Los sobres.** Se vende un objeto y se enseña una miniatura.
- **El rango.** Es el eje competitivo y aparece como una fila más.
- **Los mapas.** Existen cuatro trazados dibujados en SVG y en el vestíbulo del entrenador
  no se ve ninguno.

### Qué necesita animación, profundidad o arte

| Necesidad | Dónde |
|---|---|
| **Arte real de carta** (marco, retrato, foil, relieve) | Carta → 8 pantallas |
| **Profundidad 3D** | Cartas, sobres, insignias de rango |
| **Movimiento con propósito** | Entrada de rejilla, revelación de sobre, choque de turno, subida de nivel |
| **Fondo con contexto** | Ya existe `DynamicGameBackground`; hay que darle materia (formas, fragmentos, energía) |
| **Composición** | Inicio (héroe), Arena (mesa), Tienda (escaparate), Entrenador (mapas visibles) |

---

## FASE B — DIRECCIÓN VISUAL PROPUESTA

**Principio rector: una sola pieza no puede servir para todo.** Se define un vocabulario de
superficies con jerarquía real, y cada cosa usa la suya.

### 1 · Vocabulario de superficies

| Pieza | Para qué | Tratamiento |
|---|---|---|
| **Escenario** (`stage`) | Héroe, arena, revelación | Ocupa, tiene luz propia, arte de fondo, profundidad |
| **Objeto** (`object`) | Carta, sobre, insignia | Tiene cuerpo: marco, relieve, sombra proyectada, brillo especular |
| **Panel** (`panel`) | Agrupar contenido | Discreto, no compite |
| **Dato** (`readout`) | Cifras, estados | Sin caja: tipografía y color |

Lo que hoy falla es que **todo es «panel»**.

### 2 · Rareza como sistema, no como color de fondo

Cada rareza recibe: color de acento, tratamiento de marco, intensidad de foil, halo y
partícula. Una Icon Series tiene que **verse** distinta a tres metros, no solo más clara.

### 3 · Movimiento con propósito

Cuatro momentos, y solo cuatro: **entrada** (una rejilla que se puebla), **elección** (la
carta responde al puntero), **revelación** (sobre y choque de turno) y **recompensa**
(subida de nivel, reclamo). Fuera de ahí, quieto.

### 4 · Identidad NEXUS

Geometría angular y limpia, magenta como acento único de acción, cian para lo informativo,
oro para lo valioso. Sin degradados arcoíris, sin neón por todas partes. **El color se gasta
donde importa.**

---

---

## FASES C–O — LO IMPLEMENTADO

### El principio que ordenó el trabajo

**Arreglar la carta arregla ocho pantallas.** La carta aparece en Inicio, Colección,
Inventario, Tienda, Constructor, Duelos, Resultado y Repetición. Era, además, el peor
elemento de todos. Por ahí se empezó.

---

### Bloque 1 · EL ARTE DE LA CARTA — `PlayerSigil`

**El problema.** No hay retratos de jugador, y cuando faltaba la foto —siempre— la carta
dibujaba una silueta genérica: círculo, hombros y dos iniciales. **772 cartas con la misma
imagen.** Eso es lo que hacía que la colección se leyera como una hoja de cálculo con
colores.

**La solución.** `src/components/cards/layers/PlayerSigil.tsx`: un emblema geométrico
derivado del identificador del jugador. Esquirlas de energía, anillos, núcleo poligonal
oscuro con borde luminoso y el monograma dentro.

Tres propiedades que no son negociables:

| Propiedad | Por qué |
|---|---|
| **Determinista** | El mismo jugador da siempre el mismo emblema, en cualquier dispositivo. Si cambiara al azar, coleccionar dejaría de tener sentido: una carta tiene que ser reconocible |
| **Original** | Formas geométricas propias. Ni un asset, ni una silueta, ni un logo de nadie |
| **Sustituible** | Es el RESPALDO de `PlayerPhoto`. El día que haya retratos autorizados, la foto gana y esto no se dibuja. No hay que deshacer nada |

**Dos iteraciones fueron necesarias, y las dos por mirar el resultado:**

1. La primera versión salió **lavada**: las esquirlas se perdían contra el degradado claro
   de la carta. Se añadió una viñeta oscura bajo el emblema y se subió la opacidad.
2. Al invertir el núcleo a negro, el monograma quedó **negro sobre negro**: `palette.text`
   es oscuro en las paletas claras (Icon, Oro), porque está pensado para leerse sobre el
   fondo claro de la carta. El texto pasó a claro y la rareza la lleva el borde.

**Y el hueco inferior.** El tamaño pequeño ocultaba las estadísticas y dejaba un tercio de
la carta vacío. Primera idea: las seis cifras en una línea — **se salían de la carta**.
Segunda: una rejilla de seis columnas — ilegible a 25 px por columna. La que quedó: un
**perfil de barras**, que se compara de un vistazo, que es lo que se hace al mirar una
rejilla. Las cifras exactas siguen en la carta grande y en el detalle.

---

### Bloque 2 · EL VESTÍBULO

| Antes | Ahora |
|---|---|
| Ni una carta sobre la línea de flotación | **Abanico de tus tres mejores cartas** en el héroe, superpuestas e inclinadas como cartas en la mano |
| El 60 % derecho del héroe, negro | Ocupado por ese abanico |
| Cuatro cajas idénticas con una rayita de 9 px | Cuatro **puertas** con emblema geométrico propio; Duelos ocupa el doble |
| El aviso de instalación, lo primero de cada pantalla | Movido **debajo** del contenido |

**`ModeEmblem`** (`src/components/visual/ModeEmblem.tsx`) da a cada modo una marca que dice
de qué va antes de leer: cuñas enfrentadas (Duelos), cuadro que asciende (Torneos), retícula
(Pick'ems), nodos unidos sobre cuadrícula (Entrenador). Van **detrás** del texto, grandes y
recortadas por el borde: un icono pequeño en una esquina se lee como decoración.

Dos ajustes que salieron de mirar la captura: el abanico se **salía** del héroe
(`overflow-hidden` lo cortaba) y la rejilla de seis columnas hizo falta porque, con cuatro y
Duelos ocupando dos, **Entrenador caía solo a una segunda fila**.

---

### Bloque 3 · LA TIENDA

El sobre medía **100×148 px dentro de una tarjeta de 450**. Se vendía un objeto y se
enseñaba una miniatura.

Ahora ocupa 288 px de alto y se comporta como un objeto: flota, **se inclina en 3D** al
pasar por encima y proyecta su luz. Es el mismo `SealedPack` que se ve al abrirlo, así que
lo que compras y lo que abres son la misma pieza.

---

### Bloque 4 · LA COLECCIÓN

**640 px de cromo antes de ver una carta.** Aviso de instalación, cabecera, barra de
progreso, pestañas, cuatro tarjetas de región y dos filas de píldoras.

| Cambio | Efecto |
|---|---|
| Las cuatro tarjetas de región bajan **debajo** de la rejilla | Es un resumen, y un resumen se consulta después de mirar |
| Los filtros se **pliegan**; buscador y orden siempre visibles | El botón lleva un contador de filtros activos para que plegarlos no los esconda |
| El aviso de instalación, fuera del top | — |

**Las cartas empiezan ahora a ~375 px en vez de ~640.** Dos filas completas visibles.

---

### Bloque 5 · LA ARENA

| Antes | Ahora |
|---|---|
| 300 px de columna para «aún no se ha jugado ningún turno» | La columna de historial **solo aparece cuando hay turnos**. La mesa arranca a lo ancho |
| Rival arriba, mano abajo, **nada en medio** | Una **mesa**: tu carta contra el dorso del rival, con el VS en medio |
| Sin señal de «ya puedes confirmar» | La barra central se enciende cuando la jugada está lista |

La mano cabe ahora en **una sola fila** y las cartas llevan su emblema. No cambia ninguna
regla: la misma elección, la misma confirmación y el mismo resultado del servidor.

---

### Bloque 6 · EL CENTRO TÁCTICO

Seis rectángulos de texto, y **ningún mapa a la vista** en una herramienta táctica: el
equivalente a una tienda sin escaparate. Existían cuatro trazados dibujados y no se veía
ninguno.

- **`MapThumb`** (`src/components/tactics/MapThumb.tsx`) dibuja el trazado. No es
  `StrategyBoard` en pequeño: la pizarra es un editor con rejilla, etiquetas, fichas
  arrastrables y manejo de puntero, y nada de eso sirve a 120 px ni debe pagarse cuatro
  veces para enseñar una forma.
- **Los mapas suben por delante de las herramientas.** Los mapas son el contenido; las
  herramientas, la navegación. Poner el índice delante del material dejaba la pantalla
  pareciendo una tabla de contenidos.

---

## COMPONENTES: NUEVOS Y REUTILIZADOS

**Reutilizados y extendidos** (regla de no duplicación):

| Componente | Qué se hizo |
|---|---|
| `CardRenderer` | Se extendió: perfil de barras en tamaño pequeño, propagación de `rank` y `rich` |
| `PlayerPhoto` | Se extendió: el respaldo pasa de silueta genérica a `PlayerSigil` |
| `Card3D` | **Reutilizado tal cual** en el abanico del héroe |
| `SealedPack` | **Reutilizado tal cual**, a escala, en la tienda |
| `DuelCard` / `DuelCardBack` | **Reutilizados tal cual** en la mesa de la arena |
| `GameShell` | Se extendió: el aviso de instalación baja |
| `DynamicGameBackground`, `PlayerCard`, `CardRegistry` | Sin tocar |

**Nuevos, y solo porque no existía nada que hiciera eso:**

- `src/components/cards/layers/PlayerSigil.tsx` — arte de carta generado
- `src/components/visual/ModeEmblem.tsx` — marcas de modo de juego
- `src/components/tactics/MapThumb.tsx` — miniatura de mapa

---

## ARCHIVOS MODIFICADOS

**Producto (9):**
`src/components/cards/layers/PlayerSigil.tsx` *(nuevo)* ·
`src/components/cards/layers/PlayerPhoto.tsx` ·
`src/components/cards/CardRenderer.tsx` ·
`src/components/visual/ModeEmblem.tsx` *(nuevo)* ·
`src/components/tactics/MapThumb.tsx` *(nuevo)* ·
`src/components/duel/MatchBoard.tsx` ·
`src/components/duel/DuelCard.tsx` ·
`src/components/packs/PackStoreCard.tsx` ·
`src/components/layout/GameShell.tsx`

**Pantallas (3):** `src/app/page.tsx` · `src/app/coleccion/page.tsx` ·
`src/app/entrenador/page.tsx`

**Herramienta (1):** `scripts/visual-shots.ts` *(nuevo)* — juegos ANTES/DESPUÉS

---

## VERIFICACIÓN

| | |
|---|---|
| `npm run typecheck` | ✅ |
| `npm test` | ✅ **374 tests** |
| `npm run build` | ✅ |
| `npm run security:verify` | ✅ |
| `npm run audit:stability` | ✅ 105 comprobaciones · **P0 0 · P1 0** |
| `npm run audit:interactions` | ✅ modales, menús, pestañas, sesión |
| `npm run ux:verify` | ✅ 22 pantallas × **5 anchos** (390/768/1024/1440/1920) |
| `npm run duel:e2e` | ✅ partida completa con clics reales |
| `npm run duel-gameplay:verify` | ✅ |
| `npm run progression:verify` | ✅ |
| `npm run strats:verify` | ✅ |
| `npm run sw:verify` | ✅ |
| `npm run test:e2e` | ✅ |

**Capturas:** 40 ANTES en `docs/product/visual/before/` y 40 DESPUÉS en
`docs/product/visual/after/`, mismas pantallas y mismos estados, con cuenta sembrada
(70 cartas, 5 sobres, 940 puntos, mazo guardado, partida jugada).

### Una regresión que causé y corregí

`ux:verify` la cazó: el arte nuevo subió `/coleccion` de ~1.500 a **4.058 nodos**, justo por
encima del umbral de 4.000 que vigila el rendimiento en móvil. **No moví el listón.** Se
optimizó:

- menos esquirlas en carta pequeña (4-5 en vez de 5-9): ~240 nodos menos;
- el filtro de desenfoque y los gradientes que no se usan **ya no se declaran** —un
  `<filter>` sin usar sigue siendo nodos, y multiplicado por sesenta cartas se nota;
- la tanda de la rejilla baja de 60 a 48, que siguen llenando de sobra un 1920.

---

## DECISIONES DE DISEÑO

1. **El arte de carta se genera, no se descarga.** SVG en línea, determinista, sin red y sin
   peticiones que fallen. Original al 100 %.
2. **Barras en vez de cifras en la carta pequeña.** Seis números diminutos son ruido; un
   perfil se compara de un vistazo.
3. **Duelos ocupa el doble que los otros modos.** Es el modo propio del juego; los otros
   tres cuelgan del calendario real. Una rejilla de cuatro piezas iguales no dice cuál es la
   principal.
4. **El aviso de instalación va debajo.** Es una utilidad del navegador, no contenido del
   juego.
5. **El historial de la arena aparece cuando hay historial.** Que la mesa arranque a lo
   ancho y la columna entre cuando hay algo que contar es la progresión natural de la partida.
6. **Los mapas por delante de las herramientas** en el centro táctico.
7. **Los filtros se pliegan, con contador.** Plegar no puede esconder que hay filtros puestos.
8. **`MapThumb` es un componente aparte, no `StrategyBoard` en pequeño.** Un editor y una
   miniatura son cosas distintas y la miniatura no debe pagar el coste del editor.

---

## LO QUE DELIBERADAMENTE NO SE TOCÓ

Motor de duelos · Combat Resolver · orquestador · bots · RNG · balance · `COMBAT_MATCHUP` ·
estadísticas · OVR · reglas de empate · autoridad de servidor · seguridad · API ·
persistencia · sistema de rangos · progresión · economía · sistema táctico (dominio) ·
validación de mazos.

`duel:e2e` juega una partida completa con clics reales y `duel-gameplay:verify`,
`progression:verify`, `strats:verify` y `security:verify` pasan sin cambios. Los datos de las
cartas —OVR, variantes, estadísticas— **no se han tocado**: solo su presentación.

---

## LO QUE FALTA — Y ES BASTANTE

Esta es una **primera pasada** sobre lo de mayor impacto, no la transformación completa que
pediste. Lo que queda, con su motivo:

| Pendiente | Estado |
|---|---|
| **Pase / Progreso (Fase K)** | Los niveles siguen siendo celdas. Falta la línea temporal, la recompensa siguiente destacada y la animación de reclamo |
| **Rangos (Fase J)** | `RankBadge` mejoró en la Fase 9D pero sigue sin ser una insignia con presencia: falta emblema por rango y animación de ascenso |
| **Apertura de sobre (Fase G)** | La ceremonia (selección → animación → cartas ocultas → reveal por rareza) sigue siendo la de antes. Solo se rehízo el escaparate |
| **Perfil, Mundo, Logros (Fase M)** | Sin tocar. «Mundo» sigue sin una función claramente delimitada |
| **Resultado y Repetición** | Heredan la carta nueva, pero su composición no se ha replanteado |
| **Constructor (Fase I)** | Era ya la mejor pantalla y hereda el arte nuevo; no se le añadió movimiento al colocar carta |
| **Cartas en el héroe móvil** | El abanico es solo para pantallas anchas: a 390 px el titular y la llamada a la acción se quedan el alto disponible |

---

## RIESGOS ABIERTOS

1. **El presupuesto de nodos está justo.** `/coleccion` quedó cerca del umbral de 4.000.
   Cualquier capa nueva en la carta lo supera y `ux:verify` fallará — que es exactamente
   para lo que está.
2. **`audit:stability` falló una vez dentro de un lote** de tres auditorías de navegador
   seguidas y pasó limpio en las tres ejecuciones aisladas posteriores. Sospecho contención
   con el servidor de desarrollo y una ventana de asentamiento de 2,8 s demasiado justa
   cuando Next está recompilando. No lo he demostrado.
3. **El sigilo es arte de relleno de calidad, no arte final.** Cuando haya retratos
   autorizados, la foto gana automáticamente y el emblema deja de dibujarse. Ese camino está
   probado y no requiere deshacer nada.
4. **El monograma usa las dos primeras letras del alias.** Dos jugadores cuyo alias empiece
   igual comparten monograma, aunque su emblema (esquirlas, núcleo, anillos) sí se distinga.
