# Apertura de sobres · sala por rareza y sin monigote (2026-10-15)

Estado: **en local, sin desplegar ni subir** (rama `feat/pack-opening-atmosphere`). Producción sigue en `drl-0.1.1-1-baddbaed`.

## 1. Qué había
- `PackOpeningExperience`: sobre → rotura → **walkout 3D** (la figura humana Rocketbox: el «monigote», solo para cartas especiales, `PACK_WALKOUT_3D_ENABLED = "all"`) → hero → **resto en cascada de miniaturas** → resumen.
- El fondo era el del **sobre** (`PackBackdrop`, color del sobre) más un tinte radial del color de la *edición* de la hero. Ese tinte no coincidía con lo que ve el jugador: por ejemplo, Masters L/SDC usan la paleta de respaldo `cinematic`, que es naranja, y las cartas Masters reales son violetas. El resto del sobre no cambiaba la sala.

## 2. Qué hay ahora
- **Sin monigote.** La apertura no importa, no carga y no monta el walkout en ninguna fase, y el interruptor queda en `off`. No se borró ninguna pieza del walkout: sigue disponible como vista previa protegida en `/admin/walkout`. Las cartas y su arte no se tocan.
- **Sala por rareza** (`domain/packs/atmosphere.ts` + `RevealAtmosphere.tsx`). Es una sola capa persistente que toma el color de la carta en escena.
  - **Clave:** la clase canónica `packCardClass(card)`, que sale de la edición y el OVR del catálogo, los mismos datos que guardó el servidor. Nunca el nombre ni el precio.
  - **Reserva neutra:** se usa en la tensión antes de cada giro y para cartas que no se pueden clasificar.
  - **Ediciones fuera de la línea:** toman el color de su propia edición.
- **Resto carta a carta** (`RestReveal`). Cada carta tiene su momento: luz neutra mientras se carga el dorso, giro y luego la sala de su rareza.
  - **Navegación:** «Anterior», «Siguiente» y «Ver resumen»; teclas ← → Enter; con un toque avanza. Lo ya visto vuelve boca arriba.
  - **Puntos de posición:** solo colorean cartas ya vistas.
  - La posición la lleva `revealReducer` (`restIndex`, `restShown`, `restSeen`; eventos `REST_SHOWN` y `BACK`).
- **Carta en escena compartida** (`RevealSpotlight`): giro, ficha y efectos proporcionados a la rareza. Ya no hay destello a pantalla completa: la clase más alta tiene un florecer suave.
- **Movimiento reducido:** respeta el del sistema, salvo que el jugador elija otra cosa en «Animaciones de apertura» (Cinemática, Automático o Reducidas). Esa preferencia ahora rige toda la apertura y sus textos ya no hablan de 3D (8 idiomas).

## 3. Colores
| Clase (ediciones) | Sala | Luz | Intensidad | Fuente |
|---|---|---|---|---|
| Base (base, OVR 70–81) | pizarra `#2f3a4b → #080b11` | `#8b96a3` | 0 · reflejo suave | `PACK_CLASS_COLOR.base` |
| Plata (base, OVR 82–85) | plata `#4a5664 → #0a0d12` | `#cfd6de` | 0 · reflejo metálico | `PACK_CLASS_COLOR.plata` |
| Oro (base, OVR 86–92) | dorado `#a0700f → #1e1403` | `#ffce4f` | 1 · reflejos metálicos | `PACK_CLASS_COLOR.oro` |
| Masters (Masters L/SDC) | **lila/violeta** `#5a2ea3 → #140726` | `#b48cff` | 2 · corona + motas | arte real de las cartas Masters |
| Champions (Champions S) | negro con oro campeón `#3a2e10 → #040302` | `#ffe08a` | 2 · corona + reflejos | `PALETTES.champion` + arte |
| Prime (Future Star) | azul cósmico `#2140a8 → #050a26` | `#3aa6ff` | 2 · corona + motas | `PACK_CLASS_COLOR.prime` |
| Icon (Record Breaker, Moments) | **marfil** `#fffcf4 → #d8ccab` (sala clara, ficha en tinta oscura) | `#ffffff` | 3 · corona, reflejos, motas y florecer | `PACK_CLASS_COLOR.icon` |
| Fuera de la línea | el color de su edición | `palette.primary` | 1 | `VARIANTS` |
| Desconocida o preparación | neutra `#161a29 → #04050b` | `#9aa7c7` | 0 | — |

## 4. Pruebas
- `src/components/packs/packAtmosphere.test.tsx` (17 pruebas), con catálogo real y escenas del arnés:
  - color por clase y cobertura de las 331 cartas;
  - reserva segura ante datos no válidos;
  - sobre de 7 clases con una sala por revelado, sin la sala anterior, y la preparación neutra;
  - avanzar, retroceder, terminar y «abrir otro»;
  - sobre de una carta;
  - resultado y orden intactos, con 1 sola petición;
  - sin walkout;
  - contrato de que el elemento que gira en 3D no lleva `filter` (lo aplanaría y se vería el dorso espejado: pasó durante la QA y se corrigió).
- Pruebas antiguas reescritas para fijar el comportamiento nuevo: walkout05 P17/P21/P23/P24/P25, walkout06 D01/D02/D07, walkout08 M03/M10, f57 A4 y behavior REVEAL.
- Suite completa **6.613/6.613**, `tsc` 0 errores, ESLint 0 errores (los 30 avisos de siempre), i18n «sin problemas», `next build` OK (con el aviso previo de `instrumentation.ts`).
- Navegador (`scripts/_pack-atmosphere-qa.ts`, build de producción local con el arnés `/design-system/fase81`, escenas `r-mixed`, `r-masters`, `r-icon`, `r-gold`), a 390/768/1440 con movimiento normal y reducido: **232 PASS · 0 FAIL**.
  - Sala correcta por carta (clave y uid), y la anterior ya no está al girar.
  - Sin `<canvas>` ni walkout en ninguna fase.
  - Atrás y adelante, cerrar a mitad y omitir funcionan.
  - El resumen trae las mismas cartas con 1 sola apertura.
  - Carta, ficha y botones dentro del viewport sin solaparse; imagen cargada y cara visible.
  - Sin errores de consola ni respuestas ≥ 400.
- Capturas: `docs/product/qa/pack-atmosphere-2026-10-15/`.

## 5. Pendiente
- **Identidad de Masters y Champions sin unificar.** `PACK_CLASS_COLOR` (barras de probabilidades de tienda y fichas) sigue con Masters en naranja y Champions en violeta, que no coincide con el arte. La sala sigue al arte. Unificarlo es otra decisión, porque toca la tienda.
- **Sin probar en producción con sesión real ni con aperturas reales.** Por diseño, la QA usa resultados fijos.
- **Sobres de más de 5 cartas:** el resto pide un toque por carta, aunque «Omitir» sigue disponible siempre.
- **Recuperación tras F5:** sigue yendo directo al resumen, sin ceremonia, como antes.

## 6. Revisión final (2026-10-15, segunda pasada)

Problemas encontrados y corregidos:
1. **Finales de línea:** las primeras ediciones convirtieron 3 ficheros CRLF a LF (`fase81/page.tsx`, `RestReveal.tsx`, `packOpening.behavior.test.ts`). El diff mostraba 105 y 192 líneas en vez de 11 y 6. Restaurado; ningún fichero cambia ya de estilo.
2. **«Animaciones de apertura» no llegaba a todas las piezas.** `SealedPack` y `CardBack` leían solo el sistema: con «Reducidas» y el sistema sin restricción, el sobre y el sigilo del dorso seguían moviéndose. Ahora tienen la propiedad opcional `reducedOverride`, que solo pasa la ceremonia; la tienda y las demás pantallas siguen con el sistema. Prueba SCN6.
3. **«Anterior» ilegible en la sala marfil (Icon):** era el secundario translúcido, con texto blanco sobre marfil. En sala clara ahora tiene fondo oscuro. Prueba SCN7 y comprobación de contraste en la QA.
4. **Instrumento de QA** (no del producto):
   - `x ?? "" === "y"` hacía que las esperas no esperasen;
   - un escape de expresión regular dentro de una plantilla estaba roto;
   - el servidor lanzado aparte moría a mitad: ahora la QA arranca el suyo (`QA_SERVE=1`).

Ampliaciones de la QA:
- Sobres de 1, 5, 6, 7 y 10 cartas (escena de estrés `r-big`): recorrido completo en el orden del plan, «Omitir» desde el resto en menos de 40 ms, el resumen con las mismas cartas, 1 sola petición y 1 sola apertura.
- «Cerrar» desde el resumen lleva a `/coleccion`.
- Las 4 combinaciones de preferencia × sistema: el modo correcto, la cara visible y el dorso oculto sin estados intermedios, y avanzar, retroceder y omitir funcionando.

Resultado: QA **348 PASS · 0 FAIL** (390/768/1440 × normal/reducido), suite **6.615/6.615**, `tsc` 0, ESLint 0 errores (los 30 avisos de siempre), i18n «sin problemas», build OK (con el aviso previo de `instrumentation.ts`).

## 7. Release preparada (NO desplegada)

| | |
|---|---|
| Candidata | **`drl-0.1.1-1-2b8f8817`** → `valorosters-i18n-qa/rc/drl-0.1.1-1-2b8f8817.tar` |
| sha256 | `8f6cdf70199c6c6df10175fa023bbefbbe7e2f6f5c2ec43891065fe03f544d3b` (97.945.600 B) |
| Contenido | fuente de producción `drl-0.1.1-1-baddbaed` + overlay de 46 ficheros de `src/`, sacado del commit `515ad89` (sha256 del overlay `a66128ad…5dc1`). El padre de los 42 modificados es byte a byte el de producción; los otros 4 son nuevos |
| Stage (`scripts/ops/_pack-atmosphere-rc-stage.sh stage`) | BOUNDARY_OK (46 = overlay exacto, 0 retirados) · F78 = producción · NO_MIGRATIONS_OK (cabeza 0076 = producción; sin `supabase/`, `docs/` ni instrumentos `_`) · ECONOMY_RULES_OK · PACKS_DOMAIN_OK (en `domain/packs` solo `reveal.ts` y `atmosphere.ts`) · WALKOUT_OUT_OK (`/admin/walkout` presente) |
| Puerta (contenedor desechable, entorno del stack de QA) | **GATE_OK**: `npm ci` + `next build` + `tsc` + ESLint 0 errores (30 avisos de siempre) + i18n «sin problemas» + **6.606/6.606** pruebas (9 menos que en local: son del trabajo F78, que no viaja) · BUILD_HAS_ATMOSPHERE_OK · BUILD_ID = nombre |
| Candidata fallida | `drl-0.1.1-1-92a99190` (sha256 `1e7aa9a5…c4ff`): la puerta la paró porque al commit `aed5ac6` le faltaba `RevealSpotlight.tsx`. Arreglado en `515ad89`. Se deja en `rc/` sin usar; no está en `incoming/` ni en `releases/` |
| Producción | sin cambios: `current` → `baddbaed`, `/api/ready` ready, app sin reiniciar, artefacto anterior con sha256 `2d19ca56…94cc` intacto |

**Activar** (decisión del propietario; hace falta una copia de seguridad del mismo día ya verificada):
`ssh nexusadmin@212.95.40.144 'bash /tmp/pa-rc/_pack-atmosphere-deploy.sh /opt/nexus/backups/supabase-drlcards/<carpeta>'`
(guion `scripts/ops/_pack-atmosphere-deploy.sh`, sha256 `e81b5dca…d4d1`). Antes de activar, el guion comprueba:
- que la versión activa sigue siendo `baddbaed`;
- la copia de seguridad;
- la suma de control del artefacto anterior y de la candidata.

Después copia la candidata a `incoming/` y llama a `bin/deploy.sh`, que solo recrea `valorosters-app` y no ejecuta migraciones.

**Rollback:** `cd /opt/nexus/projects/valorosters && bin/deploy.sh --activate drl-0.1.1-1-baddbaed`. Solo frontend: no hay que restaurar la base de datos.
