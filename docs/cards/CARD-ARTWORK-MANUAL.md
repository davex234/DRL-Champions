# ARTWORK MANUAL POR VERSIÓN DE CARTA

> Estado: **READY** · P0 = 0 · P1 = 0 · `npm run card-artwork-upload:verify` → 29/29
> Sin commit, sin push, sin deploy.

## La premisa

Las cartas de NEXUS **se diseñan a mano**. El artwork final es un fichero que exporta una
persona. NEXUS no lo reconstruye desde una foto, no lo genera y no lo aproxima. Este bloque
solo le da un sitio donde vivir, lo ata a una versión concreta y sabe devolverlo.

No se ha descargado ninguna foto, no se ha generado ninguna carta y no se ha inventado ningún
artwork. El renderizador técnico anterior (`CARD-ARTWORK-EXPORT.md`) sigue donde estaba, pero
ha dejado de ser el camino principal: ahora es una utilidad secundaria, plegada tras un
`<details>` en el panel.

## Lo que NO es

No es una segunda arquitectura de assets. Escribe en la tabla `assets` y en el bucket `assets`
de siempre, con las mismas rutas, el mismo checksum y el mismo modelo de versión de asset
(`group_id` · `version` · `is_current`). La migración 0043 amplía **dos listas de valores
admitidos** y añade un índice parcial. Nada más.

```
assets.subject_type += 'card'
assets.kind         += 'card_artwork'
```

## La clave: `<card_id>#v<N>`

`subject_id` es compuesto a propósito. La v1 y la v2 son **dos sujetos distintos** para el
gestor de assets, con sus propias filas y su propio `is_current`: publicar la v2 no puede pisar
el artwork de la v1 porque ni siquiera comparten fila.

La versión de la carta **no** va en `assets.version`, que ya significa la versión DEL ASSET —la
que sube al reemplazar un fichero por otro mejor—. Mezclarlas habría hecho imposible reemplazar
el artwork de la v1 sin que pareciera el de la v2.

### La ruta de Storage NO lleva `#`

`card_artwork/<card_id>/v<N>/<uuid>.<ext>`, con la versión en un segmento propio.

`#` no puede aparecer en la clave de un objeto de Storage: viaja en la URL de subida y se lee
como separador de fragmento, así que todo lo que va detrás se descarta y **las dos versiones
acaban escribiendo el mismo fichero**. Se descubrió porque la v2 moría con «The resource
already exists» — es decir, la independencia entre versiones fallaba exactamente donde el brief
la exigía. Está arreglado y hay una prueba que lo fija (`son dos sujetos distintos`, `hay una
fila de artwork por versión`).

## La resolución: `card_id` + `minted_version`, y nada más

Sin heurísticas. Ni la versión más reciente, ni `obtained_at`, ni la fecha del asset. Un
ejemplar acuñado bajo la v1 devuelve el artwork de la v1 aunque exista la v2 y aunque la v2 sea
mejor. Es la misma regla que ya gobierna sus estadísticas desde 8.2, aplicada a la ilustración.

Cuando esa versión no tiene artwork subido devuelve `null`, y `null` significa «píntala como
siempre», nunca «pon la de otra versión».

## Validación: no basta con la extensión

El `upload` genérico de `/api/admin/assets` no valida nada y deja el fichero en un bucket
público. Para el artwork de una carta hay una puerta propia que comprueba cuatro cosas:

| Comprobación | Qué rechaza |
|---|---|
| Extensión | cualquier cosa que no sea `.png` o `.webp` |
| MIME declarado | un `.png` anunciado como `image/gif` |
| Tamaño | > 12 MB, **cortado por `Content-Length` antes de leer el cuerpo** |
| **Bytes reales** | un `.png` que no empieza por la firma PNG; un `.webp` sin contenedor `RIFF`/`WEBP` |

La cuarta es la que decide: confiar en la extensión es cómo se sube un ejecutable a un bucket
público. El corte por `Content-Length` existe porque `req.formData()` sobre un multipart enorme
revienta antes de que la regla de los 12 MB llegue a ejecutarse, y salía un 500 opaco donde
debía salir un 400 con el motivo.

## Reemplazar

Subir sobre una versión que ya tenía artwork es un **reemplazo**: la fila anterior deja de ser
`is_current` y la nueva sube `version` dentro del mismo `group_id`. El fichero viejo **no se
borra** del bucket — un artwork que alguien ya pudo distribuir no desaparece porque se suba
otro, y el historial es lo que permite volver atrás. Reemplazar el de la v1 no toca la v2.

## Deuda conocida, no oculta

**El juego todavía no pinta el artwork manual.** La resolución por `card_id + minted_version`
está implementada, probada y servida por la API (`artworkForInstance`), pero **ningún
componente de cliente la consume**: `/coleccion`, `/inventario` y el duelo siguen pintando con
`Card3D` como hasta ahora.

Es deliberado: hacerlo requiere tocar `Card3D`, que este brief prohíbe expresamente. Queda como
el siguiente paso natural, con el contrato ya cerrado y verificado por su lado del servidor.
Hasta entonces, el artwork manual es visible y descargable **desde el panel de administración**.

## Verificación

```
npm run card-artwork-upload:verify     # 29/29
npm run card-artwork:verify            # 29/29 (renderizador técnico)
npm run card-artifacts:verify          # 18/18
npm test                               # 773/773
npm run security:verify                # PASA
E2E_BASE_URL=http://127.0.0.1:3005 npm run ux:verify   # PASA
```
