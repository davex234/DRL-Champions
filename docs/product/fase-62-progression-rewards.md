# FASE 62 — PROGRESSION & REWARDS 5.0

Fecha: 2026-09-25 · Rama `arch/stabilization` · sin commit, sin push, sin deploy · **0 migraciones**.
Evidencia: `docs/product/qa/fase62-progression/` (JSON, `live/`, `screenshots/{before,after,after-profile,harness,live}`).

**En una frase:** NEXUS ya tenía casi toda la progresión (dos XP, pase de temporada, misiones diarias/semanales con
rotación pura, logros, historial, delta post-partida), pero repartida en siete pantallas y con el reclamo escondido en
`/logros`. La QA lo midió en una cuenta real: 14 duelos jugados, **nivel 0 de temporada y 4 objetivos completos sin
recoger**. F62 junta todo en un hub de juego, deja reclamar donde se ve (hub y resultado), pone el progreso en la
secuencia del resultado de F61 y en la portada, y arregla un problema de concurrencia real en los reclamos.
**No añade ninguna fuente nueva de créditos, sobres ni cartas.**

---

## 1. Baseline (antes de editar)

5180/5180 tests · 331 cartas · 29 agentes · migración head `0057` · marketplace OFF · pagos OFF · :3005 = build F61
(PID verificado) · túnel abierto · F61 y CMS intactos. Recompensas: `award()` → `app_grant_reward` (única vía, clave
`ref` única). Temporada: `SEASON_CALENDAR` + pase de 30 niveles. Objetivos: misiones del pase. `baseline.json`.

## 2. Sistemas encontrados (reales)

| Sistema | Fuente | Cómo progresa | Recompensa | Reclamo |
|---|---|---|---|---|
| Nivel de cuenta | `profiles.xp` | **XP de cuenta**: duelos, sobres, Pick'ems | ninguna por nivel | — |
| Temporada (pase) | `user_pass.state.xp` | **XP de temporada**: SOLO al reclamar misiones | carril libre (créditos, sobre cada 5), competitivo (Oro), de pago (cosmético, no se vende) | manual |
| Objetivos | misiones del pase | métricas del servidor; diaria ×3, semanal ×2, temporada, hitos; ventanas UTC | créditos/sobres + XP de temporada | manual |
| Logros | `ACHIEVEMENTS` (7) | colección y sobres, evaluados en servidor | créditos | manual |
| Colección | `user_cards` | cartas únicas del catálogo | vía logros e hitos del pase | — |
| Competitivo | `duel_pvp_ratings` | Elo + escalera (F55) | ninguna | — |
| Campaña / Draft / Coach | propios | nodos / runs / partidas | campaña: créditos 1ª victoria (auto); draft y coach: ninguna | — |
| Historial | `credit_transactions` | — | — | — |

Sin rachas, sin desbloqueos por nivel y sin cuenta atrás inventada (la temporada tiene fecha real desde F34).

## 3. Eliminados / unificados

No se borra ningún sistema. Se **unifica la experiencia**: `/progresion` es el HUB CENTRAL (una lectura: `GET /api/game/meta`)
y reclama con los mismos tres reclamos del servidor. `/temporada` (F52), `/logros` y `/recompensas` siguen como detalle.
Una sola representación de recompensas (`RewardDisplay`) para hub, resultado, reclamos y portada.

## 4. Progression map

`progression-map.json`. Resumen: **jugar** → XP de cuenta (+ créditos) y avance de objetivos → **reclamar objetivo** →
créditos/sobres + **XP de temporada** → **nivel de temporada** → **reclamar nivel** del carril → siguiente nivel.
Coleccionar → únicas/331 → logros e hitos. Ranked → rating y puesto (aparte).

## 5. Account level

Cabecera del hub: medalla cian, «X / Y **XP de cuenta**», barra con `role="progressbar"`, «Faltan N para el nivel L+1»
y de dónde sale. Sin tope (curva creciente): se muestra correctamente sin barra rota. **Sin recompensa por nivel**
(decisión documentada: sería un grifo nuevo que duplica el carril; pin «7» de F27 lo fija).

## 6. XP

Dos XP con nombre propio en TODA la interfaz: **XP de cuenta** (cian) y **XP de temporada** (oro). Corregido donde se
mezclaban: la guía «Cómo se progresa» decía que las misiones daban «XP», el resultado decía «Experiencia» y el perfil
«XP» a secas.

## 7. Level up

`LevelUpBanner` enseña **«Nivel 7 → Nivel 8»** (de → a), «nivel de cuenta», se cierra con «Seguir», y con movimiento
reducido es un fundido. Aparece en el resultado cuando el servidor sube el nivel (delta de dos lecturas).

## 8. Season

Cabecera del hub: nivel de temporada / 30, XP de temporada, días restantes del calendario real, y cómo se gana. `/temporada`
(F52) sigue como pantalla completa.

## 9. Season track

Ventana de 7 niveles alrededor del actual (`trackWindow`): **Recogido · Reclamable · Siguiente · Bloqueado**, recompensas
reales (arte del sobre, créditos), «+N» ocultos a cada lado y «Siguiente recompensa en el nivel N». Al nivel 30:
«Temporada completada» (sin siguiente inexistente).

## 10. Objectives

Tarjetas por grupo (Hoy / Esta semana / Temporada / Hitos): progreso / meta, barra, recompensa real, estado (Completado,
En progreso, Recogido, Caducado) y un acceso real a la pantalla que lo mueve (Jugar, Ir a sobres, Predecir, Mis equipos).

## 11. Daily · 12. Weekly

Existían y pasan al centro: 3 diarias y 2 semanales por ventana UTC del servidor, **«Renueva en X»** calculado desde
`serverNow` (el reloj local solo cuenta el tiempo transcurrido; cambiarlo no mueve la fecha). Las tandas caducadas no se
ofrecen para reclamar. Sin FOMO añadido.

## 13. Challenges

«Desafíos» son las misiones del pase (no hay otro sistema): mismo modelo.

## 14. Achievements

Los 7 existentes (colección y sobres) se integran: tarjeta en el hub (x/7, listos para reclamar, el más cercano con
barra), reclamo desde el hub y aviso «listo» tras la partida. **No se añaden logros**: los 7 con sus recompensas están
congelados (pin «60», economía F57.6); logros de partidas/competitivo/draft darían créditos nuevos o requerirían guardar
fechas (migración). Queda documentado como siguiente paso posible.

## 15. Collection progression

«24 / 331 cartas únicas del catálogo · 25 ejemplares» en hub y vestíbulo. Definición: **carta** = `card_id` del catálogo
vigente (cada edición es una carta: 331); **ejemplar** = fila de `user_cards`. Ids fuera del catálogo no cuentan. Marcas
10/50/100/150/250/331 sin premio propio.

## 16. Competitive progression

Tarjeta aparte en el hub: rating, puesto de la escalera, partidas, «provisional». Nunca mezclado con el nivel de cuenta.
F55 intacta.

## 17. Post-match integration

`ResultScreen` gana el hueco **`progress`** justo después de las recompensas: RESULTADO → RECOMPENSAS → **CUENTA** (nivel,
XP antes → después) → **OBJETIVOS** («14 → 15 / 25», «OBJETIVO COMPLETADO» + **Reclamar** ahí mismo) → **TEMPORADA** (solo
si cambió, releída del servidor) → **LOGROS** listos. Solo las secciones que cambiaron (`postMatchSections`). Real:
`live/result-progress.png` (+25 XP de cuenta, 14→15/25, antes de las acciones).

## 18. Reward types

`reward-types.json`: créditos, XP de cuenta, sobre, carta, cosmético, puntos (libro mayor) y XP de temporada (pase).
`materials` no tiene entrega: se marca, no se pinta.

## 19. Reward reveal

`RewardReveal` por niveles: **minor** (tira abajo, 2,4 s), **standard** (tira con énfasis), **major** (tarjeta centrada con
pausa: carta, ≥ 2 sobres o ≥ 2.000 créditos). Con sobre: **«Abrir sobre»** → `/abrir/<id>` (ceremonia F57, sin apertura
paralela). Reducido: fundidos.

## 20. Credits · 21. Packs · 22. Cards

Siempre por `award()` → libro mayor con `ref` idempotente; nada se concede en cliente. Sobres con su arte real y al
inventario real; cartas con `CardArt` y como ejemplar real (sin auto-salvage: no existe y no se inventa). Fórmulas intactas.

## 23. Claims

Semántica intacta: **reclamo manual**, autoridad del servidor. Nuevo: se puede reclamar en el hub (uno a uno o **«Reclamar
todo»**, que encadena misiones → niveles que esas misiones abren → logros, hasta 3 rondas) y en el resultado.

## 24. Idempotence

Mismo reclamo ×10 → 1 pago; partida pagada ×10 → 1 concesión; 5 lecturas → 0 escrituras; BD real: **0 claves
duplicadas** tras doble clic, reintentos y dos «Reclamar todo». `idempotence.json`.

## 25. Concurrency

**Encontrado en la QA real:** doble clic en «Reclamar todo» → dos tandas → conflicto optimista del pase: el pago ya
estaba hecho (idempotente) pero la XP de temporada no se guardaba hasta volver a pulsar. **Arreglado** en servidor
(`withPassRetry`: reintenta el reclamo entero, misma clave) y en cliente (una tanda a la vez, botón bloqueado toda la
cadena). Test: dos pestañas a la vez → todo reclamado en una ronda y XP exacta. Las sumas de XP son atómicas en la RPC
(`xp = xp + p_xp`). `concurrency.json`.

## 26. Server authority · 27. Replay safety

El cliente solo envía ids; la ruta no lee cantidades, XP ni «completado» (test). Reclamos falsificados → sin pago ni XP
(test). Cada concesión tiene identidad (`ref`); reprocesar no duplica. No hace falta un «procesador de eventos» nuevo:
el progreso de misiones se DERIVA de métricas del servidor (sin contadores que puedan contar dos veces) y cada pago
tiene su clave. `security.json`.

## 28. Home

Bloque **«Tu progreso»** bajo el menú (con sesión): recompensas por reclamar o el objetivo más cercano con su acceso
(p. ej. «Juega 25 duelos 15/25 · Jugar»), y el nivel de temporada con la siguiente recompensa. Usa la foto del vestíbulo
que ya se cargaba: **cero peticiones nuevas**. Sin sesión, el lema de siempre.

## 29. Profile

Nivel de cuenta con su XP nombrada, logros y temporada ranked (F56). El pase no viaja al perfil (contrato F34/F56).
**Arreglado** un desbordamiento real de 9 px a 390 px (rejillas sin `min-w-0`).

## 30. Admin integration · 31. Progression Health

No hay CMS de misiones (contenido en código): F62 no crea un segundo CMS. `/admin/system` gana la luz **«Progresión y
recompensas»** (`progressionHealth`): temporada activa enlazada al pase, recompensas de carril/misiones/logros
entregables (`validateReward`: tipo desconocido, sobre/carta inexistente, negativo, decimal, sin entrega), métricas que
el servidor sabe medir. Admin no gana ninguna vía de concesión.

## 32. Economic impact

`economy-impact.json`: **0 fuentes nuevas**. Techo recurrente diario = 850 (misiones) + 7.000 (duelos al tope) + 471
(semanales) + 488 (carril) = **8.810 créditos/día ≤ 11.150** (techo F41). Lo que sube es la tasa de cobro REAL hacia ese
techo (el simulador de F41 ya suponía cobro completo). Sobre Estándar = 1.000.

## 33. New-player state

Cuenta nueva: foto válida sin NaN, barras en [0,1], temporada 0/30, colección 0/331, **nada que reclamar** (test y captura
`harness/fase62-hub-new-*`).

## 34. Existing-player compatibility

Sin migración ni reinterpretación: mismos datos, mismos reclamos, mismas claves. Una cuenta con progreso previo mantiene
nivel, XP y reclamos (test). La cuenta QA real pasó de nivel 0 a 2 de temporada reclamando lo que ya había ganado.

## 35. Desktop · 36. Tablet · 37. Mobile

1440 / 1024 / 390: hub, temporada, perfil, portada y resultado sin desbordes; a 390 el hub apila cuenta y temporada,
reclamar y objetivos en una columna; el aviso de recompensa va por encima de la barra inferior.

## 38. Reduced motion

Subida de nivel, revelación y reclamables se leen igual sin movimiento (fundidos; sin brillos en bucle). QA real hecha
con `reduce` (lo que ve el usuario en su PC).

## 39. Performance

Hub = 1 petición (`/api/game/meta`); portada = 0 nuevas; el historial no carga arte de cartas. Sin animaciones infinitas
de sombra (una se quitó por el test de rendimiento de F44).

## 40. DB/schema changes · 41. Migration required: **NO** · 42. Production DB modified: **NO** (esquema)

Solo escrituras de juego normales de la **cuenta QA** (partida, reclamos) por las rutas existentes.

## 43. Cards: **331** · 44. Agents: **29** · 45. Marketplace: **OFF** · 46. Payments: **OFF**

## 47. F61 regression

Suite F61 en verde; el resultado solo gana el hueco `progress` y la etiqueta «XP de cuenta». Partida real completa sin
incidencias.

## 48. QA account actions (QA-1ff2c0ef, no la del usuario)

1 partida PvE real (derrota: +40 créditos, +25 XP de cuenta), 1 partida iniciada por el instrumento y abandonada (sin
pago), reclamos: 4 misiones (4.550 créditos, 2.900 XP de temporada), niveles 1 y 2 del carril (530 créditos). Verificado en
BD (`live/db-verify.txt`): 7 asientos, **0 duplicados**, pase 2.900 XP y niveles [1, 2].

## 49. My account modified: **NO**

## 50. Tests before / after

**5180 → 5208**, 0 fallos (+28 en `f62.progression.test.tsx`). Pins reescritos por decisión F62 (no debilitados):
«/progresion solo lectura» → «no concede XP y reclama SOLO por los reclamos existentes»; orden de secciones del hub
(ahora `ProgressionHub`); hueco post-partida (`progress`, antes de las acciones).

## 51. tsc web — OK · 52. tsc scripts — OK · 53. lint — 0 errores, 27 avisos (base) · 54. build — exit 0

## 55. :3005 — build final F62, HTTP 200 (PID verificado antes de cada parada) · 56. tunnel — abierto

## 57. Limitations

- Logros de partidas/competitivo/draft/coach: no añadidos (economía congelada; requerirían decisión y quizá migración).
- Temporada 2 / cierre del pase: sin política definida (F34); el hub muestra el estado real, no inventa el cierre.
- Portada: 3 × 404 del vídeo de fondo pendiente de F46 (previo).
- El reclamo en el resultado no se pudo ejercitar en real (la partida de QA no completó ningún objetivo): cubierto por
  tests de servicio + arnés.
- `RewardVisual` (F52) sigue en `/temporada` con la misma lógica de arte; unificarlo del todo tocaría pins de F52.

## 58. Files

Modificados: `server/services/{meta,progression}.ts`, `server/admin/overview.ts`, `components/progression/{PostMatchProgress,
ProgressAlerts}.tsx`, `app/progresion/page.tsx`, `components/duel/ResultScreen.tsx`, `app/duelos/jugar/page.tsx`,
`components/home/MainMenu.tsx`, `components/player/{PlayerIdentityView,PlayerHero}.tsx`, `domain/progression/xpSources.ts`,
`app/game-experience.css`; tests `domain/progression/{xpSources.test,meta.contract.test}.ts`.
Nuevos: `domain/rewards/display.ts`, `domain/progression/{hub,health}.ts`, `domain/progression/f62.progression.test.tsx`,
`components/rewards/{RewardDisplay,RewardReveal}.tsx`, `components/progression/hub/ProgressionHub.tsx`,
`lib/progression/claims.ts`, `components/home/ProgressDock.tsx`, arnés `app/design-system/fase62/{page.tsx,snapshot.json}`,
instrumentos `scripts/_fase62-{live,economy,evidence,memprobe}.ts`, este informe y `docs/product/qa/fase62-progression/**`.

## 59. GO

**GO.** Tras una partida se ve qué se ganó, qué progresó y cuánto, qué se completó (y se reclama ahí), qué falta y qué
hacer después; fuera de la partida, `/progresion` responde progreso general, temporada, objetivos, logros y recompensas.
Todo del servidor, idempotente, sin fuentes nuevas, sin datos falsos, con una concurrencia real encontrada y cerrada.

FASE 62 — CERRADA
