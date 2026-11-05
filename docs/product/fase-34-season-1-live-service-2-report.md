# FASE 34 — SEASON 1 + LIVE SERVICE 2.0 · Informe

Temporada real con calendario server-side, Season Hub, pase, objetivos, ranked, eventos, resumen y archivo,
**sin resetear nada y sin economía nueva**. Fecha: 2026-09-15. Sin commit, sin push, sin deploy, sin Docker, sin
VPS, sin migraciones aplicadas.

---

## 1. Estado inicial encontrado

- 1870/1870 tests verdes (cierre de la Fase 33).
- **Dos respuestas a «¿cuál es la temporada actual?»**: `src/data/season.ts` exporta `CURRENT_SEASON` =
  `nexus-s1` (contenido real del pase, servidor) y `src/data/seasons.ts` exporta OTRO `CURRENT_SEASON` = `s1`
  (pase local heredado de Colección 6/7, 50 niveles, materiales; lo usan `useBattlePassStore` y
  `scripts/battlepass-verify.ts`).
- **Sin fechas**: `durationDays: 84` y `MetaSnapshot.season.endsAt: null` a propósito; `SeasonPanel` decía
  «Activa · sin fecha de cierre publicada».
- `public.seasons` (0012) existe con `starts_at/ends_at` + `active boolean`, pero es la temporada de Pick'ems
  (`pickem_events.season_id`), la rellena `seed-demo` con `s1` y **nadie la lee**: no es la temporada de NEXUS.
- `getProgression` **escribe al leer** (abre el carril competitivo y sortea/rota misiones, Fases 9E/27) y
  `getRating`/`getCompetitivePosition` llaman a `ensureRating` (inserta la ficha la primera vez): reutilizarlos
  tal cual en `/temporada` habría hecho que abrir la página mutase el pase y el rating.
- `user_cards.obtained_at` existe, pero lo reescribe el mercado (0020) y nace con `now()` en la sincronización
  inicial (0011).

## 2. Modelo de temporada encontrado

`SeasonDef` (`@/battlepass/types`): id, nombre, niveles, XP por nivel (lineal 1.000), carriles `free`,
`competitive` (se abre con `competitiveMinPoints` = Oro, 400 puntos de rango), `premium` (solo cosmética),
`missionPool` (daily/weekly/seasonal/progressive), `durationDays`. Estado del jugador en `user_pass.state`
(`PassState`: xp, claimed*, missions con `assignedAt/baseline`, `missionsCompleted`, `archive[]`). Si el id del
contenido cambia, `loadPass` archiva y arranca limpio (`advanceSeason`, en memoria hasta el siguiente guardado).
Rotación diaria/semanal por ventanas UTC (`periods.ts`). Dos XP: cuenta (`profiles.xp`) y pase.

## 3. Deudas de FASE 27 resueltas

| deuda | resolución |
|---|---|
| Dos `CURRENT_SEASON` | el legado local pasa a `LEGACY_LOCAL_SEASON` (mismo contenido); test «no hay un segundo CURRENT_SEASON» |
| Temporada sin fechas / `endsAt: null` | calendario canónico `SEASON_CALENDAR` + `resolveCalendar`; `MetaSnapshot.season.endsAt` sale de él |
| Sin estado, transición, recap ni historial | ciclo UPCOMING/ACTIVE/ENDED + presentación ENDING_SOON/FINAL_DAY, fases IN_SEASON/PRE_SEASON/OFF_SEASON, resumen y archivo |
| `SeasonPanel` con cuenta atrás imposible | cuenta atrás real y, terminada, «Finalizada» (antes habría dicho «Termina en 0 min») |

## 4. Fuente canónica de temporada

`src/data/seasonCalendar.ts` (`SEASON_CALENDAR`) + `src/domain/season/calendar.ts` (`resolveCalendar(entries,
serverNow)`), leída en servidor por `loadSeasonCalendar()` (`services/season.ts`) y por `meta.ts`. Un contrato
fija que solo esos tres ficheros tocan `SEASON_CALENDAR` y que ningún cliente llama a `resolveCalendar/statusAt`.

## 5. Qué has construido

Detalle en las secciones 6–42 · dominio puro `domain/season` (calendario, tiempo, resumen, acciones) · calendario canónico ·
`services/season.ts` (calendario + hub, solo lectura) · `peekProgression` · `readCompetitivePosition` · ruta
`GET /api/game/season` · cliente con reloj de servidor · Season Hub (`/temporada`), archivo (`/temporadas`),
detalle (`/temporadas/[slug]`) · bloque de temporada en vestíbulo y perfil propio · entrada de navegación ·
telemetría `season` (no-op) · cubeta `season_read` · arnés `/design-system/fase34` · capturas · `season-verify`
(5 entradas) · tests.

## 6. Season 1 / nexus-s1

`nexus-s1` **sigue siendo** la Temporada 1: el calendario usa ese mismo id y `passSeasonId: "nexus-s1"`;
`displayName` = `CURRENT_SEASON.name` («Temporada 1 · Ascenso»). No se renombró ningún id, no se creó otra S1,
`user_pass.season_id`, las claves del libro mayor (`pass:nexus-s1:…`, `mission:nexus-s1:…`) y el archivo del pase
siguen resolviéndose igual.

## 7. Fechas y server time

**Decisión de producto LOCAL (no desplegada), documentada en el propio fichero**: no existía ninguna fecha.
Inicio `2026-09-07T00:00:00Z` (lunes 00:00 UTC, inicio de la ventana semanal de misiones de la semana en la que
el pase ya estaba activo) y final `2026-11-30T00:00:00Z` = exactamente `durationDays` (84 días = 12 semanas),
también lunes 00:00 UTC. No son fechas del VCT. ISO con zona obligatoria (una fecha sin hora/zona se rechaza).
El servidor manda `serverNow`; el cliente estima `serverNow + max(0, relojLocal − recepción)`: un reloj local
adelantado o atrasado no cambia el estado; nada consulta el servidor cada segundo.

## 8. Lifecycle Upcoming/Active/Ending Soon/Ended

`UPCOMING now < startsAt` · `ACTIVE startsAt ≤ now < endsAt` · `ENDED now ≥ endsAt`. Presentación (no persistida):
`ENDING_SOON` si quedan **≤ 7 días exactos** (`ENDING_SOON_MS`), `FINAL_DAY` si quedan **< 24 h**. Sin booleanos
`is_active`/`is_current`. Calendario inválido (fecha sin zona, `startsAt ≥ endsAt`, solape, id/slug/número
duplicado) → `ok:false` con los problemas; el servicio responde 500 codificado y la ruta 503 genérico: nunca se
arregla en silencio.

## 9. Off-season/Next Season

`OFF_SEASON` = hay una terminada y ninguna activa (con o sin siguiente); `PRE_SEASON` = ninguna ha empezado;
`NO_SEASONS` = calendario vacío. «Próxima temporada»: solo si existe una entrada futura; si no, «Aún no anunciada».
No se extiende S1 para tapar un hueco. No existe Temporada 2 (la de las capturas es un fixture etiquetado).

## 10. Season Hub

`/temporada`: héroe → [resumen final si terminó] → ¿qué hago ahora? + pase → objetivos + ranked → eventos +
colección + logros → calendario → «hasta ahora» → archivo. Sin sesión: héroe, eventos y calendario públicos con
invitación a entrar. Estados: sin temporada, próxima, en curso, últimos días, último día, terminada, entre
temporadas, error, foto vieja (> 10 min, «Actualizar»), temporada inválida.

## 11. Hero/countdown

«NEXUS — TEMPORADA 1», subtítulo «Ascenso», chip de estado con glifo y texto, cuenta atrás grande (≥ 24 h
«DÍAS · HORAS», < 24 h «HH:MM:SS», próxima «COMIENZA EN», terminada «FINALIZÓ EL …»), fechas absolutas en la zona
del usuario, barra de tiempo transcurrido con marcas semanales («Día 9 de 84»), pase (nivel, XP de pase) y nivel
de cuenta aparte, CTA contextual (primera acción del servidor / resumen / calendario / entrar). Al llegar a 0 la
página pide otra foto una vez; no decide nada.

## 12. Season progress

Sin porcentaje global. Por separado: **tiempo transcurrido** (días), **progreso del pase** (nivel/XP de pase),
**objetivos** (hoy/semana/temporada/hitos X/Y). Nada se mezcla en un «67 % completada».

## 13. Battle Pass integration

«PASE DE TEMPORADA · Nivel N de 30» con XP de pase, siguiente recompensa real, tiras del carril libre (ventana
alrededor del nivel actual) y competitivo (sus 6 hitos), estados Reclamada / Reclamable / Bloqueada con glifo y
texto, y CTA a `/logros` («Reclamar N en Logros y pase»). El aspecto (premium) no se expone en el hub ni se
redefine.

## 14. Free Track

`CURRENT_SEASON.free` sin tocar (test: niveles idénticos).

## 15. Competitive Track

`CURRENT_SEASON.competitive` sin tocar (test y verificador: recompensas idénticas, umbral = `competitiveMinPoints`).
Si el jugador llegó al umbral y el carril aún no se persistió abierto, se dice «se abre al entrar en Logros y pase»
en vez de abrirlo desde un GET.

## 16. Account XP vs Pass XP

Etiquetadas y separadas en héroe y panel: «Nivel de cuenta · XP de cuenta» (`profiles.xp`, `levelFromXp`) vs
«XP de pase» (`user_pass.state.xp`, 1.000 por nivel). Test con 12.345 vs 7.400.

## 17. Reward claims

Sin segunda función: el hub no reclama nada (contrato: `season.ts` no contiene `claim*`/`grantRewards`/
`awardMany`) y enlaza a `/logros`, que usa `claimPassLevel`/`claimMission`/`claimAchievement` con sus claves
idempotentes intactas (`pass:<season>:<track>:<level>`, `mission:<season>:<id>:<assignedAt>:<baseline>`).
**Política al terminar**: no existía ninguna; no se impone pérdida. `claimPassLevel` no mira fechas y los
reclamos pendientes se conservan hasta que exista una política explícita (test 32).

## 18. Objectives Daily/Weekly/Seasonal

Los del pool real (`missionPool`): recuentos HOY / ESTA SEMANA / TEMPORADA / HITOS y hasta 3 objetivos
destacados (`ObjectiveCard` de la Fase 27), CTA a `/progresion#objetivos`. La rotación sigue siendo la de la
Fase 27 al abrir Progresión/Logros; el hub **no rota**: si hay una tanda de una ventana anterior lo dice
(`rotationPending`). No se inventó ninguna misión.

## 19. Competitive integration

«TU COMPETITIVO»: rating, posición (#N de M o «Sin clasificar», orden de escalera de la Fase 28, sin crear la
ficha), V/D/E totales, provisional (`isProvisional`, < 10 partidas), «esta temporada: N partidas · V/D/E» (asientos
con `created_at` en la ventana) y últimas 5 con su delta real.

## 20. Ranked reset policy

**Ninguna**. El rating es persistente y se muestra así («El rating es permanente: la temporada no lo reinicia»).
No hay «rating de temporada» ni rango de temporada (test 42–43).

## 21. Live Events integration

`getEventsOverview` (Fase 30, lectura): en directo («● EN DIRECTO EN NEXUS») y próximos, enlazados a
`/torneos/[id]`; en el calendario, eventos cuyas fechas tocan la ventana, sin FK ni `seasonId` (test 50). Sin
eventos: «No hay eventos en directo ni programados ahora mismo.»; si falla la lectura: «No se pudieron leer los
eventos».

## 22. Pick'ems integration/privacy

Pendientes (preguntas abiertas sin responder, calculado por la Fase 30 solo con sesión) y puntuados en la ventana
(`pickem_scores.scored_at`): puntos y aciertos. Nunca opciones elegidas (test: una respuesta con marca secreta
no aparece en el JSON).

## 23. Collection integration

«Colección TOTAL» (distintas / catálogo, ejemplares). **«Cartas conseguidas esta temporada» se OMITE**
(`COLLECTION_WINDOW_RELIABLE = false`): `obtained_at` lo reescribe el mercado (0020), nace con `now()` al
sincronizar la colección local (0011) y lo vendido desaparece; la ventana mezclaría las tres cosas. El camino
queda cableado tras la bandera (capturado solo en el arnés, etiquetado).

## 24. Achievements integration

«LOGROS DE NEXUS · permanentes» (no «de temporada»): conseguidos / total, pendientes de recoger y 4 destacados.

## 25. Action Board

«¿QUÉ HAGO AHORA?» con máximo 5 acciones. Candidatos con hechos de la foto (partida PvE a medias, reclamables,
Pick'ems pendientes, sobres, equipo legal, ranked, evento en directo) ordenados con **`todayActions`**, la misma
prioridad de la home: no hay un segundo NextUp (contrato: sin `RANK` ni `sort` propios). Sin acciones: «Nada
pendiente ahora mismo». Solo con la temporada en curso.

## 26. Home/Lobby integration

Bloque compacto **después** de `NextUp` («TEMPORADA 1 · 75 días restantes · Ver temporada»; últimos días «Últimos
días: revisa tu pase»; terminada «Ver tu resumen»; próxima «Ver calendario»), con barra de tiempo. Solo lee el
calendario público (`?scope=calendar`): no cambia la prioridad de NextUp ni añade lecturas personales.

## 27. Profile integration

Perfil **propio** (`view === "SELF"`): el mismo bloque compacto («Tu temporada»). El perfil público no recibe
nada de temporada (`playerIdentity.ts` sin tocar): ni XP de pase, ni reclamos, ni objetivos, ni «nivel de
temporada» inventado.

## 28. Navigation

«Temporada» como PRIMERA entrada de Progreso («Tiempo restante, pase, objetivos, ranked y tu resumen.»). No se
tocó Jugar (sigue ≤ 7) ni la barra móvil; `sectionForPath` la marca por su `href`; `zoneFromPath` → `pass` (la
taxonomía de zonas es cerrada por CHECK 0029 y no se amplía).

## 29. Season Calendar

Barra de 12 semanas con «Hoy», inicio y final absolutos, próximas rotaciones diaria y semanal REALES
(`periodWindow`), eventos del circuito en esas fechas y «Próxima temporada: aún no anunciada». Sin hoja de ruta
inventada.

## 30. Season Archive

`/temporadas`: temporada actual, próximas (si existen) y anteriores; con una sola temporada «Todavía no hay
temporadas anteriores: la Temporada 1 es la primera de NEXUS.». `/temporadas/[slug]` abre una temporada; id/slug
inválido o inexistente → «Temporada no encontrada». Sin pretemporada ni beta inventadas.

## 31. Season Recap

`buildSeasonRecap` con hechos fechados: Pase (estado vivo o entrada de `archive`), Ranked (partidas, V/D/E, rating
al final de la ventana y máximo alcanzado, de `duel_pvp_rating_events`), Logros (reclamados en la ventana por
`claimed_at`), Pick'ems (puntuados en la ventana). Terminada → «TEMPORADA 1 COMPLETADA · TU RECORRIDO»; en curso →
«hasta ahora»; próxima → nada; sin actividad → resumen mínimo sin cifras vistosas. **No existen** horas jugadas,
racha, carta/equipo favorito, MVP de temporada ni percentil (tests 60–62). Colección omitida y dicho.

## 32. End-of-season behavior

GET sin efectos (P0): `getSeasonHub` usa `peekProgression` (misma vista, sin `savePass`),
`readCompetitivePosition` (sin `ensureRating`) y lecturas directas. Probado contra una base en memoria que registra
escrituras: antes, en y después de `endsAt` (y 60 días después, con y sin sesión) → **0 escrituras, 0 RPC de
escritura**, tablas idénticas byte a byte (rating, XP, cartas, créditos, mazos, logros, pase). La única RPC
observada es `app_content_distribution_snapshot` (0039, `language sql stable`, solo SELECT, catálogo).
Sin cron, sin scheduler, sin VPS, sin funciones de cierre.

## 33. Next-season transition

La decide el servidor al resolver el calendario con su reloj: cuando exista una Temporada 2 en el calendario,
`current` pasará a ella en su `startsAt` sin que el cliente compare fechas. El contenido del pase (`CURRENT_SEASON`)
es independiente: cambiarlo sigue siendo un despliegue y seguiría archivando el pase como hoy. P2: política de
cierre (reclamos pendientes, carriles) antes de publicar la S2.

## 34. Data model/migration

**Sin 0051.** El calendario vive en código versionado (fechas absolutas ISO UTC, validado en tests y en el
verificador) porque: la temporada no necesitaba escritura en caliente, una tabla sin aplicar obligaría a un
segundo camino (código de respaldo = dos fuentes) y `public.seasons` es de Pick'ems. `loadSeasonCalendar()` es la
frontera para moverlo a base de datos cuando haga falta (P2).

## 35. Read models/API

`GET /api/game/season` → `SeasonHubSnapshot {serverNow, calendar, season, isCurrent, events, personal|null}`;
`?season=<id|slug>` (regex estricta `SEASON_KEY`, 400/404); `?scope=calendar` → `SeasonCalendarSnapshot` sin base de
datos. Parámetros desconocidos → 400 (incluido `userId`). `SeasonPersonal`: account, pass, objectives, achievements,
competitive, pickems, collection, actions, recap. Sin filas crudas.

## 36. Cache/performance

Público: `public, max-age=10, s-maxage=15`, **sin** `stale-while-revalidate` (un `serverNow` viejo desplazaría la
cuenta atrás). Con sesión: `no-store`. Lecturas en paralelo, todas con `limit`/recuento, ninguna en bucle: el
número de lecturas es fijo e independiente del volumen (test con 300 asientos extra: mismas lecturas, ≤ 60). La
cuenta atrás repinta cada 30 s (cada 1 s solo en el último día) sin red.

## 37. Security/privacy

Usuario del token (`getSession`); anónimo sin `personal`; sin email, `is_admin` ni créditos; sin respuestas de
Pick'ems; id estricto; 5xx → 503 genérico; la ruta solo exporta GET; el perfil público no recibe temporada. Tests
65–75 + verificador `season-security`. RLS y PostgREST reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS.

## 38. Rate limiting

Cubeta `season_read` (30/min) sobre la misma RPC `app_rate_take` (0036), sin migración; solo con sesión (sin
sesión la lectura es pública y no se escribe un contador por IP, misma política documentada en D-RL-1).

## 39. Telemetry

Seis contextos (`season_hub_view, season_pass_open, season_objective_open, season_ranked_open, season_event_open,
season_recap_view`) en el flujo `season`, reservado en 0046 (NO aplicada) y fuera de `FLOWS` → `trackSeason` es
no-op honesto (test).

## 40. Responsive/mobile/tablet

390: héroe apilado (título, estado, tiempo transcurrido, cuenta atrás, pase, nivel de cuenta, CTA a todo el ancho) →
acciones → pase (tiras de carril desplazables con snap natural) → objetivos (contadores 2×2) → ranked → eventos →
colección → logros → calendario (barra desplazable dentro de su panel) → resumen en una columna. 1024: héroe en dos
columnas y paneles en dos. 1440: héroe ancho con cuenta atrás a la derecha, acciones 5/12 + pase 7/12, objetivos +
ranked, eventos/colección/logros en tres. **0 desbordes horizontales** medidos en las 92 capturas (script).

## 42. Game feel/visual system

Pantalla de campaña, no de configuración: héroe con tipografía display enorme, retícula y anillos hexagonales NEXUS,
color por estado (cian en curso, oro últimos días, naranja último día, violeta próxima, gris archivo), cuenta atrás
de marcador, barra de 12 semanas, carriles como fichas con estado, tablero de acciones numerado con la primera
resaltada, resumen «TEMPORADA 1 COMPLETADA» en oro. CSS/SVG estático; sin canvas ni bucles.

## 41. Accessibility/reduced motion

Cuenta atrás `role="timer"` con frase sin segundos (sin `aria-live` por tic); estado y progreso con texto; carriles
con `aria-label` por nivel («Nivel 7: 320 créditos. Reclamable.»); glifo + palabra, no solo color; encabezados
h1/h2; `<time dateTime>` en todas las fechas; enlaces y botones de 44–64 px; `nx-focus`; flujo de teclado
capturado; decoración estática salvo un pulso `motion-safe:` (se apaga con movimiento reducido); sin bucles.

## 42. Game feel/visual system

⟨pendiente de la pasada final⟩

## 43. QA visual

`docs/product/qa/fase34/` — **92 capturas** a 1440/1024/390 de los 64 escenarios del brief (+ acciones sin eventos,
eventos no disponibles, sin temporada configurada, cartas por temporada solo en arnés), con README (escena,
estado medido, desborde, errores). **0 desbordes, 0 errores de consola propios, 0 selectores fallidos**.
Arnés `/design-system/fase34?scene=…` con calendario canónico REAL y relojes de servidor fijos (antes, en curso,
últimos 7 días, < 24 h, última hora, terminada, entre temporadas); la «Temporada 2» y la ruta «cartas por
temporada» son fixtures etiquetados en pantalla. Rutas reales (`/temporada`, `/temporadas`, `/`): sin Supabase
local la carga de `/temporada` se queda en «Leyendo la temporada…» mientras supabase-js reintenta (entorno;
ver P2). La API real se probó en el dev server: `?scope=calendar` → 200 `IN_SEASON` con `serverNow`,
`?userId=x` → 400, `?season=../x` → 400. Fallos del instrumento corregidos: fixtures de «Próximamente» y un
verificador que contaba una RPC de lectura.

## 44. Tests/gates

| gate | resultado |
|---|---|
| `npm test` | **1971 / 1971 verdes** (1870 al empezar; +101) |
| typecheck web / scripts | **0 / 0 errores** (el de scripts cazó `battlepass-verify` → corregido) |
| `next build` | **exit 0** (`/temporada`, `/temporadas`, `/temporadas/[slug]`) |
| ESLint (lo tocado) | **0 problemas** |
| `season:verify` · `-time` · `-pass` · `-security` · `-recap` | 21/0 · 4/0 · 4/0 · 4/0 · 4/0 |
| `security` · `pack` · `content` · `distribution` · `competitive` | 201/0 · 42/0 (aislado; ver 45) · 21/0 · 30/0 · 27/0 |
| `importer-vlr` · `combat` · `deck` · `social` · `replay` | 69/0 · 5/0 · 34/0 · 33/0 · 25/0 |
| `battlepass-verify` (afectado por el renombrado) | todas las comprobaciones pasan (29 ✓) |
| Postgres real (RLS, PostgREST, `app_rate_take`, e2e con cuenta) | **NO EJECUTADO — REQUIERE BD DE PRUEBAS** |

Cobertura del brief: dominio 1–24 y 57–64, 89–92 en `domain/season/season.test.ts`; pase 25–32, objetivos 33–38,
competitivo 39–44, eventos/Pick'ems 45–50, colección 51–56, seguridad 65–75, fin de temporada 76–84 y lecturas
acotadas en `server/services/season.service.test.ts` (BD en memoria que registra escrituras); UI 85–94, fuente
única, navegación, home, perfil, meta, telemetría, rate limit, caché y regresión 95–119 en
`domain/season/season.contract.test.ts`. Regresiones Meta/Progresión/Competitivo/Live Events/Pick'ems/Colección/
Deck/Match Experience/Perfil/Social: sus suites de contrato y servicio siguen verdes dentro de las 1971.

## 45. Bugs reales encontrados/corregidos

| # | bug | dónde | estado |
|---|---|---|---|
| 1 | Dos `CURRENT_SEASON` con contenido distinto (`nexus-s1` vs `s1` legado) | `data/season.ts` / `data/seasons.ts` | corregido: `LEGACY_LOCAL_SEASON` |
| 2 | Reutilizar `getProgression` en una lectura de temporada mutaría el pase (unlock + rotación) | `progression.ts` | evitado: `peekProgression` (misma vista, sin escrituras) |
| 3 | `getCompetitivePosition` crea la ficha de rating (`ensureRating`) al leer | `competitive.ts` | evitado: `readCompetitivePosition` |
| 4 | `SeasonPanel` habría mostrado «Termina en 0 min» con la temporada terminada | `SeasonPanel.tsx` | corregido: «Finalizada» |
| 5 | Rótulo «Archivo» en una temporada PRÓXIMA (`isCurrent` falso sin temporada en curso) | `SeasonHero.tsx` | corregido (QA) |
| 6 | Objetivos del hub con títulos partidos en panel estrecho (rejilla de `ObjectiveList`) | `SeasonPanels.tsx` | corregido (QA): `ObjectiveCard` en columna |
| 7 | `scripts/battlepass-verify.ts` dependía del `CURRENT_SEASON` legado | script | corregido (gate typecheck scripts) |
| 8 | Fixtures del arnés con acciones y evento en directo que el servicio no daría en «Próximamente» | `design-system/fase34/fixtures.ts` | corregido (instrumento) |
| 9 | Verificador contaba como fallo una RPC de solo lectura (`app_content_distribution_snapshot`) | `season-verify.ts` | corregido (instrumento), P0 intacto |

Falso positivo de entorno (no es bug): `pack:verify` falla su chequeo de linealidad de rendimiento con Chrome y el
dev server en paralelo (ratio 3,33); aislado pasa (ratio 1,72).

## 46. P2 reales

- **Política de cierre de temporada** (reclamos pendientes, carriles, archivo del pase) antes de publicar una S2:
  hoy se conservan los reclamos porque no hay política.
- **Cartas conseguidas por temporada**: requiere un registro inmutable de adquisiciones (hoy `obtained_at` no es
  fiable). Camino cableado tras `COLLECTION_WINDOW_RELIABLE`.
- **Calendario en base de datos** (tabla `game_seasons` + escritura de administración) cuando haga falta publicar
  temporadas sin desplegar; frontera ya aislada en `loadSeasonCalendar()`.
- Resumen de **temporadas pasadas con estado cambiante**: el nivel de cuenta y la colección actuales no se pueden
  reconstruir a una fecha; el resumen no los usa (solo hechos fechados).
- Reto privado pendiente (Fase 29) no entra en «¿qué hago ahora?» de la temporada (la home sí lo tiene vía `getLoop`,
  que escribe); añadirlo exige una lectura social sin efectos (0048 sin aplicar).
- El hub no permite reclamar en el sitio: enlaza a `/logros` (un solo camino de reclamo). Reclamar desde el hub
  sería reutilizar el mismo endpoint; no se hizo para no duplicar pantallas de reclamo.
- Tarjeta para compartir el resumen: no construida (fuera de fase).
- `/temporada` espera la foto completa (eventos + personal) antes de pintar; con la base de datos lenta o caída
  tarda lo que tarden los reintentos. Pintar primero el calendario (`?scope=calendar`, sin base de datos) y
  completar después mejoraría la carga.
- RLS, PostgREST y `app_rate_take` reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS.

## 47. Migraciones creadas/no aplicadas

Ninguna creada (no hay 0051; test). 0046 **editada solo en su lista reservada** (añade `'season'`, sigue NO
APLICADA, patrón de las Fases 29–32). 0046–0050 sin aplicar (tests 115–119). `schema_migrations` intacta.

## 48. Archivos creados/modificados

**Creados**
- `src/data/seasonCalendar.ts`
- `src/domain/season/{calendar,time,recap,actions,index}.ts` · `season.test.ts` · `season.contract.test.ts`
- `src/server/services/season.ts` · `season.service.test.ts` · `testing/fakeSupabase.ts`
- `src/app/api/game/season/route.ts`
- `src/lib/season/{client,telemetry}.ts`
- `src/components/season/{SeasonHub,SeasonHero,SeasonCountdown,SeasonPanels,SeasonActionBoard,SeasonCalendar,SeasonRecap,SeasonArchive,SeasonHomeBlock}.tsx`
- `src/app/temporada/page.tsx` · `src/app/temporadas/page.tsx` · `src/app/temporadas/[slug]/page.tsx`
- `src/app/design-system/fase34/{page.tsx,fixtures.ts}`
- `scripts/season-verify.ts` · `scripts/_fase34-visual-qa.ts`
- `docs/product/qa/fase34/` (PNG + README) · `docs/product/fase-34-season-1-live-service-2-report.md`

**Modificados**
- `src/data/seasons.ts` (`CURRENT_SEASON` → `LEGACY_LOCAL_SEASON`) · `src/store/useBattlePassStore.ts` · `scripts/battlepass-verify.ts`
- `src/server/services/progression.ts` (`composeView`/`readViewParts` + `peekProgression`; reclamos y escrituras de `getProgression` sin cambios)
- `src/server/services/competitive.ts` (+ `readCompetitivePosition`)
- `src/server/services/meta.ts` (`endsAt` del calendario) · `src/domain/progression/meta.contract.test.ts` (test reescrito a su intención)
- `src/components/progression/SeasonPanel.tsx` (terminada → «Finalizada»)
- `src/server/services/rateLimit.ts` (+ `season_read`)
- `src/design/nav.ts` (+ «Temporada») · `src/lib/telemetry/contract.ts` (`/temporada` → zona `pass`)
- `src/app/page.tsx` (bloque tras NextUp) · `src/app/jugador/[id]/page.tsx` (bloque en perfil propio)
- `supabase/migrations/0046_telemetry_flows_progression.sql` (reserva `'season'`, NO APLICADA)
- `package.json` (+ `season:verify`, `season-time:verify`, `season-pass:verify`, `season-security:verify`, `season-recap:verify`)

Sin tocar: combate, rating, liquidación, matchmaking, recompensas, sobres y RNG, colección, Deck Builder / equipo
activo, Match Experience, perfil (servicio/dominio), social, Pick'ems, Live Events (servicio), worker, importer VLR,
marketplace, 0045 y migraciones aplicadas.

---

**FASE 34 — CERRADA** (con los P2 de la sección 46; lo que requiere Postgres queda NO EJECUTADO — REQUIERE BD DE PRUEBAS).
