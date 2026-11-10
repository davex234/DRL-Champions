# FASE 48C · VEIL V2 — informe

**Resultado: CANDIDATO V2 PARA APROBACIÓN VISUAL.** No es «Veil definitivo»: la aprobación la
hace el usuario mirando las capturas de § 34.

---

## 1 · Análisis visual de V1

Funcionaba: cara reconocible (enjuta, mandíbula larga, barba de días), capucha, cuatro cartuchos
en el lado correcto, un solo acento, cero armas. Fallaba: arquetipo «encapuchado» genérico,
sobretodo con solapas y cremallera (chaqueta de calle), cicatriz invisible, micrófono no
canónico, ojos demasiado expuestos, y ningún vínculo con el glifo más allá del color.

## 2 · Cambios buscados

Del glifo (`M5 9h22` + dos `U`: **una barra de la que cuelgan verticales que acaban en curva**)
salió la idea que ordena V2 — traducirlo a CONSTRUCCIÓN, no pegarlo:

- **yugo recto sobre el hombro derecho del que cuelgan pliegues verticales con punta ribeteada**
  = la barra y los velos del sigilo, y el «bajo que cuelga recto» de la biblia;
- **cuello alto técnico** de competición, cierre oculto, sin solapas ni cremallera;
- **módulos de tapa plana** con anillo en la junta, en una carcasa a la espalda;
- **sin micrófono**; **cicatriz de quemadura curada y visible**; **sombra de capucha dominante**.

## 3 · Rondas (4, cada una con un problema)

| Ronda | Qué resolvía | Método | Resultado |
|---|---|---|---|
| R1 | Traje, cuello, módulos | inpaint con la cara de V1 protegida | Cuello y traje **resueltos**. Módulos = **balas de latón** (rechazado); a 0,95 la cara se duplica. |
| R2 | Micro, sombra, módulos, glifo | quitar el micro de la zona protegida + pase de valores + prompt corregido | **Aparece el yugo con pliegues** (glifo). Micro fuera. Pero la sombra queda en banda y hay 3 módulos. |
| R3 | Sombra sin banda, 4.º módulo, unificar | repintado (módulo duplicado sólo sobre fondo, sombra graduada que no toca el fondo) + img2img 0,28/0,36 | **Candidato r3_28_s2**. La palabra «scar» vuelve a dar cortes rojos. |
| R4 | Cicatriz | retoque sobre el candidato: quitar cortes, pintar quemadura moteada con borde, conservando textura | Cicatriz curada y visible. |

Postproceso: BiRefNet + llave local para los módulos con cierre morfológico (el relleno por
columnas de F48B metía fondo bajo las tapas) y erosión de 1 px del borde.

## 4 · Hoja de candidatos

`docs/product/art/veil/v2/candidatos-v2.jpg` (7 candidatos, cuerpo + cara) y
`ronda-r1.jpg`, `ronda-r2.jpg`, `ronda-r3.jpg`.

## 5 · Candidato seleccionado

**r3_28_s2 + retoque de cicatriz.** Criterio: la única base con los cuatro módulos, la sombra
sin banda, el mismo rostro de V1 y el yugo de pliegues limpio.

## 6–14 · Comparación elemento a elemento

| | V1 | V2 |
|---|---|---|
| **Cara** | — | **La misma**: se protegió en todas las rondas; sólo cambia la luz sobre la frente. |
| **Cicatriz** | invisible | parche de quemadura curado, moteado, con borde; se lee a 128–480 px. A 256 px podría confundirse con un reflejo si no se sabe que está. |
| **Capucha** | genérica | la misma forma + sombra dominante: ojos difíciles de leer, con brillo, rostro inferior iluminado. **El rasgo propio de la capucha no está en la capucha**: lo aporta el conjunto capucha + yugo. |
| **Cuello / outfit** | solapas, cremallera | cuello alto técnico, malla de compresión con ventilación. Queda una hombrera acolchada en el hombro derecho (lectura deportiva, no militar, pero es una placa). |
| **Módulos** | botes | cuatro cilindros de tapa plana con anillo; leen a tecnología. Las tapas son algo «seta». |
| **Glifo** | sólo color | yugo + pliegues verticales con punta violeta = barra + velos. Visible en retrato; en el hueco de 128 px se ve a medias. |
| **Color** | 3 sitios | costura de capucha, puntas de pliegues, anillos. Sigue siendo acento. |
| **Silueta** | capucha + botes | capucha + cuatro módulos separados y más altos. **Los pliegues no cambian la silueta** (quedan dentro del contorno): el avance en silueta es moderado. `v2/silueta-v1-vs-v2.png`. |

## 15–18 · Assets

| Pieza | Ruta | Tamaño | Peso (límite) |
|---|---|---|---|
| Máster V2 | `docs/product/art/veil/v2/veil-v2-master-960x1280.webp` | 960×1280, sin pérdida, alfa | 735 KB (no servido) |
| Portrait V2 | `public/agents/veil/portrait.webp` (+ copia `v2/portrait-v2.webp`) | 480×640, alfa | **40,1 KB** (90) |
| Avatar V2 | `public/agents/veil/avatar.webp` (+ copia `v2/avatar-v2.webp`) | 256×256, alfa | **10,2 KB** (40) |
| **V1 conservado** | `docs/product/art/veil/veil-master-960x1280.webp`, `v1/portrait-v1.webp`, `v1/avatar-v1.webp` | — | md5 idénticos a los publicados en F48B |

Mismo máster para retrato y avatar. Recortes: retrato 880 px desde x = 10; avatar 610 px en (295,110).

## 19–23 · QA en producto (`npm run start`, BD del VPS por túnel, cuenta QA F45)

`docs/product/qa/fase48c/qa/_qa.json`:

- **Composition Manager**: hueco 128×171 (≥1024), 120×160 (768), 52×70 (390); roster 30 px; lista 34 px. Arte cargado ✓.
- **Plan Táctico**: tira 24 px ✓ a 390/1024/1440.
- **Presentar**: 30 px (escritorio) y 20 px (móvil) ✓. El `✗ 0×0` es la lista duplicada que ese ancho oculta con `display:none`; no se pide (lazy) y no está rota.
- **Mapa**: `mapaConCaras = 0`; Veil sigue siendo sigilo.
- **Otros nueve**: `otros-con-imagen = 0` en todas las escenas. Imágenes rotas 0. Scroll horizontal 0.
- **Tamaños** (`qa/banco-tamanos.png`, 24/30/32/48/56/96/128/256): 96–256 muy bien; **48–56 reconocible** (capucha + sombra + mandíbula); **30–32 aceptable**; 24 sólo masa. A 24–32 V2 se lee **algo peor que V1** porque los ojos ya no están: es el precio de la sombra que pedía el encargo.
- **Service worker**: sirve `.webp` con stale-while-revalidate (política existente). Quien ya vio V1 lo verá UNA carga más; la siguiente ya es V2. No se ha tocado.

## 24 · Screenshots V1 / V2 (misma pantalla, resolución y estado)

V1 = `docs/product/qa/fase48b/despues/`, V2 = `docs/product/qa/fase48c/v2/`. Comparativas en
`docs/product/qa/fase48c/v1-vs-v2-*.png` (editor 1440/1920/390, lista, Presentar, Plan).

## 25–29 · Gates

Tests **4547/4547** · tsc web **PASS** · tsc scripts **PASS** · lint **exit 0** (0 errores) ·
build **PASS** · :3005 en marcha con `npm run start`.

## 30 · Working-tree safety

Copia previa en el scratchpad (`backup-pre-f48c/`, incluidos los WEBP de V1). `git status`
antes/después: sólo aparece `docs/product/qa/fase48c/`. Ediciones: `visuals.ts` (un comentario),
biblia § 5, `_fase48b-veil-qa.ts` (opción `--out=` y tamaños 24–256). Sin reset, clean, restore,
checkout, stash, commit ni push.

## 31 · Sistemas no tocados

`AgentPortrait` (md5 igual que F48A), arquitectura, fallback, componentes, gameplay, dominio
táctico, coordenadas, pasos, reproducción de 520 ms, strats, dominio de composiciones,
asignaciones, concurrencia. `published` no cambia (mismas rutas).

## 32 · Migraciones / Marketplace

Cabecera **0054**, 0 migraciones · `GLOBAL_MARKET_ENABLED = false`.

## 33 · CANDIDATO V2: **SÍ**

| ¿V2 soluciona…? | |
|---|---|
| arquetipo genérico | **Parcial.** Sigue siendo encapuchado; lo que lo hace suyo es capucha + yugo de pliegues + módulos, no la capucha sola. |
| chaqueta de calle | **Sí.** |
| cicatriz invisible | **Sí** (visible y curada; ambigua a 256 px). |
| micro no canónico | **Sí**, eliminado. |
| ojos demasiado expuestos | **Sí.** |
| relación débil con glifo | **Sí, en color y valor; no en silueta.** |
| sigue siendo reconociblemente V1 | **Sí** (misma cara protegida). |
| parece atleta | **Sí**, más que V1 (malla, ventilación, cuello técnico); la hombrera es lo menos deportivo. |
| parece NEXUS | **Sí.** |
| funciona pequeño | **Sí a 48–56**, aceptable a 30–32, peor que V1 a 24. |
| funciona grande | **Sí** hasta 480; más grande pide un máster mayor. |
| silueta propia | **Moderada.** |
| no recuerda a una IP | **Sí**, sin parecido claro; el riesgo es de arquetipo. |

## 34 · LO QUE HAY QUE MIRAR PARA APROBAR

1. `docs/product/art/veil/veil-v1-vs-v2.png` — V1 y V2 lado a lado + avatares de 24 a 256 px.
2. `docs/product/qa/fase48c/v1-vs-v2-03-editor-lleno-1440.png` — el Composition Manager real, mismo estado.
3. `docs/product/art/veil/v2/portrait-v2.webp` — el retrato publicado, a tamaño real.
4. `docs/product/qa/fase48c/qa/banco-tamanos.png` — el arte servido por el producto a 24–256 px.
5. `docs/product/art/veil/v2/silueta-v1-vs-v2.png` — la prueba de silueta.

Los otros nueve **no se han producido**.
