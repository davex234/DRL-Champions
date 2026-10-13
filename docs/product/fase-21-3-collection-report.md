# FASE 21.3 — COLECCIÓN / INVENTARIO DE CARTAS

**Estado: entregado sobre el sistema existente.** NEXUS ya tenía una colección madura; la Fase
21.3 la **reutiliza** y añade el hueco real —explorar la colección **por equipo**— sin duplicar
datos, mint, seriales ni sistema de inventario. `npm test` 926/926, typecheck, build y verifiers
en verde. Validación real en navegador incluida.

## Objetivo
Convertir las cartas obtenidas de los sobres en una experiencia de colección completa, sobre el
sistema que YA existe, y cerrar la exploración por equipo.

## Estado previo (lo que YA existía — no se reescribió)
Auditado y reutilizado tal cual (fronteras fijadas en la Fase 11):
- **`/coleccion`** — el ÁLBUM: las 772 cartas, tengas o no cada una. Buscador (jugador/equipo),
  ownership (Todas/Tengo/Faltan), orden (Rareza/OVR/A-Z), filtros por rareza/región/grupo,
  **progreso 10/772 · 1%** desde el catálogo real, y detalle con `CardViewer` (serial, valor,
  stats, accolades, owned/count). Motor `CollectionEngine` como fuente única de filtro/orden.
- **`/inventario`** — lo que POSEES y no has resuelto: sobres sin abrir y duplicados (desguace).
- **`/colecciones`** — sets con progreso y recompensa.
- **`/mercado`** — mercado.
- Datos: `useGameStore.ownedCards` (sincronizado del servidor: `user_cards`/`card_mints`),
  `CARDS`, `getPlayer`, `getVariant`, `instanceValue`. `OwnedCard` = uid, cardId, serial,
  obtainedAt, mintedVersion.

**Conclusión:** el álbum ya cubre §2–§7, §11–§13, §16 y §24. El hueco claro era **§8 (por equipo)**.

## Qué se ha añadido (el hueco)
Una sub-ruta **`/coleccion/equipos`** que explora la colección agrupada por equipo, reutilizando
todo:
- **Lista de equipos** con el progreso del usuario (obtenidas/total, barra), logo (`TeamLogo`).
- **Detalle de un equipo:** sus cartas poseídas en rejilla (`PlayerCard`/`CardVisual`/`Card3D`),
  con buscador de jugador, orden (Rareza/OVR/Valor/Reciente), duplicados (×N), serial y valor
  reales, y acceso al **detalle** (`CardViewer` existente).
- Enlace **«Por equipo →»** desde el álbum principal.

Team Heretics es **un equipo más**: el grupo es el valor real de `Player.team` (como maestría y
logros), sin ningún `if team === …`.

## Rutas
| ruta | rol |
|---|---|
| `/coleccion` | álbum (existente) — +enlace «Por equipo →» |
| `/coleccion/equipos` | **nueva** — colección por equipo |
| `/inventario`, `/colecciones`, `/mercado` | sin cambios (fronteras respetadas, §17) |

## Componentes
| fichero | rol |
|---|---|
| `src/domain/collections/teamCollection.ts` | **nuevo** — proyección pura por equipo (agrupa/cuenta; no recalcula OVR/valor, no acuña) |
| `src/domain/collections/teamCollection.test.ts` | **nuevo** — 7 tests |
| `src/components/collection/TeamCollection.tsx` | **nuevo** — lista + detalle de equipo + visor |
| `src/app/coleccion/equipos/page.tsx` | **nueva** ruta |
| `src/app/coleccion/page.tsx` | +enlace «Por equipo →» (1 bloque) |

Reutiliza `CardViewer`, `PlayerCard`, `CardVisual`, `Card3D`, `TeamLogo`, `Meter`, `Segmented`,
`Badge`, `teamIdentities`, `instanceValue`. Sin framework visual nuevo.

## Fuente de datos
`useGameStore.ownedCards` (cartas reales del usuario, del servidor) + `CARDS` (catálogo, para el
denominador real) + `teamIdentities` (etiqueta/tag/región) + `instanceValue` (valor del dominio).
**No** hay segunda tabla de inventario, ni segundo mint/serial, ni recálculo de OVR/valor. El
grupo es `Player.team` (el mismo que usa el resto de NEXUS).

## Filtros / búsqueda / ordenación
- **Álbum (existente):** buscador jugador/equipo, ownership Todas/Tengo/Faltan, rareza/región/grupo,
  orden Rareza/OVR/A-Z.
- **Por equipo (nuevo):** buscador de jugador (cliente, sin petición por tecla), orden
  Rareza/OVR/Valor/Reciente (§5, solo sobre datos existentes: rank, ovr, `instanceValue`,
  `obtainedAt`). La ordenación no altera nada persistido.

## Progreso de colección
Álbum: **conseguidas / 772 · %** (denominador del catálogo real, `distinct` sin contar dos veces
una carta con varias copias). Por equipo: **ownedDistinct / total** y **%** por equipo, con
`total` derivado del catálogo (`teamTotals()`), nunca inventado.

## Detalle de carta
`CardViewer` existente: artwork (real por `uid`, o dibujado por capas de fallback), jugador,
equipo, región, rol, rareza, OVR, estadísticas, **serial real** (`#N/limit` solo si la variante es
serializada; nunca inventado), **valor** (`instanceValue`, fórmula del dominio), estado owned/count.

## Serial / Valor
El serial es el del ejemplar real (variante serializada → `#N/serialLimit`; si no, no se muestra).
El valor sale de `instanceValue(def, serial)` del dominio; **no se recalcula en frontend**.

## Team Heretics
Funciona como cualquier equipo (test + código: agrupación por `Player.team`, etiqueta de
`teamIdentities`). Si el usuario posee cartas de Heretics, aparece su mosaico con progreso; si no,
no aparece (y el estado vacío global lo cubre el componente `Empty`). Sin lógica especial.

## Cartas RETIRED / versiones (§14-§15)
No se toca el ciclo de vida de cartas. Una carta poseída se resuelve por su `cardId` del catálogo
(igual que el álbum); el `mintedVersion` del ejemplar se conserva en `OwnedCard` y el artwork lo
resuelve `CardVisual` por `uid`. No se sustituye silenciosamente ninguna versión ni se altera el
lifecycle.

## Responsive
Rejillas `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` (equipos) y adaptativas (cartas), cabeceras
`flex-wrap`, buscador y orden apilables, gutter lateral constante. Verificado a 1440; sin overflow
horizontal.

## Seguridad (§24)
El usuario solo ve SUS cartas: la colección se lee de `ownedCards` del store, sincronizado del
servidor bajo su sesión/RLS existentes. La nueva capa **no añade endpoints**; es presentación pura
sobre el estado ya autorizado. No se confía en IDs del cliente para acceder a inventarios ajenos.

## Rendimiento
Sin N+1: `buildTeamCollection` recorre `ownedCards` + `CARDS` una vez (memoizado), sin petición por
carta/filtro. La búsqueda es cliente. El artwork lo cachea `CardVisual` existente.

## Tests
- **Nuevos (7):** `teamCollection.test.ts` — totales del catálogo, solo equipos con cartas,
  Team Heretics como uno más, duplicados fiables + serial/valor del ejemplar real, estado vacío,
  no se generan cartas, ordenaciones.
- **Suite:** `npm test` **926/926** ✅ · typecheck ✅ · build ✅ (`/coleccion/equipos` registrada)
  · `security:verify` ✅ · `pack:verify` ✅ · `content:verify` ✅ · `distribution:verify` ✅ (30/0).
- Ningún test existente modificado para forzar verde.

## Validación real (navegador, `next start`)
Con la colección **real persistida** (cartas obtenidas al abrir un sobre en la Fase 21.2):
1. `/coleccion` → «MI ÁLBUM», progreso **10 / 772 · 1%**, buscador, filtros, orden, cartas reales
   (ALFAJER 83 EMEA Winner **#1/500**, VEQAJ 88 Oro, COMEBACK, EXIT…). ✅
2. Enlace **«Por equipo →»** → `/coleccion/equipos`: «8 equipos · 10 cartas distintas», mosaicos
   con progreso (FNC 2/8, Fnatic 1/25, NAVI 2/16, EDward Gaming 1/21, FUT 1/10…). ✅
3. Entrar en **NAVI** → «2 / 16 · 13%», buscador + orden, sus 2 cartas reales (COMEBACK 72,
   EXIT 70, Bronce, 🪙100). ✅
4. Abrir **COMEBACK** → `CardViewer`: OVR 72, Bronce, stats, EQUIPO NAVI, rol Flex, región. ✅
5. **Apertura → colección:** las cartas del sobre (ALFAJER/COMEBACK/EXIT…) aparecen en el álbum y
   en su equipo. ✅
Etiquetas por equipo corregidas: «FNC» y «Fnatic» se muestran como valores distintos (no una
etiqueta duplicada), coherente con maestría/logros. Capturas en el scratchpad.

## P2 reales restantes
- **«Nueva» por instancia (§10):** el store no persiste un flag `isNew` por ejemplar (solo existe
  en el instante de la apertura). Los **duplicados sí** son fiables (`count>1`, mostrado como ×N).
  «Nueva» no se inventa; sería un dato del backend por-instancia — **P2**, no se modifica la
  economía para conseguirlo.
- **Orden por «reciente/valor» en el ÁLBUM:** el álbum es por-definición (una casilla por carta);
  reciente/valor son por-instancia y encajan en la vista por equipo (donde sí se añadieron) y en
  `/inventario`. No se forzó en el álbum para no tocar su motor.
- **Rareza declarada sin cartas** en algunos Team Packs: heredado, fuera de alcance (§25).

## Cambios NO realizados
Sin tocar RNG, pack draw engine, probabilidades, pools, minting, economía, market, mastery, PvP,
Pick'ems, Trainer, roster, `teamIdentities`, Team Packs, pipeline de artwork ni el ciclo de vida de
cartas. No se resolvieron los 6 BLOCKED, no se hizo Ola 4, no se corrigió la rareza P2, no se
modificó Fnatic. No se eliminó `/inventario` ni `/colecciones`. Sin commit/push/deploy.
