# Fase 46 · La Home de NEXUS pasa a ser un MENÚ PRINCIPAL — informe

Fecha: 2026-09-18 · Rama `arch/stabilization` · sin commit, sin push, sin deploy, sin Docker, **0 migraciones**.
Referencia visual: `inventario.png` (raíz del proyecto).

---

## 1 · Qué cambié en la Home

La Home era `DailyLobby`: **seis bloques apilados** (héroe del día, «después», hoy, temporada, jugar, circuito,
colección) dentro del armazón, con una barra de **seis secciones y ~20 enlaces**. Responde muy bien a «¿qué hay?» y
muy mal a «¿qué hago?».

Ahora es `MainMenu`: **tres acciones** sobre una escena a pantalla completa, sin barra de navegación.

`DailyLobby` **no se ha borrado**: sigue siendo la vista del arnés de QA de la Fase 36. Y la lectura no cambia: la
Home sigue usando el mismo `GET /api/game/daily-loop`, que sigue siendo **de sólo lectura**.

## 2 · Cómo repliqué `inventario.png`

| Referencia | NEXUS |
|---|---|
| HUD fino arriba: marca izquierda, jugador derecha | Igual. Marca **real** de NEXUS, no «NEXUS CHAMPIONS» (§29) |
| Tres botones angulares verticales, ~40 % del ancho | Igual: `clip-path` biselado, `min(92vw, 640px)` |
| JUGAR magenta · INVENTARIO cian · TIENDA dorado | Igual |
| Muescas de conector en el canto izquierdo | `.nx-menu-ticks` |
| Lema de dos líneas bajo el menú | «LAS CARTAS / HACEN LEYENDAS» + regla |
| Escena catedralicia con torres y bruma | Siluetas oscuras en dos planos + haces + bruma |
| Suelo reflectante en fuga | `perspective(760px) rotateX(74deg)` + charco |
| Cartas cayendo a distintas profundidades | 5 cartas **reales**, con desenfoque por distancia |
| Carta legendaria grande arriba-derecha | Hero card real (`PlayerCard size="lg"`) con montura dorada |
| Caja abierta abajo-derecha con luz dorada | Pack de 8 capas con boca, labio incandescente, haces y velo |
| Dos accesos pequeños abajo | Carta destacada (izq.) · Road to Champions (der.) |
| «PLAY · COLLECT · COMPETE · BELONG» | Igual, al pie y en el monolito del fondo |

**Lo que NO copié, a propósito:** el branding «NEXUS CHAMPIONS» (§29) y la **segunda moneda** de la referencia
(30.940 + 1.250). El producto tiene **una** moneda, créditos; inventar una premium porque salga en una imagen sería
prometer algo que no existe.

## 3 · JUGAR

Primera, magenta `255, 46, 99`, la tipografía más grande de la pantalla (`clamp(28px, 5.6vh, 58px)`).
→ **`/jugar`**, el Play Hub de la Fase 45. **No he tocado F45.** PvE, Ranked, Campaña, Draft y PvP siguen viviendo
ahí dentro; ninguno sube a la Home.

## 4 · INVENTARIO

Cian. → **`/boveda`** (hub nuevo).

Ojo con la ruta: **`/inventario` ya existe y es otra cosa** —los sobres sin abrir y las duplicadas, que pertenecen a
TIENDA, y a donde apunta el enlace «Mis sobres» de la tienda—. Secuestrar esa URL habría roto navegación viva (§43),
así que la bóveda estrena ruta.

Dentro: **Colección** (`/coleccion`), **Equipos** (`/duelos/mazos`, que incluye el laboratorio de estrategia) y
**Sets** (`/colecciones`). Mismo lenguaje visual que el menú principal; no es un cuadro de mandos.

## 5 · TIENDA

Dorado. → **`/tienda`**.

**No he creado un hub aquí, y es deliberado:** `/tienda` ya ES la cámara de sobres y ya enlaza `/inventario` («Mis
sobres») y la apertura. Envolverla en otro hub habría añadido un clic para no añadir nada. Marketplace: **OFF**, y
hay una prueba que lo fija.

## 6 · Qué pasó al menú secundario

Nada se ha borrado. `MoreMenu` (icono del HUD, y **Escape**) agrupa, con rutas reales:

- **Progreso**: Temporada · Progresión · Logros
- **Circuito**: Eventos · Pick'ems · Social
- **Cuenta**: Perfil y ajustes

Es un `role="dialog"` con `aria-modal`, foco al abrir, salida por botón, por fondo y por Escape.

## 7 · Escenario / background

`NexusHall`, catorce capas, **todo CSS**: cielo → arquitectura lejana → arquitectura cercana → haces → horizonte →
bruma → suelo → charco → acentos → monolito → cartas → pack → hero card → motas → viñeta.

Sin WebGL, sin canvas, sin Three.js, sin vídeo de terceros, sin blur animado. Sólo se mueven `transform` y `opacity`.
Las motas son **dieciséis, contadas en el fuente**.

**Reacción al menú (§27):** apuntar JUGAR baña la escena de magenta; INVENTARIO, de cian; TIENDA enciende el dorado
del pack. Son tres capas de tinte con `opacity`; el fondo no cambia.

## 8 · Pack

La parte que más iteraciones costó, y la que marcabas como NO-GO («el pack parece una card rectangular»). Tres
versiones fallidas y por qué:

1. **v1** — un rectángulo con esquinas redondeadas: sin cantos no hay volumen.
2. **v2** — con `clip-path` angular, pero **la luz nacía detrás de la caja** y la cara frontal, que se pinta después,
   se la comía: quedaba una losa oscura con una raya dorada.
3. **v3** — la luz pasa a pintarse **DESPUÉS** del cuerpo, en `mix-blend-mode: screen`, centrada en la boca. Una caja
   abierta se ve sobre todo por el *bloom* que deja en el aire, por delante del canto. Ahí empezó a leerse.

Final: 8 capas — haces cónicos, estallido, tapa en perspectiva, boca, cara lateral (el volumen), cara frontal, filo
violeta, labio incandescente, velo y núcleo.

## 9 · Cartas

**Cinco cartas reales del catálogo**, con la pieza canónica `PlayerCard` — no `CardThumb`, que está hecho para 44 px
y a tamaño grande se lee como un bloque de color con dos iniciales (exactamente «cartas que parecen thumbnails»).
Escala y desenfoque decrecientes con la distancia.

## 10 · Hero card

**ASPAS 92 · ICON SERIES**, carta real con sus estadísticas, montura dorada.

No existe un sistema «Héroe del día» en el producto y **no he inventado uno**: ni rotación, ni recompensa. La regla
(`src/lib/home/selection.ts`) es pura y determinista: **la mejor carta que posees** (rareza, y a igualdad, media); si
aún no tienes ninguna, la mejor del catálogo, para que la escena nunca esté vacía. La misma colección enseña siempre
la misma carta, y la protagonista nunca se repite entre las que vuelan.

## 11 · HUD

Marca real arriba-izquierda. Derecha: nivel (de la curva del dominio, `levelFromXp`), nombre, **créditos reales** y
el botón de «Más». Con sesión iniciada aparecen nivel y nombre; sin ella, sólo lo que se puede saber.

**Añadido tras fallar una prueba:** el aviso de red (`data-testid="home-offline"`). Al rehacer la Home me dejé por el
camino el indicador de «sin conexión / sin datos» que tenía `DailyLobby`, y una pantalla bonita que no dice que está
sin datos miente. Está restaurado y fijado por test.

## 12 · Arquitectura de vídeo

Montada **entera**, no esbozada:

```
<video autoPlay muted loop playsInline poster="/video/nexus-lobby-poster.jpg">
  <source src="/video/nexus-lobby.webm" type="video/webm" />
  <source src="/video/nexus-lobby.mp4"  type="video/mp4"  />
</video>
```

Va en la capa más baja. Las capas 2.5D de encima **no son un sustituto**: son el sombreado de la escena y seguirán
funcionando cuando el vídeo exista. Poner el fichero mañana **no obliga a rehacer nada**.

## 13 · BACKGROUND VIDEO ASSET PENDING — **P2 abierto**

`public/video/nexus-lobby.*` **no existe**. `onError` apaga el vídeo y la escena 2.5D queda de fondo, que es lo que
se ve en todas las capturas. No lo he disimulado: no tengo forma de producir un vídeo cinematográfico desde este
entorno. La arquitectura está lista para recibirlo.

## 14 · Audio

Reutilizado de la Fase 44.1: **ningún AudioManager nuevo**. `playSound("ui.hover")` al apuntar, `ui.confirm` al
entrar, `ui.back` al volver. La música de vestíbulo sigue saliendo de `MusicDirector`, que la rama inmersiva del
armazón conserva. `game-audio:verify` **20/20**.

## 15 · Responsive

- **390** — la escena pasa a ser **fondo**: la protagonista se retira, las cartas bajan a opacidad 0,2 y el pack se
  va al pie. Los tres botones mandan. (Primera versión: las cartas caían encima del menú y no se leía. Corregido.)
- **768 / 1024** — protagonista al 72 %, anclada al borde derecho para no invadir el menú.
- **1440 / 1920** — la composición de la referencia.
- **2560** — el escenario **se expande** y los botones **no se estiran** (§41).

## 16 · Rendimiento

Sin WebGL, sin canvas, sin vídeo, sin blur animado, sin partículas ilimitadas. Lo único animado son `transform` y
`opacity` —las dos propiedades que el compositor mueve sin repintar— y el recinto lleva `contain: strict` para que no
pueda forzar reflow.

## 17 · Scroll (F44.1)

`min-h-[100dvh]`, **no** `h-screen` + `overflow: hidden`. En escritorio la primera vista llena la pantalla sin
scroll; en pantallas bajas, en móvil o con zoom de accesibilidad, la página puede crecer y desplazarse.
`game-scroll:verify` **7/7**. Hay una prueba que impide reintroducir `overflow-hidden` en la Home.

## 18 · Capturas

**12**, en `docs/product/qa/fase46/`: 390, 768, 1024, 1440, 1920, 2560, hover de las tres acciones, menú secundario,
y movimiento reducido a 1440 y 390.

Método: **implementar → capturar → comparar con `inventario.png` → corregir → recapturar**, seis vueltas. Las tres
correcciones que salieron de mirar y no de leer: la escena estaba lavada (arquitectura invertida: bandas claras en
vez de siluetas oscuras), el pack no leía (luz ocluida), y a 390 las cartas tapaban el menú.

## 19 · Tests y gates

| Gate | Resultado |
|---|---|
| `npm test` | **4481 / 4481 · 0 fallos** (+22 de esta fase) |
| `tsc` web | **0** |
| `tsc` scripts | **0** |
| `next build` | **exit 0** |
| ESLint (ficheros nuevos) | **0** |
| `game-scroll:verify` (F44.1) | **7 ✓ · 0 ✗** |
| `game-audio:verify` (F44.1) | **20 ✓ · 0 ✗** |
| `game-experience-navigation:verify` | **7 ✓ · 0 ✗** |

**20 pruebas nuevas** (`mainMenu.test.tsx`): tres acciones exactas y en orden, rutas reales, JUGAR domina, ningún
modo como acción principal, Marketplace ausente, todo lo desplazado sigue alcanzable, el menú secundario es un
diálogo con Escape, la raíz es inmersiva **sin** meter `"/"` en la lista de prefijos (que haría inmersiva toda la
aplicación), la arquitectura de vídeo degrada, nada de WebGL, motas contadas, movimiento reducido, scroll intacto,
sólo monedas reales, campaña sólo con datos reales, nivel de la curva del dominio, y la elección de cartas.

**Tres pruebas existentes fallaron y las tres tenían razón:**

1. `ADOPCIÓN` fijaba que la Home montara `DailyLobby`. Reescrita sobre la pieza nueva, conservando lo que protegía
   (que la página no se invente su vocabulario y siga leyendo el Daily Loop).
2. `SIN RED` exigía `network={network}`. **Era una regresión real mía**: restaurado el aviso (§11), y la prueba ahora
   exige además que el menú principal lo enseñe.
3. `SIN CALLEJÓN` fallaba porque la Home dejó de recibir las salidas del armazón. Actualizada `CORE_SCREENS`: la Home
   es inmersiva y declara sus propias salidas (sus tres acciones); añadida `/boveda`.

## 20–23 · Lo que no se ha tocado

**Gameplay: 0. Economía: 0. Recompensas: 0. Combate: 0. BD/migraciones: 0. Marketplace: OFF.** Ninguna ruta de API,
ningún servicio de servidor, ningún fichero de dominio de juego. **F45 intacta.** Ninguna URL existente rota.

## 24 · P2

1. **BACKGROUND VIDEO ASSET PENDING** (§13) — el único pendiente de peso.
2. El monolito del fondo usa el icono de marca escalado; con un arte propio ganaría.
3. `/tienda` y `/boveda` conservan el armazón con barra de secciones: sólo la Home es inmersiva. Extenderlo a los
   hubs es una decisión tuya, no la he tomado por mi cuenta.
4. La hero card a 2560 podría crecer algo más.

## 25 · GO / NO-GO

### **GO.**

Contra tu checklist (§47): menú a la izquierda ✓ · exactamente 3 acciones ✓ · JUGAR primero y dominante ✓ ·
INVENTARIO segundo ✓ · TIENDA tercero ✓ · botones grandes y angulares ✓ · HUD superior ✓ · escenario centro/derecha ✓
· pack protagonista con luz saliendo ✓ · cartas flotantes ✓ · una carta protagonista ✓ · profundidad ✓ · suelo ✓ ·
iluminación cian/magenta/dorada ✓ · secundarios abajo ✓ · poco texto ✓ · navbar eliminada de la Home ✓ · pantalla
completa ✓.

Y tu criterio del §58 —*si quito el logo, ¿seguiría pareciendo la pantalla principal de un videojuego?*—: sí. Lo que
queda sin el logo es una escena oscura con profundidad, un pack abierto escupiendo luz, cartas cayendo y tres botones
biselados de neón. No hay nada en esa imagen que se lea como una web.

La única reserva honesta es la del §13: **el fondo definitivo es un vídeo que todavía no existe**. Lo que hay es el
mejor fallback original que puedo construir con CSS, y la arquitectura está lista para recibir el vídeo sin rehacer
la Home.

**Estado final:** NEXUS levantado en **http://localhost:3005** con la build de producción. Túnel 54521 abierto.
0 Chrome sin cabeza. Tu Unreal y tu Chrome, intactos.
