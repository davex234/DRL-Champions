# Contrato de la colección (Fase 37 · Collection & Card Experience 3.0)

Fuente de verdad del modelo: `src/domain/collection/room.ts` (foto) y `src/domain/collection/query.ts` (consulta/URL). Servicio: `src/server/services/collection.ts`. API: `src/app/api/game/collection/route.ts`. Cliente: `src/lib/collection/client.ts`. UI: `src/components/collectionRoom/*` + rutas `/coleccion`, `/coleccion/carta/[cardId]`, `/coleccion/comparar`.

## 1. Definición ≠ instancia

| | CARD DEFINITION (pública) | OWNED CARD INSTANCE (privada) |
|---|---|---|
| origen | catálogo (`CARDS`, `getCard`) | `user_cards` |
| identidad | `cardId = playerId__variantId` (`^[a-z0-9-]{1,64}__[a-z0-9-]{1,32}$`) | `uid` |
| datos | jugador, variante, rareza (bucket), OVR, stats de combate (`combat.ts`), equipo, rol, región, arte | `cardId`, `serial` (o `null`), `mintedVersion` |
| quién la ve | cualquiera, también sin sesión | solo su dueño |

La definición nunca lleva serial, dueño ni uid. El serial se formatea `#N/LÍMITE` (`formatSerial`) y su prestigio (`#1`, `Top 10`, `Top 100`) es solo visual: **no cambia stats, OVR, recompensas ni economía**.

## 2. CollectionSnapshot (`buildCollectionSnapshot(cards, resolvePlayer, facts)`)

Pura, determinista, sin red. Campos:

- `catalogTotal` = número real de definiciones (hoy 772; nunca escrito a mano).
- `uniqueOwned` = definiciones con ≥ 1 copia. `totalCopies` = instancias. `duplicates = totalCopies − uniqueOwned`.
- `completionPct` = `uniqueOwned / catalogTotal`, truncado a 1 decimal (definiciones, no copias).
- `unknownInstances` = copias cuya carta ya no está en el catálogo (se cuentan aparte; no rompen el total).
- `best` = carta propia de mayor OVR → rango de variante ↓ → serial ↑ → id (determinista; no «mejor» inventado).
- `highestOvr`, `serials { owned, number1, lowest }`.
- `sets { team, region, role, rarity, edition }` → `CollectionSetProgress { id, kind, key, label, owned, total, pct, complete, near, missing }`; `nearComplete` = `pct ≥ 70`, `< 100`, `total ≥ 5`. Sin recompensas por completar.
- `favorites` (filtradas al catálogo), `favoritesAvailable`, `showcaseAvailable`, `decksAvailable`.
- `byCard: Map<cardId, CardOwnership { count, instances (serial ↑), bestSerial, favorite, showcaseUids, deckIds, inActiveDeck }>`.

Equipos por identidad canónica (`teamIdentities`): los alias conocidos se agrupan (p. ej. Fnatic/FNC); los no resueltos quedan con su nombre (`raw:<equipo>`), sin fusiones adivinadas. Retirada: el catálogo no tiene retirada por carta; solo los sobres tienen ciclo de vida.

## 3. API `/api/game/collection`

| | GET | POST |
|---|---|---|
| sesión | obligatoria (`401 UNAUTHENTICATED`) | obligatoria |
| entrada | **ningún** parámetro (`?userId=` → `400`) | cuerpo cerrado `{ action: "favorite", cardId, favorite: boolean }` (≤ 2 000 caracteres; claves extra → `400 FIELD_NOT_ALLOWED`) |
| usuario | del token | del token |
| salida | `{ serverNow, instances[{uid,cardId,serial,mintedVersion}], favorites|null, showcase{uids,version}|null, decks[{id,name,active,cardUids}]|null, truncated }` | `{ ok }` |
| caché | `no-store` | `no-store` |
| límite | `collection_read` 30/60 s | `collection_write` 40/60 s |
| errores | `500` genérico «No se pudo leer tu colección» si fallan las instancias; favoritos/vitrina/equipos caídos → `null` (aislados) | `400 INVALID_CARD` · `400 BAD_BODY` · `404 UNKNOWN_CARD` · `409 FAVORITES_LIMIT` · `503 FAVORITES_UNAVAILABLE` (0052 sin aplicar) |

Lecturas: 4 en paralelo; instancias paginadas por `range` de 1 000 (tope 20 000), sin consultas por carta ni por equipo. GET no escribe nada. La única escritura del POST es `user_card_favorites` (insert/delete).

La definición pública no necesita API: sale del catálogo empaquetado.

## 4. Consulta y URL (`/coleccion?…`)

| parámetro | valores |
|---|---|
| `q` | texto ≤ 48; sin tildes ni mayúsculas; busca jugador, equipo e id de carta; sin regex |
| `tener` | `owned` · `missing` (por defecto todas) |
| `rareza` | `legendary,epic,rare,uncommon,common` |
| `rol` | `Duelista,Iniciador,Controlador,Centinela,Flex` |
| `region` | `EMEA,Americas,Pacific,China` |
| `equipo` | clave de identidad o `raw:<nombre>` |
| `edicion` | `exclusiva,mvp,winner,internacional,regional,base` |
| `dup=1` · `fav=1` | solo duplicadas · solo favoritas |
| `min` · `max` | OVR 0–99 (si `min > max` se intercambian) |
| `orden` | `ovr-asc`, `rarity`, `player`, `team`, `copies` (por defecto `ovr-desc` → rareza → jugador) |

Lista blanca: valores desconocidos se descartan; parámetro > 512 caracteres se ignora; ≤ 12 valores por lista. La URL describe qué mirar; **nunca autoriza** nada. Filtrar y ordenar ocurre en cliente.

## 5. Rutas

- `/coleccion` — sala: cabecera (X/Y, %, copias, duplicadas, OVR más alto, serial más bajo, carta de mayor OVR), descubrir (favoritas, mayor OVR, casi completos), libro de sets (click → aplica el filtro), álbum paginado de 48 en 48.
- `/coleccion/carta/[cardId]` — ficha estable. Valida formato y catálogo antes de usar el id (inexistente o con rutas → «Carta no encontrada»). Sin sesión: definición pública + «Inicia sesión». Con sesión: tus copias y seriales, favorita, vitrina, equipos, variantes del jugador, sets, «Dónde puede salir» (solo sobres ACTIVOS a la venta, «No es una garantía»).
- `/coleccion/comparar?a=&b=` — OVR + Stronghold/Gamesense/Entryfrag del catálogo, diferencias `+N / −N / =` con frase accesible y **sin veredicto**; primero se proponen tus cartas.
- No se enlaza a `/jugador/[id]`: es el perfil de USUARIO, no del profesional.

## 6. Integraciones (sin segundos sistemas)

- Render: `Card3D`/`PlayerCard` existentes (rejilla `mode="static"`, profundidad solo en cabecera y ficha).
- Vitrina: `saveShowcase` → `POST /api/game/player { action: "set_showcase" }` (máx. 3 instancias propias, versión optimista).
- Equipos: `AddToDeckSheet` → constructor canónico; uso en equipos derivado de `duel_decks` leídos una vez.
- Sobre → colección: «Ver en mi colección» abre la ficha de la mejor carta del botín (`cardHref`). Sin segunda ceremonia.
- Sin precio, valor, venta, venta rápida, mercado, intercambio, procedencia («del sobre X») ni «recientes» por `obtained_at`.

## 7. Sin conexión y fallos

Se conserva la última foto con aviso textual; favoritos, vitrina y «Añadir al equipo» se desactivan. Fallos parciales (arte → reverso/retrato de reserva; disponibilidad; equipos; favoritos) se aíslan en su bloque.
