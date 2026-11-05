# FASE 48B · VEIL GOLDEN SAMPLE — informe

**Resultado:** el bloqueo de F48A (`ART PRODUCTION BLOCKED — HUMAN/IMAGE PIPELINE REQUIRED`)
está **resuelto**: hay una pipeline de generación real y local, y Veil tiene retrato y avatar
originales, integrados por `published` y probados en producción. **GO técnico.** El veredicto
artístico está en § 26–27: **candidato, no estándar**, hasta aprobación humana.

---

## 1 · Capacidades investigadas

| Capacidad | Resultado |
|---|---|
| Herramientas de la sesión | Sin herramienta de generación de imágenes integrada. |
| Claves de APIs de imagen en el entorno (`OpenAI`, `Replicate`, `Stability`, `fal`, `BFL`, `HF`…) | Ninguna. |
| Ollama 0.34 (instalado) | **Sin generación de imágenes en Windows** (`ollama run` no expone `--width/--height`). Sólo modelos de texto/visión (qwen3-vl). |
| **GPU local** | **RTX 3060 12 GB**, driver 596.49, CUDA disponible. 16 GB de RAM, 3,3 TB libres en `D:`. |
| Red a Hugging Face / PyTorch | Accesible (200). |

**Decisión:** instalar una pipeline propia de difusión en local, aislada del repo y del sistema.

## 2 · Pipeline utilizada

- venv aislado en `D:\nexus-artgen\venv` (Python 3.14, **torch 2.11 + CUDA 12.8, diffusers 0.40**). Nada instalado en el repo ni en el Python del sistema.
- Modelo: **Z-Image-Turbo** (Tongyi-MAI, **Apache-2.0**, uso comercial permitido). Transformer en **GGUF Q8_0** (unsloth, Apache-2.0, 7,2 GB) + codificador de texto Qwen3 bf16 + VAE.
- Carga en **dos fases** para caber en 12 GB: codificar todos los prompts → liberar el codificador → cargar el transformer. ~48 s por imagen 960 × 1280, 9 pasos.
- Refinado: `ZImageImg2ImgPipeline` sobre un **pase de valores** (oscurecer la frente bajo la capucha) — el modelo re-pinta la sombra de forma coherente.
- Recorte de fondo: **BiRefNet** (MIT) + llave de color local para los cartuchos (BiRefNet los descartaba como fondo) con relleno por columnas.
- Exportación: Pillow → WEBP con alfa, presupuesto de peso del contrato.
- Todo reproducible: `docs/product/art/veil/pipeline/` (`gen.py`, `refine.py`, `post.py`, prompt final y jobs).

## 3 · Datos canónicos usados

De `nexus-agent-bible.md § VEIL` y `src/agents/visuals.ts`: Controlador · 4 cargas humo + cobertura · acento `#8b7bf0` sólo en juntas de cartuchos y costura interior de la capucha · capucha estructurada con varilla interna · mitad superior de la cara en sombra, mandíbula y boca visibles · piel mate, cicatriz corta de quemadura en el pómulo derecho · delgado, fibroso, hombros estrechos · sobretodo de composite mate abierto, mono gris grafito · **cuatro cartuchos verticales sobre el hombro derecho** · verticales pesadas · atleta, no militar · sin armas · sin humo pintado · luz fría alta a la izquierda, relleno tenue de clase a la derecha, contraluz.

## 4 · Dirección artística

Retrato de busto de un atleta de un deporte táctico reglado: realismo estilizado con acabado
pintado, silueta limpia, materiales identificables, un único acento de color. Añadido (no
estaba en la ficha, **pendiente de aprobar**): micrófono de competición en la mandíbula, porque
la ficha dice que Veil habla «en imperativo corto» durante la ronda y es un marcador de deporte,
no de ejército.

## 5 · Iteraciones (≈60 imágenes, hojas en `docs/product/art/veil/`)

| Ronda | Qué salió | Por qué se rechazó / qué se corrigió |
|---|---|---|
| R1 (12) | Cuerpo ¾, render 3D genérico | Encuadre ignorado; ojos iluminados; cartuchos violeta enteros y de 3; «corte sangrante» en vez de quemadura; asesino encapuchado genérico. |
| R2 (8) | Busto correcto, acabado pintado | «Visera cuadrada» → **gorra de béisbol** bajo la capucha; gabardina con solapas; ojos iluminados. |
| R3 (6) | Capucha buena, rostro consistente | Ojos siguen iluminados; cicatriz = arañazos. |
| R4 (8) | Sombra forzada | **Banda negra tipo antifaz** — viola «nada de cara tapada». |
| R5 (12) | Sombra por cámara/luz | Vuelven los ojos iluminados: el modelo no hace sombra graduada sólo con texto. |
| R6 | Pase de valores + img2img | **Funciona**: sombra natural. Base con 3 cartuchos. |
| R7 | Inpaint de cicatriz y cartuchos | **Rechazado**: heridas abiertas y botes de spray gigantes. |
| R8 (12) | Nuevas bases con «exactamente cuatro» | 4 cartuchos en el lado correcto en casi todas → base **s1212**. |
| R9 (6) | Repintado de cicatriz + pase de valores + img2img 0,36 | Elegido **f_36_s1** + retoque local de una marca en la mejilla izquierda. |

## 6 · Máster

`docs/product/art/veil/veil-master-960x1280.webp` — 960 × 1280, **sin pérdida, con alfa**,
709 KB. Fuera de `/public`: el producto nunca lo carga.

## 7 · Portrait

`public/agents/veil/portrait.webp` — **480 × 640**, WEBP con alfa (VP8X), **37,7 KB** (límite 90).
Recorte de 880 px de ancho desde x = 40 del máster: cara y torso superior, los cuatro cartuchos
dentro del encuadre.

## 8 · Avatar

`public/agents/veil/avatar.webp` — **256 × 256**, WEBP con alfa, **10,7 KB** (límite 40). Del
MISMO máster (recorte 610 px en 295,110): cabeza y hombros, ojos al 36 %. Se probaron tres
recortes; se eligió el que conserva el contorno de la capucha, que es lo que identifica a
20–32 px.

## 9 · Rutas físicas

```
public/agents/veil/portrait.webp        480×640   37,7 KB
public/agents/veil/avatar.webp          256×256   10,7 KB
docs/product/art/veil/veil-master-960x1280.webp   (no servido)
docs/product/art/veil/pipeline/                    (reproducible)
docs/product/art/veil/iteraciones-*.jpg            (hojas de contacto)
```

## 10 · Manifest / `published`

`src/agents/visuals.ts` → `veil.published = ["portrait", "avatar"]`. **Cero cambios en
componentes**: `AgentPortrait`, `AgentEmblem`, `CompositionBuilder`, `TacticalTheater` y el
tablero están intactos (`AgentPortrait.tsx` con el mismo md5 que antes). `portrait-large` NO se
declara: sería un reescalado del recorte de 880 px.

## 11 · Integration QA (producción, `npm run start`, BD del VPS por túnel, cuenta QA F45)

Instrumento `scripts/_fase48b-veil-qa.ts` (mide el DOM) + `scripts/_fase48-shots.ts` (capturas).
Evidencia en `docs/product/qa/fase48b/{antes,despues,qa}/` y `qa/_qa.json`.

- Veil: `data-art="image"` y `naturalWidth > 0` en todas las superficies donde aparece.
- Los otros nueve: `otros-con-imagen = 0` en todas las escenas; `/agents/haze/portrait.webp` → 404 y nunca se pide.
- Imágenes rotas: **0**. Errores de consola: **sólo 429** del limitador, idénticos a la línea base de F48A.

## 12 · Composition Manager

Hueco 1 = retrato real (128 × 171 en ≥ 1024 px; 120 × 160 a 768; 52 × 70 a 390). Roster = avatar
real a 30 px. Nombre y clase los pone la UI, como en F48A.

## 13 · Plan Táctico

Tira de composición a 24 px: avatar real de Veil + sigilos de los otros cuatro. Legible (capucha +
rostro). **Observación:** en el estado mixto el avatar es un recorte cuadrado junto a fichas
redondas con anillo de clase; se resuelve solo cuando los diez tengan avatar. No se ha tocado el
producto.

## 14 · Presentar

Lista «En el mapa» con el avatar real a 30 px. Correcto.

## 15 · Mapa / glifo

Veil sigue siendo **ficha con sigilo** en el tablero y en el teatro. `mapaConCaras = 0` en todas
las escenas; la prueba «EL MAPA NO LLEVA CARAS» sigue pasando.

## 16 · Responsive

Editor a **390 / 768 / 1024 / 1440 / 1920** (+2560 en las capturas): sin scroll horizontal,
ningún retrato fuera del viewport.

## 17 · Screenshots antes / después

`docs/product/qa/fase48b/antes/` (build F48A, `published: []`) y `despues/` (build F48B), 12 + 12,
mismas escenas. Comparativas: `comparacion-03-editor-lleno-1440.png`,
`comparacion-05-editor-lleno-390.png`, `comparacion-09-presentar-1440.png`,
`comparacion-11-plan-1440.png`. Banco de tamaños: `qa/banco-tamanos.png` (20/32/48/56/96/256 y
retrato 96–640).

Tamaños: 256/96/56/48 excelentes · 32 reconocible · 20 sólo la masa de la capucha · retrato bien
hasta 320 px, blando a 640 (para eso existe `portrait-large`, no publicado).

## 18 · Tests

**4547 / 4547 PASS** (línea base 4544). Reescritas —no debilitadas— las que fijaban «cero arte»:

- `visuals.test.ts`: *Veil es la ÚNICA muestra publicada* (cuenta = 2, rutas exactas, sin `portrait-large`/`fullbody`) · *los otros nueve siguen con el sigilo* · **nueva:** *lo que declara `published` EXISTE en disco y cumple el contrato* (RIFF/WEBP, VP8X con alfa, tamaño exacto, peso ≤ límite).
- `agentPortrait.test.tsx`: *Veil pinta su arte REAL* (retrato y ficha, tamaños intrínsecos) · *los otros nueve pintan el sigilo sin pedir nada* · la simulación de «declarar y quitar» pasa a Blitz.
- `f47.close.test.ts`: intacto y en verde.

## 19–22 · Gates

`tsc` web **PASS** · `tsc` scripts **PASS** · `npm run lint` **exit 0** (0 errores, 28 avisos
previos; los ficheros tocados, 0) · `npm run build` **PASS** (`prerender-manifest.json` presente,
`published:["portrait","avatar"]` en el bundle) · **:3005 en marcha con `npm run start`**.

## 23 · Working-tree safety

Copia previa de los ficheros sin trackear que se editan (`visuals.ts`, `visuals.test.ts`,
`agentPortrait.test.tsx`, `AgentPortrait.tsx`, biblia) en el scratchpad de la sesión, con md5.
`git status` antes/después: **sólo altas** (`public/agents/`, `docs/product/art/`,
`docs/product/qa/fase48b/`, `scripts/_fase48b-veil-qa.ts`); ninguna línea previa cambia ni
desaparece. Sin reset, clean, restore, checkout, stash, commit ni push.

## 24 · Migraciones

**0.** Cabeza: `0054_tactical_compositions.sql`.

## 25 · Marketplace

`GLOBAL_MARKET_ENABLED = false` (`src/config/features.ts:34`), intacto.

## 26 · GO / NO-GO artístico

| Pregunta | Veredicto |
|---|---|
| ¿Se reconoce la cara? | **Sí.** Rostro enjuto, mandíbula larga, barba de días; igual en retrato y avatar. |
| ¿Silueta propia? | **Sí, con riesgo.** La capucha rígida alta es inconfundible dentro de los diez, pero «encapuchado» es un arquetipo muy visto. |
| ¿Parece atleta? | **A medias.** Micro de competición y malla de compresión sí; el sobretodo con solapas y cremallera lee a chaqueta de calle. |
| ¿Universo NEXUS? | **Sí.** Paleta de la casa, un solo acento, sin neón ni militar. |
| ¿Funciona pequeño? | **Sí hasta 32 px**; a 20–24 px sólo la masa de la capucha. |
| ¿Funciona grande? | **Sí hasta 320 px**; más allá necesita `portrait-large` de un máster mayor. |
| ¿Coherente con su glifo? | **Débil.** El glifo son tres velos que caen; el bajo de la capa no entra en un busto. El vínculo lo llevan el violeta y las verticales de los cartuchos. |
| ¿Coherente con su clase? | **Sí.** Cartuchos de carga a la vista, sin armas. |
| ¿Evita parecer una copia? | **Sí**, no reproduce a ningún personaje; el riesgo es de arquetipo, no de copia. |
| ¿Se reconoce sin leer el nombre? | **Sí** entre los diez (capucha + cartuchos + violeta). |

**Desviaciones de la ficha que hay que decidir:** cicatriz casi invisible · solapas y cremallera
· micrófono añadido · ojos en penumbra (no sombra total; la sombra total salía como antifaz).

**Veredicto: GO técnico · arte = CANDIDATO.** Es un retrato original, coherente y bien integrado,
el primero real del producto. **No lo apruebo yo como estándar**: el techo de acabado lo pone un
modelo local de 6 B cuantizado, y la cara de una franquicia necesita el ojo de una persona.

## 27 · ¿Aprobado como estándar para los otros nueve?

**Todavía no.** Recomendación, en este orden:

1. **Revisión humana** del máster (`docs/product/art/veil/`) y de las capturas `fase48b/despues/`.
2. Si se aprueba con cambios, una **v2 de Veil** con la misma pipeline: sobretodo sin solapas (cuello alto de composite), cicatriz de quemadura legible, decidir si el micro entra en la ficha.
3. Sólo entonces producir los otros nueve con `docs/product/art/veil/pipeline/` como plantilla (mismo encuadre, luz, fondo gris plano, post de BiRefNet + llave, mismo contrato de peso).

Los otros nueve **no se han producido**, a propósito.
