# Auditoría del Entrenador / Tactical Coach — estado real (2026-09-22)

Solo lectura: no se ha modificado código, esquema ni navegación. Evidencia: código del repo, build de producción en `localhost:3005` contra la BD del VPS, cuenta `demo@nexus.local`. Los datos de QA (`__QA_TRAINER_AUDIT__*`: 2 composiciones y 1 jugada) se crearon con las API del propio juego y **se borraron** (quedan 0 jugadas y 0 composiciones). No se jugó ningún partido del simulador (no se creó ninguna fila en `coach_matches`).

## 1. Rutas (9 páginas, todas compilan y dan 200 en la build)
| Ruta | Archivo | Sesión | Estado probado |
|---|---|---|---|
| `/entrenador` | `app/entrenador/page.tsx` (+ `coach/TrainerPortal`) | no (lee estado local) | carga, con datos reales |
| `/entrenador/equipos` | `app/entrenador/equipos/page.tsx` | no (equipos en localStorage) | carga |
| `/entrenador/mapas` | `app/entrenador/mapas/page.tsx` | no | carga, 12 mapas, zoom |
| `/entrenador/strats` (Pizarra) | `app/entrenador/strats/page.tsx` | **sí** | carga, guarda y recupera |
| `/entrenador/strats/revisar?id=` | `app/entrenador/strats/revisar/page.tsx` | **sí** | carga la jugada guardada |
| `/entrenador/composiciones` | `app/entrenador/composiciones/page.tsx` | **sí** | crea, lista, edita, duplica y borra |
| `/entrenador/plan?match=` | `app/entrenador/plan/page.tsx` | **sí** | carga; sin partida de simulador no se pudo probar entero |
| `/entrenador/partido` | `app/entrenador/partido/page.tsx` | no (simulador local) | carga; sin equipo pide crearlo |
| `/entrenador/partidos` | `app/entrenador/partidos/page.tsx` | **sí** (historial en servidor) | carga; demo sin partidos |

API: `GET/POST /api/game/strats`, `/api/game/compositions`, `/api/game/match-strats` (`?matchId=`), `GET /api/game/coach-matches`. Todas dan **401 sin sesión**. No hay rutas `/pizarra`, `/theater`, `/tactical` ni `/coach`.

## 2. Navegación — ¿descubrible?
**ENTRENADOR ES DESCUBRIBLE DESDE LA UI: SÍ, pero solo por un camino secundario.**
- Escritorio (≥1024 px): barra superior → **«Más»** (el desplegable de la sección *jugar*) → «Entrenador». Definido en `design/nav.ts` (NAV_SECTIONS, sección `jugar`) y pintado por `PlayMenu` en `layout/GameShell.tsx`, que solo se muestra desde `lg`.
- Móvil: botón «Menú» → sección Jugar → «Entrenador».
- Otros: `/carrera` enlaza a `/entrenador/equipos`; el manifest PWA tiene el atajo «El Entrenador».
- **NO aparece** en el selector `/jugar` (`GameModesHub`: 5 modos — Road to Champions, Partida rápida, Competitivo, Retar a un amigo, Draft Gauntlet; `lib/campaign/presentation.ts` `gameModes()`), **ni** en el menú «Más» del vestíbulo (`home/MoreMenu.tsx`), **ni** en las salidas de `/jugar` (`design/gameShell.ts` `CORE_SCREENS`).

## 3. Matriz
| Funcionalidad | Existe | Funciona | Accesible UI | Ruta / componente | Estado |
|---|---|---|---|---|---|
| Hub del entrenador | Sí | Sí | Sí (Más → Entrenador) | `/entrenador` · `TrainerPortal` | Funcional |
| Plantilla / equipos del simulador | Sí | Sí | Sí | `/entrenador/equipos` · `useTeamStore` | Funcional, **solo local** (localStorage `drl-champions-teams`) |
| Simulador «Dirigir partido» (13 rondas) | Sí | Carga (no jugado) | Sí | `/entrenador/partido` · `coach/*`, `sim/*` | No verificado en partida |
| Expediente de partidos | Sí | Sí (lectura) | Sí | `/entrenador/partidos` · `coach_matches` | Funcional, vacío en demo |
| Mapas | Sí | Sí | Sí | `/entrenador/mapas` · `MapCanvas`, `MapPicker` | Funcional |
| Pizarra | Sí | Sí | Sí | `/entrenador/strats` · `StrategyBoard` | Funcional |
| Fichas por rol (DUE/CON/INI/CEN/FLX) | Sí | Sí | Sí | pizarra | Funcional |
| Asignar agente a ficha | Sí | Sí (código) | Sí | `AgentPicker` | Funcional (no probado a mano) |
| Habilidades del agente como utilidad | Sí | Sí (código) | Sí | `AbilityPicker` | Funcional (no probado a mano) |
| Utilidades genéricas (8) | Sí | Sí | Sí | Humo, Destello, Incendiaria, Aturdidor, Muro, Información, Spike, Punto de ruta | Funcional |
| Dibujo (7) | Sí | Sí | Sí | Marcador, Flecha, Línea, Círculo, Rectángulo, Zona, Trazo | Funcional |
| Colores | Sí | Sí | Sí | 6 colores fijos | Funcional |
| Notas de texto | Sí | Sí | Sí | herramienta «Nota» | Funcional |
| Mover / eliminar objetos | Sí | Sí (código) | Sí | `moveObject` / `removeObject` | Funcional |
| Pasos (secuencia, hasta 12) | Sí | Sí | Sí | pizarra | Funcional |
| Deshacer / rehacer | **No** | — | — | solo existe en un modelo de test (`f47.fuzz.test`) | Inexistente en la UI |
| Guardar / cargar (`?abrir=`) | Sí | **Sí (probado)** | Sí | `/api/game/strats` | Funcional |
| Duplicar / eliminar jugada | Sí | Sí (código) | Sí | pizarra | Funcional |
| Revisión de una jugada | Sí | **Sí (probado)** | Sí (desde pizarra) | `/entrenador/strats/revisar` | Funcional |
| Presentación / Tactical Theater | Sí | **Sí (probado, modo foco)** | Sí («⛶ Presentar») | `TacticalTheater` | Funcional; pantalla completa real no comprobable en la pestaña oculta |
| Reproducción de pasos | Sí | Sí (código) | Sí | Theater (520 ms/paso) | Funcional |
| Composiciones | Sí | **Sí (probado)** | Sí (hub) | `/entrenador/composiciones` · `CompositionBuilder` | Funcional |
| Composición principal por mapa | Sí | Sí (código) | Sí | API `primary` | Funcional |
| Plan táctico | Sí | **Parcial** | Solo desde el expediente de partidos | `/entrenador/plan?match=` | Necesita un partido del simulador |
| Exportar | **No** | — | — | — | Inexistente |
| Historial / versionado | Parcial | Parcial | — | cerrojo `updated_at` en servidor; **la pizarra no lo usa** | Ver bug 2 |

## 4. Roster
**Activo:** `src/domain/tactics/roster.ts` + `valorantRoster.ts` → **29 agentes reales**.
- Controladores (7): Astra, Brimstone, Clove, Harbor, Miks, Omen, Viper.
- Iniciadores (7): Breach, Fade, Gekko, KAY/O, Skye, Sova, Tejo.
- Centinelas (7): Chamber, Cypher, Deadlock, Killjoy, Sage, Veto, Vyse.
- Duelistas (8): Iso, Jett, Neon, Phoenix, Raze, Reyna, Waylay, Yoru.

`AgentPicker` usa este roster.

**Legado no seleccionable:** los 10 propios (`veil, haze, probe, pulse, spear, blitz, warden, tripwire, specter, echo`, en `src/agents/catalog.ts`, que además usa gameplay): `isKnownAgentId = true`, `isSelectableAgentId = false`. Ningún agente ficticio aparece en el selector.

## 5. Mapas
12: Abyss, Ascent, Bind, Breeze, Corrode, Fracture, Haven, Icebox, Lotus, Pearl, Split, Sunset. PNG RGB de ~1.200–1.320 px de lado (~0,95–1,2 MB cada uno) en `public/maps/`. Cargan, se eligen y la pizarra dibuja encima.

## 6. Persistencia
| Tabla | Migración | Qué guarda |
|---|---|---|
| `user_strats` | 0017, 0028 | jugadas (JSON `plan`) |
| `user_compositions` | 0054 | composiciones |
| `coach_match_strats` | 0054 | plan de una partida |
| `coach_matches` | 0044 | partidos del simulador |

Las cuatro con **RLS por dueño**. Escritura con `service_role` en las rutas y `user_id` tomado siempre del token. Las tablas de la 0054 **existen en la BD en vivo**: `compositions` y `match-strats` responden 200. Los equipos del simulador van a localStorage, no al servidor.

## 7. Seguridad
Sin sesión → 401 en las cuatro API. Toda lectura y escritura filtra por `user_id` del token (además de RLS). Probado con ids ajenos o inexistentes:
- borrar composición → 404;
- actualizar jugada → 404;
- asignar jugada a una partida ajena → 404.

No se encontró acceso a datos de otro usuario.

## 8. Tests
11 ficheros propios, **140 tests, todos pasan**: `domain/tactics/{agents,f47,f47.close,f47.fuzz,tactics}.test.ts`, `components/tactics/{boardLayers,agentPortrait}.test`, `agents/visuals.test`, `coach/engine.test`, `lib/match/roster.test`, `server/services/coachMatches.test`. También hay referencias en los contratos de telemetría y campaña.

## 9. Bugs y huecos encontrados (no arreglados)
1. **La API acepta composiciones de agentes del legado.** Se guardó `veil/haze/probe/pulse/spear` con 200. La UI no los ofrece, pero el servidor los admite, y luego la lista pinta «5 / 5» sin ningún chip de agente.
2. **La pizarra no usa el cerrojo optimista.** `saveStratVersioned` y el 409 `VERSION_CONFLICT` existen, pero la página llama a `saveStrat` sin versión: con dos pestañas, gana la última.
3. **`/entrenador/plan` con una partida inexistente no avisa.** Pinta el plan vacío con el mapa en blanco («No hay composiciones en . Crear una») en lugar de «partida no encontrada».
4. **No hay deshacer/rehacer** en la pizarra.
5. **No hay exportación.**
6. **Los equipos del simulador son solo locales** (se pierden al cambiar de navegador o dispositivo) y son distintos de los mazos del juego.
7. **El plan táctico solo se alcanza desde el expediente de partidos**: sin haber jugado un partido del simulador no hay forma de abrirlo con datos.

## 10. Capturas
`docs/product/qa/trainer-audit/`:
- sin sesión, Chrome sin cabeza a 1440×900: hub, equipos, mapas, partido, partidos, composiciones, pizarra y plan (las cuatro últimas muestran «Necesitas una cuenta»), más la lámina `_lamina-sin-sesion.jpg`;
- con la cuenta demo (tu Chrome): `auth-hub`, `auth-pizarra-con-jugada-QA`, `auth-presentacion-theater`, `auth-plan-sin-partida`.

Con la pestaña de tu Chrome en segundo plano, varias capturas autenticadas salen con el velo de carga encima o en blanco (las animaciones no terminan); el contenido sí estaba en el DOM.

## 11. Estado visual
El hub es moderno (F44/F47.1). La pizarra, las composiciones y el plan usan el estilo NEXUS de F47.1, pero son pantallas de herramienta: fondo del «Mundo», paneles y el mapa en líneas sobre gris. No comparten la dirección visual de NEXUS Arena.

## 12. Categoría global
**FUNCIONAL PERO POCO DESCUBRIBLE (y visualmente anterior a NEXUS Arena).** De las categorías pedidas, la que corresponde es **FUNCIONAL PERO VISUALMENTE ANTIGUO**, con dos matices: la descubribilidad (solo desde «Más») y el Plan táctico, que queda en PARCIAL hasta que haya un partido del simulador.

## 13. ¿Por qué no aparece en `/jugar`?
Porque `/jugar` es el **selector de modos de duelo de cartas** (`GameModesHub` → `gameModes()`), que solo declara 5 modos. El Entrenador nunca se añadió como modo. Su única entrada está en el desplegable «Más» de la barra superior (desde 1024 px) y en el menú móvil. No es un error de enlace ni una ruta rota: es una decisión de navegación (F44 sacó JUGAR de la barra como enlace y dejó sus secciones en «Más»).
