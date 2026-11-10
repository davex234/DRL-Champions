# NEXUS · Contrato de experiencia de juego (Fase 44 · Game Experience 4.0)

Fecha: 2026-09-17 · Rama `arch/stabilization` · sin commit, sin deploy, sin migración.
Arnés: `/design-system/fase44` · Verificador: `npm run game-experience:verify` (y sus 8 secciones).

Este contrato fija **cómo se presenta** NEXUS. No cambia reglas, economía, recompensas, sobres, combate ni prioridades:
el servidor decide el contenido; la presentación decide el impacto.

---

## 1 · Jerarquía visual

1. **JUGAR** · 2. **CONTINUAR PARTIDA** (si el servidor la tiene) · 3. **ABRIR SOBRES** (si hay) · 4. progreso/objetivos ·
5. equipo · 6. colección · 7. temporada/eventos · 8. sistemas secundarios.

- **Un dominante por contexto** (`data-cta="primary"`). Excepción documentada: el resumen del sobre ofrece ABRIR OTRO
  como dominante y JUGAR como secundario.
- En el lobby, si la acción del día del Live Service **ya es** jugar o continuar, el héroe es el escenario (botón de
  juego). Si no lo es (reclamar, predecir, abrir, construir…), encima va el **escenario JUGAR** (`LobbyPlayStage`) y el
  héroe baja a nivel «contexto» con el **mismo contenido**. Durante la guía de primera sesión manda la guía.
- Botones: `PlayButton` (acción de juego, 3 tamaños), `NxButton` primary/secondary/tertiary/ghost/danger (sin cambios).

## 2 · Navegación

- Barra superior: logo → **Colección · Equipos · Sobres · Temporada · Mundo** → nivel/créditos → **Más** (modos,
  competitivo, social, eventos, Pick'ems, entrenador) → **JUGAR**. Fuente única: `src/design/nav.ts`; presentación:
  `src/design/gameShell.ts`.
- Móvil: dock `Inicio · Cartas · [JUGAR elevado] · Sobres · Perfil` + hoja **Menú** con todas las secciones y el sonido.
- **Marketplace OFF**: `/mercado` fuera de todo menú (la ruta conserva contexto de Colección).
- Teclado: «Saltar al contenido» es el primer Tab; Tab recorre secciones, ↓ abre desplegable, Escape cierra.
- Sin callejones: toda pantalla con armazón tiene JUGAR e INICIO; las inmersivas declaran salida (`CORE_SCREENS`).

## 3 · JUGAR global y CONTINUAR PARTIDA

- `GET /api/game/play-status` (solo lectura, sin parámetros, Bearer, cubeta `daily_loop_read`) →
  `readActiveMatches` + `primaryResume` (misma lectura y mismo orden que el vestíbulo; **no** hay segunda prioridad).
- Sin estado, sin sesión, error o tiempo agotado → **JUGAR** (`/jugar`). Nunca se afirma una partida que no consta.
- Se refresca al cambiar de pantalla (≥ 20 s), al volver a la pestaña, al salir de una ruta inmersiva y con
  `nexus:daily-loop-changed`.

## 4 · Jerarquía de movimiento (`src/design/motion.ts`)

| Nivel | Nombre | Presupuesto | Ejemplos |
|---|---|---|---|
| 0 | Estático | 0 ms | texto, listas, cifras en reposo |
| 1 | Microinteracción | ≤ 180 ms | hover/foco/pulsación, JUGAR, carta de colección |
| 2 | Transición | ≤ 350 ms | cambio de pantalla, hoja, toast, revelado común |
| 3 | Momento | ≤ 900 ms | victoria/derrota, subida de nivel, objetivo, plantilla lista, rating |
| 4 | Excepcional | ≤ 1.200 ms | legendaria, serial #1 (luz de sala) |

- Tokens: `MOTION.fast/normal/game/celebration/exceptional`; muelles `SPRING.card/button/sheet` (amortiguación ≥ 30).
- Transiciones de pantalla por **familia** (4): gameplay 180 ms (sube), collection 240 ms (profundidad), season 300 ms
  (luz), default 200 ms (fundido). Solo `transform`/`opacity`.
- Un único bucle en el armazón: el barrido lento de JUGAR (6 s). Nada parpadea ni vibra.
- Momentos (`GameMoment`): uno visible, cola ≤ 4, caducan (≤ 3,2 s), no bloquean ni roban foco, `aria-live`.

## 5 · Ceremonia de sobre (sobre la Fase 38, sin tocar su lógica)

- Servidor primero, idempotencia, cartas reales, serial, nueva/duplicada, tiempos por rareza y reintentos: **intactos**.
- Añadido: **luz de sala nivel 4** tras girar una legendaria o un serial #1 (nunca antes del resultado del servidor).
- Resumen: dock **pegado** con ABRIR OTRO (dominante) · VER EN MI COLECCIÓN · JUGAR; sin valor ni venta.
- Inventario: `PackOpenStage` (sobre como objeto + ABRIR SOBRE); vacío → CONSEGUIR SOBRES / JUGAR.
- Saltar: botón y teclas S/Esc (Fase 38) — el fuzzer verifica que SALTAR siempre llega al resumen.

## 6 · Resultado de partida

- Orden: héroe (VICTORIA/DERROTA/EMPATE) → cómo se decidió → recompensa (servidor) → **XP** → **acciones** → carta
  destacada → progreso del meta → historia → lectura estratégica → cifras.
- XP (`xpTimeline`): de `xp − award.xp` a `xp` reales, tramo por nivel; **SUBIDA DE NIVEL** solo si cambia el nivel.
- Victoria: barrido de luz una vez (nivel 3) + corona. Derrota: sin barrido; progreso y siguiente acción. Empate: nivel 2.
- Ranked: antes → después con entrada escalonada; solo cifras reales (sin contadores intermedios).
- Objetivo completado / logro / nivel: momento a partir de `progressEvents` (dos lecturas del servidor).

## 7 · Estados

- Cargando: `GameLoader` (marca NEXUS + frase real; sin spinner, sin %). Esqueletos contextuales `hero/cards/deck`.
- Error: «No se ha podido cargar» + REINTENTAR + VOLVER AL LOBBY; `playerMessage` filtra textos técnicos.
- Vacío: siempre con siguiente acción real. Sin cuenta: ENTRAR / VOLVER AL LOBBY.
- Sin conexión: «Estás sin conexión · Los datos mostrados pueden estar desactualizados.» (un aviso por pantalla).
- 404 y errores de pantalla/armazón con experiencia NEXUS, sin traza.
- Toasts: placa de juego, sin «✓/✕», errores filtrados. **No fake live**: un evento DEMO nunca dice «En directo».

## 8 · Accesibilidad

- Foco visible en todo control (JUGAR: contorno blanco de 3 px). Objetivos táctiles ≥ 44 px.
- Capas (`GameSheet`/`GameModal`): `role="dialog"`, `aria-modal`, Escape, foco atrapado y devuelto, scroll restaurado,
  desmontaje total al cerrar (sin overlay pegado).
- Nada importante solo en animación: XP/rating/rareza/resultado/momentos tienen texto y `aria-live`/`aria-label`.

## 9 · Movimiento reducido

- `MotionConfig reducedMotion="user"` en todo el armazón; regla CSS global de la Fase 9; toda animación de
  `game-experience.css` vive bajo `prefers-reduced-motion: no-preference`.
- Con reducido: transiciones = fundido ≤ 120 ms; sin partículas, barridos, luz de sala animada (queda halo fijo),
  inclinaciones ni escalados; la barra de XP aparece ya en su valor final.

## 10 · Rendimiento

- Solo `transform`/`opacity` en lo que se repite; sin sombras/blur animados en bucle; colección con escalonado acotado
  (≤ 0,28 s) y paginación de 48; partículas solo en nivel 4.
- Presupuesto: sin regresión > 15 % (bundle JS, JS por pantalla, tareas largas, CLS, fotogramas lentos) frente a BEFORE,
  medido con `scripts/_fase44-perf.ts` sobre build de producción (`performance-before-after.json`).

## 11 · Sonido

- `src/lib/sound.ts`: sintetizado con Web Audio (sin ficheros, sin descargas). Eventos con nombre:
  `ui.hover · ui.confirm · pack.open · card.rare · card.epic · card.legendary · match.win · match.loss · level.up`.
- Ajustes **general / efectos / silencio** en este dispositivo (`localStorage` `nexus:audio:v1`), en Cuenta y en la hoja
  Menú. Nada suena sin un gesto previo (política de autoplay).

## 12 · Fase 44.1 · Mundo, música, efectos y entrada

- **Scroll.** `html, body { overflow-x: clip }` y `overscroll-behavior-y: none` SOLO en `html`. Nunca `hidden|auto` ni
  `overscroll-behavior` en body (convierte body en un contenedor de scroll que no se desplaza: la rueda muere y `sticky`
  no se pega). Sin listeners de `wheel` globales ni `scrollBy`. Un único cerrojo de scroll con contador
  (`lib/gameExperience/scrollLock.ts`) para hojas, diálogos y el visor de carta.
- **Ambiente.** `GameEnvironment` (montado por `GameShell` según `environmentForPath`) pinta el lugar detrás de la
  interfaz: L0 base + grano, L1 arquitectura SVG original, L2 luces, L3 partículas en canvas 2D, L5 tinte de modo en el
  lobby (`nexus:env-focus`, 320 ms) y atenuado (`nexus:env-dim`, cámara de sobres por fase). `aria-hidden`, sin puntero,
  `-z-10`, parallax 4–12 px solo con puntero fino ≥ 1024 px, ≤ 3 movimientos por lugar, nada con movimiento reducido.
  Sin Three.js, WebGL ni vídeo. `body` es transparente para que el lugar se vea.
- **Paneles.** Sobre el ambiente, los paneles grandes son translúcidos (≤ 0,85 de opacidad) para que el lugar se lea.
- **Música.** Un único motor (`lib/audio/musicEngine.ts`, contexto de audio de `lib/sound`), temas ORIGINALES generados
  en el navegador (`lib/audio/music.ts`): LOBBY · COLLECTION · PACKS · DECKS · CAMPAIGN · DRAFT · RANKED · MATCH · RESULT.
  Arranca con el primer gesto; fundidos 500–1500 ms; ≤ 2 capas vivas; duck en la apertura de sobres y bajo los stingers;
  pestaña oculta → 0. Prohibido: ficheros de audio, `<audio>`, pistas de terceros.
- **Efectos.** Catálogo de 20 eventos (`SOUND_EVENTS`); los de paso (`ui.hover`, `play.hover`) limitados a uno cada
  90 ms y nunca crean el contexto de audio.
- **Ajustes.** MÚSICA y EFECTOS con deslizador 0–100 y silencio propio, más el silencio general (misma clave
  `nexus:audio:v1`, compatible con lo guardado en Fase 44).
