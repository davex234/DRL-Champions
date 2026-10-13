# Valorosters · cierre final de la release de 8 idiomas + ICON (2026-10-12)

Sigue a `docs/product/i18n-8-idiomas-release-2026-10-12.md` (candidata `442a28e0`). Este documento recoge solo los
últimos arreglos y la candidata definitiva.

**No se ha desplegado, no se ha ejecutado ningún SQL con `--commit`, no se ha tocado la base de producción, no se han
concedido créditos ni sobres reales y no hay commits ni push.** Producción sigue en `drl-0.1.1-1-e5db60b6`.

## 1. Candidata definitiva

- **`drl-0.1.1-1-b48d76af`** · sha256 `836cf0342b6753f640acbab736d7d7d74fdf0d31c5756f5998226541937fe29e`
- En `/opt/nexus/projects/valorosters-i18n-qa/rc/` (fuera de `incoming/`: no se puede desplegar por accidente).
- Fuente de producción `e5db60b6` + overlay de 1.979 ficheros (1.146 añadidos, 833 modificados, 0 borrados). Sin
  migración (cabeza 0073), sin variables de entorno nuevas, F78 igual que en producción.
- Sustituye a `442a28e0`. Las anteriores (`442a28e0`, `24091e6c`) se conservan.

## 2. Qué cambia respecto a `442a28e0`

Nada de economía, probabilidades, inventarios, servidor ni animaciones. Tres cosas:

1. **`/admin/walkout` (los 2 FAIL de la QA autenticada)**. Los rótulos de las escenas de prueba vivían en un fixture
   del arnés que el extractor de i18n no recorre; se traducían a trozos y «1 carta: Filipinas MEGA» quedaba en español
   (en los ocho idiomas, aunque el detector solo lo marcaba en francés y japonés). Ahora son 10 textos propios de la
   página (`src/app/admin/walkout/page.tsx`), traducidos enteros a los siete idiomas.
2. **Texto fuera de pantalla en `/admin/pools` a 390 px**. No era del japonés: el rótulo del componente `Rail`
   (`src/components/ui/Surface.tsx`) no podía encogerse y un texto largo se salía en cualquier idioma y en cualquier
   motor. Ahora parte en dos líneas centrado; los rótulos cortos quedan idénticos (medido).
3. **Revisión de los textos de ICON, tienda, compras y crafteo**: 1.304 textos por idioma, revisados uno a uno en los
   siete idiomas contra el español. 260 correcciones:

   | Idioma | Correcciones | Lo más relevante |
   |---|---|---|
   | en | 22 | «guaranteed **as** the featured card» (decía «in»), comillas «» españolas en la forja |
   | de | 11 | «Wirtschaftsprüfung» (auditoría contable) → «Economy-Gate»; «Karten-Assets» → «Map-Assets» |
   | it | 4 | «Pacchetto» usado para lotes de créditos → «Bundle / Offerta» |
   | fr | 22 | objetivo de forja invertido («carte différente de X» → «carte X différente»); «salida» unificado |
   | pt-PT | 33 | «porta de pagamento» → «gateway»; gerundios brasileños; «Receita» por «Ingreso» chocaba con receta |
   | pt-BR | 14 | «seus pacotes» (leía «tus») → «os pacotes dele»; término de hueco y de crafting unificados |
   | ja | 154 | 24 numerales escritos con cifra; frase de guía con el sentido invertido; clase «Icon» confundida con el producto «ICON»; 開ける/開封 y 保証/確定 unificados; separador de miles |

   Dudas que los revisores dejaron sin tocar (no bloquean): nombres de receta y de plano («Forjado Masters», «plano
   Sello») sin referencia única; «Sobre Icon» frente a «Sobre ICON» en el propio español de dos textos.

Catálogos: 13.800 textos × 7 idiomas, auditoría sin problemas (0 ausentes, 0 variables o plurales rotos, 0 fuera de
glosario). Cifras de precios y probabilidades idénticas a las del español en los ocho idiomas.

## 3. Japonés en Safari y Firefox

`word-break: auto-phrase` solo existe en Chromium. Se midió con los motores reales (Playwright 1.62: Firefox, WebKit
—el motor de Safari— y Chromium de referencia), 44 pantallas × 3 anchos por motor, con sesión, juego y administración,
con la misma sonda de recortes que la QA visual más una comprobación de recorte vertical:

| Motor | Pantallas | Idioma equivocado | Desbordes | Textos cortados | Errores | `auto-phrase` | Últimas líneas de 1 carácter |
|---|---|---|---|---|---|---|---|
| Firefox (Gecko) | 132 | 0 | 0 | 0 | 0 | no | 56 |
| WebKit (motor de Safari) | 132 | 0 | 0 | 0 | 0 | no | 55 |
| Chromium (referencia) | 132 | 0 | 0 | 0 | 0 | sí | 7 |

**396 PASS · 0 FAIL** sobre `b48d76af` (`logs/i18n/rc8/vps/vrqa_run_engines-rerun.log` y `engines-rerun/engines-qa.json`).
La última columna es informativa: cuántos textos acaban con un carácter suelto en la última línea; mide la elegancia
del salto, no un fallo.

Conclusión: donde `auto-phrase` no existe, el navegador parte la línea por cualquier carácter (el comportamiento de
siempre). Eso cambia dónde cae el salto, no produce recortes ni desbordes. No se ha añadido ninguna alternativa:
las candidatas (`keep-all`, `overflow-wrap`) sí pueden sacar texto de su caja y romperían el diseño.
Límite: WebKit de Playwright en Linux no es Safari en un iPhone; falta una mirada en dispositivo real.

## 4. Validación sobre `b48d76af`

| Prueba | Resultado |
|---|---|
| Suite completa (PC) | 6.479 / 6.479 |
| Typecheck · lint | 0 errores · 0 errores (30 avisos previos) |
| Auditoría i18n (8 idiomas) | sin problemas, 13.800 × 7 |
| `economy:verify` | 60 ✓ · 0 ✗ |
| Compuerta del artefacto (VPS): build + typecheck + tests | build correcto, BUILD_ID coincide, 6.451 pasan · 8 fallan (los de siempre: leen `docs/` y `personajes/`, que una release no lleva) |
| WALKOUT 3D, 8 idiomas | 56 PASS · 0 FAIL |
| Motores en japonés (Firefox, WebKit, Chromium) | 396 PASS · 0 FAIL |
| QA autenticada, 8 idiomas | **1.293 PASS · 0 FAIL** |
| Visual jugador, japonés completa | 132 pantallas · 0 hallazgos |
| Visual administración, fr / pt-PT / pt-BR / ja completa | 276 pantallas · 0 cortados · 0 desbordes |
| Visual administración, es / en / de / it (pantallas con raíl + walkout) | 96 pantallas · 0 hallazgos |
| Visual jugador, es / en / de / it / fr / pt-PT / pt-BR (tienda, sobres, crafteo, raíl) | 630 pantallas (90 × 7 idiomas) · 0 hallazgos |
| Humo de invitado, 8 idiomas | 132 PASS · 0 FAIL (precios 30.000 y 80.000 en los ocho) |
| SQL de datos (receta y pool, 8 variantes) | idénticos a los ensayados (solo cambia la fecha del comentario de cabecera) |
| Ensayo de rollback con barrera | `ENSAYO_OK` (dos pasadas; la segunda con recuento exacto en la base, ver §9) |

En administración el detector marca 10 pantallas por idioma «con español»: es contenido de la base de datos y
diagnósticos del servidor (ya clasificados en el cierre anterior), no interfaz sin traducir.

No se repitió la pasada visual completa de jugador de es/en/de/it/fr/pt: los cambios no tocan esas pantallas más allá
de las rutas incluidas.

## 5. ICON

Sin cambios: ICON 30.000 con 1 carta ICON garantizada; ICON Premium 80.000 con 3; reparto 65 / 17,5 / 17,5; ICON por
sobre 1 / 5 / 10 / 15 / 20 %; crafteo 3 Champions → 1 ICON Premium. La QA autenticada compra, abre y craftea ambos
sobres con cuentas sintéticas en los ocho idiomas.

## 6. Despliegue y rollback

Sin cambios respecto al informe anterior (§6 y §7), cambiando solo el identificador por `drl-0.1.1-1-b48d76af`:
backup verificado → receta 3:1 → despliegue → pool → comprobaciones; rollback con custodia y barrera transaccional
(`rollback-hold.sql` → activar la vieja → `rollback-unfreeze.sql` → al volver `rollback-release.sql`). Los SQL
congelados en `logs/icon-data/activacion/` siguen siendo válidos (huellas comprobadas).

## 7. Git (preparado, no ejecutado)

Índice intacto: 0 ficheros en preparación, ningún commit. Listas de rutas por commit en `logs/i18n/final/git/`
(para `git add --pathspec-from-file=<lista>`):

| Lista | Ficheros | Contenido |
|---|---|---|
| `commit-0-base-produccion.txt` | 3.823 | lo ya desplegado en `e5db60b6` y nunca commiteado, más docs y scripts históricos |
| `commit-1-icon.txt` | 47 | sobres ICON y cambios previos a i18n |
| `commit-2-i18n.txt` | 1.924 | infraestructura, catálogos y texto envuelto (incluye los arreglos de este cierre) |
| `commit-3-qa.txt` | 68 | instrumentos de QA, scripts de datos y de rollback, informes |
| `compartidos-icon-e-i18n.txt` | 11 | tocados por ICON y por i18n: van al commit 2 (o se parten con la copia previa a i18n) |
| `aparte-f78.txt` | 18 | copias off-site, nunca desplegadas: decisión aparte |
| `sin-clasificar.txt` | 3 | `.env.example`, `AGENTS.md`, `CLAUDE.md` |
| `EXCLUIDOS.txt` | 830 | `logs/` (824) y ficheros locales del PC |

Búsqueda de secretos en todas las listas: 0 coincidencias. Las capturas de QA de las candidatas ya están ignoradas
por `.gitignore`. Sigue pendiente antes de un push: la IP del VPS aparece en scripts de operación y el correo
personal en 3 ficheros.

## 8. Riesgos pendientes

- Los cuatro idiomas nuevos siguen sin revisión nativa fuera de ICON, tienda, compras y crafteo.
- Japonés en Safari real (dispositivo) sin comprobar; en Firefox y WebKit los saltos de línea son menos naturales.
- La apertura real de un sobre ICON en producción no se puede verificar sin conceder créditos o sobres (no autorizado):
  queda cubierta por la QA con cuentas sintéticas y por el humo de solo lectura.
- Con la barrera de rollback puesta, el jugador ve un error genérico, no un aviso de mantenimiento.
- 8 tests del artefacto fallan por diseño (ficheros que la release no lleva).
- **Tope de 1.000 cartas por cuenta (anterior a esta release, no la bloquea)**: el estado de juego lee `user_cards`
  sin paginar (`src/server/services/inventory.ts`, idéntico al de producción) y PostgREST corta en 1.000 filas. Una
  cuenta con más de 1.000 cartas dejaría de ver parte de su colección. Hoy las dos cuentas de producción tienen 78 y
  35 cartas. Arreglo recomendado para la siguiente release: paginar esa lectura con `pageAll`, como ya hace `card_mints`.

Evidencia: `logs/i18n/final/` (correcciones, motores, git) y `logs/i18n/rc8/` (registros de la cadena).

## 9. Reanudación del 2026-10-13 (sesión interrumpida)

La sesión anterior se cortó con la cadena de QA ya terminada en el VPS y este informe a medio rellenar. Al retomar no
se ha reconstruido ni retraducido nada: **la candidata sigue siendo `drl-0.1.1-1-b48d76af`**.

Comprobado al reanudar:

- Producción sigue en `drl-0.1.1-1-e5db60b6`; `incoming/` no contiene la candidata; 2 cuentas, 0 sobres ICON o
  Champions (consulta de solo lectura).
- `sha256sum` del tar = `836cf034…e29e`, igual que el registrado.
- **Código local = artefacto**: overlay recalculado contra la fuente de producción (1.979 ficheros: 1.146 añadidos,
  833 modificados) y comparado fichero a fichero con el contenido del tar: 0 diferencias. Lo único tocado después de
  construirla son instrumentos de QA y documentación, que no van en la release.
- La app del stack de QA sirve `b48d76af`.

Lo que faltaba de verdad y cómo queda:

| Pendiente | Resultado |
|---|---|
| Motores en japonés sobre `b48d76af` | La pasada de la cadena salió mal por el instrumento (la cuenta de QA conservaba el italiano de la pasada anterior y Chromium se cerró). La sesión anterior ya la había relanzado con el instrumento corregido (elige el idioma en el selector real tras entrar); terminó bien y solo faltaba recoger el resultado: **396 PASS · 0 FAIL** (§3) |
| Cuatro huecos de este informe (§3 y §4) | Rellenados con los registros de `logs/i18n/rc8/vps/` |
| Registros de las compuertas del PC para esta candidata | No se habían guardado. Repetidas hoy y guardadas en `logs/i18n/rc8/pc/`: suite **6.479 / 6.479**, lint 0 errores (30 avisos), auditoría i18n sin problemas (13.800 × 7), `economy:verify` **60 ✓ · 0 ✗** |
| SQL de datos ICON | Las 11 huellas de `logs/icon-data/activacion/` verificadas; las 8 variantes de receta y pool regeneradas desde este árbol son idénticas salvo la fecha de la cabecera |
| Ensayo de rollback | Terminaba en `ENSAYO_OK`, pero su último paso no listaba las cartas entregadas: la cuenta sintética ya pasa de 1.000 cartas y la sonda las contaba a través de la API (tope de 1.000, ver §8). Corregido el instrumento (lee las cartas de la respuesta de la apertura y cuenta en la base) y repetido: `ENSAYO_OK`, base idéntica antes y después en las dos ventanas con barrera (créditos, 1.125 cartas, sobres), y cada sobre devuelto entrega exactamente 1 / 3 / 3 / 3 cartas ICON. Acta: `logs/icon-data/acta-rollback-barrera-b48d76af-exacto.txt` |

Los tres asuntos que se conocían como pendientes están cerrados en `b48d76af`: `/admin/walkout` (QA autenticada
1.293 / 0), el texto de `/admin/pools` a 390 px (visual de administración 276 + 96 pantallas, 0 cortados) y el
japonés en Firefox y WebKit (396 / 0).

**Estado al cerrar la reanudación: LISTA PARA DESPLEGAR.** (Desplegada después, el mismo día: §10.) Autorizaciones que faltan, sin cambios: desplegar y ejecutar los dos
pasos de datos (receta 3:1 y pool) en producción; decidir cómo verificar la apertura real de un sobre ICON; commits.

## 10. Despliegue en producción (2026-10-13) — DESPLEGADO Y VERIFICADO

Con autorización expresa del propietario para: desplegar `drl-0.1.1-1-b48d76af`, el commit de la receta 3:1 y el
commit del pool ICON. Nada más: sin concesiones, sin cambios de cuentas, sin commits de git. Registros de cada paso en
`logs/i18n/deploy-b48d76af/`.

| Paso | Hora (UTC) | Resultado |
|---|---|---|
| Puerta de entrada | 08:30 | `current` = `e5db60b6`, `ready` (0073), contenedor `healthy`, 0 errores; `sha256sum -c` de la candidata OK (`836cf034…e29e`); 11/11 huellas de los SQL; código local = tar (0 diferencias); QA recuperada entera sin fallos |
| Foto previa (T0) | 08:32 | 2 cuentas, 83.671 créditos (74.960 + 8.711), 113 cartas (35 + 78), 1 sobre sin abrir (`premium`), 0 ICON / Champions; receta 2:1 v1; sin pool `pack-icon-single`; sin actividad en la última hora, 0 bloqueos |
| Backup fresco | 08:33 | `BACKUP_OK` · `/opt/nexus/backups/supabase-drlcards/pre-i18n-icon/20261013T083307Z` · `db.dump` 2.924.750 B, sha256 `71a61e0b491285804ba2742c4a2d326d1d0e94361974d3f6515ac5602cecde83` · `SHA256SUMS` 7/7 |
| Prueba de restauración | 08:33 | Base desechable en el stack de QA: `pg_restore` salida 0, 0 errores, 34/34 tablas con el mismo recuento, 236 funciones, receta 2:1 v1, 83.671 créditos, 2 cuentas. Base borrada |
| Copia fuera del VPS | 08:33 | `C:\NEXUS-CENTRAL\DRLCards-backups\pre-i18n-icon\20261013T083307Z` (PC), `SHA256SUMS` 7/7 |
| Receta: ensayo | 08:34 | `VERIFICACIÓN OK`, ROLLBACK, receta intacta en 2:1 v1 |
| Receta: commit | 08:34:19 | `COMMIT` · `pack-champions-icon` **3:1, versión 2**, «Champions → ICON Premium», auditada; las otras 10 recetas con la misma huella |
| Código | 08:34:37 → 08:38:02 | tar copiado a `incoming/` (sha256 comprobado otra vez), `bin/deploy.sh drl-0.1.1-1-b48d76af` → `ACTIVA`, `ready`. **Activación: 2026-10-13 08:38 UTC** |
| Salud inmediata | 08:44 | `healthy`, 0 reinicios, 0 errores en el log, túnel con 4 conexiones, web pública 200 |
| Pool: ensayo | 08:44 | `VERIFICACIÓN OK` (ACTIVE/EXPLICIT, 331 entradas, vínculo @100), ROLLBACK, versión 950 |
| Pool: commit | 08:44:59 | `COMMIT` · `pack-icon-single` ACTIVE, 331 entradas, vínculo `icon-single` @100; los otros 51 pools, sus 5.027 entradas y los 51 vínculos con la misma huella |
| Foto posterior y final | 08:45 y 09:03 | Créditos, cartas y sobres **idénticos** a T0. Solo cambian la receta, el pool nuevo y su vínculo |

Compatibilidad durante la activación: no hubo ventana incompatible y no hizo falta barrera. La receta se aplicó
antes que el código (con el código viejo, 3:1 solo encarece un crafteo); entre el código y el pool, el sobre usa las
reglas de su definición (así corrió toda la QA). No había ningún sobre `icon`, `icon-single` ni Champions en
inventarios y no hubo ninguna operación económica durante la ventana (`economy_ops`: 0 en la última hora).

Verificación en producción (solo lectura, sin sesión, sin compras):

| Comprobación | Resultado |
|---|---|
| Código publicado = tar validado | 4.964 ficheros, 0 diferencias |
| Humo de invitado, 8 idiomas (`prod-smoke.sh`) | **132 PASS · 0 FAIL** (ICON 30.000 e ICON Premium 80.000 en los ocho) |
| Invitado ampliado, 8 idiomas (`prod-extra.sh`, nuevo) | **168 PASS · 0 FAIL**: detección automática (es-MX, en-GB, de-AT, it-CH, fr-CA, pt-AO → pt-PT, pt-BR, ja-JP), selector con los ocho, persistencia al navegar y al recargar; portada, tienda, fichas de los dos sobres ICON, colección y crafteo a 390 y 1.440 px sin desbordes, claves ni errores de consola; las fichas muestran 65 % / 17,5 % / 17,5 % |
| `production:check -- --app --vps` | 26 PASS · 1 WARN · 5 FAIL, todos conocidos y ajenos a esta release: «build» (el PC no tiene build local) y los cuatro de copias off-site (F78 sin configurar); WARN de autoconfirmación de correo |
| Build publicado | 0 source maps públicos; 0 secretos (el único token en estáticos es la clave pública `anon`) |
| Configuración ICON | Precios 30.000 (1 ICON garantizada) y 80.000 (3); ICON por sobre 1 / 5 / 10 / 15 / 20 %; receta 3 Champions → 1 ICON Premium; pool ACTIVE |
| WALKOUT 0.9 | `PACK_WALKOUT_3D_ENABLED = "all"`, sus 23 ficheros estáticos se sirven (200) |
| Otros servicios NEXUS | Sin tocar: `deploy.sh` solo recreó `valorosters-app`. Los bucles de reinicio de `supabase_edge_runtime_*` y `supabase_vector_*` son anteriores |

**No ejecutado en producción, a propósito**: ninguna compra, apertura ni crafteo real, ni el WALKOUT 3D con una carta
(exigen sesión y gastar créditos o conceder sobres, no autorizado). Tampoco las pantallas con sesión en los ocho
idiomas: no hay cuenta de QA en producción y crear una no estaba autorizado. Quedan cubiertas por la QA sobre este mismo
artefacto (autenticada 1.293 / 0, WALKOUT 3D 56 / 0).

La copia externa del backup está en el PC del propietario: el destino off-site (B2, F78) sigue sin configurar.

Rollback: disponible y sin usar. `e5db60b6` sigue construida (`bin/deploy.sh --activate`), los SQL de reversión y de
custodia con barrera están congelados y verificados, y el backup de las 08:33 restaura. Con 0 sobres ICON vendidos
hoy basta la variante simple; en cuanto se venda uno, usar la de custodia con barrera (§7 del informe anterior).

El stack de QA sigue levantado sirviendo `b48d76af`.

## 11. Cierre en Git (2026-10-13)

Ejecutado con autorización del propietario, solo en local (sin push). La propuesta de §7 se sustituyó por una
reconstrucción desde los tar publicados: base `e5db60b6`, ICON, ocho idiomas (= `b48d76af`, comprobado byte a byte y
por identificador de build) y QA/documentación. Detalle, comprobaciones y pendientes en
`git-cierre-b48d76af-2026-10-13.md`; tareas de la siguiente versión en `siguiente-actualizacion-2026-10-13.md`.
