# EXTENSIÓN DEL SIMULADOR MULTIMAPA — análisis previo

> **Esto es un análisis, no una implementación.** No se ha tocado ni una línea del simulador en
> este bloque. Sirve para poder planificar el trabajo con números en vez de con impresiones.

## El problema en una frase

El simulador del Entrenador juega en **un solo mapa**: Ascent, y solo su zona A. No es una
limitación de datos —los doce PNG reales existen y se usan en la pizarra— sino de **motor**: la
geometría está escrita como un módulo concreto y el resto del código la importa por su nombre.

```
src/sim/map/ascentA.ts   ← «Ascent, SOLO zona A», 12 zonas en un campo de 1000×700
```

## Qué exporta hoy `ascentA`, y qué significa cada cosa

| Export | Qué es | ¿Es específico del mapa? |
|---|---|---|
| `ZoneId` | unión de 12 literales (`a_main`, `tree`, `site`, `heaven`…) | **Sí, totalmente** |
| `ZONES` | posición de cada zona | Sí |
| `ADJ` | grafo de adyacencia (pathing) | Sí |
| `WALLS` | segmentos de cobertura y línea de visión | Sí |
| `PLANT_ZONE`, `PLANT_RADIUS` | dónde se planta | Sí |
| `FIELD` | dimensiones del campo | Sí |
| `DEFENSE_HOLDS`, `ATTACK_STAGING` | zona inicial por rol | Sí |
| `nearestZone(pos)` | zona más cercana a un punto | **No** — algoritmo, no mapa |
| `route(from, to)` | camino entre zonas | **No** — BFS sobre `ADJ` |

Las dos últimas ya son genéricas: operan sobre los datos, no sobre Ascent. Se moverían tal cual.

## Quién depende de él

**24 ficheros** importan de `ascentA` directamente (medido sobre los `import`, sin contar
pruebas), en seis módulos:

| Módulo | Import directo | Qué usa |
|---|---|---|
| `src/sim` | `engine`, `combat`, `perception`, `types`, `ai/director`, `ai/behaviors`, `ai/playerBrain`, `identity/modifiers`, `index` | geometría completa |
| `src/brain` | `apply`, `evaluate`, `options`, `perceive`, `types` | `ZoneId`, `ZONES`, `nearestZone` |
| `src/tactics` | `assign`, `map`, `spatial` | `ZoneId`, `ZONES`, `nearestZone` |
| `src/utility` | `engine`, `read`, `types` | `ZoneId`, `ZONES`, `ADJ` |
| `src/abilities` | `types`, `decide`, `apply` | `ZoneId`, `ZONES` |
| `src/spatial` | `ascent` | `ZONES`, `ADJ`, `WALLS`, `FIELD` — es el adaptador |

Y dependen **de forma indirecta**, sin nombrarlo:

- a través de los carriles de `tactics/map`: `tactics/broadcast`, `opponent`, `planner`, `runner`;
- a través de `spatial/ascent`: `spatial/index`;
- a través de la reexportación de `@/sim`: la capa de VISTA —`camera/engine`, `render/svgCamera`,
  `spectator/priorities`, `spectator/types`, `visualizer/scene`—, que pinta sobre el campo
  abstracto de 1000×700;
- con nombres de zona escritos a mano pero sin import: `brain/beliefs`, `tactics/planner`,
  `tactics/types`, `tactics/opponent`, `tactics/narrative`, `sim/analysis`.

`src/sim/index.ts` **reexporta** `ZONES`, `WALLS`, `FIELD`, `PLANT_ZONE`, `PLANT_RADIUS` y
`ZoneId`, así que la superficie pública del simulador incluye hoy la geometría de Ascent.

## Lo que de verdad cuesta: los nombres de zona escritos a mano

Contando apariciones de literales de zona (`"site"`, `"heaven"`, `"a_main"`…) **fuera** del
módulo del mapa y **dentro** de los módulos del simulador (`sim`, `brain`, `tactics`, `utility`,
`abilities`, `spatial`). Fuera de ellos «mid», «site» o «plant» aparecen con otros significados
—un tramo de precio, un cue de sonido— y contarlos inflaría la cifra hasta 212 en 49 ficheros:

```
154 apariciones en 23 ficheros
(209 contando las 55 de la definición del propio mapa)
```

Repartidas así (las mayores):

| Fichero | Literales | Qué hace con ellos |
|---|---|---|
| `src/tactics/assign.ts` | 25 | reparte roles por zona concreta |
| `src/tactics/spatial.ts` | 22 | lecturas espaciales por nombre |
| `src/tactics/map.ts` | 18 | conocimiento del mapa cableado |
| `src/brain/options.ts` | 18 | opciones del jugador según dónde está |
| `src/utility/engine.ts` | 12 | dónde tiene sentido cada utilidad |
| `src/sim/ai/director.ts` | 11 | decisiones del director |

**Esto es el 80 % del trabajo.** Cambiar la firma de un módulo es mecánico; reescribir la lógica
que dice «si estás en `heaven`, ancla» para que funcione en un mapa que no tiene `heaven` es
diseño, no refactor.

## Lo que YA es agnóstico (y es más de lo que parece)

`src/spatial/` está construido a propósito para no conocer el mapa. Su propio adaptador lo dice:

> *«El Spatial Engine NO conoce este mapa: solo este archivo lo traduce. Otro mapa = otro
> adaptador, sin tocar el resto del módulo.»* — `src/spatial/ascent.ts`

Es decir: **el patrón que hace falta ya está inventado dentro del proyecto**, aplicado a un
módulo. `spatial/ascent.ts` construye un `MapDescriptor` desde `ZONES`/`ADJ`/`WALLS` y memoiza un
`SpatialMap`. Un segundo mapa solo necesitaría su propio descriptor.

También son reutilizables sin tocar: combate, percepción, economía, loadouts, narrativa,
broadcast y todo el motor de habilidades **salvo por el tipo `ZoneId`**, que los atraviesa.

## Qué habría que generalizar

1. **`ZoneId`: de unión literal a `string` con marca.** Es el cambio que más ficheros toca y el
   más mecánico. Hoy `ZoneId` es una unión cerrada de doce nombres, así que el compilador impide
   que exista un mapa con otras zonas. Pasaría a ser un identificador opaco por mapa.

2. **Un `SimMap` en vez de un módulo.** La misma forma que ya tiene `ascentA`, pero como valor:
   `{ id, field, zones, adj, walls, plant, defenseHolds, attackStaging }`. `nearestZone` y
   `route` se convierten en funciones que reciben el mapa.

3. **Sustituir los nombres por ROLES DE ZONA.** El paso de diseño. En vez de `"heaven"`, cada
   zona declara para qué sirve —`site`, `choke`, `connector`, `anchor`, `mid`, `spawn`— que es
   exactamente el vocabulario de `TAGS` que `spatial/ascent.ts` ya define. La IA dejaría de
   preguntar «¿estoy en heaven?» para preguntar «¿estoy en un anclaje del sitio?».

4. **`MatchConfig` gana `mapId`.** Hoy el mapa no se elige porque no hay nada que elegir.
   `broadcast/engine.ts:99` lo tiene fijo (`map: "Ascent", site: "A"`) y saldría de ahí.

## Qué DATOS faltan por mapa — y este es el bloqueo real

Para cada uno de los doce mapas haría falta, medido sobre el asset y no deducido:

- polígonos o centros de sus zonas, con su rol
- grafo de adyacencia
- segmentos de muro para línea de visión
- sitios de plantado y su radio
- posiciones iniciales por bando

**Nada de eso existe.** `TacticalMap.zones` es opcional y está vacío en los doce, con esta razón
escrita en el catálogo desde el principio: *«los assets no traen esa geometría y deducirla sería
redibujar el mapa»*.

Y además, hoy el simulador cubre **un sitio** (A), no un mapa entero: Ascent completo tendría
sitio B, su mid y sus rotaciones. La escala real no es «doce veces lo que hay», es «doce veces
algo bastante mayor que lo que hay».

## La frontera fuera del motor — dónde se dice «Ascent · A» hoy

Además del motor, el producto declara el mapa del simulador en cuatro sitios. Todos lo hacen a
propósito y con honestidad, y todos cambiarían el día que `MatchConfig` lleve `mapId`:

| Sitio | Qué hace | Qué pasaría con multimapa |
|---|---|---|
| `src/broadcast/engine.ts:99` | `map: "Ascent", site: "A"` fijos en la retransmisión | leer `config.mapId` |
| `src/lib/match/history.ts` | `SIM_MAP_ID = "ascent"`, `SIM_MAP_SITE = "A"` al registrar el partido | leer `config.mapId` / sitio jugado |
| `src/components/coach/TrainerPortal.tsx` | `MAPA_DEL_SIM = "ascent"` como fondo de la entrada | el mapa elegido |
| `coach_matches.map_id` / `map_site` | se guardan **por fila**, no como constante | nada: el historial antiguo sigue diciendo dónde se jugó |

**La calibración que falta además de la geometría.** El campo del simulador es un sistema de
coordenadas abstracto (1000×700) que no corresponde píxel a píxel con `ascent.png`. Pintar el
partido en vivo sobre el PNG real exige una transformación **medida** por mapa —tres puntos de
referencia bastan para una afín—, y hoy no existe ni para Ascent. Deducirla sería inventar la
correspondencia, que es lo que se ha evitado en todos los bloques.

**La red de seguridad para la fase 1.** Ninguna prueba unitaria usa nombres de zona propios de
Ascent (solo tres usan `"site"`), pero el motor es determinista por semilla y ya hay pruebas que
juegan partidos completos (`src/match/engine.test.ts`, `src/lib/match/history.test.ts`). Antes
de tocar nada: grabar el resultado de N semillas —marcador, ronda a ronda, eventos— y exigir que
tras el refactor mecánico salga idéntico. Si la fase 1 cambia un solo marcador, no era mecánica.

## Coste, por fases

| Fase | Trabajo | Naturaleza |
|---|---|---|
| 1 | `ZoneId` opaco + `SimMap` como valor + `nearestZone`/`route` parametrizados | mecánico, ~24 ficheros |
| 2 | Sustituir los 154 literales por roles de zona | **diseño de IA**, el grueso |
| 3 | `mapId` en `MatchConfig` y en el broadcast | pequeño |
| 4 | Levantar la geometría de un segundo mapa | **datos**, no código |
| 5 | Repetir la fase 4 doce veces | datos |

La fase 2 es la que decide si el proyecto es viable: mientras la IA razone con nombres propios,
cada mapa nuevo es un motor nuevo.

## Recomendación

Hacer las fases 1 y 3 **antes** de necesitar el segundo mapa: son mecánicas, no cambian ningún
comportamiento y se pueden verificar comprobando que el partido en Ascent sigue dando exactamente
los mismos resultados con la misma semilla. Dejan el motor listo sin arriesgar nada.

La fase 2 merece su propio bloque, con un mapa de prueba —aunque sea Ascent partido en dos
sitios— para poder afirmar que la IA razona por roles y no por nombres.

La fase 4 no es trabajo de programación: es levantar geometría sobre los assets. Hasta que
exista, **el simulador sigue siendo Ascent · sitio A, y así se dice en pantalla y en la base de
datos** (`coach_matches.map_id` / `map_site`), en vez de fingir doce mapas.
