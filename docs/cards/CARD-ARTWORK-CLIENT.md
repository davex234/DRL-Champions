# ARTWORK MANUAL EN EL GAME CLIENT

> Estado: **READY** · P0 = 0 · P1 = 0 · `npm run card-artwork-client:verify` → 38/38
> Sin commit, sin push, sin deploy.

Continúa [CARD-ARTWORK-MANUAL.md](CARD-ARTWORK-MANUAL.md), que dejó el servidor resolviendo
bien y **a nadie pintándolo**. Esto es quien lo pinta.

## La regla, y dónde se aplica

Un ejemplar enseña el artwork de la versión con la que se acuñó. Si esa versión no tiene
artwork, se dibuja como siempre. No hay tercera opción, y en particular no existe «enseña el
de la versión más nueva».

La resolución **no ocurre en el navegador**. El servidor la hace por `card_id` +
`minted_version` y entrega el resultado ya atado al `uid` del ejemplar; el cliente recibe un
mapa `uid → artwork` y hace un acceso directo. Es deliberado: si el navegador recibiera «los
artworks de esta carta» tendría que elegir versión, y ahí es donde nacen las heurísticas que
el bloque anterior se dedicó a prohibir. Sin nada que elegir, no hay cruce posible.

## Una sola consulta, no N+1

El mapa viaja dentro de `GET /api/game/state`, que la colección ya pedía. Se resuelve con
`artworkDeInstancias`, que agrupa los ejemplares por clave distinta y pregunta en tandas de
150 —`in(...)` viaja en la URL y PostgREST trunca en silencio por encima de `max_rows`—.

Medido en el verificador: pintar `/coleccion` e `/inventario` con artwork hace **0 peticiones**
adicionales a la API de cartas.

## Dónde aparece

| Pantalla | Qué se ve | Ejemplar citado |
|---|---|---|
| `/coleccion` (rejilla) | la cara del fichero dentro del `Card3D` de siempre | el de serie más baja, el mismo del que ya salía el número de serie |
| `/coleccion` (ficha) | la carta grande | el mismo, para que artwork y serial no se contradigan |
| `/inventario` | una cara por copia | el ejemplar **exacto** de cada fila |
| Revelado de sobre | la carta que acaba de salir | el ejemplar recién acuñado |
| `/duelos` | el arte **debajo** del cromo | el ejemplar de tu mazo |

### Por qué en el duelo va debajo y no encima

En la colección la carta es un objeto que se mira, así que el fichero ocupa la cara entera. En
el duelo la carta es **el control con el que se elige**, y esa elección se hace leyendo el
trío de combate. Taparlo con un artwork de 750×1050 encogido a 84 px no habría sido un cambio
visual sino un cambio de reglas, así que el artwork sustituye la capa de arte y el OVR, el
nombre y las tres estadísticas siguen encima, donde estaban.

El degradado inferior que ya existía mantiene legible el trío. Se añadió uno **arriba**, y solo
cuando hay artwork: con la foto de siempre el OVR se lee sobre el fondo de la paleta porque el
retrato va metido hacia dentro, pero el artwork va a sangre y el número quedaba directamente
sobre el arte. Lo detectó el QA visual, no las aserciones.

## El fallback es el contrato

Cinco caminos llevan al dibujado de siempre, y todos están probados:

| Caso | Qué pasa |
|---|---|
| sin `uid` (carta del catálogo que no tienes, o modo local) | `Card3D` + `PlayerCard` |
| el ejemplar no está en el mapa (su versión no tiene artwork) | `Card3D` + `PlayerCard` |
| `url` ausente, vacía o con esquema que no sea `http(s)` | rechazada antes de tocar el DOM |
| la imagen falla al cargar (`onError`) | cede el sitio, sin hueco ni icono roto |
| sin `minted_version` | el servidor no lo incluye en el mapa, así que no hay entrada |

Lo que **nunca** pasa es enseñar el artwork de otra versión: `CardVisual` no elige artwork,
recibe un `uid` y busca esa entrada. Si no está, no hay sustituto que buscar.

## Piezas

| Fichero | Qué es |
|---|---|
| `src/domain/cards/artwork.ts` | el tipo que cruza la frontera y `artworkPintable` |
| `src/server/services/cardArtworkUpload.ts` | `artworkDeInstancias` — la resolución en lote |
| `src/app/api/game/state/route.ts` | entrega el mapa junto al estado |
| `src/store/useArtworkStore.ts` | caché de presentación, **no persistida** |
| `src/components/cards/CardVisual.tsx` | `CardFace` (presentacional) + `CardVisual` (conectado) |

`useArtworkStore` no se persiste a propósito: el mapa lo deriva el servidor de `assets`, y si
un diseñador reemplaza un artwork, una URL congelada en `localStorage` señalaría al fichero
viejo hasta que alguien limpiara el navegador.

## El P0 que encontró el verificador

**La CSP bloqueaba el artwork.** `img-src 'self' data: blob: https:` no cubre
`http://127.0.0.1:54521`, que es donde vive Storage en local y en cualquier despliegue
autoalojado: la imagen se bloqueaba sin más aviso que una línea en consola y el juego caía al
fallback como si no hubiera artwork. En producción (`https://…supabase.co`) `https:` lo tapaba,
así que era invisible salvo donde se desarrolla.

Arreglado nombrando el origen exacto que la configuración **ya calculaba** para `connect-src`,
no abriendo `http:` entero — eso habría convertido un fallo local en un agujero real.

## Deudas conocidas, no ocultas

**1 · Las cartas del rival no muestran su artwork.** El cliente solo conoce sus propios
ejemplares; las del rival —y las del bot, cuyos `uid` son sintéticos— caen al dibujado de
siempre. Traerlas exigiría resolver artwork ajeno dentro del DTO de PvP, que este encargo
prohíbe tocar, y adivinar la versión del rival sería justo el cruce que se quiere impedir.

**2 · La casilla agrupada de `/coleccion` cita un ejemplar.** Si tienes copias de la v1 y de la
v2 de la misma carta, la rejilla —que agrupa— enseña la de serie más baja, la misma de la que
ya salía el número de serie. No es un cruce: artwork y serial vienen del mismo ejemplar, y en
`/inventario` cada copia se ve por separado con su cara.

**3 · `/mercado`, `/colecciones` y `/cuenta` siguen sin artwork.** Están fuera del encargo, que
nombra colección, inventario y duelos. `CardVisual` ya existe y solo hace falta pasarles el
`uid`.

## Verificación

```
npm run card-artwork-client:verify                     # 38/38 (Chrome real, sesión real)
npm run card-artwork-upload:verify                     # 29/29
npm run card-artwork:verify                            # 29/29
npm run card-artifacts:verify                          # 18/18
npm test                                               # 787/787 (14 nuevos)
npm run security:verify                                # PASA
E2E_BASE_URL=http://127.0.0.1:3005 npm run ux:verify   # PASA
```

QA visual en `docs/cards/qa/artwork-cliente/`.
