# I18N (8 idiomas) + ICON — Release consolidada (2026-10-12)

> **Actualización 2026-10-13:** la candidata vigente es `drl-0.1.1-1-b48d76af` (sustituye a `442a28e0`; cierra los 2 FAIL de
> `/admin/walkout`, el texto de `/admin/pools` y la medición en Firefox/WebKit). Ver `docs/product/i18n-cierre-final-2026-10-12.md`.

Sustituye como candidata a `drl-0.1.1-1-24091e6c` (4 idiomas), que se conserva intacta en el VPS. Continúa
`docs/product/i18n-final-release-2026-10-11.md` y `docs/product/i18n-icon-activacion-2026-10-12.md`.

**No se ha desplegado, no se ha ejecutado ningún SQL con `--commit` en producción, no hay commits ni push.** Producción
sigue en `drl-0.1.1-1-e5db60b6`. Todo lo probado ha corrido en el stack de QA aislado con cuentas y créditos sintéticos.

## 1. Estado de los ocho idiomas

| Idioma | Código | Estado | Textos traducidos |
|---|---|---|---|
| Español | `es` | idioma de origen | 13.790 |
| Inglés | `en` | ya estaba (revisado el 2026-10-11) | 13.790 / 13.790 |
| Alemán | `de` | ya estaba (revisado) | 13.790 / 13.790 |
| Italiano | `it` | ya estaba (revisado) | 13.790 / 13.790 |
| Francés | `fr` | **nuevo** | 13.790 / 13.790 |
| Portugués de Portugal | `pt-PT` | **nuevo** | 13.790 / 13.790 |
| Portugués de Brasil | `pt-BR` | **nuevo** | 13.790 / 13.790 |
| Japonés | `ja` | **nuevo** | 13.790 / 13.790 |

Los cuatro nuevos no existían al empezar: se han implementado hoy sobre `24091e6c`.

Qué incluye:
- **Selector de idioma** con los ocho (bandera local + nombre propio: Français, Português (PT), Português (BR), 日本語).
- **Detección automática** del navegador. El portugués es el único con variante: cualquier etiqueta con región BR →
  `pt-BR`; `pt`, `pt-PT` y el resto de regiones → `pt-PT`. `fr-CA` → `fr`, `ja-JP` → `ja`.
- **Persistencia**: la misma de antes (dispositivo > cuenta > navegador > español; cookie `vr_locale` validada contra la
  lista). Sin migración.
- **Formato** de números y fechas por idioma (`30 000` en francés y portugués de Portugal, `2026年10月10日` en japonés).
  Los dígitos de precios y probabilidades son los mismos en los ocho (lo fija un test).
- **Plurales**: reglas de cada idioma (en francés 0 es singular; el japonés no tiene plural).
- **Japonés**: partición de línea por frases (`word-break: auto-phrase`, solo `lang="ja"`), para que las etiquetas no se
  corten carácter a carácter.

Cómo se han traducido y revisado los cuatro nuevos:
1. Traducción completa de los 11.829 textos únicos por idioma, con el inglés ya revisado como contexto, un glosario
   obligatorio por idioma (`docs/i18n/TRANSLATION-BRIEF-8.md`) y un verificador automático por trozo (variables, plurales,
   espacios).
2. **Sentido por módulo**: 86 palabras españolas significan cosas distintas según la pantalla («Media» es la valoración
   de la carta en el walkout y «promedio» en el mercado; «Entrar» en torneos no es «Iniciar sesión»). Se revisaron las 261
   apariciones tomando como referencia las tres lenguas ya revisadas: 179 correcciones.
3. Glosario de 40 términos aplicado y comprobado por la auditoría en los siete catálogos.
4. Barrido de restos de español en portugués y francés: 0 reales.
5. Japonés: en los textos de sobres y tienda, los numerales que añade el idioma («al menos una» → «1枚») van en kanji,
   para que las cifras de probabilidad sigan siendo idénticas carácter a carácter en todos los idiomas.

## 2. Qué trabajo falta

Nada que bloquee. Lo que queda es calidad y decisiones:

- **Revisión nativa de los cuatro idiomas nuevos.** Son traducciones de máquina con controles automáticos y una revisión
  de sentido por módulo; no ha pasado por ellas una persona nativa ni la revisión lingüística módulo a módulo que sí
  tuvieron inglés, alemán e italiano. Es donde más probable es que quede una frase rara, sobre todo en japonés.
- **Terminología entre módulos**: cada tramo lo tradujo un traductor distinto; el glosario fija 40 términos, pero
  palabras fuera de él pueden variar entre pantallas (p. ej. «carril» del pase: «faixa» / «via» en portugués de Portugal).
- **Lo que sigue en español a sabiendas en todos los idiomas** (igual que antes): nombres de rango de la escalera,
  contenido escrito en el CMS, Open Graph, diagnósticos de servidor y herramientas de QA del panel de administración.
- **Tarjeta de perfil a 390 px**: queda apretada con apodos largos. Es anterior a esta release (pasa igual en inglés).
- **Fuentes japonesas**: el juego usa las del sistema del jugador para los caracteres japoneses (no se sirve una fuente
  propia). En Windows, macOS, iOS y Android existen; el aspecto varía un poco entre plataformas.

## 3. Nueva release candidata

| | |
|---|---|
| Identificador | **`drl-0.1.1-1-442a28e0`** |
| Artefacto | `/opt/nexus/projects/valorosters-i18n-qa/rc/drl-0.1.1-1-442a28e0.tar` (fuera de `incoming/`: no se puede desplegar por accidente) |
| sha256 | `7838792eef202fdfd040cf22dcfc7aa0fc56fbdb735fc075e736e5c2c310b06f` (verificado con `sha256sum -c`) |
| Base | fuente de producción `drl-0.1.1-1-e5db60b6` + overlay de 1.979 ficheros (1.146 nuevos, 833 modificados, 0 borrados) |
| Migraciones | ninguna nueva (cabeza 0073) |
| Entorno | sin variables nuevas; mismas dependencias que producción |
| Código local = artefacto | 0 ficheros de diferencia |

Respecto a `24091e6c` cambian, fuera de catálogos: `src/i18n/config.ts`, `react.tsx`, `manifest.ts`, el glosario, el test
del núcleo i18n, el generador de trozos, `globals.css` (regla de japonés) y la bandera `pt.svg`. Ni una línea de
economía, servidor o walkout.

Candidatas que se conservan en `rc/`: `24091e6c` (4 idiomas, QA completa, sigue siendo desplegable) y `e6f97047`
(primera de 8 idiomas; obsoleta: su QA encontró los sentidos por módulo y las cifras japonesas que corrige `442a28e0`).

## 4. Tests

Todo sobre `442a28e0`. Registros: `logs/i18n/rc7/` (PC) y `logs/i18n/rc7/vps/` (VPS); capturas en
`docs/product/qa/i18n-442a28e0/` (1.356).

| Prueba | Resultado |
|---|---|
| Suite completa (PC) | **6.479 / 6.479** |
| Typecheck (app + scripts) | 0 errores |
| Lint | 0 errores, 30 avisos (los de siempre) |
| Auditoría i18n de los ocho idiomas | sin problemas · 13.790 / 13.790 en los siete catálogos · 0 ausentes, 0 variables o plurales rotos, 0 fuera de glosario |
| `economy:verify` | **60 ✓ · 0 ✗** |
| Build + typecheck + tests del artefacto (VPS) | `BUILD_ID` correcto, 0 errores TS, 6.451 pasan / 8 fallan |
| `production:check --app` contra la candidata | 18 PASS · 1 WARN · 1 FAIL |
| Secretos y source maps en el build | 0 y 0 |
| **WALKOUT 3D**, 8 idiomas | **56 PASS · 0 FAIL** (escena 3D por WebGL en los ocho) |
| **QA autenticada**, 8 idiomas | **1.291 PASS · 2 FAIL** |
| QA visual de jugador, idiomas nuevos (completa) | 528 pantallas (44 × 3 anchos × 4 idiomas): 0 con idioma equivocado, desbordes, cortes, restos de español, claves o errores |
| QA visual de jugador, idiomas antiguos (acotada) | 240 pantallas (portada, tienda, sobres, cuenta y selector): 0 hallazgos |
| QA visual de administración, idiomas nuevos | 276 pantallas: 1 texto cortado (ver abajo) |
| Humo de invitado, 8 idiomas | 132 PASS · 0 FAIL (precios 30.000 y 80.000 en los ocho) |
| Scripts de datos | 8/8 idénticos a los ensayados |
| Ensayo de rollback con barrera | `ENSAYO_OK` |

Lo que no es verde:

- **8 tests del artefacto**: la misma lista de siempre; leen `docs/` y `personajes/`, que una release no lleva. En el PC
  pasan los 6.479.
- **`production:check`**: FAIL «build» porque el PC no tiene build local (verificado en el VPS) y WARN de catálogo
  porque el stack de QA no tiene contenido publicado. Igual que con las candidatas anteriores.
- **2 FAIL de la QA autenticada**: el mismo rótulo en francés y japonés, «Pack ICON · 1 carta: Filipinas MEGA», de una
  escena de prueba de `/admin/walkout` (herramienta de QA del panel). No es una pantalla de jugador.
- **1 texto cortado**: en japonés, una frase de ayuda de `/admin/pools` se sale a 390 px. Es el panel de administración
  en ancho de móvil; aparece ahora porque el japonés ya no se parte carácter a carácter. Arreglo: acortar esa frase.
  No he reconstruido la candidata solo por esto.
- Administración sigue mostrando en español los cuatro tipos de texto ya clasificados (motivos de auditoría guardados,
  columna técnica «Fuente», diagnóstico de servidor, escenas de QA).

Pendiente de probar, y por qué:
- **Pasada visual completa de es/en/de/it sobre esta candidata**: la completa es de `b7f0be1e`; aquí se repitió lo que
  toca el cambio (selector de ocho idiomas y pantallas de tienda).
- **Dispositivos reales y Safari/Firefox en japonés**: la QA corre en Chromium en contenedor. La regla de partición por
  frases no existe fuera de Chromium; allí el japonés se parte como antes (correcto, menos elegante).
- **Apertura real en producción**: no se puede sin créditos reales (ver §9).

## 5. Compatibilidad de ICON

Sin cambios en reglas económicas. Comprobado en código, en tests y en la QA de los ocho idiomas:

| | |
|---|---|
| Sobre ICON (`icon-single`) | 30.000 créditos, 1 carta ICON garantizada |
| ICON Premium (`icon`) | 80.000 créditos, 3 cartas ICON garantizadas |
| Probabilidad por carta | PatMen 65 %, marteen 17,5 %, mada 17,5 % |
| ICON por sobre | Bronce 1 %, Plata 5 %, Oro 10 %, Masters 15 %, Champions 20 % |
| Crafteo | 3 Champions → 1 ICON Premium (paso de datos del despliegue) |
| WALKOUT 0.9 | sin cambios; `PACK_WALKOUT_3D_ENABLED = "all"` |

- `economy:verify`: 60 ✓ · 0 ✗ (con el verificador usando el rol impreso de la carta).
- Los tests de invariancia económica entre idiomas cubren ya los ocho: mismos porcentajes, mismos precios.
- Scripts de datos (receta y pool): las 8 variantes generadas desde este árbol son idénticas a las ensayadas y congeladas
  (`logs/icon-data/activacion/`, con huellas). Producción no ha cambiado desde el ensayo.

## 6. Procedimiento de activación

El de `docs/product/i18n-icon-activacion-2026-10-12.md` §5, sin rehacer nada, cambiando solo el identificador:

0. Puerta de entrada: `current` = `e5db60b6`, `sha256sum -c` de la candidata, `status.sh`.
1. Backup fresco (`backup-drlcards.sh`, `BACKUP_OK`) y copia al PC.
2. Foto de inventarios `icon` / `icon-single` / `champions` (hoy: 0 unidades).
3. Receta 3:1: ensayo y commit (antes del código; con el código viejo solo encarece un crafteo).
4. Copiar el tar a `incoming/`, comprobar el sha256 y `bin/deploy.sh <candidata>`.
5. Salud: `status.sh --logs`, `production:check -- --app --vps`.
6. Pool `pack-icon-single`: ensayo y commit.
7. Comprobaciones: humo de invitado en los **ocho** idiomas (`prod-smoke.sh`, solo lectura), receta y pool por consulta,
   y a mano el selector de idioma, la ficha de los dos sobres ICON y `/admin/walkout`.

Sigue sin hacer falta ventana de mantenimiento: las dos únicas cuentas de producción son del propietario.

## 7. Rollback sin pérdidas

El problema: en producción el id `icon` es hoy otro producto (3 cartas 70 % Prime / 30 % Icon, 60.000). Si se vuelve al
código anterior con sobres ICON de la release nueva sin abrir, un ICON Premium de 80.000 se abriría como el producto
antiguo (medido: 2 Prime + 1 Icon). `icon-single` no existe allí: se tolera y no se consume.

La versión anterior del plan dejaba unos segundos entre la custodia y la activación del código viejo en los que una
compra podía quedar fuera. **Ya no**: el paso de custodia lleva una barrera transaccional.

**Orden del rollback con sobres vendidos**

1. `rollback-hold.sql` (una transacción):
   - `LOCK TABLE user_packs`: espera a las operaciones en vuelo y retiene las nuevas;
   - instala la **barrera**: un disparador que rechaza cualquier cambio de cantidad de `icon` e `icon-single`;
   - mueve las unidades sin abrir a custodia (`ops_pack_escrow`: mismo usuario, misma cantidad).
2. `bin/deploy.sh --activate drl-0.1.1-1-e5db60b6`.
3. `rollback-unfreeze.sql`: retira la barrera (la release vieja ya vende su producto antiguo con coherencia).
4. Reversión de receta y pool (`recipe-revert-commit.sql`, `pool-revert-commit.sql`).
5. Al volver a publicar la release nueva: `rollback-release.sql` devuelve cada unidad 1:1 y retira la barrera si seguía.

**Por qué no hay pérdida posible en la ventana**

- Compra, apertura, crafteo y concesión de recompensa son cada una **una función transaccional** en la base
  (`app_buy_pack`, `app_apply_pack_open`, `app_craft_pack`, `app_grant_reward`), y ninguna función que toque inventario
  de sobres captura excepciones (comprobado en producción, solo lectura). El rechazo de la barrera aborta la operación
  entera: no se cobra, no se consume y no se entrega nada a medias.
- Lo que estaba en vuelo termina antes de la custodia (y queda custodiado) o después (y se rechaza). No hay un tercer caso.
- Las recompensas se pagan antes de marcarse como reclamadas y son idempotentes por clave: una concesión rechazada se
  puede volver a reclamar después.

**Ensayado de extremo a extremo** en el stack de QA con la release vieja construida de verdad y la candidata
(`logs/icon-data/acta-rollback-barrera-*.txt`): con la barrera puesta, comprar `icon-single`, comprar `icon`, abrir
ambos y craftear Champions → ICON se rechazan, y créditos, sobres y cartas quedan **idénticos** antes y después, tanto
con la release nueva como con la vieja. Tras la devolución, los sobres entregan lo comprado (1 ICON, 3 ICON) y el
crafteo 3:1 funciona.

Límites honestos:
- La custodia y la barrera crean una tabla, una función y un disparador fuera de migraciones. Solo existen si se llega
  a hacer un rollback con sobres vendidos; hay que registrarlo si ocurre.
- Con la barrera puesta, el jugador que intenta comprar un sobre ICON ve un error genérico («No se pudo completar la
  operación»), no un aviso de mantenimiento.
- Lo primero sigue siendo corregir hacia delante; el rollback de código es para una app rota.

## 8. Git: propuesta de commits (no ejecutada)

Situación real del repositorio: la rama `arch/stabilization` tiene **6.623 ficheros pendientes** (496 modificados
y 6.127 sin seguimiento). El último commit es de mucho antes de producción: todo lo desplegado desde entonces está
sin commitear. No se puede hacer «un commit de i18n» limpio sin fijar antes una base.

Propuesta, en este orden (clasificación completa en `logs/i18n/rc7/git-proposal.json`):

| # | Commit | Ficheros | Contenido |
|---|---|---|---|
| 0 | `chore(baseline): estado desplegado drl-0.1.1-1-e5db60b6` | 2.043 + 1.783 | Lo que ya es idéntico a producción, más documentación, scripts y migraciones históricas que no van en la release |
| 1 | `feat(packs): dos sobres ICON, probabilidades y receta 3:1` | 47 (+11 compartidos) | `icon-single`, ICON Premium 80.000, `iconQuality`, confirmación de precio, tests económicos |
| 2 | `feat(i18n): ocho idiomas` | 1.924 (+11 compartidos) | `src/i18n/` (runtime, catálogos de 7 idiomas, glosario), texto envuelto en ~780 ficheros de la app, bandera `pt.svg`, CSS de japonés |
| 3 | `test(qa): instrumentos, stack de QA y scripts de datos` | 62 | `scripts/_i18n-*`, `scripts/_icon-odds/`, `scripts/ops/i18n-qa-stack/`, informes de esta release |

Notas:
- **11 ficheros** los tocan a la vez ICON e i18n (p. ej. `packClass.ts`, `PurchaseModal.tsx`). Para separarlos de verdad
  se usa la copia de antes de i18n (`logs/i18n/src-before-i18n.tgz`) en el commit 1 y la versión actual en el 2.
- **Fuera de todos los commits**: `logs/` (729 ficheros: registros, copias `.tgz` del código, SQL generado),
  `.claude/settings.local.json`, `puente.png`, `mapas/`.
- **Aparte, a decidir**: 18 ficheros de F78 (copias off-site), que nunca se han desplegado.

Comprobaciones hechas sobre lo que entraría:
- **Secretos**: 0 coincidencias con patrones de claves (JWT reales, `sb_secret_`, claves privadas, Resend, AWS, GitHub).
  Las 8 asignaciones con forma de secreto son valores de prueba en tests.
- **Backups y volcados**: ninguno (`.dump`, `.env*` salvo `.env.example`). Las capturas de QA ya están ignoradas.
- **Otros proyectos**: ningún fichero de otro proyecto NEXUS.
- **A valorar antes de un push**: la IP del VPS aparece en 75 ficheros de scripts y documentación, y tu correo personal
  en 3 (`scripts/_f77-recovery-e2e.ts`, un test de feedback y un JSON de QA de F77). No son secretos, pero el remoto es
  GitHub.

## 9. Autorizaciones necesarias

1. **Desplegar** la candidata y ejecutar `recipe-commit` y `pool-commit` en la base de producción (pasos 0–7 de §6).
2. **Verificación de la apertura real** en producción: darla por cubierta con la QA o conceder sobres a una cuenta tuya.
3. **Commits** según §8 (y, aparte, si quieres push).
4. Opcional: revisión nativa de francés, portugués y japonés antes o después de publicar.
