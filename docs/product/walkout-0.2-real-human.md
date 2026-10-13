# VALOROSTERS — WALKOUT 0.2: REAL HUMAN CINEMATIC

2026-10-08 · ruta interna `/design-system/pack-walkout` (404 en producción) · sin commit, sin push, sin despliegue, sin migración.

**Veredicto: WALKOUT 0.2 — REAL HUMAN = READY FOR VISUAL REVIEW** — con los límites de la sección 13, que hay que mirar a ojo (sobre todo: es un humano *estilizado-realista* de juego, no un escaneo fotorrealista, y no hay medición en GPU real).

## 1 · Modelo humano seleccionado
**Quaternius · Universal Base Characters · `Superhero_Male_FullBody`** (versión Standard, gratuita): humano completo de proporciones anatómicas, malla de juego de ~12,6 k triángulos (cuerpo) + cara, ojos, cejas y pelo `Hair_SimpleParted`, con texturas PBR (albedo, normal, rugosidad), cuello, manos con cinco dedos articulados (15 huesos por mano), pies y un esqueleto humanoide de **65 huesos** estilo UE5.

Animación: **Quaternius · Universal Animation Library 1 y 2** (CC0), autoradas para ese mismo esqueleto (sin retargeting): `Walk_Loop` (paso), `Idle_FoldArms_Loop` (reposo con brazos cruzados, el que se usa al llegar) e `Idle_Loop` (reposo alternativo, para QA). Se compararon también `Walk_Formal_Loop` e `Idle_No_Loop` y se retiraron del asset para no pesar.

**Por qué este y no otro (opciones evaluadas):**
| Opción | Resultado |
|---|---|
| Mixamo | Calidad buena, pero exige cuenta Adobe para descargar y su FAQ prohíbe redistribuir los ficheros «raw»; un GLB servido en `public/` es descargable tal cual → riesgo de licencia. Descartado. |
| Ready Player Me | Tras la compra por Netflix (dic. 2025) sus servicios públicos para desarrolladores (creador, API, SDK) se apagaron a finales de enero de 2026, según fuentes secundarias (ryanschultz.com, avatarsdk.com); no encontré comunicado oficial. No disponible. Descartado. |
| Sketchfab | Hay humanos CC-BY riggeados, pero la descarga exige cuenta y cada modelo trae su licencia, su rig y (a menudo) ningún paso propio. **No lo exploré a fondo**: la opción elegida ya cumplía todo sin cuenta. Queda como vía para un humano más realista (con atribución CC-BY). |
| Khronos / three.js examples (Soldier, Michelle, Xbot, CesiumMan) | Soldier/Michelle son de Mixamo (misma duda); Xbot es un robot; CesiumMan, de baja calidad. |
| **Quaternius UBC + UAL** | **CC0 en el `License.txt` de cada zip, descargable sin cuenta, glTF nativo, mismo esqueleto para cuerpo y 260 clips, peso contenido. Elegido.** |

## 2 · Origen y enlaces
- Cuerpo y pelo: https://quaternius.itch.io/universal-base-characters (también https://quaternius.com/packs/universalbasecharacters.html) — `Universal Base Characters[Standard].zip` (122 MB).
- Paso y reposo: https://quaternius.itch.io/universal-animation-library y https://quaternius.itch.io/universal-animation-library-2 — `…[Standard].zip`.
- Descargados el 2026-10-08 por el flujo público «name your price» de itch.io (sin cuenta, sin pago).

## 3 · Licencia (verificada)
- **Dentro de los zips** (`License_Standard.txt`, `License.txt`): «CC0 1.0 Universal (CC0 1.0) Public Domain Dedication — https://creativecommons.org/publicdomain/zero/1.0/ — Models by @Quaternius». Leído en los ficheros descargados.
- La ficha de itch.io dice también «Creative Commons Zero v1.0 Universal».
- La web de Quaternius publica además una «Quaternius Asset License» (actualizada el 2026-08-28) para lo que se publique bajo ella. Los ficheros de esta fase declaran CC0 en su propio License.txt. Aun así, esa licencia también permite el uso comercial en juegos y solo prohíbe revender los assets como pack suelto.
- Uso comercial ✔ · integración en un juego web ✔ · distribución dentro de la app ✔ · atribución: no exigida, documentada igualmente en `public/walkout/human/LICENSE-ASSETS.txt`.
- No es asesoramiento legal: si el juego se comercializa, conviene guardar los zips originales (están en el scratchpad de la sesión; no en el repo).

## 4 · Formato y tamaño
`public/walkout/human/`:
| Fichero | Bytes |
|---|---|
| `esports-player.gltf` (JSON: escena, esqueleto, 3 clips) | 244 822 |
| `esports-player.bin` (geometría + animación) | 627 872 |
| `body-albedo/normal/orm.webp` (1024²) | 130 572 |
| `hair-albedo/normal.webp` (1024²) | 114 292 |
| `eye-albedo/normal.webp` (256²) | 2 308 |
| **Total** | **≈ 1,12 MB** |

**Por qué `.gltf` + recursos externos y no un `.glb`:** la CSP de la app (`connect-src 'self' …`, sin `blob:`) bloquea cómo GLTFLoader decodifica las texturas embebidas en un GLB (`fetch(blob:…)`). Con ficheros externos del mismo origen no hace falta tocar la política de seguridad global.

Construcción reproducible: `scripts/_walkout-human-build.mjs` (gltf-transform + sharp, dependencias instaladas aparte, no en `package.json`): fusiona cuerpo + pelo + clips, retira el resto, remuestrea la animación, texturas a WebP 1024 y mide la zancada en la variante root motion.

## 5 · Rig y animaciones
- Esqueleto de 65 huesos (pelvis, 3 vértebras, cuello, cabeza, clavículas, brazos, antebrazos, manos con 5 dedos × 3 falanges, muslos, gemelos, pies y bola del pie).
- **Paso real** `Walk_Loop`: cadera que oscila, balanceo de brazos opuesto, flexión de rodilla, talón → planta → despegue de la punta, torso que contrarrota y transfiere el peso. Es una animación esquelética de librería, no una interpolación manual.
- **Zancada medida** en `UAL1_Standard_RM.glb`: 1,30 m por ciclo de 1,333 s.
- **Reposo** `Idle_FoldArms_Loop`: llega, cruza los brazos y respira (se compararon tres reposos; todos comparten la misma postura de piernas abiertas «de poder»).

## 6 · Integración en Three.js
- `src/components/walkout/human3d.ts` (nuevo; solo lo importa `stage3d.ts`, que entra por import dinámico):
  - `loadHumanAsset()`: GLTFLoader, una carga por página, cacheada; **un fallo no se queda en caché** (se reintenta).
  - `createHumanRig()`: `SkeletonUtils.clone` + `THREE.AnimationMixer` con dos acciones (paso y reposo) cuyos pesos y tiempos se fijan **desde el fotograma de la timeline** (`pose()`): mismo instante → misma pose; SALTAR, REPETIR y congelar siguen siendo deterministas.
  - **Cuerpo de atleta** (`athleticBuild`): el cuerpo «superhéroe» se adelgaza en la pose de reposo ponderado por los pesos de cada hueso: brazos ×0,76/0,85 hacia su eje, muslos, cuello, pectorales, dorsales y trapecios. El esqueleto no cambia.
  - **Ropa esports** (`tailorOutfit`): camiseta técnica de manga larga y jogger como capas desplazadas sobre la propia piel, con los mismos pesos del esqueleto y un drapeado laplaciano para no marcar cada músculo. La piel tapada se retira; los bordes se quedan para que no haya huecos bajo puños y cuello. Las **zapatillas son paramétricas** (`sneaker`): suela plana clara con la puntera levantada, contrafuerte, empeine, pesos al pie y a la bola, sin dedos. Tela con normal de punto generada en un lienzo y `sheen` (terciopelo) en escritorio. Ribete del color de la edición en cuello, mangas, costura del pantalón y talón. **Sin logos ni patrocinadores.**
  - Shader compartido (inyección en `MeshStandard/Physical`): **contraluz fresnel** del color de la edición y **disolución ascendente** en celdas con borde incandescente (la transición a la carta).
  - `foot()` y `lift()`: posición de la bola del pie e **IK de dos huesos** (cadera, rodilla, tobillo) para levantar el pie libre conservando su orientación.
- `src/domain/walkout/walk.ts` (nuevo, puro): arranque de 0,7 s → crucero → frenada de 1,15 s → quieto. La **fase del clip sale de la distancia** (`walkTime = distancia / zancada × ciclo`): la velocidad de los pies corresponde siempre al desplazamiento (sin patinar, también al frenar). El trayecto es de 4,36 zancadas, para **terminar en la fase 0,36**, medida: el pie de apoyo bajo la pelvis y el otro pasando a su lado. `footfalls()` da los instantes de apoyo: **el audio de pasos cae cuando el pie toca el suelo**.
- `stage3d.ts`: el maniquí procedural (`buildHuman`) **se ha eliminado**. En la frenada, mientras el reposo sustituye al paso, el **pie de apoyo queda clavado** (la raíz se compensa) y el **pie libre da un paso en arco** con la IK en vez de arrastrarse. La persona tiene su reflejo en el suelo (un segundo rig sin sombras).
- Si el modelo no carga: `ready` rechaza → `WalkoutStage` pasa a **2D** sin parar la timeline (comprobado en navegador).

## 7 · Calidad visual de la caminata (medida, no solo vista)
`scripts/_walkout-footslide.ts` recorre el paseo a 60 fps y lee la posición en el mundo de la bola de cada pie:
| Medida | Antes del ajuste | Final |
|---|---|---|
| Deslizamiento del pie apoyado, crucero | — | 4–7 mm por apoyo (izq.) · 5–7 mm (der.) |
| Frenada: pie de apoyo | 33 cm | **4–7 mm** |
| Frenada: pie libre al llegar | 32 cm (arrastre) | **1–3 mm** (da un paso en arco) |
| Suela respecto al suelo en reposo | — | ±2 cm (test H08) |
| Cadencia | 1,34 × la del clip (prisa) | **1,22 ×** (1,19 m/s, paso humano) |

Visto en vídeo lateral y frontal de los pies (QA): talón, planta y punta; la rodilla se dobla en el balanceo y los brazos van opuestos a las piernas. **La persona frena, da su último paso y cruza los brazos.**

## 8 · Iluminación
- **Contraluz** (foco con sombra PCF 1024/512) que sigue a la persona desde detrás y arriba: la recorta y proyecta su **sombra hacia la cámara** sobre el suelo semirreflectante.
- **Dos recortes traseros** a ras de hombro (color de la luz y del acento de la edición): bordes de brazos y piernas.
- **Relleno hemisférico muy bajo** (0,12): se intuye el volumen sin aplanar la silueta; sube con la media («las luces aumentan»).
- **Frontal alto** solo al detenerse: ilumina el cuerpo y deja la cara bajo la sombra de la frente. En el clímax no se enciende de frente (la figura se volvía un maniquí gris, corregido): lo que estalla es el contraluz y el borde fresnel.
- Al fondo empieza casi como silueta, pero con volumen y borde, no en negro plano.

## 9 · Transición humano → carta
1. Se detiene (7,4–8,4 s) y cruza los brazos. 2. Edición (7,6) y media «9»→«95» **a su derecha**, nunca sobre la cara. 3. El relleno y el frontal suben. 4. Flash (9,2): el borde de luz de la silueta estalla. 5. **La persona se disuelve de los pies a la cabeza en celdas de luz con borde incandescente** mientras la carta canónica sale de esa luz en el mismo sitio (9,9–10,75). 6. Nombre (9,75). 7. Carta completa (11,0). La identidad es solo la de la carta (`Card3D → CardVisual → PlayerCard`): la persona 3D es genérica y su cara no representa a nadie.

## 10 · Rendimiento escritorio/móvil (lo que se pudo medir)
- **Carga de la persona:** 340–610 ms en dev local (incluye el clonado, la ropa y el adelgazado: 31–38 ms en Node).
- **Por fotograma (persona + reflejo + sombra + túnel):** 116 llamadas de dibujo y 54 k triángulos. Geometrías y texturas vivas en la GPU: 60 y 23 durante el paseo. Memoria JS de la página: 39 MB (1440) y 47 MB (390 × DPR 3).
- **DPR:** tope 1,5 en escritorio y 1,25 en móvil (390 × DPR 3 → lienzo de 487 × 1055). En móvil la tela es `MeshStandard` (sin sheen) y la sombra va a 512.
- **Ritmo:** solo se ha podido medir con WebGL **por software**. Tanto el Chrome headless como tu Chrome (comprobado con la extensión) informan «Microsoft Basic Render Driver»: el WebGL de tu Chrome **no está usando la RTX 3060**, revisa `chrome://gpu` y la aceleración por hardware. Así, con render por CPU: p50 de 33 ms (≈30 fps) y p95 de 50 ms a 1440, y p50 = p95 = 33 ms a 390. **No hay medida en GPU real: no se inventa.**
- Limpieza: REPETIR ×5 y cambiar de edición ×3 dejan 1 lienzo y 1 contexto vivos. `dispose` libera geometrías y materiales del rig (test H11). Tras SALTAR no se dibuja más.

## 11 · Capturas y vídeos
`docs/product/qa/walkout-0.2/`:
- Beats a 1440 y 390 (champions-s, WALKOUT): `1-figura-al-fondo`, `2-inicio-caminata`, `3-bandera`, `4-mitad-caminata`, `5-impacto-escudo`, `6-deteniendose`, `7-ovr`, `8-transicion`, `9-transicion-b`, `10-carta-final`.
- Otras ediciones (base, record-breaker) e intensidad MEGA_WALKOUT (future-star).
- `footslide-report.json` (deslizamiento por apoyo, versión final) y `runtime-asset-failure-final-1440.png`.
- **Vídeos: NO generados en la versión final.** Claude Code detuvo el lote final (y el servidor de desarrollo) porque el PC se quedó sin memoria (3,8 GB libres de 16). Durante el trabajo sí se revisaron vídeos y hojas de contactos intermedios (lateral de pies y paseo completo) en el scratchpad de la sesión, pero no se publican porque no corresponden al código final. Para generarlos: `npm run dev` y luego `BASE_URL=http://localhost:3000 WALKOUT_OUT=docs/product/qa/walkout-0.2 npx tsx scripts/_walkout-video.ts champions-s WALKOUT 1280 0` (y `390`; para los pies, `WALKOUT_FROM=2.4 WALKOUT_TO=8.9 WALKOUT_CAM="2.6,0.6,0.4,0,0.5,0" WALKOUT_TAG=-pies-lateral … 960 0`).
- El rol «CONTROLADOR» rozaba el hombro de la persona en la captura `base-…-4-mitad-caminata`. Se corrigió después (entra al 62 % y más a la izquierda), pero esa captura es anterior al ajuste y **la corrección no se ha visto en el navegador**.

## 12 · Tests
- **Nuevos H01–H12** (`src/components/walkout/human3d.test.ts`). Cubren: el paseo (arranque, marca, sin tirones), que la fase sale de la distancia, la cadencia en WALKOUT/MEGA y los pasos sonoros. También el asset (externo, 65 huesos, clips, peso < 2 MB), la licencia, y el **rig real cargado en Node**: ropa con cara y manos a la vista, pose determinista, IK, suela en el suelo y atleta con la cabeza intacta. Y por último que la carga no deja un fallo en caché, el `dispose` y la arquitectura (three solo en stage3d + human3d, fallo del GLB → 2D).
- **Nuevo W21**: con la persona en escena ninguna pista entra sobre ella y el escudo se retira tras el impacto.
- **Reapuntados (no relajados):** W02 (final a 11,0 s y la secuencia 0–11 del encargo), W05 (ventana del reloj hasta 12 s), W08 (instante 6,0 s), W19 (media parcial a 8,2 s), W20 (human3d puede importar three) y ENV 62 (three en stage3d + human3d).
- **Suite completa: 6272/6272** (baseline 6259 + 13). Lint: 0 errores (los 3 avisos de `Reveals.tsx` son de 0.1). Typecheck ✔. Build ✔.
- Navegador (`_walkout-runtime.ts`, versión final): SALTAR por teclado, REPETIR ×5, cambio de edición ×3, contexto perdido → 2D, sin errores de consola, asset roto → respaldo y 0 peticiones `/api`. **Persona que no carga → 2D y termina**, reducido 2D de 3,3 s y coste por fotograma: comprobados en la pasada anterior (con la persona ya integrada); en la final no llegaron a ejecutarse por el corte de memoria.
- Se corrigió un aviso de React («Maximum update depth exceeded»): el panel del prototipo hacía `setState` en cada fotograma y, con el 3D pesado, encadenaba renders. Ahora solo se actualiza cuando algo cambia de verdad. Antes fallaba 2 de 2 veces; ahora, 0 de 3.
- Producción: `/design-system/pack-walkout` → 404 sin arnés (comprobado con `next start`). three + GLTFLoader en un único chunk perezoso que ninguna página referencia de entrada.

## 13 · Problemas pendientes (honestos)
1. **Estilo:** humano de juego estilizado-realista (texturas a 1024, cara sencilla), no fotorrealista. Si se quiere más: la versión Source del pack (19,99 $) trae proporciones «Regular» (menos de cómic) y 20 peinados; o un humano a medida.
2. **Proporciones:** el cuerpo base es «superhéroe»; adelgazado en código, sigue siendo ancho de hombros.
3. **Ropa generada:** convincente en contraluz y a media distancia. De cerca es tela ajustada sin pliegues reales, y las zapatillas son una forma sencilla, sin cordones.
4. **Ritmo en GPU real** sin medir (tu Chrome usa WebGL por software). Pendiente de mirarlo en un PC con aceleración y en un iPhone/Android de verdad.
5. **El paso** es una animación de librería con 1,22 × de cadencia. El último paso de la frenada es una síntesis (bloqueo de pie + IK), creíble pero no un clip de «stop» capturado.
6. El reflejo del suelo es un segundo rig: duplica el coste de skinning (barato con 65 huesos, pero es coste).
7. Los ficheros de `public/walkout/human/` existen también en un build de producción (inertes: la ruta que los usa es 404). Si se despliega antes de decidir, se puede excluir esa carpeta.
8. Audio sigue sin escucharse en esta sesión (sintetizado; ahora sincronizado con los apoyos).

## 14 · Cómo abrirlo
- `npm run dev` → **http://localhost:3000/design-system/pack-walkout?reduced=0**
- Tu Chrome declara movimiento reducido: sin `?reduced=0` verás la versión 2D corta.
- QA: `&fx=base|future-star|champions-s|record-breaker|moments|masters-l|masters-sdc` · `&i=WALKOUT|MEGA_WALKOUT` · `&t=<s>` · `&cam=x,y,z,lx,ly,lz` (cámara libre relativa a la persona) · `&idle=Idle_Loop|Idle_FoldArms_Loop`.

## Ficheros
- Nuevos: `src/components/walkout/human3d.ts`, `src/components/walkout/human3d.test.ts`, `src/domain/walkout/walk.ts` y `public/walkout/human/*` (asset + `LICENSE-ASSETS.txt`). Instrumentos locales fuera de CI: `scripts/_walkout-human-build.mjs`, `_walkout-human-shots.ts`, `_walkout-footslide.ts` y `_walkout-outfit.ts`.
- Tocados (todos del prototipo 0.1, sin seguimiento): `stage3d.ts`, `WalkoutStage.tsx`, `WalkoutDirector.tsx`, `Reveals.tsx`, `walkout.test.tsx`, `timeline.ts`, `audio.ts`, `pack-walkout/page.tsx` y los instrumentos `_walkout-video.ts` y `_walkout-runtime.ts`. Fuera del walkout, solo el pin ENV 62 de `environment.test.tsx`.
- Nada de RNG, probabilidades, economía, inventario, compras, recompensas, BD, Pack Opening real, Marketplace, pagos, sistema de cartas ni usuarios. Sin dependencias nuevas en `package.json`.
