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

## 8. Despliegue (2026-10-15, 20:10–20:14Z) — DESPLEGADA

| | |
|---|---|
| Antes → ahora | `drl-0.1.1-1-baddbaed` → **`drl-0.1.1-1-2b8f8817`** (activación 20:10:04Z–20:13:45Z, autorizada por el propietario) |
| Artefacto | sha256 `8f6cdf70199c6c6df10175fa023bbefbbe7e2f6f5c2ec43891065fe03f544d3b` = el registrado por la puerta. El valor del encargo (`8f6cdf70…bbefbd3b`, 35 caracteres) era ese mismo hash truncado: coinciden sus 32 primeros caracteres y el final |
| Revalidación en el VPS | candidata = fuente de producción + 4 añadidos + 42 modificados (= overlay); 0 retirados; sin `supabase/`, servidor, API, sync, store ni economía; cabeza de migraciones 0076 = la de producción; walkout en `off` y sin referencias en la apertura |
| Copia | `/opt/nexus/backups/supabase-drlcards/pre-pack-atmosphere-deploy/20261015T200918Z`: BACKUP_OK, `COMPLETE`, los 7 `SHA256SUMS` OK, `pg_restore --list` legible (2.484 entradas = `db.toc`), BD 2.978.807 B. Configuración en `pre-pack-atmosphere-deploy-config/20261015T200918Z` (`compose.yml`, `app.env`, `current.txt`; 700/600; huellas OK). Sin réplica externa (no configurada) |
| Previas | `current` = baddbaed; `/api/ready` ready; artefacto anterior sha256 `2d19ca56…94cc` y `releases/drl-0.1.1-1-baddbaed` presentes; sin build, puerta, copia ni restauración en curso; ninguna tarea programada en esa franja |
| Guion | `/tmp/pa-rc/_pack-atmosphere-deploy.sh`, sha256 `e81b5dca…d4d1` (el del repositorio): BACKUP_VERIFIED, PREV_ARTIFACT_OK, RC_OK, sha256 en `incoming/` OK → `bin/deploy.sh` |
| Después | `current -> releases/drl-0.1.1-1-2b8f8817`, BUILD_ID igual. `/api/ready` ready con 20/20 checks. App healthy sin reinicios; túnel con 4 conexiones; público 200 |
| Estáticos y páginas | chunk con la sala nueva servido (200, JavaScript). `/`, `/coleccion`, `/tienda`, `/packs`, `/jugar`, `/temporada`, `/cuenta`, `/abrir/estandar`, `/api/health`, `/api/ready` → 200. Arneses `/design-system/fase81` y `/design-system/pack-walkout` → 404. `/admin/walkout` → «Acceso restringido» para invitados |
| Navegador (invitado, sin abrir sobres) | `/abrir/estandar` en el sobre cerrado: 0 chunks del walkout descargados, 0 `<canvas>` dentro de la apertura (el único es la capa global de ambiente), sin errores de consola ni respuestas ≥ 400 |
| Humo | invitado en 8 idiomas **132/0**; logos 41/41 + 3 × 404 |
| Logs | 0 líneas de error, fatal o unhandled desde el arranque |
| Datos | 25 recuentos (solo lectura) = la copia previa = la línea base anterior (2 perfiles, 130 cartas, 14 sobres, 80 transacciones…); última transacción de créditos 2026-10-14 11:47Z, anterior al despliegue |
| Migraciones / economía | ninguna migración; nada de servidor, probabilidades, precios, créditos ni inventario en la release |

**Pendiente:** la animación no se ha probado con una apertura REAL en producción, a propósito: no se abrieron sobres ni se tocaron cuentas. Lo validado con resultados fijos (QA local 348/0) no equivale a eso. La primera apertura real de una cuenta es la prueba que falta. Rollback: `cd /opt/nexus/projects/valorosters && bin/deploy.sh --activate drl-0.1.1-1-baddbaed` (solo frontend, sin tocar la base).

## 9. QA visual con aperturas reales (2026-10-15, después del despliegue)

Evidencias y procedencia: `docs/product/qa/pack-opening-production-2026-10-15/README.md`.

**Dónde.**
- **Producción, como invitado** (solo lectura, sin abrir): el sobre cerrado, a 390/768/1440 × normal/reducido. **18/0**: se sirve la apertura nueva, 0 `<canvas>`/walkout y 0 chunks del walkout, consola limpia.
- **Aperturas REALES en el stack de QA aislado del VPS**, con la **build exacta de producción** (BUILD_ID `2b8f8817`). En producción no hay ninguna cuenta de QA autorizada (solo las 2 reales) y no se creó nada.
  - Cuenta sintética `@example.invalid`, con inicio de sesión por el formulario.
  - Compra con créditos sintéticos por el endpoint de la tienda (Sobre Oro y Sobre ICON).
  - Apertura por la interfaz: las cartas las decidió el servidor del stack.
  - 6 combinaciones (390/768/1440 × normal/reducido), con salida en japonés y en español; más una reproducción a 768.
  - Se vieron Oro, Masters (L y SDC, también como protagonista), Champions S, Prime (Future Star), ICON (Record Breaker y Moments, también dentro de un Sobre Oro) y Base/Plata por la QA de fixtures.
  - Resultado de la pasada en español: **192 PASS · 35 FAIL**. Los 35 son un único hallazgo, abajo.

**Inspección visual** (capturas abiertas y revisadas una a una):
- Masters en lila/violeta, ICON en marfil, Oro en dorado, Champions S negro con oro y rayos, Prime en azul.
- Cartas nítidas y centradas, sin deformar.
- Sin monigote y sin dorso en espejo.
- La sala anterior no queda tras el giro.
- «Anterior» y «Siguiente» se leen y no pisan la carta; tampoco quedan huecos ni elementos cortados.
- El resumen conserva sus acciones.
- Los puntos de posición solo colorean cartas vistas.

**Hallazgo (corregido en local, NO desplegado): el dorso anticipaba la rareza.**
- *Qué pasaba:* la sala sí estaba neutra en la tensión y en cada preparación, pero el DORSO se cargaba con la luz de la clase de la carta que iba a salir (`accent={atmosphere.glow}` en `HeroReveal` y `RestReveal`). Por ejemplo: dorado antes de una Oro, violeta antes de una Masters, blanco antes de una ICON.
- *Por qué no se vio antes:* la QA anterior solo miraba el fondo. Ahora el dorso se carga con la luz neutra y el color llega al girar.
- *Pruebas:* prueba SCN8 y chequeo del filtro del dorso en las dos QA de navegador.
- *Resultado local:* la QA de fixtures pasa **384/0** (36 chequeos del dorso) y la suite **6.616/6.616**.
- *Evidencia:* `entregables/hallazgo-dorso-antes-despues.png`.
- *Pendiente:* desplegarla exige una release nueva y autorización.

**Investigado y no reproducido:** en la primera pasada (768 normal), una captura de la ICON Mada salió sin carta, aunque el DOM estaba correcto (giro −180°, imagen cargada y en primer plano). Se repitió en el mismo entorno, ancho y modo hasta volver a sacar a Mada: carta visible a 2 s y a 5 s. Tampoco apareció en las demás pasadas. Se interpreta como una captura tomada antes de que el compositor sin GPU del contenedor pintara la capa 3D. Queda anotado; no se cambió código por ello.

**Notas.**
- La cuenta QA tenía el japonés guardado de la QA i18n, y la primera pasada salió en japonés; la entrega se repitió en español.
- Volver a cargar `/abrir/<sobre>` justo después de abrir muestra el resumen guardado: es la recuperación de F40, ya existente.
- En el stack de QA quedan 29 compras sintéticas y 1 Sobre ICON sintético sin abrir; `vrqa_app` sirve ahora la build `2b8f8817`.

**Producción:** sin cambios (`2b8f8817`, `ready`, 0 errores, recuentos = línea base). Sin migraciones, sin despliegues, sin push.
