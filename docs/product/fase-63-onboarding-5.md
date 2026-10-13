# FASE 63 — ONBOARDING 5.0 · PRIMERA SESIÓN

Fecha: 2026-09-26 · Rama `arch/stabilization` (HEAD `48dac2a`, sin commit) · Evidencia: `docs/product/qa/fase63-onboarding/`

**Veredicto: GO.** Una cuenta nueva, sin que nadie le explique nada, entra → ve una bienvenida → ve sus recursos reales →
abre un sobre real (F57) → aprende su primera carta real → ve su colección → crea un equipo legal con SUS cartas → juega
contra el bot Fácil real (F61) → entiende el resultado (gane o pierda) → ve su progreso (F62) → pulsa SEGUIR JUGANDO y queda
libre. Probado de punta a punta en la BD real con tres cuentas QA nuevas (1440, 1440 y 390 con movimiento reducido), una
cuarta para saltar/retomar, y una cuenta antigua para la regresión. Sin migración.

---

## 1. Baseline

| | Antes | Después |
|---|---|---|
| Tests (`npm test`) | 5.208 / 5.208 | **5.262 / 5.262** (+54 de F63) |
| tsc web / scripts | exit 0 / exit 0 | exit 0 / exit 0 |
| Build | exit 0 | exit 0 |
| Cabeza de migraciones | 0057 | **0057** (sin migración) |
| Cartas (código / BD) | 331 / 331 | 331 / 331 |
| Agentes (BD) | 29 | 29 |
| Marketplace / pagos | OFF / OFF | OFF / OFF |
| F61 (huella del motor) / F62 | verdes | verdes |

BD viva (solo lectura, 2026-09-26): 122 tablas públicas, 12 cuentas (1 admin = la tuya). `baseline.json`.

## 2. FTUE anterior

- **Alta**: el trigger `handle_new_user` (0011) crea perfil (6.000 créditos), `user_game`, `user_packs` inicial×3 + estandar×1 y el asiento `starter_grant`. Una vez por cuenta. Verificado vivo en la BD.
- **Estado**: ninguno persistido. El recorrido de F40 (`domain/journey`) se deriva de hechos reales y va dentro del Daily Loop.
- **Pantallas**: Mission Control / tira / «Primera sesión completada» (F40) en `DailyLobby`, coach de colección, coach del constructor y coach de la pre-partida.
- Prueba ciega con una cuenta nueva (`93915dc0`, registrada por `/cuenta`): `old-ftue-walk.json`, capturas `screenshots/before/`.

## 3. Problemas encontrados

| Id | Problema | Estado |
|---|---|---|
| P0-1 | **La guía F40 era código muerto en la portada**: desde F46 la home es `MainMenu`, que no pinta `journey`. El servidor calculaba «Abre tu primer sobre» y nadie lo enseñaba: el jugador nuevo veía JUGAR/INVENTARIO/TIENDA sin más. | Arreglado |
| P0-2 | Al registrarse, la cuenta se quedaba en `/cuenta` (perfil), no en el juego. | Arreglado |
| P1-1 | JUGAR → `/jugar` con los cuatro modos «EQUIPO NO VÁLIDO». | Guía + franja «Tu inicio» |
| P1-2 | 3 × 404 en cada visita a la portada (vídeo pendiente de F46). | Arreglado (§31) |
| P1-3 | **`deckReadiness` contaba dos veces a un jugador con cartas de dos roles**: el 0,02 % de las cuentas nuevas simuladas salía «listo» sin poder formar equipo. La guía proponía crearlo, el constructor fallaba y el Sobre Inicial gratis se negaba («ya puedes»): callejón sin salida. | Arreglado (§14) |
| P2-1 | Terminología mezclada: «mazo» (pre-partida y resultado), «plantilla» (guía y reglas) y «equipo». | Arreglado en todo el camino |
| P2-2 | El coach de la colección hablaba solo de SH/GS/EF. La carta imprime DMG·SCR·FKS·HS·AST·CLU y no se explicaba la diferencia. | Arreglado (§10) |
| P2-3 | Ninguna ayuda de ATACAS/DEFIENDES dentro de la partida; tras la primera partida no había puerta a F62. | Arreglado (§16–18) |

## 4. Starter package real encontrado

**6.000 créditos + 3 Sobres Iniciales + 1 Sobre Bronce** (id `estandar`, renombrado en F57 sin cambiar su id).
- Ambos sobres existen y se abren (Inicial: precio 0, 5 cartas; Bronce: 1.000, 5 cartas, techo de OVR 85).
- Fuente: función viva `handle_new_user`; `profiles.credits` default 6000.
- `starter-contract.json` incluye el SQL del trigger.

## 5. Cambios de starter: **NO**

El starter es válido: no hay sobres retirados. No se tocó ni el trigger, ni los precios, ni los pesos, ni la asistencia F41.
Lo único que cambia es el **orden que la guía propone** (§9).

## 6. Flujo nuevo completo

Seis pasos, contador «Tu inicio · X/6»:

| # | Paso | Hecho cuando (hecho REAL) | CTA | Reanuda en |
|---|---|---|---|---|
| 1 | Bienvenida | pulsó EMPEZAR o ya hizo algo en el juego | EMPEZAR (orden `start`) | `/` |
| 2 | Tu primer sobre | un sobre abierto o cartas | ABRIR MI PRIMER SOBRE | `/abrir/estandar` |
| 3 | Tu colección | sus cartas forman un equipo legal | Abrir el siguiente sobre / Ver mi colección | `/coleccion?tener=owned` |
| 4 | Tu primer equipo | un equipo guardado y legal | CREAR MI PRIMER EQUIPO (orden `first-team`) / Montarlo yo | `/` |
| 5 | Tu primera partida | una partida terminada (ganar, perder o empatar) | JUGAR MI PRIMERA PARTIDA | `/duelos/jugar?dificultad=EASY&primera=1` |
| 6 | Tu progreso | pulsó SEGUIR JUGANDO (orden `finish`) o 2 partidas | VER MI PROGRESO → SEGUIR JUGANDO | `/progresion` |

Estado autoritativo: `NOT_STARTED / IN_PROGRESS / COMPLETED`, **derivado de los hechos de F40**. No hay segunda fuente de verdad.
Solo tres **acuses** no se deducen del juego: `startedAt`, `skippedAt` y `finishedAt`. Viven en `auth.users.app_metadata.nx_onboarding`, que escribe SOLO el servidor (service_role); el cliente no puede escribir `app_metadata`.
Ningún acuse concede nada.

Piezas: `domain/onboarding` (puro), `server/services/onboarding.ts`, `GET/POST /api/game/onboarding`, `onboarding` dentro de la foto del Daily Loop, `lib/onboarding/client.ts` y `components/onboarding/*`.

## 7. Welcome

Sobre la misma escena del menú (cartas reales volando):
- Título: **NEXUS · «Construye tu equipo. Juega. Progresa.»**
- Tres líneas: Colecciona · Construye · Juega.
- **Un** botón, EMPEZAR, más «Saltar tutorial».

La cabecera (MÁS, créditos) sigue accesible. Capturas `01-bienvenida-{1440,1024,390}`.

## 8. Starter moment

«Tus recursos para empezar», con **lo que la cuenta tiene de verdad**:
- los sobres sin abrir con su **arte real** y la cantidad (Bronce ×1, Inicial ×3);
- los créditos del estado del juego, la misma cifra del HUD.

La animación no concede nada: el alta ya lo concedió. Capturas `02-recursos-*`.

## 9. First pack

ABRIR MI PRIMER SOBRE lleva a la **ceremonia real de F57** (`/abrir/estandar`).

Orden determinista: **Bronce primero, luego los Iniciales**. Lo decidió una simulación de 20.000 cuentas con el motor real, el catálogo real y los pools reales de la BD:

| Orden | Equipo solo con los 4 sobres de bienvenida | Iniciales gratis extra (máx.) |
|---|---|---|
| Iniciales primero (F40) | 94,0 % | 1 |
| **Bronce primero (F63)** | **99,97 %** | 1 |

Educación mínima: «Los sobres añaden cartas a tu colección». Nada de probabilidades.

## 10. First card education

Dentro del resumen real de F57 y solo tras el PRIMER sobre. La carta es la **destacada de ese sobre**, nunca una inventada: `alym__base`, `alym__future-star` y `kr1stal` en las tres pruebas. Se explica:
- **OVR** (1–99);
- **rol de la carta** («tu equipo lleva 2 de cada rol»);
- las **3 de combate SH/GS/EF**, con las que compite en la partida;
- plegadas, **las seis impresas** DMG · SCR · **FKS** · HS · AST · CLU («el rendimiento real del jugador»). Nunca COM.

Con la guía delante, el dock de acciones del resumen deja de ir pegado al pie: en 390 px tapaba los botones de la guía. Captura `04-primera-carta-*`.

## 11. Collection

«Ver mi colección» → `/coleccion?tener=owned`. El bloque dice:
- «Estas son tus cartas. Con ellas formas tu equipo: 10 cartas, 2 de cada rol, sin repetir jugador».
- Los roles con cifra y texto (✓ Duelista 2/2 · Controlador 0/2…). No depende solo del color.

Sin filtros avanzados. Sustituye al coach de F40 mientras la guía está activa, y no aparece después.

## 12. First deck

**CREAR MI PRIMER EQUIPO** es una orden del servidor (`first-team`):
- toma **solo cartas poseídas** (la colección del constructor, resuelta por el servidor);
- usa el `autocomplete` del constructor;
- guarda con `createTeam`, que pasa el validador canónico;
- activa el equipo si no había ninguno activo.

Nunca inventa cartas: sin cartas suficientes responde 409 con los roles que faltan. «Montarlo yo» abre el constructor normal.

## 13. Auto-deck

Idempotente:
- Con un equipo legal ya guardado lo devuelve, no crea otro.
- Si dos pestañas lo crean a la vez, las dos calculan el MISMO equipo, se queda el más antiguo y el duplicado se borra.

**En la BD real**: 5 órdenes en paralelo dejaron **un** equipo (`multitab-race-live.json`). Tests S04–S07.

## 14. Deck validity

Reglas sin cambiar: 10 cartas, 2 por **rol de la carta**, sin repetir jugador (tampoco entre variantes) y una sola versión de datos.

Arreglo de P1-3: `deckReadiness` pasa a ser exacto, con una asignación jugador → hueco de rol (camino aumentante, 10 huecos). Tras el arreglo, 20.000/20.000 cuentas simuladas forman un equipo que **el validador canónico firma** (antes 99,98 %). Tests R01–R04.

## 15. First match

Partida rápida PvE contra el **bot Fácil real** (`?dificultad=EASY` solo preselecciona; se puede cambiar).
- No es ranked, no es un motor aparte y no hay victoria amañada.
- Rival: el mazo determinista del motor, con OVR parecido al del jugador (833 contra 835 en la prueba 1).
- Resultados reales: **derrota 5–6** por desempate (prueba 1), **victoria** (prueba 2) y **derrota** (prueba 390).

## 16. Contextual match teaching

Solo en la primera partida, una franja fina ENCIMA del tablero de F61. Nunca tapa cartas y se puede jugar con ella abierta.
- La primera vez que **ATACAS**: «Elige una carta y una de sus tres estadísticas de combate… El valor más alto gana el turno.»
- La primera vez que **DEFIENDES**: «…respondes con la que marca la tabla: SH contra EF, GS contra GS… Si empatáis, nadie puntúa.»

Una vez cada una, y un F5 no la repite. Las reglas se contrastan con el motor en test D21. `MatchBoard` no se toca.

## 17. First result

El resultado normal de F61 y la progresión de F62 no cambian. Debajo, «**Tu primera partida ya cuenta**» con VER MI PROGRESO. Aparece gane, pierda o empate.

Recompensas reales del servidor:
- derrota: +25 créditos, +15 XP de cuenta;
- victoria: +120 créditos.

## 18. Progression

En `/progresion`, encima del hub real de F62, «Así avanzas en NEXUS» explica tres bloques:
- **XP de cuenta**: jugando y abriendo sobres;
- **Objetivos**: se reclaman aquí;
- **XP de temporada**: se gana reclamando objetivos.

El hub sigue interactivo. Todo el copy es cierto según el sistema actual; «tus partidas suman» y no «cada partida», porque hay tope diario PvE.

## 19. Completion

«**YA ESTÁS LISTO**. Ahora puedes: jugar más partidas · mejorar tu equipo · completar objetivos» y **SEGUIR JUGANDO** → `/jugar`. La orden `finish` exige una partida terminada en la BD.

Después, la portada vuelve a ser el menú de F62 y no queda cromo de tutorial.

## 20. Resume

Todo vive en el servidor y nada en `localStorage`:
- F5 en la bienvenida → bienvenida.
- F5 en recursos → recursos.
- Otro dispositivo u otra sesión → el mismo paso.

## 21. Skip

«Saltar tutorial» (bienvenida, recursos y «continúa tu inicio») pide confirmación. El foco inicial va a «Seguir con el tutorial».
- Saltar **no concede ni quita nada**: los sobres y los créditos siguen en la cuenta, que queda usable.
- Se puede retomar en **Más → Cómo jugar** («Retomar el tutorial»), salvo que la guía esté completada por otra vía.

Probado en real (`skip-live-1440.json`).

## 22. Returning users

Quien vuelve con la guía a medias la retoma en su paso; quien la terminó o la saltó no ve nada. Al iniciar sesión:
- con la guía activa, portada;
- en otro caso, se queda donde estaba, como hasta ahora.

## 23. Existing users

Una cuenta con partidas que nunca pulsó EMPEZAR queda **COMPLETADA (SELF_GUIDED)**: nunca ve la guía, no recibe nada y no se escribe nada.
- BD real: tu cuenta (10 partidas) y las QA de F35, F45 y F40 → completadas.
- Regresión en vivo con QA `1ff2c0ef`: ninguna UI de la guía en `/`, `/coleccion`, `/jugar` ni `/progresion`; créditos, XP, cartas y equipos idénticos.

## 24. New-user detection

No se usa `created_at` (test D12). Nuevo = sin actividad real (sobres abiertos, cartas, equipos, partidas) y sin acuses.

Consecuencia documentada: 7 cuentas QA antiguas sin ninguna actividad verán la bienvenida si alguien entra con ellas. Son, de hecho, jugadores nuevos, y **no reciben nada** (su starter ya se concedió al crearlas).

## 25. Starter idempotence

El starter solo lo concede el trigger de alta. Ninguna ruta de F63 toca `user_packs`, `profiles.credits`, `credit_transactions`, `user_cards` ni `economy_ops` (tests D24 y S08).
- EMPEZAR ×1, ×2, ×10 y ×10 en paralelo: 0 escrituras en tablas del juego y 1 acuse (S02).
- En real: 10 en paralelo → 200, con el inventario intacto.

## 26. Step idempotence

Repetir un callback deja el mismo estado final: `start`, `finish` y `first-team` (D13–D15, S03, S05). Los pasos se derivan de hechos, así que releer nunca avanza ni retrocede nada por sí solo.

## 27. Multi-tab

- La foto de la guía se comparte entre pantallas (almacén de módulo por usuario, caché de 20 s). Cada orden la actualiza en todas las pantallas montadas.
- Crear el equipo en dos pestañas deja un equipo (real).
- La recompensa de la partida sigue siendo la de F61 (clave `duel:<id>`).

## 28. Refresh / recovery

| Momento | Resultado (real) |
|---|---|
| F5 en plena ceremonia del sobre | cartas 5 → 10 (exactamente +5), sin duplicar |
| F5 tras crear el equipo | 1 equipo |
| F5 a mitad de partida | «Partida recuperada», la ayuda no se repite |
| F5 sobre el resultado | mismo resultado (`?resultado=`), «Ver mi progreso» sigue, XP y créditos iguales |

`recovery.json`.

## 29. Security

| Intento | Resultado |
|---|---|
| Órdenes inventadas (`grant`, `claim-starter`) | 400 |
| Cuerpo con `userId` o `finishedAt` | 400 (cuerpo estricto) |
| GET con parámetros | 400 |
| Sin token | 401 |
| «Completado a mano» con `auth.updateUser` (user_metadata) | sin efecto: la guía solo lee `app_metadata` |
| Reclamar el starter otra vez (comprar Inicial gratis con uno sin abrir) | 409 «Ya tienes un Sobre Inicial por abrir» |
| `finish` sin partida (o con partida en curso / Draft) | 409 |
| Límite de ritmo | cubetas nuevas `onboarding_read` 60/min y `onboarding_write` 20/min (sin migración) |

`security-live.json`.

## 30. Home

- Bienvenida y recursos ocupan el sitio de las tres acciones: un solo botón que pulsar.
- Del paso 3 en adelante vuelven las tres acciones y debajo va «Continúa tu inicio · Paso X/6» con UN botón. En el paso 5 se ven las diez cartas del equipo, con el botón encima para que no quede bajo el pliegue.
- Llega en la misma foto del Daily Loop: **cero lecturas nuevas en la portada**. La foto no lleva créditos (contrato de privacidad de F36).

## 31. 404 heredados de F46

**Causa**: `NexusHall` montaba siempre el `<video>` con `poster="/video/nexus-lobby-poster.jpg"` y dos `<source>` (webm, mp4). Ninguno existe en `public/video/`, así que cada visita a la portada pedía tres ficheros inexistentes: 3 × 404 en la consola.

**Arreglo**: `LOBBY_VIDEO_READY = false`. El `<video>` solo se monta si el fichero existe, y un test compara la bandera con `public/video` (U10). La arquitectura de vídeo sigue entera: poner el fichero es cambiar la bandera.

Resultado: 0 errores de consola en la portada (antes 3).

## 32. Mobile (390)

Recorrido entero a 390 px con movimiento reducido y una cuenta nueva: 0 desbordes, 0 imágenes rotas, 0 errores. Los botones grandes ocupan el ancho y la ayuda de la partida va encima del tablero.

## 33. Tablet (1024)

Cada etapa de la pasada principal se captura también a 1024: 0 desbordes.

## 34. Desktop (1440)

Dos recorridos completos (derrota y victoria): 0 desbordes, 0 imágenes rotas, 0 errores.

## 35. Reduced motion

Tu Chrome ve el modo reducido, así que es TU experiencia. Recorrido completo con `prefers-reduced-motion: reduce`: la guía solo usa fundidos (`nx-f63-rise` → `nx-f63-fade`) y la ceremonia y la partida son las de F57/F61. Se entiende igual (24 capturas).

## 36. Accessibility

- CTAs como botones y enlaces del sistema (≥ 44 px), con `data-command` en las órdenes.
- Diálogo de salto con foco atrapado, Escape y foco inicial en la opción segura.
- Contador con `aria-label` «paso X de 6, título» y lista de pasos en texto («hecho / ahora / después»).
- La ayuda de la partida es `role="note"`; los roles llevan texto además de color; los errores son `role="alert"`.

## 37. Performance

- Portada: 0 lecturas nuevas (va en la foto del Daily Loop).
- Resto de pantallas: 1 `GET /api/game/onboarding` compartido entre pantallas (caché de 20 s).
- Para cuentas COMPLETADAS, como máximo una lectura por sesión: el estado es terminal en el cliente y ni jugar ni abrir sobres la vuelve a pedir.
- No se carga ningún catálogo extra; las cartas del equipo salen del catálogo ya cargado.

## 38. QA account

| Cuenta | Uso |
|---|---|
| `93915dc0` | ANTES (build anterior): registro y 1 sobre |
| `a9a86124` | DESPUÉS, 1440, prueba 1 (derrota) |
| **`772cf6f1`** | **DESPUÉS, 1440, prueba principal (victoria)** |
| `344349b7` | DESPUÉS, 390 + movimiento reducido + URL directas (derrota) |
| `0692cbd0` | saltar / retomar + sondas de seguridad + carrera real |
| `1ff2c0ef` (existente, F45) | regresión: solo lectura + login |

Todas son `@example.invalid`, registradas por el formulario real de `/cuenta`. Las credenciales están solo en el scratchpad de esta sesión.

## 39. Starter inventory before/after (prueba principal `772cf6f1`)

- Antes: 6.000 créditos · Inicial ×3 · Bronce ×1 · 0 cartas · 0 equipos.
- Después: 6.120 créditos (+120 de la victoria) · Inicial ×1 · 15 cartas · 1 equipo. Ningún sobre ni crédito extra.

## 40. Pack opened

Bronce (`/abrir/estandar`) → Inicial (con F5 en plena ceremonia) → Inicial. Con 3 sobres ya formaba equipo y le queda 1 Inicial.

## 41. Cards obtained

15 (5 + 5 + 5). Primera carta destacada: `alym__future-star` (OVR 92).

## 42. Deck created

«Mi primer equipo»: 10 cartas, válido y **activo**. En la prueba 1, Σ OVR 833.

## 43. Match result

Prueba principal: match `52e7b5e2…`, EASY, **victoria**. Prueba 1: `0fea81af…`, EASY, **derrota 5–6** (empate a 5, desempate por suma de OVR 833–835). Prueba 390: **derrota**.

## 44. Rewards

Las de F61, del servidor:
- victoria: +120 créditos;
- derrota: +25 créditos y +15 XP de cuenta.

Sin recompensa de «onboarding»: la guía no da nada.

## 45. Progress changes

Cuenta nivel 1 → 3 (sobres y partida). Objetivos del día completados y listos para reclamar en `/progresion` (F62): en la prueba 1, «4 recompensas por reclamar», visible en la captura `17-ya-estas-listo`. La XP de temporada sube al reclamarlos.

## 46. My account modified: **NO**

Fila de `2f86cbe8` idéntica antes y después de toda la QA: créditos, XP, puntos, sobres, cartas, equipos, partidas, asientos, `app_metadata` (null) y `auth.updated_at`.

## 47. Engine changed: **NO**

La huella dorada F61 MOTOR 01 está verde. `MatchBoard` y las reglas no se tocan. Solo cambian textos del resultado («mazo» → «equipo»).

## 48. Economy changed: **NO**

Precios, probabilidades, pools, valores de mercado, salvage y recompensas quedan intactos.

Nota: el arreglo de `deckReadiness` (§14) corrige a quién se considera «sin equipo posible» en la política F41 (0,02 % de las cuentas nuevas). Esas cuentas ahora sí reciben el Sobre Inicial asistido que la política ya prometía. No es una fuente nueva ni cambia ningún valor.

## 49. Cards changed: **NO** (331)
## 50. Agents changed: **NO** (29)
## 51. DB migration: **NO** (cabeza 0057)

Acuses en `app_metadata` (existente) y cubetas de ritmo nuevas en la tabla existente.

## 52. Production DB modified: **solo cuentas QA**

5 cuentas QA nuevas con sus datos de juego normales (sobres, cartas, equipos, partidas, libro mayor), y `app_metadata.nx_onboarding` en las 4 de después. Ningún cambio de esquema, catálogo, economía ni de cuentas ajenas.

## 53. Tests before/after

5.208 → **5.262** (todas verdes). Nuevas:
- `onboarding.test.ts` (25), `onboarding.service.test.ts` (9), `starterMath.test.ts` (6), `readinessExact.test.ts` (4), `onboarding.render.test.tsx` (10);
- T79 reescrito.

Pines reescritos **a propósito**, todos por «equipo» o por el contador de 6 pasos: J26, JR11, T46, J-reglas, C7 (PreMatch), A12 (resultado), F61 acciones.

## 54. tsc web: exit 0
## 55. tsc scripts: exit 0
## 56. lint: 0 errores, 10 avisos (todos de antes de F63, ninguno en ficheros de F63)
## 57. build: exit 0 (`/api/game/onboarding` y `/como-jugar` incluidas)

## 58. :3005

Build final servido con `next start -p 3005`, iniciado con `Start-Process` (el PID se localiza por línea de comandos al entregar); HTTP 200 al terminar.

## 59. Tunnel

Túnel SSH 54521/54522 abierto al entregar. Se cerró durante los gates para que ningún verificador tocara producción.

## 60. Files modified

**Nuevos**
- `src/domain/onboarding/{index,starterMath}.ts` y sus tests
- `src/domain/journey/readinessExact.test.ts`
- `src/server/services/onboarding.ts` y su test
- `src/app/api/game/onboarding/route.ts`
- `src/lib/onboarding/client.ts`
- `src/components/onboarding/{OnboardingKit,OnboardingHome,FirstCardLesson,OnboardingCollectionCoach,FirstMatchHelp,OnboardingProgress,OnboardingRail}.tsx` y su test
- `src/app/como-jugar/page.tsx`
- `scripts/_fase63-{before,live,starter,evidence}.ts` (instrumentos fuera de CI)
- esta documentación y `docs/product/qa/fase63-onboarding/`

**Modificados** (parches quirúrgicos, copia previa en el scratchpad)
- Servidor: `server/services/{session,rateLimit,dailyLoop}.ts`, `server/services/testing/memSupabase.ts` (insert+maybeSingle como PostgREST), `app/api/game/daily-loop/route.ts`
- Dominio: `domain/dailyLoop/index.ts` (solo el tipo), `domain/journey/index.ts` (readiness exacta, contador, «equipo»)
- Portada y menú: `components/home/{MainMenu,NexusHall,MoreMenu}.tsx`, `app/page.tsx`
- Sobres: `components/packs/{PackOpeningExperience,PackSummary}.tsx`
- Colección: `components/collectionRoom/CollectionRoomScreen.tsx`, `app/coleccion/page.tsx`
- Partida: `app/duelos/jugar/page.tsx`, `components/duel/{PreMatch,ResultScreen,DeckBuilder}.tsx`, `lib/duel/{experience,gameplayUx}.ts`
- Progreso: `app/progresion/page.tsx`
- Armazón y alta: `components/layout/GameShell.tsx`, `components/auth/AuthForms.tsx`
- `components/journey/FirstMatchCoach.tsx`
- `app/game-experience.css` (bloque F63)
- Tests con pines reescritos (§53)

## 61. Limitations

- **Tiempo humano no medido.** El recorrido automatizado llega a la primera partida en 73–92 s, con unas 12 decisiones. Una persona leyendo los textos debería tardar 5–8 min (estimación, no medida).
- La **carta destacada de la portada** sale del catálogo (MARTEEN) mientras no se tienen cartas. Es preexistente y dice «Carta destacada», no «tuya».
- La **arte del Sobre Bronce** es la oficial del producto (troquel «ICON · BRONZE» de F57). No es de F63.
- **Residuo QA**: 5 cuentas `@example.invalid`. No se borran porque borrar `auth.users` arrastraría libro mayor, acuñaciones y seriales; se documentan, como en fases anteriores.
- Las 7 cuentas QA antiguas sin actividad verán la bienvenida si alguien entra con ellas (§24).
- La franja «Tu inicio» en `/coleccion` antes del paso 3 está en el build final y cubierta por el test U08, pero no se recapturó en vivo.

## 62. GO / NO-GO

**GO.** Cumplido:
- existing users intactos (tu cuenta, 0 escrituras);
- economía, motor, 331 cartas, 29 agentes, marketplace OFF y pagos OFF intactos;
- starter idempotente y seguro con F5 y con varias pestañas;
- móvil usable;
- tests, tsc, lint y build verdes.

Sin migración.

FASE 63 — CERRADA
