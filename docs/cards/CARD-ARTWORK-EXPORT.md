# Exportar una versión de carta como imagen

> **Estado: funciona, y la imagen está a medio vestir.** El pipeline entero corre de punta a
> punta —fila de `content_card_versions` → `CardSpec` → `ArtworkComposition` → PNG · WEBP ·
> miniatura · vista previa · `manifest.json`— con la v1 y la v2 en carpetas separadas y sin
> pisarse. Lo que no hay son **fotos de jugador**: el renderizador sustituye 14 elementos por
> el marcador oficial, así que el fichero es correcto en datos y no es material presentable.
> `card-artwork:verify` **29/29**. **Sin commit, sin push, sin deploy.**

---

## 1. Qué había, y qué faltaba

Lo que faltaba no era un renderizador. Era el **puente**.

```
YA EXISTÍA, y funciona desde julio:
  card-generator ──► CardSpec ──► artwork-composer ──► ArtworkComposition
                                                              │
                                                     artwork-renderer (sharp)
                                                              ▼
                            PNG 750×1050 · WEBP · thumbnail 150×210 · preview 375×525
                                        + manifest.json

NO EXISTÍA:
  content_card_versions ──► CardSpec
```

Ese motor come `CardSpec`, que nace de una generación de torneo. Las cartas del panel nacen de
otro sitio: una fila. `src/server/services/cardArtwork.ts` es ese puente, y nada más.

---

## 2. El adaptador no duplica ni una derivación

| Campo del `CardSpec` | De dónde sale |
|---|---|
| `cardId` · `playerId` · `variantId` · `ovr` · `stats` | `fromVersionRow()` — la MISMA proyección que usa el catálogo servido |
| `rarityBucket` | `bucketForRank()`, del dominio de sobres |
| `serialized` · `serialLimit` · paleta | `getVariant()` |
| `series` | `seriesOf()` — exportada por `card-generator` |
| `kind` | `kindForFamily()` — exportada por `card-generator` |
| `artwork` | `resolveArtwork()` — exportada por `card-generator` |
| `estimatedValue` | `marketValue()`, la del mercado |
| `eligibility.market` | `decideMarket()`, la de `live/market` |

**No se calcula aquí ni un OVR, ni una rareza, ni un rango, ni una serie.** Se leen.

Solo hay **dos traducciones**, y ninguna inventa nada:

- **`tier`** ← `rarityBucket`, 1:1. Son dos vocabularios del mismo eje (`rare`→`rara`). No se
  recalcula desde el OVR: eso sería una segunda autoridad de rareza.
- **`family`** ← el **grupo** de la variante. Es exactamente lo que una carta creada a mano es:
  una carta de su familia de variante, sin accolade de torneo detrás.

Y una decisión que sostiene la idempotencia: **`now` es la marca de la versión**
(`effective_from`), no el reloj de la petición. Con el reloj, cada pulsación cambiaría la
metadata EXIF embebida y el manifest, y «idempotente» dejaría de serlo.

---

## 3. Dónde se guarda, y por qué no en `assets`

```
output/artwork/admin/<cardId>/v<N>/
  ├─ cards/<cardId>.png
  ├─ cards/<cardId>.webp
  ├─ thumbnails/<cardId>.png
  ├─ previews/<cardId>.webp
  └─ manifest.json
```

**Una carpeta por versión.** Es lo que hace imposible que publicar la v2 pise el PNG de la v1:
escriben en sitios distintos. Verificado con SHA-256 antes y después.

**No se ha tocado la tabla `assets` ni el bucket de Storage**, y es deliberado. Su `CHECK` de
`subject_type` admite `player · team · league · tournament · country · role · variant · none`
— no `card` — y su `kind` admite `player_photo · team_logo · card_template · background…`. Ese
sistema está pensado para los **ingredientes** de una carta, no para la carta renderizada.
Ampliarlo es una migración, y el encargo pedía no tocar infraestructura crítica el día de la
demo. Queda como el paso siguiente, escrito abajo.

**Los binarios no están en `public/`.** Los sirve el panel, que ya ha comprobado quién pide:
`GET /artwork/admin/…` desde el navegador responde **404**, verificado.

---

## 4. La imagen que sale hoy

Un render real de `derke__champions-mvp` v1: nick correcto, OVR 88, `legendary ·
champions-mvp`, paleta legendaria, temporada 2026, insignia de estrella. Y:

```
sustituidos: 14
```

Catorce elementos —foto del jugador, escudo del equipo, bandera, rol, región, colección y las
medallas— caen al **marcador oficial** porque `public/players` y `public/teams` solo tienen un
`README.md`. `AssetMaterializer` nunca falla por un asset ausente: sustituye y lo marca.

**No se inventa ninguna foto de persona.** El recuento viaja en la respuesta y se enseña en la
pantalla, para que nadie descargue el fichero creyendo que está terminado.

---

## 5. Qué falta para que la imagen sea presentable

**BLOCKER: no hay assets de jugador.** Ni uno.

| Qué falta | Dónde va | Estado |
|---|---|---|
| Fotos de jugador (773 cartas, 379 jugadores) | `public/players/<id>.png` o tabla `assets` | **0** |
| Escudos de equipo | `public/teams/<slug>.png` | **0** |
| Banderas, iconos de rol y región | assets `flag` · `role` | **0** |
| Medallas / insignias | assets de badge | **0** |

Con eso, el mismo render que ya funciona produce la carta completa sin tocar una línea más.

**Y para guardarlo en `assets` en vez de en disco**, que es lo que el encargo describía en su
§4, harían falta exactamente cuatro cosas:

1. Migración pequeña: añadir `'card'` al `CHECK` de `assets.subject_type` y `'card_render'` al
   de `assets.kind`.
2. Subir el resultado al bucket `assets` con `subject_id = card_id` y `version = N` — las
   columnas ya existen, incluida `is_current`.
3. Decidir si el bucket sigue siendo público (hoy lo es) o si estas cartas se sirven firmadas.
4. Sustituir la lectura de disco de `artworkStatus()` por una consulta a `assets`.

Nada de eso cambia el adaptador ni el renderizador.

---

## 6. Card3D no se toca

```
JUGADOR  →  Card3D / CardRenderer   (en vivo, en el navegador)
ADMIN    →  artwork-renderer        (fichero exportable, uso interno)
```

El juego **no depende** del PNG para pintar una carta y no lo hará. Son dos cosas con dos
propósitos: una es interactiva, la otra es un artefacto.

---

## 7. Verificado

`card-artwork:verify` — **29/29**, contra el servidor real:

```
antes de generar        v1 NO generada · PNG da 404
generar v1              602 ms · png · webp · thumbnail · preview · manifest.json
                        14 sustituidos, declarados
descarga                PNG 174 KB (firma ‰PNG) · WEBP 105 KB (RIFF/WEBP)
                        nombre por versión: derke__icon-series.v1.png.png
idempotencia            2ª pulsación 54 ms · cached · sha256 idéntico · mtime intacto
v2 no pisa a la v1      v1 sha256 idéntico al de antes de existir la v2
                        v2 otro sha256 · carpetas v1/ y v2/ separadas
seguridad               sin sesión 401 · jugador 401 · generar como jugador 401
                        URL pública 404 · artefacto inexistente 404
limpieza                0 carpetas, 0 filas, 773 definiciones
```

---

## 8. Deudas

1. **Sin assets de jugador la imagen no es presentable.** Es el bloqueo real, y es de
   contenido, no de código.
2. **El almacenamiento es disco, no `assets`.** Elegido para no tocar el esquema el día de la
   demo. Los cuatro pasos para moverlo están en §5.
3. **`output/` está en `.gitignore`.** Los artefactos no sobreviven a un clon del repositorio;
   se regeneran pulsando el botón, que es idempotente.
4. **No hay recolección de basura.** Purgar una carta borra sus filas pero deja su carpeta de
   artwork. Hoy no importa —lo purga la verificación— pero con uso real haría falta limpiarlo
   al purgar.
