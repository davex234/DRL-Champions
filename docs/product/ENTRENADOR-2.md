# ENTRENADOR 2.0

> Estado: **PARCIAL** — las fases 0-18 y 23-31 entregadas y verificadas; 19, 20 y 21 **no**.
> P0 = 0 · P1 = 0 en lo entregado. Sin commit, sin push, sin deploy.
>
> **Continúa en [`ENTRENADOR-2-CIERRE.md`](ENTRENADOR-2-CIERRE.md)**, que cierra la 19 (partidos
> jugados) y la 20 (carrera). La 21 (Duelos) sigue fuera, por encargo.

## El bug real

**El usuario elegía bando.** `MatchSetup` pintaba dos píldoras —Ataque / Defensa— y el jugador
se quedaba con la que prefería. No es una opción de interfaz: atacar y defender no valen lo
mismo con la misma composición, así que elegir era llevarse media ventaja antes de empezar.

Ahora sale a cara o cruz. `drawSide` vive en `src/lib/match/sideDraw.ts`, es puro, recibe el
generador por parámetro —para poder probarlo— y corta exactamente en 0,5. La pantalla lo dice
**antes** del sorteo, no lo justifica después. La revancha vuelve a sortear: repetir el lado
anterior habría devuelto la elección por la puerta de atrás, bastando con perder.

## El orden, que era el problema de fondo

Nada de esto estaba roto. Estaba en el orden equivocado.

| Antes | Ahora |
|---|---|
| `/entrenador`: cabecera → 4 pasos → equipo → 12 mapas → 6 tarjetas iguales | `TrainerPortal` ocupa la primera pantalla; el método y las herramientas, debajo |
| Sala táctica: CTA en la línea 230 de un panel de 382 | orden anclada al pie del escenario |
| Compra: CTA en la línea 91 de 97 | ídem |
| Fin de ronda: resultado → causas → briefing → botón | resultado arriba, botón anclado, análisis debajo |
| Partido: `aspect-video` dentro de `main` con paneles colgando | `ImmersiveStage` a viewport completo |

Medido en Chrome real a 1440×900: la entrada mide **392 px** frente a **58 px** de una
herramienta y **153 px** de las seis juntas. Las acciones principales están a `top 0px` en la
home y a `top 839px` en un viewport de 900 dentro del partido — siempre dentro, nunca
buscándolas.

## `ImmersiveStage`

Dos inmersiones, y la separación es deliberada.

**Fullscreen-like (siempre).** Rompe el ancho y el relleno del `main` con `100vw` y márgenes
negativos calculados en CSS, y fija `height: calc(100svh - 64px)`. **Altura fija, no mínima**:
con `min-height` el escenario crecía con su contenido —la sala táctica llegó a medir 1.813 px—
el `overflow-y-auto` interno no se activaba nunca y la barra de acción acababa otra vez fuera
de la pantalla.

**Fullscreen real (si el navegador quiere).** Un control con la Fullscreen API. Si no existe o
la deniegan, el botón no se enseña y la inmersión de CSS sigue en pie. Un modo que solo se
siente bien en fullscreen real se siente mal en medio internet.

`GameShell` deja de inyectar el banner de instalación en `/entrenador/partido`, como ya hacía
con `/duelos`.

## Los números

Tres arriba, y se justifican solos: **ronda** (dónde estás), **marcador** (el único a tamaño de
titular, porque es la pregunta que el entrenador se hace cada treinta segundos) y **lado**
(cambia el significado de todo lo demás). Créditos, bajas, ADR, momentum y velocidad siguen
existiendo en sus paneles; han dejado de competir.

Se quitó el marcador **duplicado** del deck de control, que repetía ronda y tanteo cinco
centímetros por debajo de la franja.

**Defecto propio, encontrado en el QA visual:** la franja marcaba 0–0 mientras el titular del
fin de ronda decía 0–1. `match.score` aún no ha sumado la ronda cuando `roundEnd.score` sí. Se
corrigió dando prioridad al de `roundEnd` en esa fase.

## La pizarra: agentes y habilidades REALES

Los agentes salen de `src/agents/catalog.ts` — **Veil, Haze, Probe, Pulse, Spear, Blitz,
Warden, Tripwire, Specter, Echo**: el roster propio de NEXUS, que su primera línea declara
como «NO copia de Valorant». Las habilidades salen de `abilitiesFor(agent)`, que las deriva del
kit del agente contra `src/abilities/catalog.ts` — la **misma función que usa el motor** para
decidir en partida. El agente número once aparecerá sin tocar la interfaz.

`PlayerToken` gana `agentId` y `UtilityToken` gana `abilityId` + `ownerId`, los tres
**opcionales**: una jugada dibujada antes de esto se abre sin perder nada, y quitar el agente
devuelve la ficha byte a byte a como estaba.

**La validación está en la puerta, no en la pantalla.** `sanitizeStrat` comprueba los dos
identificadores contra los catálogos reales: lo que no existe, no se guarda. Un `agentId`
inventado dejaría fichas apuntando a nada y la pizarra tendría que decidir qué pintar en su
lugar — que es exactamente el hueco que se rellena inventando.

### El puente entre dos vocabularios

El motor modela mecánicas (`smoke | flash | molly | recon | cover`); la pizarra dibuja
intenciones (nueve marcas, con spike, punto de ruta y marcador, que no son habilidades de
nadie). Cuatro coinciden literalmente. `cover` se dibuja como `wall`, que es la marca que
significa «aquí se tapa el paso». Es una equivalencia **declarada** en una tabla con nombre
(`KIND_DEL_MOTOR`), no una deducción repartida por el código.

## MISSING — lo que no existe y no se ha inventado

**1 · Geometría de zonas de los doce assets.** `TacticalMap.zones` es opcional y está vacío en
los doce, documentado en su día como *«deducirla sería redibujar el mapa»*.

**2 · Mapas del simulador distintos de Ascent A.** El sim corre sobre `src/sim/map/ascentA.ts`
—*«Ascent, SOLO zona A»*, doce zonas en 1000×700— y lo importan `engine`, `combat`,
`playerBrain` y `director`; `broadcast/engine.ts:99` tiene `map: "Ascent", site: "A"` fijo.
Añadir mapas es tocar el motor, que este encargo prohíbe.

> **Consecuencia, dicha claramente:** no se puede superponer el partido en vivo sobre el PNG
> real sin inventar la correspondencia de coordenadas, que es literalmente lo que la fase 9
> prohíbe. Los mapas reales se usan donde el mapa **es** el mapa —pizarra, `/entrenador/mapas`,
> el fondo del portal— y el campo del partido sigue siendo la geometría que el simulador
> realmente simula, rotulada con su nombre honesto: **Ascent**.

**3 · Slot de ultimate.** `Ability` tiene cargas, recuperación y duración; no tiene definitiva.
La pizarra lo dice en pantalla, y un test lo fija para que el texto no acabe mintiendo.

**4 · Historial de partidos.** `useCareerStore` persiste desarrollo, no partidos. «Partidos
jugados» sigue declarado como pendiente, no disimulado.

## Lo que NO se ha hecho

- **Fase 19 · Partidos jugados** — sin fuente de datos (ver MISSING 4). Requiere persistir el
  `MatchState` al terminar; es real y no está inventado, pero es trabajo aparte.
- **Fase 20 · Carrera** — sin tocar.
- **Fase 21 · Duelos, game feel** — sin tocar. La auditoría encontró que la **fase 22 ya estaba
  cumplida**: `/duelos/jugar` tiene su propia `Arena` a `min-h-screen`, con zonas seguras de
  móvil y `MotionConfig reducedMotion="user"` global (900/900 px, sin scroll). Forzarle
  `ImmersiveStage` habría sido la segunda arquitectura de duelo que el encargo prohíbe.

## Verificación

```
npm run trainer:verify                                  # 35/35
E2E_BASE_URL=http://127.0.0.1:3005 npm run strats:verify  # PASA
npm test                                                # 801/801 (14 nuevos)
npm run security:verify                                 # PASA
E2E_BASE_URL=http://127.0.0.1:3005 npm run ux:verify      # PASA
typecheck · build                                       # limpios
npx tsx scripts/_qa-trainer2.ts                         # 29/29 (Chrome real)
```

QA visual en `docs/product/qa/entrenador2/`: home, preparación con el sorteo, sala táctica,
compra, ronda en vivo, fin de ronda, pizarra con agentes y home a 390 px.
