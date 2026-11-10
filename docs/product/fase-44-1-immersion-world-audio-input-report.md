# Fase 44.1 · Immersion, World, Audio & Input — informe

Fecha: 2026-09-17 · Rama `arch/stabilization` · sin commit, sin push, sin deploy, sin Docker, 0 migraciones.

## 1 · Rueda del ratón (P0)

- **Reproducido con rueda REAL** (CDP `Input.dispatchMouseEvent` tipo `mouseWheel`, `scripts/_fase44-1-wheel.ts`):
  rueda ↓0 ↑0 en las 11 pantallas core; el teclado sí desplazaba (`docs/product/qa/fase44-1/wheel-before.json`).
- **Causa raíz:** `globals.css` ponía `overflow-x: hidden` en `html, body`. Con eso el `overflow-y` calculado de `body`
  pasa a `auto`: body se convierte en un contenedor de scroll que nunca se desplaza (su altura es su contenido). La rueda
  se dirige al contenedor desplazable más cercano (body), no puede moverlo, y `overscroll-behavior-y: none` en body
  cortaba el encadenamiento al viewport. El teclado iba directo al viewport. Probado inyectando cada cambio por separado:
  `overscroll-behavior-y:auto` o `overflow-x:clip` bastaban por sí solos.
- **Arreglo (no parche):** `overflow-x: clip` en html/body (recorta sin crear contenedor de scroll; de paso `sticky`
  vuelve a funcionar) y `overscroll-behavior-y: none` SOLO en `html`. Ningún listener de `wheel` global ni `scrollBy`.
- **Cerrojo de scroll único** con contador (`src/lib/gameExperience/scrollLock.ts`) para `GameOverlay` (hojas y
  diálogos) y `CardViewer`, que antes guardaban/restauraban `body.style.overflow` cada uno por su lado.
- **Evidencia DESPUÉS** (build de producción, cuenta QA): rueda ↓/↑, trackpad (20 deltas de 12 px), PageDown, flecha y
  táctil real en 12 pantallas (`wheel-after.json`); Equipos e Inventario caben a 1440×900 y se midieron en 1440×560
  (↓303/↓349); rueda vertical sobre el carril horizontal de cartas baja la página 720 px y el carril no se mueve;
  100 ciclos de hoja+diálogo anidados y 100 del menú móvil real sin fuga (`scroll-lock-cycles.json`).
- **Efecto secundario detectado y corregido:** con `sticky` funcionando de verdad, el contenido pasaba por debajo de la
  barra superior (78 % opaca abajo) y se leía a través. Barra casi opaca (0,98 → 0,94).

## 2 · Mundo (GameEnvironment)

- `src/design/environment.ts` (puro): 12 lugares (`lobby, collection, packs, loadout, campaign, draft, ranked, season,
  match, events, profile, world`) con base, colores, arquitectura propia, partículas, ≤ 3 movimientos, parallax 4–12 px
  (0 en partida) y atenuado; `environmentForPath` (la ruta más específica gana).
- `src/components/visual/GameEnvironment.tsx`: L0 base + viñeta, L1 arquitectura SVG ORIGINAL (arena con skyline y
  suelo en perspectiva; bóveda con huecos de cartas y haces de luz; cámara con cono y pedestal; sala táctica con rejilla
  y roles; mapa con curvas de nivel y ruta; tríptico de focos; escalera; horizonte; anillos; cuadro; galería; globo),
  L2 luces con deriva, L3 un canvas 2D acotado, L5 tinte de modo (lobby) y atenuado. `aria-hidden`, sin puntero, fijo
  detrás (`-z-10`), parallax pasivo en rAF solo con puntero fino ≥ 1024 px. Montado por `GameShell` en las dos ramas.
- `body { background: transparent }`: el fondo opaco de body se pintaba ENCIMA de las capas con z negativo.
- **Trampa medida:** una capa de grano a pantalla completa (SVG `feTurbulence` y después PNG en mosaico) sobre las luces
  animadas hacía que Chrome sin GPU dejase de entregar fotogramas desde ~1,5 M px físicos (768@2x, 1920, 2560). Se
  bisecó capa a capa con CSS inyectado y se eliminó el grano.

## 3 · Pantallas

- **Home:** escenario JUGAR más alto y translúcido con anillos; fichas de modo que tiñen el mundo (PvE cian, ranked
  magenta, campaña azul, draft ámbar, 320 ms) y suenan; héroe del día + «después» (Pick'ems / Road to Champions) en UNA
  fila con arte abstracto propio (cuadro, ruta) y flecha; paneles translúcidos (0,72–0,86).
- **Colección:** cabecera translúcida con la carta de mayor OVR en vitrina: cono de luz, halo y pedestal del color de su
  rareza, flotado lento; cartas del carril y del álbum salen de la pared (elevación, sombra, brillo).
- **Sobres:** cámara (cono y pedestal del color del sobre seleccionado, que cambia al elegir otro); la ceremonia apaga la
  sala por fase (`packChamberDim`: petición 0,45 → apertura 0,7 → revelado 0,8 → resumen 0,25) y agacha la música.
- **Equipos / Estrategia / Campaña / Draft / Ranked / Temporada:** cada una con su lugar (capturas en `after/`).
- **Barra superior:** foco que sigue al puntero (`--nx-lx`), marca que se enciende desde el centro, sonido de paso.

## 4 · Audio

- **Encontrado:** `src/lib/sound.ts` (Web Audio sintetizado, ajustes general/efectos/silencio, 9 eventos). Se reutiliza:
  un único AudioContext.
- **Música:** `src/lib/audio/music.ts` (puro: 9 contextos LOBBY…RESULT, temas ORIGINALES descritos como tempo, modo,
  progresión, pad, bajo, pulso y arpegio; compases deterministas ≤ 20 notas; fundidos 500–1500 ms; reducer con desbloqueo,
  ruta, override, duck con contador, visibilidad y volumen) + `src/lib/audio/musicEngine.ts` (único gestor, ≤ 2 capas,
  planificador con anticipación, pestaña oculta → 0 sin programar, sin ráfagas al volver) + `MusicDirector` (primer
  gesto, ruta → contexto). Resultado impone RESULT y agacha bajo el stinger.
- **Efectos:** 20 eventos (`ui.*`, `play.*`, `pack.*`, `card.*`, `serial.one`, `match.*`, `level.up`,
  `mission.complete`, `achievement.unlock`); hovers limitados a uno cada 90 ms y nunca crean el contexto. Conectados:
  barra, JUGAR, fichas de modo, selección de sobre, turno de partida, empate, momentos (objetivo/logro).
- **Ajustes:** MÚSICA y EFECTOS 0–100 con silencio propio + silencio general, misma clave local `nexus:audio:v1`
  (compatible con Fase 44). Por defecto música 50 %, efectos 80 %, general 80 %.
- **Copyright:** 0 ficheros de audio en `src/` y `public/`; nada descargado. **P2:** es una banda sonora ambiental
  procedural sencilla, no música compuesta de estudio; la arquitectura acepta temas nuevos sin cambios.

## 5 · Pruebas y verificadores

- `npm test`: ver gates. Nuevas: `scroll.test.ts` (28, fuzz 100.000), `audio.test.tsx` (24, fuzz 20.000),
  `musicEngine.test.ts` (19, Web Audio falso), `environment.test.tsx` (20, fuzz 50.000), `immersion.contract.test.tsx`
  (67: 12 mundos, 9 temas, 20 efectos, 13 secciones del arnés, 12 pantallas core).
- Verificadores nuevos (`scripts/game-immersion-verify.ts`): `game-immersion`, `game-environment`, `game-audio`,
  `game-scroll`, `game-scroll-lock`, `game-atmosphere`; leen la evidencia de navegador de `docs/product/qa/fase44-1`.
- Arnés `/design-system/fase44-1`: Ambient Worlds (12), Lobby (+4 focos), Collection Vault (3 rarezas), Pack Chamber
  (reposo/apagada), Loadout, Campaign, Draft, Ranked, Season, Music (contextos, duck, override, estado del motor), SFX
  (20 + ajustes), Scroll (hoja + diálogo + contador de cerrojos), Reduced Motion.

## 6 · Rendimiento (Chrome sin cabeza, `--disable-gpu`, 3 s por medida)

| Pantalla | fps con ambiente | fps sin ambiente | scroll con rueda | tareas largas |
|---|---|---|---|---|
| Home | 60 | 60 | 59 | 0 |
| Colección | 51 | 59 | 57 | 0 |
| Tienda | 60 | 60 | 59 | 0 |
| Equipos | 60 | 60 | 60 | 0 |

## 7 · QA visual por lotes y presión de memoria

- **Causa de la presión:** no era una fuga del arnés (su Chrome se mantuvo plano, 0,76–1,20 GB por lote, sin crecer entre
  lotes). Fueron dos cosas: (1) cada ejecución del runner que el sistema mataba dejaba su Chrome sin cabeza HUÉRFANO —se
  encontraron 11 procesos colgando del perfil de QA—, y (2) la máquina tenía a la vez Chrome del usuario (~5–6 GB) y
  `UnrealEditor-Cmd` (~2–2,9 GB), con la RAM libre oscilando entre 0,5 y 6 GB.
- **Estrategia:** una invocación = un lote (≤ 25, en la práctica 8–10) con UN Chrome que se cierra al acabar; checkpoint
  por captura (ruta, viewport, build, hora, clasificación, PASS/RETRY, intentos); espera a ≥ 3 GB libres antes de lanzar;
  parada inmediata si baja de 2 GB; limpieza de los Chrome de NUESTRO perfil por línea de comandos (nunca los del
  usuario); Chrome sin caché atrás/adelante (guardaba páginas vivas), un renderer, GPU en proceso y `about:blank` entre
  capturas; con poca memoria, primero las ventanas pequeñas.
- **Números (build final `fb7530d2d643`):** 24 lotes · 163 capturas tomadas · 7 rechazadas/reintentadas · pico de Chrome
  propio 1.204 MB · pico de 10 PIDs · 0 huérfanos tras cada lote · 1.769 s de captura.
- **Capturas rechazadas antes:** 136 de la tanda cortada (`after/prior-114-classification.json`): 134 `INVALID_BUILD`
  (la build se regeneró) y 2 `INVALID_BACKEND`. Todas rehechas.
- **Regeneración por cambio de producto:** al revisar las capturas se vio que el texto de la página se transparentaba a
  través de la barra superior (ahora que `sticky` funciona de verdad). Se corrigió la CSS (barra 0,995 → 0,985), se
  volvieron a pasar `npm test`, `tsc`, `next build` y los verificadores, se generó una build nueva
  (`cb67f86d3c4e` → `fb7530d2d643`) y **las 173 capturas se regeneraron** con ella.
- **Estado final:** 173/173 `VALID` en una única build, sin desbordamientos ni texto técnico, con sesión y BD vivas.

## 8 · Deudas (P2)

- Música procedural sencilla: sustituir por temas compuestos originales cuando existan (misma API).
- Colección a 51 fps en software por flotado + halo + partículas; con GPU no se aprecia, pero es la pantalla más cargada.
- `/duelos/mazos` e `/inventario` caben en 1440×900 con la cuenta QA: la rueda se midió en ventana baja.
- La ceremonia real de sobre no se abrió en QA (consume un sobre de la BD real): se verificó con el arnés de Fase 38,
  el atenuado del arnés 44.1 y las pruebas del reducer.
