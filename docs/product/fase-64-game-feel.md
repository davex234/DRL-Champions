# FASE 64 — GAME FEEL 5.0 · DE WEB APP A VIDEOJUEGO

Fecha: 2026-09-26 · Rama `arch/stabilization` (sin commit) · Evidencia: `docs/product/qa/fase64-game-feel/`

**Veredicto: GO.** F64 no añade sistemas: arregla lo que hacía que NEXUS pareciera una web. Todo sale de problemas medidos en 24 rutas × 3 anchos con una cuenta QA, antes y después, más una pasada con movimiento reducido (tu modo real).

Lo que ha cambiado:
- **Menos peticiones:** una pantalla con sesión pasa de 21 a 9 peticiones de API y desaparecen los 429.
- **Datos honestos:** el HUD ya no enseña cifras falsas sin sesión.
- **Iconos propios:** los emojis de las pantallas principales pasan a glifos SVG de la casa.
- **Estados coherentes:** carga, error, avisos y capas hablan el mismo idioma.
- **Respuesta también en reducido:** cada pulsación responde y la carta responde sin moverse.
- **Terminología:** el flujo principal dice «equipo».
- **Consola limpia:** 0 errores y 0 peticiones 404 internas.

Sin tocar motor, economía, cartas, agentes ni base de datos.

---

## 1. Baseline

| | Antes | Después |
|---|---|---|
| Tests | 5.262 | **5.286** (+21 F64, +3 del bucle de efectos por los 3 sonidos nuevos) · 0 fallos |
| tsc web / scripts | exit 0 / exit 0 | exit 0 / exit 0 |
| Lint | 0 errores · 10 avisos | 0 errores · 10 avisos (los mismos, ficheros previos) |
| Build | exit 0 | exit 0 |
| Migraciones | cabeza 0057 | **0057** |
| Cartas / agentes (BD viva) | 331 / 29 | 331 / 29 |
| Mercado / pagos | OFF / OFF | OFF / OFF |

Infraestructura encontrada: F44 ya había hecho gran parte del trabajo (cargador de marca, estados de error y vacío, avisos de juego, `GameSheet`/`GameModal`, audio sintetizado con ajustes, niveles de movimiento, transiciones por familia). `baseline.json`.

## 2. Rutas auditadas

`/`, `/jugar`, pre-partida PvE, `/competitivo`, `/coleccion`, `/duelos/mazos`, constructor, `/inventario`, `/packs`, sobre sellado, `/tienda`, `/progresion`, `/temporada`, `/logros`, `/jugador/me`, Draft, Road to Champions, Tactical Coach, Pick'ems, `/cuenta`, `/como-jugar`, 404, entrada sin sesión y portada sin sesión.

Todas a 1440, 1024 y 390, y las principales también con movimiento reducido. Capturas en `before/screenshots`, `after/screenshots` y `regression/screenshots`.

## 3. Problemas de «web» encontrados (medidos)

| Id | Qué parecía web | Medida antes |
|---|---|---|
| W1 | El armazón montaba `useBadges()` 4 veces: 8 × `/social`, 8 × `/live-events` y 5 × `/profiles` en **cada** pantalla. El limitador cortaba a las ~15 navegaciones. | 21,4 peticiones de API por pantalla · **40 × 429** |
| W2 | Sin sesión, el HUD y la portada enseñaban «Nivel 1 · 6.000», del store local (dato falso). | 2 pantallas |
| W3 | Emojis como iconos de producto (📦 🏭 ⭐ 👑 🗂 🐉 🌍 ⚔ 🎮 🏅 🪙 🔒 ✕). | **345** visibles en la matriz |
| W4 | Entrada y registro: formulario de web (caja redondeada, campos grises) bajo «MI PERFIL · Tu progreso competitivo». | — |
| W5 | `/pickems` pedía 17 logos `/teams/*.png` que no existen (la misma clase de fallo que el vídeo de F46). | **51 × 404 internos** |
| W6 | Cargador de marca a pantalla completa en hubs y perfil; `GameSkeleton` sin usar; salto de maquetación al llegar los datos. | CLS 0,158 en progresión |
| W7 | Pulsaciones sin respuesta; con movimiento reducido, la carta no respondía a nada. | — |
| W8 | «mazo» y «plantilla» en ranked, draft, estrategia, recorrido, misión y copia del starter. | 27 apariciones |
| W9 | Aviso PWA como caja redondeada con una «D» de icono, en casi todas las pantallas. | — |
| W10 | Desbordes a 390 px en `/pickems` y `/progresion` (elementos de rejilla sin `min-w-0`). | 12 + 3 elementos |
| W11 | Colección en móvil: la cabecera ocupaba la primera pantalla entera. | — |
| W12 | «Añadir al equipo» sin Escape ni foco; la ficha de carta no devolvía el foco; cierres de 36 px con «✕». | 2 capas |
| W13 | Avisos mudos y repetidos: el mismo aviso se reanimaba. | — |
| W14 | 404 con «Volver al lobby»; la franja F63 con un «Continuar» genérico. | — |

`visual-audit.json`.

## 4. Design language final

- **Geometría:** chaflán (`nx-clip` / `nx-clip-sm`) en paneles, botones, campos, avisos, monogramas y cierres. En el flujo principal no queda ninguna caja redondeada de web.
- **Superficies:** paneles oscuros con filo de color (`nx-f62-panel`, `nx-f63-stage`, `nx-f63-coach`).
- **Color:** con papel fijo, siempre acompañado de texto o icono:
  - rojo NEXUS = acción;
  - cian = información, XP de cuenta y foco;
  - oro = recompensa, créditos y XP de temporada.
- **Tipografía:** display en mayúsculas para títulos y botones; `nx-readout` para cifras (OVR, créditos, XP, rating, marcador).
- **Iconos:** `GameGlyph`, 26 glifos SVG propios (trazo 1,8 px, `currentColor`, rejilla 24).

Tokens: `tokens.ts` no cambia (el sistema era válido). F64 añade primitivas, no tokens. `design-system.json`.

## 5. Game shell

- **Insignias:** una sola lectura compartida (`lib/net/sharedPoll`) en lugar de una por componente.
- **HUD sin sesión:** ENTRAR en vez de cifras falsas.
- **Sonido de navegación:** la barra y el dock móvil suenan al cambiar de sección (`ui.nav`); el dock además responde a la pulsación.
- **Aviso de instalación:** placa de la casa con la marca real.
- **Perfil:** una lectura de `profiles` en vuelo por usuario, y un usuario estable ante `TOKEN_REFRESHED`.

## 6. Home

El menú de juego de F46/F62/F63 ya cumplía la jerarquía (JUGAR protagonista, progreso, guía para nuevos) y se conserva. F64 le quita a la portada los datos falsos sin sesión, las peticiones duplicadas del armazón y los 404 (F63 ya había quitado los del vídeo; el test impide reintroducirlos).

## 7. Navigation

Sonido y pulsación en las secciones. Para el jugador, la navegación sin 429 es el cambio más perceptible: antes, a partir de ~15 pantallas, las lecturas empezaban a fallar.

## 8. Route transitions

Ya existían (F44) y se mantienen: cuatro familias entre 180 y 300 ms (juego 180, colección 240, temporada 300, resto 200) y fundido de 120 ms con movimiento reducido. Un test fija ahora que ninguna pase de 300 ms. `motion.json`.

## 9. Buttons

- **Papeles:** los seis de NxButton (primary, secondary, tertiary, ghost, danger, icon) más cuatro de juego (JUGAR, menú principal, acción de hub, acceso rápido).
- **Pulsación:** NUEVA primitiva `nx-press`, 70 ms, baja 1 px y encoge un 2 %; con movimiento reducido se ilumina. Aplicada a NxButton, CTA de progreso, accesos rápidos, acciones, dock, 404, entrada, aviso de instalación y cierres.
- **Deshabilitado:** `cursor: not-allowed`.

Medido: los radios distintos por pantalla bajan de 2,2 a 1,6. Los estilos distintos de botón por pantalla **no bajan** (7,07 → 7,08): F64 unificó la respuesta, no el número de papeles. Queda como deuda.

## 10. Cards

«La carta es el asset» se respeta: ningún marco HTML. El giro 3D de ratón sigue igual y está apagado con movimiento reducido. NUEVO:
- con movimiento reducido, la carta **se ilumina** al apuntarla (filtro sobre el arte);
- con teclado se ilumina siempre.

## 11. Packs

La ceremonia F57 queda intacta; solo cambia el aspa de cierre (glifo propio). El arte de sobre es el real. En tienda e inventario, la moneda 🪙 pasa a `CreditGlyph`.

## 12. Collection

- En móvil, la cabecera deja de ocupar la primera pantalla entera: fuera el desglose por rareza (sigue en el libro de la colección), carta de vitrina menor y menos relleno.
- Los objetivos de colección usan glifos propios.
- Los datos no cambian.

## 13. Team builder

- «Plantilla por objetivo» pasa a «Equipo por objetivo».
- «Añadir al equipo» gana Escape, foco atrapado y foco de vuelta.
- Carga con la silueta de un equipo (10 huecos).

Reglas del equipo sin tocar. Deuda: el constructor sigue con 21 cajas anidadas a 1440 (su columna de análisis); no se rehízo.

## 14. Store

La moneda de la casa sustituye a 🪙 en precio, guía de rareza y productos. Pagos siguen OFF y no se ha tocado ni un precio.

## 15. Progression

La XP de las fuentes usa glifos propios. Los objetivos por reclamar tienen `min-w-0` (arreglado el desborde a 390 px) y la carga usa la silueta de un hub. F62 queda intacta y se reclama en real (§47).

## 16. Profile

Los logros usan glifos propios y la carga usa la silueta de un perfil. Los avatares emoji se quedan: son la identidad elegida por el jugador (un dato).

## 17. Competitive

Todo ranked dice «equipo» y la carga usa la silueta de un hub. «Rival encontrado» suena (`match.found`). No se inventan rangos con nombre.

## 18. Draft

La copia «equipo temporal» sustituye a «plantilla». Reglas sin tocar.

## 19. Tactical Coach

Intacto (F59): se beneficia del armazón compartido. Conserva «plantilla» porque ahí significa la plantilla de agentes, que es otra cosa.

## 20. Auth

- **Pantalla:** «Tu cuenta de jugador», panel de la casa y título por modo («Entra en NEXUS» / «Crea tu cuenta» / «Recupera tu acceso»).
- **Campos:** `nx-field` con etiqueta visible y autocompletar.
- **Error:** anunciado (`role="alert"`), con temblor de 240 ms. Con movimiento reducido no hay animación: el campo se marca en rojo.
- **Botón:** el principal del sistema.

El envío, las pestañas y la redirección de F63 no cambian.

## 21. Loading

`Loading` admite `kind`, y con él pinta la silueta del contenido (`hub`, `profile`, `deck`, `cards`, `hero`). Sin `kind` sigue el cargador de la marca, reservado a lo que no tiene forma que anticipar (arrancar partida, abrir un sobre). Aplicado en progresión, temporada, logros, competitivo, modos, equipos y perfil.

Resultado: el CLS máximo de progresión baja de 0,158 a 0,083 a 1440, y a 0,001 a 1024. Ningún spinner.

## 22. Empty states

Ya eran de juego desde F44 (`GameEmpty`: qué pasa y qué hacer, con CTA real). Sin cambios.

## 23. Error states

Ya eran de juego desde F44 (`GameError`, filtro de texto técnico, sin traza). F64 comprueba que ninguna pantalla enseña texto técnico. Un falso positivo del instrumento («NaN» casaba con «se gan*an*») se corrigió y se documenta.

## 24. Toasts

Dos capas con papeles distintos: aviso (`Toast`) y celebración (`GameMoment`). Ya eran de juego. NUEVO:
- **Suenan:** `ui.success` o `ui.error` al entrar.
- **Sin spam:** el mismo mensaje repetido no reentra; se agrega como «×N» y alarga su tiempo.

## 25. Modals

`GameSheet`/`GameModal` siguen siendo el estándar. El contrato se exporta como `useDialogLayer` y se aplica a «Añadir al equipo». La ficha de carta devuelve el foco al cerrarse. Las 20 capas propias se auditaron: las de partida, que son momentos a pantalla completa, tienen su propio teclado; solo esas dos fallaban.

## 26. Audio architecture

Un gestor único (`src/lib/sound.ts`):
- Web Audio sintetizado: sin ficheros ni licencias, y `new Audio()` aparece 0 veces.
- Eventos con nombre.
- Ajustes de volumen general, efectos y música, con silencio, en `localStorage`.
- Nada suena antes de un gesto.
- Los sonidos de paso están limitados. `audio.json`.

## 27. SFX añadidos

`ui.success`, `ui.nav` y `match.found`, sintetizados y discretos (nivel ≤ 2). Conectados a avisos, navegación y rival encontrado.

## 28. Audio settings

El panel existente de F44.1 (en la hoja del armazón): general, efectos y música, con volumen y silencio. Sin cambios.

## 29. Motion system

Las primitivas existentes (entrada, fundido, pop, impacto, revelado, celebración, niveles 0–4) se mantienen. F64 añade:
- `nx-press`, la pulsación;
- `nx-shake`, el error de formulario, sutil (240 ms, ±4 px);
- la iluminación de la carta.

Todo se mueve solo con `transform`, `opacity` y `filter`.

## 30. Reduced motion

Mismo producto, sin movimiento vestibular y **con** respuesta:
- **Pantallas:** fundido de 120 ms.
- **Pulsación:** destello.
- **Carta:** se ilumina.
- **Error:** campo en rojo y aviso anunciado.

El contrato F44 se mantiene: toda animación vive bajo `no-preference` (test). La pasada reducida da 28 capturas, 0 desbordes y 0 errores.

## 31. Typography

Sin fuentes nuevas: Rajdhani e Inter, las de siempre. Las cifras importantes (OVR, créditos, XP, rating, marcador) ya usaban `nx-readout`; en créditos se añade el glifo de moneda.

## 32. Icons

`GameGlyph` es el único juego de iconos nuevo. Traduce al pintar los símbolos que guardan los datos (logros, fuentes de XP, recompensas, acciones de ficha), así que ningún dato cambia. En la matriz, los emojis visibles bajan de 345 a 57. Los que quedan:
- avatares del jugador (su dato);
- el ✓ tipográfico;
- los marcadores de rol del constructor (✦ ◍ ➤ ▣ ◆, tipográficos).

## 33. HUD

Muestra el nivel y los créditos reales, solo con sesión. No se inventa ninguna moneda.

## 34. Mobile (390)

24 rutas: 0 desbordes (antes 1 ruta con 12 elementos), 0 errores y ningún scroll horizontal. Colección compacta, ENTRAR en el HUD y dock con respuesta.

## 35. Tablet (1024)

24 rutas: 0 desbordes y 0 errores. El CLS de progresión baja de 0,139 a 0,001.

## 36. Desktop (1440)

24 rutas: 0 desbordes y 0 errores.

## 37. Performance before/after

Pantalla con sesión, media de todas las rutas y anchos:

| | Antes | Después |
|---|---|---|
| Peticiones de API | 21,4 | **9,3** |
| Peticiones totales | 109,1 | 93,2 |
| 429 | 40 | **0** |
| CLS máximo | 0,229 | 0,215 (en `/cuenta`, ver limitaciones) |

Ejemplo de `/como-jugar`: 26 → 11 peticiones.

## 38. Bundle impact

JS transferido por pantalla: 2.369 → 2.387 KB (+18 KB, +0,8 %). `GameGlyph` es SVG en línea y `sharedPoll` pesa pocas líneas; ninguna librería nueva.

## 39. Image/network impact

Imágenes por pantalla: 612 → 595 KB. 17 peticiones a logos inexistentes eliminadas. Sin imágenes nuevas.

## 40. Accessibility

- Etiquetas y autocompletar en la entrada.
- `role="alert"` en el error.
- `aria-pressed` en las pestañas.
- Foco de ida y vuelta en las capas.
- Foco visible sobre la carta.
- Glifos decorativos `aria-hidden` (con título, `role="img"`).
- Cierres de 44 px.
- `cursor: not-allowed` en lo deshabilitado.
- El audio nunca es necesario para entender el estado.

`accessibility.json`.

## 41. 404

«Fuera del mapa · Esta zona no existe», con **VOLVER AL JUEGO** y JUGAR, dentro del armazón y con pulsación de la casa.

## 42. Internal network 404s

**0**, frente a 51 antes, todos logos de equipo. Los únicos 404 de la matriz son el propio documento de la ruta inexistente, a propósito. Hay test que compara `TEAM_LOGOS_AVAILABLE` con `public/teams` y `LOBBY_VIDEO_READY` con `public/video`.

## 43. Broken images

0 (antes 0: `TeamLogo` escondía el fallo con el monograma, pero la petición ocurría igual).

## 44. Console errors

**0** en las rutas principales (antes 94: 429 y 404).

## 45. Horizontal overflow

**0** en las 100 capturas (antes: `/pickems` a 390 px).

## 46. F61 regression

Partida real con una cuenta nueva sobre el build F64:
- 10 turnos contra el bot Fácil;
- intro y ayuda de ataque/defensa;
- F5 a mitad de partida, recuperado;
- resultado con F5, sin duplicar XP ni créditos.

La huella dorada del motor sigue verde y `MatchBoard` no se toca. `regression/f63-flow-on-f64.json`.

## 47. F62 regression

«Reclamar todo» en `/progresion` por la interfaz: 4 pendientes → 0; volver a pulsar no ofrece nada. El libro mayor cuadra con la economía vigente: 3 misiones, el logro «Consigue una leyenda» (10.000), porque la cuenta nueva sacó una Icon, y el nivel 1 del pase (260). `regression/f62-claim-live.json`.

## 48. F63 regression

Recorrido completo de 6 pasos con una cuenta nueva: 39 capturas, 0 desbordes, 0 errores y primera partida a los 81 s. La evidencia de F63 se conserva intacta; esta ejecución se guarda en F64.

## 49. Engine changed: **NO**
## 50. Economy changed: **NO**

Precios, probabilidades, recompensas y liquidación sin tocar. Solo cambia la **copia** «plantilla» → «equipo» en el texto del Sobre Inicial.

## 51. Cards changed: **NO** (331)
## 52. Agents changed: **NO** (29)
## 53. DB migration: **NO** (0057)

## 54. Production DB modified: **solo cuentas QA**

2 cuentas QA nuevas para las regresiones (`40a1e10d`, que jugó y reclamó; y la del recorrido), más los inicios de sesión de la cuenta QA de la matriz (`772cf6f1`). Ningún cambio de esquema, catálogo ni economía.

## 55. My account modified: **NO** (datos de juego)

La fila de juego de `2f86cbe8` es idéntica: créditos, XP, puntos, sobres, cartas, equipos, partidas, libro mayor y `app_metadata`.

Transparencia: `auth.users.updated_at` pasó a 2026-09-26 16:09:40Z en el mismo instante en que **tu propia sesión de Chrome** (creada el 10-sep) refrescó su token (`auth.sessions.refreshed_at`). Es contabilidad de sesión de GoTrue, provocada al abrir `/como-jugar` en tu Chrome al cerrar F63, no una escritura del juego.

## 56. Tests before/after

5.262 → **5.286**, todo verde. Nuevo: `src/design/f64.gameFeel.test.tsx` (21).

Pines reescritos a propósito (todos por «equipo» o por los eventos de audio nuevos):
- 404, audio AUDIO 46;
- journey (Equipo listo, pasos);
- draft ×2;
- economy.render ×2, starter, starterOffer.

## 57. tsc web: exit 0
## 58. tsc scripts: exit 0
## 59. lint: 0 errores · 10 avisos (idénticos a antes, en ficheros no tocados por F64 salvo `cuenta/page.tsx`, cuyo aviso es previo)
## 60. build: exit 0

## 61. :3005

Build F64 servido con `next start -p 3005` (`node_modules/next/dist/bin/next start -p 3005`, lanzado con `Start-Process`); HTTP 200.

## 62. tunnel

Túnel SSH 54521/54522 abierto al entregar. Se cerró durante los gates.

## 63. Files modified

**Nuevos**
- `src/lib/net/sharedPoll.ts`
- `src/components/ui/game/GameGlyph.tsx`
- `src/data/teamLogos.ts`
- `src/design/f64.gameFeel.test.tsx`
- `scripts/_fase64-{shots,probe,regress,evidence}.ts` (instrumentos fuera de CI)
- esta documentación y `docs/product/qa/fase64-game-feel/`

**Modificados** (parches quirúrgicos, copia previa en el scratchpad `backup-pre-f64/`)

*Armazón y red*
- `lib/social/client.ts`, `lib/liveEvents/client.ts`, `lib/supabase/auth.tsx`
- `components/layout/GameShell.tsx`, `app/page.tsx`

*Respuesta y estilo*
- `app/game-experience.css` (bloque F64)
- `components/ui/{NxButton,States,Toast}.tsx`, `lib/useToast.ts`
- `components/ui/game/{GameSkeleton,GameOverlay}.tsx`

*Audio*
- `lib/sound.ts`

*Iconos (glifos)*
- `components/events/RewardChip.tsx`, `components/player/ProfileSections.tsx`
- `components/progression/{AchievementGrid,CollectionObjectives}.tsx`, `components/progression/hub/ProgressionHub.tsx`
- `components/season/{SeasonPanels,SeasonRewards,SeasonMissions}.tsx`
- `app/logros/page.tsx`, `app/progresion/page.tsx`
- `components/pwa/InstallBanner.tsx`, `components/store/StoreProducts.tsx`
- `components/packs/{PackStoreCard,PackOpeningExperience}.tsx`, `components/shop/ShopHero.tsx`
- `app/inventario/page.tsx`, `components/collection/{PrestigePanel,TeamCollection}.tsx`
- `components/cards/CardViewer.tsx`, `lib/collections/format.ts`
- `components/pickems/{PickemResult,PickemRewards}.tsx`, `components/pickems/live/EventSummary.tsx`

*Pantallas*
- `components/auth/AuthForms.tsx`, `app/cuenta/page.tsx`, `app/not-found.tsx`
- `components/collectionRoom/CollectionHero.tsx`
- `components/deck/AddToDeckSheet.tsx`, `components/cards/layers/TeamLogo.tsx`
- `components/duel/pvp/RankedMatchFound.tsx`
- `components/onboarding/OnboardingRail.tsx`

*Terminología*
- `components/competitive/ranked/RankedPlayPanel.tsx`, `app/competitivo/page.tsx`
- `components/draft/DraftGauntletScreen.tsx`, `components/duel/strategy/SuggestSection.tsx`
- `domain/journey/index.ts`, `components/journey/JourneyMissionControl.tsx`
- `lib/campaign/presentation.ts`, `data/season.ts`, `domain/liveEvents/eventState.ts`
- `components/lobby/LoopStrip.tsx`, `domain/economy/starter.ts` (solo copia)

*Cargas*
- `app/{temporada,competitivo,jugar}/page.tsx`, `app/duelos/mazos/page.tsx`, `app/jugador/[id]/page.tsx`

*Tests con pines reescritos* (§56)

## 64. Limitations

- **Estilos de botón por pantalla:** no bajan (7,1 → 7,1). F64 unificó la respuesta y la geometría, no el número de papeles; consolidarlos exige rehacer pantallas enteras.
- **Constructor de equipo:** conserva 21 cajas anidadas a 1440 (columna de análisis y laboratorio, F43). No se rehízo para no romper F32/F43.
- **Cuenta (`/cuenta`):** CLS 0,215. Es la pantalla utilitaria, y sus bloques de resumen cargan por separado.
- **Avatares emoji:** se quedan porque son el dato elegido por el jugador; cambiarlos es un sistema de avatares nuevo.
- **Emojis fuera de las rutas principales:** carrera, mercado (OFF), broadcast y coach avanzado conservan sus emojis. `GameGlyph` ya sabe traducirlos cuando se toquen.
- **Misiones antiguas:** si la etiqueta de la misión «Guarda tu primer equipo de duelo» vive en el pase guardado, las misiones ya tiradas de cuentas existentes pueden seguir diciendo «mazo» hasta su rotación.
- **Háptica:** no se añadió; la vibración de F33 sigue solo en la partida.
- **Música:** ninguna nueva; no hay assets autorizados más allá de la procedural propia.
- **Residuo QA:** 2 cuentas `@example.invalid` más (junto a las de F63). Se documentan y no se borran.

## 65. GO / NO-GO

**GO.**
- La home es un menú de juego sin datos falsos.
- Navegar responde: sonido, pulsación, 0 × 429 y menos de la mitad de lecturas.
- Botones, cartas y capas responden, también con movimiento reducido.
- Sobres, colección, equipo, tienda, progresión y perfil comparten iconos, geometría y cargas con forma.
- Carga, error, vacío y aviso pertenecen al mismo producto.
- 1440, 1024 y 390 sin desbordes, sin errores ni 404 internos.

F61, F62 y F63 intactas en real. Motor, economía, 331 cartas y 29 agentes intactos; mercado y pagos OFF; 0 migraciones; tests y build en verde.

FASE 64 — CERRADA
