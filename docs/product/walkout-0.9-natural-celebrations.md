# WALKOUT 0.9 — celebraciones humanas naturales

**Estado: WALKOUT 0.9 — NATURAL CELEBRATIONS READY FOR REVIEW.** Release preparada y compilada con la compuerta, **sin
activar** (`drl-0.1.1-1-e5db60b6`); producción sigue en `drl-0.1.1-1-1a675671` (0.8). Evidencia: `docs/product/qa/walkout-0.9/`.
Todo el render de esta revisión es por **software** (SwiftShader): no hay medidas en GPU real.

## 1. Causas exactas de las deformaciones

| Síntoma que viste | Causa medida |
|---|---|
| POINT TO SKY: brazo recto «como un palo» | No había animación: era una **IK analítica de dos huesos sobre el reposo** con la mano a 0,985 × la longitud del brazo ⇒ codo a ~10°. |
| POINT: el brazo barría en horizontal al subir | La IK se mezclaba con el reposo con `slerp` de cuaternios **locales**: el camino intermedio no es anatómico (a t = 0,3 s el brazo salía recto hacia el lado). |
| Muñeca y dedos raros | `setFromUnitVectors` gira lo mínimo para alinear el hueso, **sin controlar el giro del antebrazo**: la muñeca heredaba un giro arbitrario. El puño de Rocketbox era **procedural** (bisagras calculadas); el pulgar y el meñique no cerraban (en SHUSH se veían «cuernos»: índice + meñique). |
| Hombro y torso no acompañan | La IK tocaba solo brazo y antebrazo: **clavícula, tronco y cabeza quietos**. Al subir el brazo por encima del hombro sin elevar la clavícula, el hombro se hunde. |
| SHUSH: dedo en la nariz / mano contra la barbilla | La meta de los labios se estimaba desde el hueso `Head` (está en la base del cráneo) y se colocaba la MUÑECA, no el dedo: el índice acababa sobre la nariz y la mano se apoyaba en la barbilla. |
| (encontrado) ARMS CROSSED: pies que se deslizan | El clip cruzado (retargeteado) se aplicaba al cuerpo **entero**: cambiaba la postura de las piernas sin pie clavado. |
| (encontrado) HYPE: puño y brazo izquierdo rígidos | Puño = IK al cielo con el brazo estirado; el izquierdo, el de los clips de salto (en cruz). |
| (encontrado) HYPE: tirón en el despegue | `Jump_Start` 0→0,1 s a velocidad real: la cabeza saltaba **16 cm entre fotogramas** (≈ 10 m/s). Además, el contacto con el suelo solo se corregía con `lift = 0`: al empezar la parábola la persona **caía 7 cm de golpe**. |
| (encontrado, del rig) | En el Biped de Rocketbox **los muslos cuelgan de `Bip01 Spine`** y **las clavículas de `Bip01 Neck`**: girar ese hueso del tronco arrastra los pies y asentir con la cabeza mueve los hombros. |

Los tests anteriores estaban verdes con todo esto: fijaban coordenadas (la punta del índice «a < 9 cm de la boca»), no
anatomía.

## 2. La solución: captura primero

- **Movimiento capturado de Microsoft Rocketbox (MIT)**, el mismo esqueleto del avatar (sin retarget), aplicado **solo a
  los huesos que hacen el gesto** (máscaras: brazo, tronco, tronco+brazos), sobre el reposo del cuerpo entero:
  - `Cheer_04` (ya estaba en el asset): brazo arriba con la clavícula elevada, codo flexionado, **puño real**.
  - `TouchFace_01` (**añadido**, `m_idle_touch_face_01`, mismo repositorio y licencia): una mano que sube a la cara con
    el codo abajo.
- **IK solo de precisión**, al final y sobre la pose capturada, **conservando el plano del codo de la captura**:
  POINT (mano sobre la cabeza, codo ≈ 45°) y SHUSH (falange media del índice delante de los labios, medida con los
  huesos `MUpperLip`/`MBottomLip`).
- **Dedos de datos**: las formas puño / índice / shush / relajada salen del **puño capturado** de `Cheer_04`.
  El procedural queda solo como respaldo para un asset sin ese clip.
- **Una sola puerta** (`celebrate3d.ts`): la usan la escena y el laboratorio de QA, así que lo que se revisó en
  capturas es lo que ve el jugador.
- **Orden por fotograma**, siempre desde cero, así que nada se acumula:
  1. pies clavados;
  2. clips;
  3. capturas enmascaradas;
  4. tronco y cabeza;
  5. manos;
  6. IK de precisión.

## 3. Cada celebración

- **POINT TO SKY** (2,45 s):
  1. Gira y abre el pecho.
  2. La mano sube con el codo flexionado (subida de un brazo de `TouchFace_01`).
  3. Se funde con la pose alta de `Cheer_04`.
  4. La IK de precisión estira hasta ~45° de codo, y el índice queda extendido sobre el puño cerrado.
  5. La mirada sube con la mano y mantiene ~0,8 s.
  6. Baja con la bajada capturada de `Cheer_04` y vuelve al reposo.
- **SHUSH** (2,45 s):
  1. Mira a cámara y la mano capturada sube a la cara.
  2. El índice queda vertical, cruzando los labios, con la punta en la base de la nariz y sin atravesarla.
  3. El resto de dedos queda recogido sin apretar y la cabeza, un poco inclinada.
  4. Mantiene y baja con la bajada capturada.
  5. El «shhh» del audio sigue sincronizado con la llegada del dedo (0,75 s).
- **HYPE JUMP**:
  1. Durante la carrerilla, el puño se carga ante el pecho (codo flexionado).
  2. Sube con el impulso y culmina en lo alto del vuelo.
  3. El brazo izquierdo va relajado (antes iba en cruz).
  4. El despegue dura 0,28 s, como un impulso real.
  5. El contacto con el suelo es continuo: sin la caída de 7 cm.
- **ARMS CROSSED**: el clip cruzado va solo en el tronco y los brazos (las piernas, del reposo), con las manos recogidas.
  Los pies no se mueven (< 1 cm, test N05).
- **Fist pump**: no existe como celebración aparte; es el puño del HYPE. No he añadido celebraciones nuevas.

## 4. Antes / después

`docs/product/qa/walkout-0.9/compare/` (arriba antes, abajo después):
- `POINT_SKY-front-antes-despues.png`, `POINT_SKY-threeq-antes-despues.png`
- `SHUSH-front-antes-despues.png`, `SHUSH-threeq-antes-despues.png`, `SHUSH-perfil-antes-despues.png`
- `HYPE_JUMP-front-antes-despues.png`, `ARMS_CROSSED-side-antes-despues.png`

Hojas completas en `before/` y `after/`:
- **POINT** — frontal, perfil, tres cuartos y espalda, en inicio, mitad, arriba, mantiene, bajada y final; primer plano
  de mano (frente y perfil), cara y hombro.
- **SHUSH** — frontal, perfil y tres cuartos; primer plano de cara y de mano, de frente y de perfil.
- **HYPE y ARMS** — frontal, perfil y tres cuartos; ARMS también con primer plano de mano.

## 5. Vídeos

`docs/product/qa/walkout-0.9/video/` (30 fps, 2,8 s, fotogramas deterministas):
- POINT frontal y tres cuartos
- SHUSH tres cuartos y primer plano de cara
- HYPE frontal y tres cuartos
- ARMS frontal y tres cuartos

Hay una tira de fotogramas por vídeo (`strip-*.png`); se revisaron una a una: continuas, sin saltos ni remontajes.

**Escena real** (`docs/product/qa/walkout-0.9/stage/`): build de producción en el contenedor de QA aislado, con la
arena, la cámara de la timeline, el reflejo y las luces:
- WALKOUT a 1440 y a 390, MEGA (Japón) y RARE.
- Las cuatro celebraciones salen en 3D y la mano levantada queda dentro del encuadre en escritorio y en móvil.
- 0 errores de consola.

## 6. Tests

| | |
|---|---|
| Nuevos `walkout09.celebrations.test.ts` (rig real en Node) | N01 codo de POINT 25–70°, mano sobre la cabeza, índice arriba, corazón y meñique cerrados · N02 la clavícula sube y la mirada sube · N03 SHUSH: contacto delante de la boca, ningún dedo detrás del plano de los labios, punta bajo la nariz, codo flexionado · N04 todas vuelven al reposo · N05 ARMS: pies quietos · N06 sin acumulación (misma t ×3 = misma pose) · N07 sin saltos a 60 fps · N08 coste < 2 ms · N09 procedencia y nada de economía |
| Actualizados | C03–C05, R01–R02 (walkout03) y H12/H15/H16 (human3d): fijaban la IK antigua |
| Tests del walkout | 121/121 |
| Suite completa | **6360/6360** |
| Typecheck / lint | verde / 0 errores |
| `pack-opening:verify` | 34/34 |
| Build de producción (compuerta, mismos parámetros que el despliegue) | GATE_BUILD_OK `drl-0.1.1-1-e5db60b6` |
| Regresión 0.8 en la build | **57/57**: reducido → 2D sin three.js, Cinemática, 390, Reducidas, sin WebGL, contexto perdido, modelo que falla; cada especial con SU país |
| Ceremonia completa (SALTAR, REPETIR, doble clic, F5) | **90/90** a 1440 (8 escenas) · **41/41** a 390 |
| Escena real por celebración | 13/13 en cada una: 1440 WALKOUT, 390 WALKOUT, 1440 MEGA y 1440 RARE |

El instrumento de regresión de 0.8 tenía una **carrera propia**: pulsaba «Continuar» en el instante de `done=1`, antes
de que el botón se montara (s6 fallaba 1 de 57). La corregí en el instrumento, que ahora reintenta hasta cambiar de
especial. El producto no cambió por ello.

## 7. Rendimiento

- **Pose por fotograma, en Chrome, solo CPU:**
  - Reposo: 0,021 ms.
  - Celebraciones: POINT 0,095 ms, SHUSH 0,087 ms, HYPE 0,141 ms y ARMS 0,061 ms por persona.
  - La escena pinta dos (la persona y su reflejo): < 0,3 ms de los 16,7 ms de un fotograma a 60 fps.
- **Lo que no se ha añadido:** contextos WebGL, cálculo por fotograma salvo una IK analítica de dos huesos en POINT,
  SHUSH y HYPE, y cachés que crezcan (las pistas se muestrean con el interpolante de three, una lista por clip y
  máscara, que se libera con el rig).
- **Asset:** +189 KB (glTF+bin), total 2,34 MB de los 2,5 MB del presupuesto (test H13). Texturas idénticas byte a byte.
- **Sin cambios:** SALTAR, REPETIR, el respaldo 2D, el movimiento reducido, la preferencia «Animaciones de apertura» y
  la telemetría.

## 8. Release

- **Preparada, NO activada:** `drl-0.1.1-1-e5db60b6`, en `incoming/` del VPS, con la build de compuerta en verde.
- **Frontera demostrada:** respecto a la release viva, cambian exactamente los 10 ficheros del overlay (2 añadidos,
  8 modificados, 0 borrados) y F78 sigue siendo el de producción.
- **No se ha tocado:** economía, RNG, sobres, créditos, inventario, recompensas, BD, migraciones ni workers. No se ha
  gastado ningún sobre, ni se ha hecho commit ni push.
- **Producción:** `drl-0.1.1-1-1a675671` healthy, `/design-system` 404, el asset servido sigue siendo el de 0.8.
- **Desplegar tras tu revisión:** `ssh nexusadmin@212.95.40.144 /opt/nexus/projects/valorosters/bin/deploy.sh drl-0.1.1-1-e5db60b6`
- **Rollback:** `… bin/deploy.sh --activate drl-0.1.1-1-1a675671` (0.8) · walkout apagado: `--activate drl-0.1.1-1-69e4b672`.

Overlay:
- `src/domain/walkout/celebration.ts`
- `src/components/walkout/{human3d,stage3d,celebrate3d}.ts`
- `src/components/walkout/{walkout03,human3d,walkout09.celebrations}.test.ts`
- `public/walkout/human/{rocketbox-player.gltf,rocketbox-player.bin,LICENSE-ASSETS.txt}`

Instrumentos locales, fuera de CI y del overlay:
- `scripts/_walkout09/` (laboratorio `serve.mjs` + `lab.ts`, `shots.ts`, `stage-qa.ts`, `perf.ts`)
- `scripts/ops/_w09-{stage,gate}.sh`
- `scripts/_walkout-rocketbox-build.mjs` (clip añadido)
- `scripts/_walkout08-qa.ts` (`QA_OUT` y la carrera de «Continuar»)

## 9. Pendiente

1. **Tu revisión visual.** Yo lo he revisado en capturas, vídeos y la escena real, pero no lo ha visto ningún humano.
   Tampoco hay medida en GPU real: todo es render por software.
2. **HYPE:** el puño sale con el impulso a ~8 m/s, como uno real, pero es el gesto más rápido. El brazo izquierdo es el
   del reposo, no una captura de salto. En el despegue queda una oscilación de ~2 cm de la raíz: el contacto de la punta
   del pie que se estira; ya no hay caída de 7 cm.
3. **Contactos sin malla de colisión:** el índice del SHUSH apoya a 2,1 cm por delante de los huesos de los labios,
   ajustado a ojo en primer plano. La mano de ARMS CROSSED, sobre la manga, no está verificada al milímetro.
4. **Quaternius** (avatar solo de comparación, `?avatar=quaternius`) no tiene los clips capturados: allí POINT y SHUSH
   caen a la pose segura (reposo). La persona de producción es Rocketbox.
5. `Cheer_05` sigue en el asset sin uso (no lo he quitado para no tocar más bytes de los necesarios).
