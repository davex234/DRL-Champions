# I18N (ES · EN · DE · IT) + ICON — Release candidata `drl-0.1.1-1-9c74e0dd` (2026-10-11)

Cierre del trabajo de internacionalización del 2026-10-10 y preparación de una release desplegable junto con los
cambios ICON aprobados el 2026-10-09. **Nada se ha desplegado, commiteado ni empujado. Producción y su base de datos
no se han modificado** (sigue en `drl-0.1.1-1-e5db60b6`, cabeza 0073).

> `drl-0.1.1-1-9c74e0dd` **sustituye** a la primera candidata `drl-0.1.1-1-794c29ba` (misma base, un fichero más
> corregido: la tarjeta de sobre de `/packs`, §7.12). Toda la QA de este informe se repitió entera sobre `9c74e0dd`.
> El árbol local se comparó con la RC fichero a fichero al cerrar: 1.417 ficheros de overlay, 0 diferencias.

## 1. Estado

**LISTA PARA DESPLEGAR cuando el propietario lo ordene**, con dos decisiones suyas pendientes (§8): los dos pasos de
datos de ICON en la BD de producción y las dos medidas de onboarding de `economy:verify`, que no son de esta tarea.

## 2. Compuertas (árbol final)

| Compuerta | Dónde | Resultado |
|---|---|---|
| Auditoría i18n (`npm run i18n:audit`) | PC | **sin problemas** · 137 módulos · 13.889 textos · en/de/it 13.889/13.889, 0 ausentes/vacíos/variables/plural/huérfanas/glosario, 0 texto sin internacionalizar, 0 claves dinámicas |
| Suite completa (`npm test`) | PC | **6.463 / 6.463** |
| Typecheck (app + scripts) | PC | verde |
| Lint | PC | 0 errores (30 avisos; 29 eran previos) |
| Build | PC | verde (`drl-0.1.1-1-dbd8fd4d` = árbol local, que incluye F78; 1 aviso previo de `src/instrumentation.ts`, que no va en la RC) |
| `production:check --app` | PC, contra la app de la RC en el stack de QA (túnel SSH) | **19 PASS · 1 WARN · 0 FAIL** (WARN: catálogo 0/331 porque el stack de QA no materializa `content_cards`; el juego usa el catálogo del código) |
| `economy:verify` | PC | **58 ✓ · 2 ✗** (§3) |
| Compuerta de la RC | VPS, contenedor desechable, fuente exacta de la RC, entorno de QA | build verde con `BUILD_ID` = `drl-0.1.1-1-9c74e0dd`, typecheck verde, tests 6.435 / 6.443 — los 8 fallos leen `docs/` y `personajes/`, que nunca van en una release |
| QA autenticada | VPS, build de la RC | **645 PASS · 0 FAIL** (§5) |
| WALKOUT 0.9 en 3D | VPS, build de la RC | **28 PASS · 0 FAIL** (7 por idioma) |
| QA visual con sesión | VPS, build de la RC | **528 pantallas · 0 hallazgos** (§6) |
| Sonda de la tarjeta de sobre | VPS, build de la RC | 18 tarjetas × 4 idiomas × 3 anchos, ninguna fuera |

## 3. Los 3 fallos de `economy:verify`

Los tres son **anteriores a la traducción**: se ejecutó el verificador sobre la copia de `src` previa a i18n
(`logs/i18n/src-before-i18n.tgz`) y dio exactamente lo mismo (413 atrapadas, P50/P90/P99 6/9/12, pin de `ALLOWED`).

1. **Cuerpo de sobres cerrado** — pin viejo, **corregido con evidencia**. Exigía la lista literal
   `["action","packId","ref"]`; desde el cambio ICON del 9-oct el cliente manda además `expectedPrice` (el precio que
   vio). El invariante real es que el cliente no DECIDE el cobro, y ahora se comprueba por comportamiento: precio visto
   1 → 409 y +0 créditos; precio visto 2.500 → cobra 2.500 del catálogo del servidor. No se tocó ninguna regla.
2. **20.000 cuentas del Sobre Inicial: 413 no completan equipo dentro del tope** — medida real, no pin. Documentada
   desde Walkout 0.6 (entonces 369; el sorteo cambió con el Icon por sobre). Decisión de producto. No se tocó.
3. **Aperturas del starter P50/P90/P99 = 6/9/12 (objetivo ≤ 4/6/8)** — misma medida. No se tocó.

Los 2 FAIL de `production:check` de ayer eran **solo** falta de conexión con la base de datos (túnel cerrado): con la
app conectada a una BD, `app-ready` y `app-migration-head` pasan.

## 4. Cobertura de los cuatro idiomas

- Código: 13.889 textos fuente, todos traducidos a en/de/it. Auditor en verde.
- Revisión lingüística: 109 correcciones (en 32, de 42, it 35) en carrera, entrenador, tácticas, launcher y avisos;
  terminología de Valorant en alemán (Spot, Taktikboard, Stammspieler), tratamiento informal, plurales ICU revisados
  (120). Sin español residual real en los catálogos.
- Código (esta sesión): 135 textos nuevos que el auditor no veía (plantillas cortas, tablas, helpers que devolvían el
  valor crudo), `tdIn(módulo, texto)` para etiquetas con dos sentidos («Entrar», «Final», «Bloqueado», «Destacado»…),
  rondas de cuadro (`lib/bracket/roundText`), fragmentos del launcher/entrenador/carrera unidos en frases, plurales
  ICU, fechas y números con el idioma activo, nombres de país por `Intl.DisplayNames`.
- Avisos del auditor que quedan y se ACEPTAN: «inconsistentes» en 38 / de 58 / it 48 (misma palabra con sentido
  distinto por módulo, cada una pintada con su `t()` o con `tdIn`) y «¿sin traducir?» 8 / 8 / 41 (nombres propios,
  marcas, URL y palabras italianas idénticas al español).
- **No traducido a propósito**: nicks, equipos, marcas, niveles de sobre fijados en el glosario; lo que responde el
  servidor (español canónico, el cliente lo traduce por texto o plantilla); `<html lang>` y metadatos del HTML inicial
  (el cliente los corrige al hidratar).
- **Contenido del CMS**: mecanismo definido y probado (`src/i18n/content.ts`, `GET /api/content/i18n`, tabla aditiva
  `content_translations` como PROPUESTA sin aplicar, interruptor `CONTENT_TRANSLATIONS_ENABLED = false`). Con él apagado
  el contenido editable se ve en español. Ver `docs/i18n/README.md`.

## 5. QA autenticada (sesión real, cuentas sintéticas, stack aislado)

Entorno: `valorosters-i18n-qa` en el VPS — Supabase propio (db, auth, rest, storage, kong), secretos propios, las 73
migraciones del repo aplicadas en limpio, dos cuentas `@example.invalid` (jugador y admin) con créditos sintéticos.
No comparte red, volúmenes ni claves con producción. Ninguna cuenta real, ningún crédito real.

Por idioma (es 159, en 162, de 162, it 162 comprobaciones, **todas PASS** sobre la build de la RC):

| Flujo | Qué se comprueba |
|---|---|
| Inicio de sesión | selector antes de entrar, formulario real, el idioma se conserva |
| Persistencia en cuenta | `user_metadata.locale` + `locale_at` tras elegir |
| Entre dispositivos | navegador nuevo en japonés hereda el idioma al entrar; el cambio hecho en el segundo llega al primero al recargar |
| Tienda | precios e identificadores idénticos a español; ICON 30.000 / ICON Premium 80.000; línea 2.500/6.000/12.000/20.000/35.000; Icon por sobre 1/5/10/15/20 %; probabilidades cifra a cifra iguales |
| Compra | Bronce cobra 2.500 e ICON 30.000 exactos según el libro del servidor; el modal enseña saldo real y resultante |
| Apertura | 5 cartas (Bronce) y 1 (ICON); las del resumen son las del servidor; consume 1 sobre y 0 créditos |
| WALKOUT 0.9 | aparece en la apertura ICON, en el idioma, sin claves; en 3D real aparte (28/28) |
| Colección e inventario | en el idioma, cartas del servidor |
| Crafteo | recetas 4/3/2/3/3 (Champions → ICON Premium 3:1); 4 Bronce → 1 Plata: −4, +1, créditos intactos |
| Perfil | `/jugador/[id]` y `/cuenta` |
| Navegación | 14 pantallas principales con sesión, sin errores de consola ni de hidratación |
| Administración | la cuenta QA admin entra y recorre 9 pantallas; la de jugador no entra |

Evidencia: `docs/product/qa/i18n-auth/<idioma>/*.png`, `logs/i18n/rc3/vps/` (la de la primera candidata, en
`logs/i18n/rc/vps/` y en el VPS en `out-794c29ba/`).

## 6. QA visual

Sobre la build de la RC, con sesión real de la cuenta QA, en serie (un navegador cada vez): **4 idiomas × 3 anchos
(1440, 768, 390) × 44 pantallas = 528 capturas**.

| Idioma | Pantallas | Idioma equivocado | Desbordes | Texto cortado | Español residual | Claves visibles | Errores de consola | Hidratación |
|---|---|---|---|---|---|---|---|---|
| es | 132 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| en | 132 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| de | 132 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| it | 132 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Incluye flujos, no solo páginas: menús abiertos, modal de compra (estándar e ICON), sobre sellado → ceremonia →
resumen, confirmación de crafteo, detalle de carta, secciones de `/cuenta`, perfil público y la ruta inexistente.
WALKOUT se valida aparte en 3D (WebGL por software): 28/28, 7 comprobaciones por idioma.

La pasada sobre la primera candidata encontró **un** defecto: en `/packs` a 390 px el botón de la tarjeta se salía en
alemán (4 tarjetas, «Pack ansehen» / «Event ansehen») e italiano (3, «Vedi pacchetto»). Corregido (§7.12) y medido con
una sonda propia: 18 tarjetas por idioma y ancho, ninguna fuera.

Evidencia: `docs/product/qa/i18n-visual/<idioma>/*.png`, `docs/product/qa/i18n-visual/_packcard/`,
`logs/i18n/rc3/vps/visual-qa.json`. Límite honesto: el detector mide desbordes y recortes por geometría y busca español
y claves por lista; no sustituye a una lectura humana de cada captura.

## 7. Errores corregidos en esta sesión (encontrados por la QA)

1. Pulsar el idioma ya activo no guardaba la elección: al iniciar sesión ganaba el idioma de la cuenta.
2. Cambiar de idioma en otro dispositivo no llegaba al primero hasta renovar el token (~1 h): ahora se concilia con
   el usuario fresco del servidor al arrancar con sesión.
3. Nombres de país en español en WALKOUT y en la carta («Filipinas», «Corea del Sur») en en/de/it.
4. Placeholder del filtro de OVR: salía «máx» en los dos campos fuera de español.
5. «Plata» sin traducir dentro de las líneas de ranuras de la ficha de probabilidades.
6. Frases del ICON («Cada carta se sortea por separado…») en español, y una caché de la ficha que no distinguía idioma.
7. «Caja Premium / Masters / Champions», «Temporada 1 · Ascenso», «Temporada competitiva 1» sin traducir.
8. Recompensas compuestas en español («2 × Sobre Plata», «600 créditos · 1× Sobre Bronce») en pase, objetivos, logros,
   competitivo y Pick'em.
9. Etiquetas con dos sentidos que salían con el equivocado («Destacado» → «Standout» en la tienda, «Entrar» → «Enter»
   en un botón de acceso, «Bloqueado» → «Locked» en social).
10. Dos componentes de servidor con texto que no se repintaba al cambiar de idioma (miga de Pick'em, aviso de admin).
11. Pin viejo de `economy:verify` (§3.1).
12. Tarjeta de sobre de `/packs` a 390 px: el botón se salía de la tarjeta en alemán e italiano. La fila de precio +
    botón ahora salta de línea y el botón baja entero (`PackCatalogCard.tsx`). Español e inglés no cambian de aspecto.

## 8. Pendientes y riesgos

**Decisiones del propietario antes o durante el despliegue**
- **Pasos de datos de ICON en la BD de producción** (no hechos; la RC no los incluye porque son datos, no código):
  la receta Champions → ICON Premium vive en `craft_recipes` y hoy es **2:1** en producción; el Sobre ICON necesita su
  pool `pack-icon-single`. Sin el primero, el código nuevo se despliega con la receta vieja.
- **Onboarding** (§3.2 y §3.3): 2 medidas fuera de objetivo, anteriores a todo esto.
- Riesgos económicos ya conocidos del informe ICON (Premium 1,06 valor/crédito, desguace del Premium 6,4 %): sin cambios.

**Pendiente de i18n (documentado, no bloquea)**
- 229 frases todavía compuestas por fragmentos fuera de launcher/entrenador/carrera/coach, y ~100 literales profundos
  de simulación, retransmisión y mundo sin envolver (inventarios en `logs/i18n/_gaps-*.txt`). Se ven en español solo
  en esas pantallas secundarias.
- Componentes sin montar con texto sin traducir (`AlbumToolbar` ya internacionalizado; `ProfileSections`,
  `PlayerProfile`, `AchievementGrid`, `RewardHistory`, `UpdatePanel`): no se ven en el juego.
- Administración: contenido de la BD, diagnósticos del servidor y rótulos de escenas QA salen en español.
- `admin.json` (lo más grande) no ha tenido lectura de calidad completa.
- Decimales con punto en español en 5 sitios (`toFixed`): cambiarlo alteraría el español; sin tocar.
- Editor de traducciones del CMS: no construido (la capa se rellenaría por SQL).
- Vistas previas al compartir enlaces (Open Graph) salen en español.

**Entorno**
- El PC se quedó sin memoria a mitad de la QA visual (Chrome y otras apps del usuario); la tarea se detuvo y **no se
  relanzó en el PC**: el resto se ejecutó en el VPS, como preveía el encargo.
- El stack de QA sigue levantado en el VPS (≈2 GB). Se borra entero con `down.sh` (§10).
- La primera candidata `794c29ba` sigue en `valorosters-i18n-qa/rc/` junto a la definitiva; se puede borrar.
- Compuertas locales de cierre en `logs/i18n/rc3/` (auditoría, typecheck, lint, tests, build, economy, production:check).

## 9. Estado de los cambios ICON

Intactos y verificados por test nuevo (`src/i18n/i18n.economyInvariance.test.ts`, 14/14) y por la QA con sesión:

| | Valor |
|---|---|
| Sobre ICON (`icon-single`) | 30.000 créditos · 1 carta |
| Sobre ICON Premium (`icon`) | 80.000 créditos · 3 cartas |
| Calidad ICON | PatMen 65 % · marteen 17,5 % · mada 17,5 % (tabla A 65/35 aprobada) |
| Champions → ICON Premium | 3:1 — **en el stack de QA**; en producción es un paso de datos pendiente |
| Icon por sobre | Bronce 1 % · Plata 5 % · Oro 10 % · Masters 15 % · Champions 20 % |

Con los catálogos reales de en/de/it cargados, precios, cartas por sobre, tablas de probabilidad y el sorteo
determinista de aperturas son idénticos a español. Los ficheros de economía solo cambian en textos.

## 10. Release candidata, despliegue y rollback

**Identificador:** `drl-0.1.1-1-9c74e0dd` · tar `sha256 3647d48561db6b7bea083f2df8316ae1bb72cd5c342bada2ef5b79f2e4e94c65`
en `/opt/nexus/projects/valorosters-i18n-qa/rc/` (a propósito **fuera** de `valorosters/incoming/`).

**Cómo se reproduce:** fuente de producción `e5db60b6` + overlay de 1.417 ficheros (589 nuevos, 828 modificados, 0
borrados) — `node scripts/ops/_i18n-rc-overlay.mjs <huellas de producción> <salida>` y
`scripts/ops/_i18n-rc-stage.sh stage|gate`. La frontera se comprueba fichero a fichero; F78 (off-site) y
`src/instrumentation.ts` quedan como en producción; sin migración.

**Despliegue (cuando se autorice)**
1. Comprobar que `current` sigue en `e5db60b6` (si no, rehacer el overlay sobre la release viva).
2. Backup verificado de la BD (`scripts/ops/backup-drlcards.sh`, `BACKUP_OK`).
3. `cp valorosters-i18n-qa/rc/drl-0.1.1-1-9c74e0dd.tar valorosters/incoming/` y `bin/deploy.sh drl-0.1.1-1-9c74e0dd`
   (construye con el entorno de producción, se niega si el `BUILD_ID` no coincide, cambia `current` y recrea solo la
   app; 1–3 s de 502).
4. Datos de ICON, cada uno en una transacción con ensayo previo (termina en ROLLBACK sin `--commit`):
   `npx tsx scripts/_icon-odds/pool-sql.ts --out f.sql [--commit]` y
   `npx tsx scripts/_icon-odds/recipe-sql.ts --out f.sql [--commit]` (probado en el stack de QA: 2 → 3, versión +1,
   auditado, resto de recetas e inventarios idénticos).
5. Verificar: `npm run production:check -- --app --vps`, `/api/ready`, tienda y `/cuenta` en los cuatro idiomas,
   ficha de los dos sobres ICON, receta 3:1 en `/misiones/crafting/sobres`.

**Rollback**
- Código: `bin/deploy.sh --activate drl-0.1.1-1-e5db60b6` (existe con build; segundos). Sin migración, no hay nada que
  deshacer en el esquema. El idioma guardado en `user_metadata.locale` y en el navegador es inocuo para la release
  anterior, que lo ignora.
- Datos: `recipe-sql.ts --revert --commit` (3 → 2); desvincular el pool con
  `app_content_pack_bind('icon-single','pack-icon-single',100,'unbind',…)`. Antes de volver atrás, cerrar la oferta del
  Sobre ICON y resolver los `icon-single` comprados en la ventana
  (`select user_id, qty from user_packs where pack_id='icon-single' and qty > 0`), como indica el informe ICON.

**Limpieza del entorno de QA** (no afecta a nada más):
`ssh nexusadmin@VPS 'cd /opt/nexus/projects/valorosters-i18n-qa && ./qa-run.sh down && ./down.sh'`; la imagen
`vrqa-chrome:1` y `/tmp/i18n-rc` se pueden borrar. Conservar `rc/` hasta desplegar.
