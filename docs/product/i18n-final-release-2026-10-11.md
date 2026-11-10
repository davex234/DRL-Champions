# I18N + ICON — Cierre final de la release candidata (2026-10-11, reanudado y cerrado el 2026-10-12)

Continúa `docs/product/i18n-release-candidate-2026-10-11.md` (RC `drl-0.1.1-1-9c74e0dd`). Este cierre ha cambiado
código y catálogos, así que la candidata dejó de ser esa. El 2026-10-11 quedó en `drl-0.1.1-1-b7f0be1e`; al reanudar el
2026-10-12 la revisión visual encontró un texto sin traducir en la ficha de los sobres ICON (§3.2, punto 4), se corrigió
y **la candidata definitiva es `drl-0.1.1-1-24091e6c`** (5 ficheros de diferencia con `b7f0be1e`).

**Nada se ha desplegado, commiteado ni empujado. Producción (`drl-0.1.1-1-e5db60b6`, cabeza 0073) y su base de datos
no se han modificado.** De producción solo se ha LEÍDO: huellas de la fuente viva, una consulta `READ ONLY` del estado
de la receta y del pool, y un `pg_dump --data-only` de 6 tablas de contenido (ninguna de usuarios) para el ensayo.

## 1. Estado

**LISTO PARA DESPLEGAR** — pendiente solo de la orden del propietario (2026-10-12).

- Candidata definitiva: `drl-0.1.1-1-24091e6c`. Construida y verificada en el VPS; código local idéntico al artefacto
  (0 ficheros de diferencia). Producción sigue en `drl-0.1.1-1-e5db60b6`, sana y sin tocar.
- Compuertas en verde; QA autenticada 645/0; WALKOUT 3D 84/84 en los cuatro idiomas; revisión visual sin hallazgos de
  juego. Los dos fallos que arrastraba el cierre (WALKOUT en inglés, 11 capturas de admin con español) están
  diagnosticados: el primero era del instrumento, el segundo es contenido técnico/datos (§6.2, §6.3).
- Un defecto real encontrado al reanudar y corregido: «Icon garantizada» sin traducir en la ficha de los sobres ICON
  (§3.2-4). Por eso la candidata cambió de `b7f0be1e` a `24091e6c`.
- No hay bloqueos. Lo que queda son decisiones de producto y deudas conocidas (§7), ninguna impide publicar.

## 2. Identificación exacta de la release

| | |
|---|---|
| Identificador | `drl-0.1.1-1-24091e6c` |
| Artefacto | `/opt/nexus/projects/valorosters-i18n-qa/rc/drl-0.1.1-1-24091e6c.tar` (a propósito **fuera** de `valorosters/incoming/`) |
| sha256 | `c2536469033a252511c26a4e0d0ca68cb78c9c24f93f8412235db728e9b25510` |
| Base | fuente de producción `drl-0.1.1-1-e5db60b6` + overlay de 1.420 ficheros (589 nuevos, 831 modificados, 0 borrados) |
| Migraciones | ninguna nueva (cabeza 0073) |
| Fuera de la RC, como en producción | F78 (copias off-site) y `src/instrumentation.ts` |
| Conserva | ICON (30.000·1 / 80.000·3, 65/17,5/17,5, Icon por sobre 1/5/10/15/20 %) y WALKOUT 0.9 |

Candidatas anteriores, **obsoletas** (siguen en `rc/`, se pueden borrar): `794c29ba`, `9c74e0dd`, `e006654f`,
`b7f0be1e` (sha256 `59460e03…5457`; su QA completa sigue siendo válida para todo lo que no son los 5 ficheros de §3.2-4).
`e006654f` fue la primera de este cierre; su QA encontró los defectos de §6.2 y por eso se rehízo.

Reproducir: `node scripts/ops/_i18n-rc-overlay.mjs <huellas de producción> <salida>` → `overlay.tar` →
`scripts/ops/_i18n-rc-stage.sh stage|gate` (comprueba la frontera fichero a fichero y que el `BUILD_ID` coincide).

## 3. Internacionalización

### 3.1 Qué se ha hecho

El «229 frases + ~100 literales» del informe anterior salía de un detector más estrecho. Con un inventario nuevo y
reproducible (`npx tsx scripts/_i18n-gaps.ts`) el punto de partida real era:

| | Antes | Ahora |
|---|---|---|
| Frases partidas a mitad (orden de palabras en español) | **340** sitios | **14** (todos «rótulo:» + valor o unidad; no dependen del orden) |
| Literales con español fuera de catálogo | 103 candidatos | 0 que se pinten sin traducir (los que quedan no llegan a pantalla; §3.3) |
| Textos fuente | 13.889 | 13.790 (menos, porque cientos de trozos son ahora frases enteras) |
| Traducidos en / de / it | 13.889 | **13.790 / 13.790 / 13.790** |

- **~390 sitios reescritos** como una frase traducible (340 del inventario + los que aparecieron en los mismos
  ficheros), con variables, `fill`/`slots` para negritas y enlaces, y plurales ICU en lugar de plurales caseros.
  623 traducciones nuevas por idioma; 668 trozos sueltos retirados.
- **~115 etiquetas-dato** (tablas del código pintadas con `td()`) registradas y traducidas: rasgos de carta, estados de
  ánimo de la afición, cabeceras de noticias, factores del panel de IA, tipos de sobre de administración, unidades.
- **Administración**: 126 frases reescritas, y los nombres que salían en español por código (sobres, logros,
  temporadas, plantillas, verbos de la matriz de contenido) pasan ya por traducción.
- **Revisión lingüística** por idioma de administración entera (3.178 claves) y de 26 módulos de las pantallas
  principales (4.696 claves): **381 correcciones** aplicadas (en 73, de 211, it 97) + 20 trasladadas a mano a frases
  nuevas. Errores de sentido reales (p. ej. `Rango` estadístico = «Rang» → «Spannweite»; `Plantilla` del sobre =
  «Roster/Kader» → «Template/Vorlage»; asientos del libro = «seats/Plätze/posti»), comillas «» y rayas a la española
  en inglés, y terminología que oscilaba entre módulos.
- **Metadatos compartidos**: el manifiesto de la app instalable (nombre de accesos directos, descripción, `lang`) sale
  en el idioma del jugador (cookie `vr_locale`). El título de la pestaña ya lo traducía el cliente.

### 3.2 Defectos funcionales encontrados por el camino (corregidos)

1. **Confirmación de torneo imposible fuera del español.** Para resolver un cruce con «los dos fuera» el panel enviaba
   al servidor la palabra tecleada *traducida* («ELIMINATE BOTH», «BEIDE ELIMINIEREN», «ELIMINA ENTRAMBI»); la RPC de
   0069 compara con el literal español → `CONFIRM_MISMATCH`. Ahora el admin teclea la frase en su idioma y al servidor
   va el literal canónico (`src/app/admin/copas/page.tsx`). Presente también en `9c74e0dd`.
2. **Etiquetas que se traducían «por casualidad».** `td()` traduce cualquier texto que esté en algún catálogo; al
   retirar trozos sueltos, «horas» (cuenta atrás de temporada) y los tipos de sobre de administración se quedaron sin
   traducción. Lo detectó la QA sobre `e006654f`; se cruzaron las 668 claves retiradas con los literales del código
   (`scripts/_i18n-restore-data.ts`) y se registraron las vivas.
3. Rótulo de `/admin/pools` que se salía a 390 px en en/de/it (traducciones más largas que el español): acortado.
4. **«Icon garantizada» en español en la ficha de los dos sobres ICON (2026-10-12).** `classGuarantee`
   (`src/domain/packs/packClass.ts`) componía la etiqueta con una plantilla de código (``${clases} garantizada``) que no
   pasaba por el catálogo, y `featuredGuarantee` unía las clases con « o » (EWC: «Champions o Icon guaranteed…»). Se veía
   en el modal de compra, la tarjeta de `/packs` y la tabla de probabilidades, en en/de/it. El detector de la QA no lo
   marcaba porque «garantizada» no estaba en su lista (añadida). Ahora: «Icon guaranteed / garantiert / garantita» y
   «Champions or / oder / o Icon …». En español el texto es idéntico al de antes (los tests que lo fijan no cambian).
   Ficheros: `packClass.ts` + `messages/{es,en,de,it}/packs.json` (3 claves nuevas).

### 3.3 Lo que NO está traducido (cobertura real)

**No declaro cobertura completa.** Queda en español, a sabiendas:

| Qué | Dónde se ve | Por qué |
|---|---|---|
| **Nombres de rango de la escalera** (Cantera, Promesa, Titular, Veterano, Capitán, Estrella, Cumbre) | Competitivo, perfil — **pantalla principal** | Los rótulos se componen en dominio («Titular II») y `td()` no puede desambiguarlos («Cantera» = cantera de club en Carrera). Además es decisión de producto: ¿nombres propios o traducibles? Dos frases ya dicen «Summit/Gipfel/Vetta». |
| Vista previa al compartir (Open Graph, `<title>` y `<html lang>` del HTML inicial) | Enlaces pegados en chats | Sin rutas por idioma, quien pide la vista previa es un robot sin preferencia. El cliente corrige título y `lang` al hidratar. |
| Contenido escrito en el CMS / base de datos | Juego y admin | Se guarda en español. El mecanismo de traducciones opcionales existe y sigue **apagado** (`CONTENT_TRANSLATIONS_ENABLED = false`, tabla `content_translations` sin aplicar). |
| Motivos de auditoría, diagnósticos del servidor (`/admin/system`), columna «Fuente» de la matriz de `/admin/content` | Admin | Texto de servidor / documentación técnica interna. |
| Rótulos de las escenas de `/admin/walkout` | Admin (página de QA) | Herramienta de pruebas. |
| Heraldo compuesto de la revelación («Serial #1» y similares del plan) | Apertura de sobre | El de la ceremonia ya se traduce; el compuesto por el plan no está en catálogo. |
| Paneles de depuración de simulación (`brain/decide.ts` «enemigo {n}s · {pct}%», `agents/composition.ts` «equilibrada») | Coach / simulación, secundarias | Vistos y no tocados. |
| Mensajes que llegan ya compuestos del servidor sin plantilla registrada | Avisos puntuales | El servidor responde en español canónico; el cliente traduce por texto o plantilla conocida. |
| Jerga que se deja igual en los cuatro idiomas | — | CLUTCH, RETAKE, TRADE, LURK, 5v5, PvPvE, Free to play… |
| Textos legales y contenido de usuarios | — | No se traducen automáticamente (instrucción). |

Avisos del auditor que se aceptan: «inconsistentes» en 43 / de 72 / it 52 (la misma palabra con sentido distinto según
el módulo; han subido porque las correcciones de los revisores son por módulo) y «¿sin traducir?» 8 / 8 / 40 (nombres
propios, marcas, palabras italianas idénticas al español).

Decisiones lingüísticas que dejo al propietario (no son errores): «Tu inicio» = «Your start» (calco; «Getting
started» tocaría ~12 claves), «arte» = Grafik/Artwork en alemán, «reto» con tres traducciones según contexto.

## 4. Onboarding: las dos métricas

**Causa: el fallo estaba en el verificador, no en el juego.** `scripts/economy41-verify.ts` decidía el rol de una
carta por el rol del JUGADOR (`p.role`); el juego lo decide por el rol IMPRESO de la carta (`c.role ?? p.role`) desde
el catálogo rediseñado del 2026-09-21 (122 de 331 cartas tienen rol distinto al de su jugador). El motor asiste por rol
de carta y el simulador contaba por rol de jugador: el 28,6 % de las cartas asistidas «no le servían».

| Simulación (20.000 cuentas, mismas semillas) | Atrapadas | P50 / P90 / P99 / máx |
|---|---|---|
| Verificador como estaba (rol de jugador) | 413 | 6 / 9 / 12 / 12 |
| Igual, con el resolutor del servicio real (rol de carta) | **0** | **4 / 4 / 5 / 5** |
| Rol de carta + «Bronce primero» (lo que propone la guía) | 0 | 4 / 4 / 4 / 5 |

**Impacto real para un jugador nuevo: ninguno medido.** 0 atrapadas en 600.000 cuentas simuladas (tres órdenes de
apertura) y en 4.000 pasando por el servicio real de extremo a extremo; conserva sus 6.000 créditos. De 369 a 413
«atrapadas» entre informes era ruido de semillas (reproducido: 369 exactas sin la tirada de Icon).

**Lo que he cambiado:** una línea del verificador (`role: c.role ?? p.role`, comentada en el sitio). **No he tocado**
probabilidades, precios, `STARTER_POLICY` ni reglas de sobres. `economy:verify` pasa a **60 ✓ · 0 ✗** midiendo lo que
el juego hace. Si prefieres que el verificador quede como estaba, es revertir esa línea.

Alternativas de producto, cuantificadas (ninguna hace falta):

| Alternativa | Atrapadas | P50/P90/P99/máx | Coste por cuenta | ¿Toca sorteo/precios? |
|---|---|---|---|---|
| **0 · Corregir el verificador** (hecho) | 0 | 4/4/5/5 | 0 | No |
| 1 · `maxFreeClaims` 8 → 12 | 0 | 4/4/5/5 | 0 | No, pero amplía el grifo sin beneficio |
| 2 · `assistSlots` 2 → 3 | 0 | 4/4/4/5 | −0,29 cartas, −334 de valor | Sí (cambia qué sale en el Inicial) |
| 3 · `assistSlots` 5 | 0 | 4/4/4/4 | −0,29 cartas, −354 de valor | Sí |
| 4 · Sobre de rescate determinista | 0 | 4/4/5/5 | 0 (nunca se activa) | No; código muerto hoy |

Pendiente derivado (no lo he tocado): el mismo resolutor antiguo sigue en `scripts/economy-starter-simulation.ts:38` y
`scripts/player-journey-verify.ts:49`, y la comprobación «C2 cumple objetivos» lee
`docs/product/qa/fase41/starter-simulation.json`, que es el informe de 772 cartas de septiembre: pasa sin medir nada
actual. Regenerarlo es decisión tuya. Detalle e instrumentos: `logs/onboarding/informe.md`, `scripts/_onboarding/`.

## 5. Scripts de datos para producción

Estado de producción leído (`READ ONLY`): receta `pack-champions-icon` **2:1, versión 1**; pool `pack-icon-single`
**no existe**; 0 crafteos históricos de esa receta; 0 sobres `icon`/`icon-single` en inventarios; 331 cartas; versión
de distribución 950.

Ensayo en una base **aislada** (`vr_rehearsal`, dentro del Postgres del stack de QA): esquema de las 73 migraciones +
contenido real de producción. 18 pasos, **18 con salida 0, 0 errores**; las huellas de «otras recetas», «otros pools»,
«otras entradas» y «otros vínculos» son idénticas en los 18. Base borrada al terminar. Acta: `logs/icon-data/acta-final.txt`.

| | `recipe-sql.ts` (Champions → ICON Premium 2:1 → 3:1) | `pool-sql.ts` (pool `pack-icon-single`) |
|---|---|---|
| Ensayo (sin `--commit`) | termina en ROLLBACK; receta sigue 2:1 v1, 0 auditorías | termina en ROLLBACK; sin pool, versión 950 |
| Aplicar | 3:1, versión +1, 1 fila de auditoría | pool ACTIVE/EXPLICIT, 331 entradas = `pack-icon`, vínculo @100 |
| **Repetir** (idempotencia) | «YA APLICADO»: no escribe nada | «YA APLICADO»: no escribe nada |
| Revertir (`--revert --commit`) | 2:1, versión +1, auditada | desvincula y deja el pool RETIRED |
| Repetir la reversión | «SIN CAMBIOS» | «YA REVERTIDO» |
| Reaplicar tras revertir | 3:1 otra vez | reactiva el pool por la RPC oficial y lo vuelve a vincular |

Cambios que he hecho a los scripts (antes fallaban cerrado al repetir, sin dañar nada, pero fallaban):
- **Receta**: transacción `REPEATABLE READ` (las fotos de control no se mueven por el tráfico concurrente de
  producción) e idempotencia real.
- **Pool**: reescrito como máquina de estados (ya aplicado / RETIRED → reactivar / parcial → completar); antes una
  segunda ejecución daba «Transición ilegal ACTIVE → ACTIVE» y no se podía reaplicar tras revertir.

Límites honestos: «reversible» es lógico, no borra historia (la versión de la receta y la de distribución siguen
subiendo, la auditoría queda, el pool queda RETIRED). El ensayo no reproduce el tráfico concurrente real. El pool solo
lo usa el panel: el motor ya reparte las mismas cartas sin él. **No se ha escrito nada en producción.**

## 6. Verificación

### 6.1 Compuertas (árbol final = RC `24091e6c`)

| Compuerta | Dónde | Resultado | Registro |
|---|---|---|---|
| Tests | PC, árbol completo | **6.463 / 6.463** | `logs/i18n/rc6/test.log` |
| Typecheck (app + scripts) | PC | 0 errores | `logs/i18n/rc6/typecheck.log` |
| Lint | PC | 0 errores, 30 avisos (los de siempre) | `logs/i18n/rc6/lint.log` |
| Auditoría i18n | PC | sin problemas · 13.790/13.790 en en, de, it | `logs/i18n/rc6/audit.log` |
| `economy:verify` | PC | **60 ✓ · 0 ✗** | `logs/i18n/rc6/economy.log` |
| Build + typecheck + tests del artefacto | VPS, contenedor desechable | `BUILD_ID` = `drl-0.1.1-1-24091e6c`, 0 errores TS, 6.435 pasan / 8 fallan | `logs/i18n/rc6/vps/driver.log`, `gate-run.out` |
| `production:check --app` contra la app de la RC | PC → stack de QA | 18 PASS · 1 WARN · 1 FAIL | `logs/i18n/rc6/production-check.log` |
| Secretos y source maps en el build de la RC | VPS | 0 source maps públicos, 0 apariciones de la clave de servicio en `.next/static` y `public/` | — |
| Frontera del overlay | VPS (`stage`) | añadidos + modificados = overlay exacto (589 + 831), 0 borrados, F78 = producción, cabeza 0073 | — |
| Código local = artefacto | PC | 0 añadidos, 0 modificados contra `staged.sha` | — |

Lo que no es verde, comprobado uno a uno:

- **Los 8 tests que fallan en el artefacto** son la misma lista que falla sobre la propia fuente de producción
  (`fail-24091e6c.txt` = lista de referencia). Los 8 leen ficheros que una release no lleva: `docs/operations/proposals/0058…`
  (2), `docs/operations/rollback/0063…` (1), `docs/product/qa/…` (2: `goldPool`, `tierIdentity.special`) y
  `personajes/` (3: arte de agentes C, D, G). En el PC, con esos ficheros, pasan los 6.463. No son regresiones.
- **`production:check` FAIL «build»**: el PC no tiene `.next` local (no hay memoria para construir aquí). El build está
  verificado en el VPS con el `BUILD_ID` esperado, y las dos comprobaciones que dependen de `.next` (secretos, source
  maps) se hicieron contra ese build.
- **`production:check` WARN «catalog:KO»**: es del stack de QA, cuya base no tiene contenido publicado en el CMS. No
  aplica a producción.

`economy:verify` conserva la corrección del verificador (`role: c.role ?? p.role`, rol impreso de la carta, como el
servicio real). Repetido dos veces el 2026-10-12, antes y después del cambio de §3.2-4: 60/0 las dos.

### 6.2 QA con sesión real (cuentas sintéticas, stack aislado `valorosters-i18n-qa`)

La cadena que quedó corriendo el 2026-10-11 **terminó** (`FIN` 21:30 UTC) sobre `b7f0be1e`: autenticada 645/0, visual
de jugador 528 pantallas sin hallazgos, admin 276 pantallas, WALKOUT 25/3. Evidencia: `logs/i18n/rc5/vps/`,
`docs/product/qa/i18n-b7f0be1e/`. Sobre la candidata definitiva se repitió lo necesario:

| Prueba (RC `24091e6c`) | Resultado | Registro |
|---|---|---|
| QA autenticada, 4 idiomas (compra, apertura, crafteo, admin, permisos) | **645 PASS · 0 FAIL** (es 159, en 162, de 162, it 162) | `logs/i18n/rc6/vps/vrqa_run_auth.log` |
| WALKOUT 3D, 4 idiomas, 3 pasadas | **84 PASS · 0 FAIL** (28/28 × 3) | `vrqa_run_w3d-final{1,2,3}.log` |

Incluye, por idioma: tienda con ICON 30.000 e ICON Premium 80.000, la compra cobra exactamente 30.000 y da 1 sobre, la
apertura ICON entrega exactamente la carta que decidió el servidor, y las recetas 4/3/2/3/3 (Champions → ICON Premium
3:1 en el stack de QA).

**WALKOUT 3D — diagnóstico de los fallos.** Era el instrumento, con dos causas independientes; el juego no se ha tocado.

1. *Carrera con «Omitir».* El walkout se carga bajo demanda; el instrumento, cuando no veía nada que pulsar, pulsaba
   «Omitir», que existe desde que llega el resultado y lleva al resumen saltándose el walkout (comportamiento
   intencionado del juego). Leer la fase y pulsar eran llamadas separadas al navegador, y en ese hueco caía el clic.
   Prueba directa en la telemetría del stack de QA: la apertura fallida (alemán, 09:34:39 UTC) registró
   `opening_skipped` a +0,1 s del resultado y ningún `walkout_shown`; las 12 aperturas de las tres pasadas finales
   registran `walkout_shown` y `walkout_stage:3d:WEBGL:cinematic`. Por eso el fallo saltaba de idioma entre pasadas
   (inglés, ninguno, alemán). Arreglo en `scripts/_i18n-walkout3d-qa.ts` (fuera de la release): fase y clic en una
   sola evaluación, nunca omite con walkouts pendientes, y deja traza de lo que pulsa.
2. *Saldo sintético agotado.* En la tercera pasada del 2026-10-11 la compra devolvió 409 en alemán e italiano: la
   cuenta QA de jugador tenía 8.500 créditos tras cuatro rondas de RC. Se repusieron 2.000.000 sintéticos en la base
   aislada (`app_adjust_credits`, ref `qa-seed-i18n-2`).

**WALKOUT 0.9 intacto.** Respecto a producción solo cambian 6 ficheros de walkout y todos son envoltorios de texto
(`Reveals.tsx`, `WalkoutDirector.tsx`, `countryTheme.ts`, `input.ts`, `animationPref.ts`, `PackWalkout.tsx`);
`public/walkout` es idéntico, `PACK_WALKOUT_3D_ENABLED` sigue en `"all"` y la escena 3D arranca por WebGL en los cuatro
idiomas (capturas `docs/product/qa/i18n-24091e6c/i18n-auth/<idioma>/walkout-3d.png`).

### 6.3 Revisión visual y lingüística

**Jugador.** Pasada completa sobre `b7f0be1e`: 528 pantallas (44 × 3 anchos × 4 idiomas), 0 con idioma equivocado,
desbordes, textos cortados, claves visibles, errores de consola o de hidratación. El detector automático dio también 0
restos de español, pero la revisión a ojo de las capturas encontró «Icon garantizada» en la ficha del ICON Premium en
en/de/it (§3.2-4): el detector trabaja con una lista de palabras y esa no estaba. Tras corregirlo, sobre `24091e6c` se
repitieron las pantallas que pintan ese texto y su entorno (tienda, sobres, modales de compra de Bronce e ICON Premium,
apertura, crafteo, menús, perfil): 192 pantallas en 4 idiomas × 3 anchos, 0 hallazgos, con «garantizada» ya en el
detector. Las otras 27 rutas no se repitieron: los 5 ficheros que cambian no las tocan.

**Administración.** 276 pantallas por pasada, 0 desbordes, cortes, claves o errores. 11 capturas por idioma con español,
las mismas en `b7f0be1e` y `24091e6c`, clasificadas una a una:

| Pantalla | Texto | Qué es | Decisión |
|---|---|---|---|
| `/admin`, `/admin/audit` (3 anchos c/u) | «ICON 2026-10-09 · decisión del propietario: Champions → ICON Premium 3:1…» | Motivo de auditoría guardado en la base (lo escribió el ensayo de la receta) | Dato: se preserva |
| `/admin/system` (3 anchos) | «Sin pool de elegibilidad pack-<id>: inicial, estandar…» | Diagnóstico compuesto por el servidor | Pendiente de internacionalizar, solo admin (§7) |
| `/admin/content` (1440) | Columna «Fuente»: `content_cards + content_card_versions (0037–0043) · lo impreso de las 331…`, `src/data/teamIdentities.ts (identidad, alias…)` | Documentación técnica con tablas y rutas de código | Identificadores técnicos: no se traduce |
| `/admin/walkout` (1440) | Rótulos de escenas de prueba («Champions · 3 RARE con una repetida…») | Herramienta de QA | Pendiente, solo admin (§7) |

Ninguna es texto funcional del juego. No se ha tocado nada.

**Incidencia del arnés (no del juego).** En la repetición, la pasada de jugador y la de admin iban en paralelo y
comparten espacio de red; Chrome elige su puerto de depuración al azar entre 180 y a las 10:01 UTC coincidieron: el
instrumento de jugador condujo el navegador de admin (le puso inglés durante 7 pantallas de es/390 y su propio login de
en/1440 «falló»). Los dos tramos se repitieron en serie y salieron limpios (`vrqa_run_visualfix.log`,
`vrqa_run_adminfix.log`). Las pasadas visuales, a partir de ahora, en serie.

Evidencia: `docs/product/qa/i18n-b7f0be1e/` (972 capturas, pasada completa) y `docs/product/qa/i18n-24091e6c/` (636
capturas de la candidata definitiva).

## 7. Problemas pendientes y riesgos

Nada de esto bloquea el despliegue.

**Pasos que forman parte del despliegue (no hechos, requieren autorización)**
- Receta `pack-champions-icon` 2:1 → 3:1 y pool `pack-icon-single` en la base de producción (§5, §8). Mientras no se
  aplique la receta, producción craftea ICON Premium con 2 Champions; conviene aplicarla en la misma ventana.

**Decisiones del propietario**
- Nombres de rango de la escalera (Cantera…Cumbre): siguen en español en los cuatro idiomas. ¿Nombres propios o
  traducibles?
- Regenerar `starter-simulation.json` (es de 772 cartas, septiembre) y pasar el resolutor de rol impreso a
  `economy-starter-simulation.ts:38` y `player-journey-verify.ts:49`.

**Sin traducir a sabiendas** (detalle en §3.3): contenido del CMS y de usuarios, Open Graph, diagnósticos de servidor
(`/admin/system`), columna «Fuente» de `/admin/content`, escenas de `/admin/walkout`, avisos de riesgo de
`domain/forge/policy.ts` (admin).

**Límites de esta verificación**
- La QA de navegador corre con WebGL por software en un contenedor; no sustituye a una mirada en un dispositivo real
  tras desplegar (paso 5 de §8).
- El detector de «restos de español» es una lista de palabras: dejó pasar «garantizada». La revisión a ojo cubrió las
  fichas de sobres y una muestra del resto, no las 528 capturas una a una.
- Sobre `24091e6c` la pasada visual de jugador es parcial (192 pantallas; la completa tiene 528 filas); la completa es de `b7f0be1e`, que
  difiere en 5 ficheros.

**Entorno de QA**: el stack `valorosters-i18n-qa` y `vrqa_app` siguen arriba en el VPS (aislados, sin coste para
producción). Bajarlos cuando se dé por cerrada la release.

## 8. Despliegue y rollback

**Despliegue (cuando lo ordenes)**
1. Comprobar que `current` sigue en `drl-0.1.1-1-e5db60b6` (si no, rehacer el overlay sobre la release viva).
2. Backup verificado de la base de datos (`scripts/ops/backup-drlcards.sh`, `BACKUP_OK`).
3. `cp valorosters-i18n-qa/rc/drl-0.1.1-1-24091e6c.tar valorosters/incoming/` (comprobar antes
   `sha256sum -c drl-0.1.1-1-24091e6c.tar.sha256`) y `bin/deploy.sh drl-0.1.1-1-24091e6c`
   (construye con el entorno de producción, se niega si el `BUILD_ID` no coincide, cambia `current` y recrea solo la
   app; 1–3 s de 502).
4. Datos de ICON, desde el PC, cada uno primero en ensayo y después con `--commit`:
   ```
   npx tsx scripts/_icon-odds/recipe-sql.ts --out recipe.sql            # ensayo: debe acabar en «tras ROLLBACK … 2 | 1»
   ssh nexusadmin@VPS 'docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -X' < recipe.sql
   npx tsx scripts/_icon-odds/recipe-sql.ts --out recipe.sql --commit   # y lo mismo
   npx tsx scripts/_icon-odds/pool-sql.ts   --out pool.sql [--commit]   # ídem
   ```
   Si algo no cuadra, el SQL aborta (`ON_ERROR_STOP`) y la transacción no se confirma. Repetir un paso es seguro.
5. Verificar: `npm run production:check -- --app --vps`, `/api/ready`, tienda y `/cuenta` en los cuatro idiomas, ficha
   de los dos sobres ICON, receta 3:1 en `/misiones/crafting/sobres`, `/admin/copas` (resolver un cruce de prueba).

**Rollback**
- Código: `bin/deploy.sh --activate drl-0.1.1-1-e5db60b6` (existe con build; segundos). Sin migración no hay esquema
  que deshacer. El idioma guardado en `user_metadata.locale`, en `localStorage` y en la cookie `vr_locale` es inocuo
  para la release anterior, que lo ignora.
- Datos: `recipe-sql.ts --revert --commit` (3 → 2) y `pool-sql.ts --revert --commit` (desvincula y retira). Antes de
  volver atrás el código, cerrar la oferta del Sobre ICON y resolver los `icon-single` comprados en la ventana
  (`select user_id, qty from user_packs where pack_id='icon-single' and qty > 0`): la release anterior no conoce ese
  producto.

**Limpieza del entorno de QA** (no afecta a nada más):
`ssh nexusadmin@VPS 'cd /opt/nexus/projects/valorosters-i18n-qa && ./qa-run.sh down && ./down.sh'`; se pueden borrar
la imagen `vrqa-chrome:1`, `/tmp/i18n-rc`, `/tmp/icon-rehearsal` y las RC obsoletas de `rc/`.
