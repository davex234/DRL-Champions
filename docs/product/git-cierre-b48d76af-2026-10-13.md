# Cierre en Git de la release `drl-0.1.1-1-b48d76af`

Fecha: 2026-10-13. Solo commits locales: sin push, sin despliegue, sin tocar producción.

## 1. Estado de partida

| | |
|---|---|
| Repositorio | `C:\NEXUS-CENTRAL\DRLCards` (remoto `origin`, rama por defecto `main`) |
| Rama | `arch/stabilization` |
| HEAD inicial | `48dac2a125fe04f5a1a36fa73af23118f757b922` (F17D) |
| Pendiente | 6.759 ficheros: 496 modificados y 6.263 sin seguimiento; 0 preparados; sin stash ni submódulos |

El repositorio llevaba sin commits desde F17D: todo lo desplegado desde entonces (F18 → WALKOUT 0.9, ICON y los
ocho idiomas) vivía solo en el árbol de trabajo. La foto inicial está en `logs/git-cierre-2026-10-13/`.

## 2. Cómo se ha construido el historial

Las dos releases se han reconstruido desde los tar que se publicaron en el VPS, no desde el árbol de trabajo:

| Release | Tar | sha256 | Identificador recalculado |
|---|---|---|---|
| Anterior | `incoming/drl-0.1.1-1-e5db60b6.tar` | `5f21c33faab8f621026b9087cee02b237cd59bf1077fa60c8a34844c9f049f92` | `drl-0.1.1-1-e5db60b6` |
| Publicada | `incoming/drl-0.1.1-1-b48d76af.tar` | `836cf0342b6753f640acbab736d7d7d74fdf0d31c5756f5998226541937fe29e` | `drl-0.1.1-1-b48d76af` |

El identificador de build es una huella del contenido (`generateBuildId` en `next.config.mjs`: `src/`,
`public/sw.js`, `package.json`, `next.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `version.json`). Que un
árbol de git lo reproduzca demuestra que su código es el de esa release.

El estado intermedio de ICON sale de una instantánea real: `logs/i18n/src-before-i18n.tgz`, tomada el 2026-10-10
justo antes de empezar i18n. Difiere de `e5db60b6` en 61 ficheros: 58 de ICON y 3 de backups off-site (F78), que
se dejan fuera.

Los commits se crearon con un índice temporal (`GIT_INDEX_FILE`) y `git commit-tree`, de modo que el árbol de
trabajo no se ha modificado en ningún momento. No se ha reescrito ningún commit ni etiqueta existente.

## 3. Commits

| # | Commit | Contenido | Comprobación |
|---|---|---|---|
| 1 | `f6eb0a7` · base de producción `e5db60b6` | 2.730 ficheros (2.423 nuevos, 307 modificados) | los 3.817 ficheros del tar, byte a byte; identificador `e5db60b6` |
| 2 | `6a019a6` · documentación e instrumentos F18 → WALKOUT 0.9 | 1.620 ficheros fuera del artefacto | el identificador sigue siendo `e5db60b6` |
| 3 | `9e3cfdb` · ICON | 79 ficheros: 58 de la instantánea, arte del sobre, `scripts/_icon-odds/`, informe | typecheck sin errores; 6.389 / 6.389 tests |
| 4 | `fa35b79` · ocho idiomas = release `b48d76af` | 1.935 ficheros (1.145 nuevos, 790 modificados) | los 4.963 ficheros del tar, byte a byte; identificador `b48d76af` |
| 5 | este commit · QA, datos aplicados, rollback y documentación | 72 ficheros: instrumentos, SQL congelado, informes | identificador `b48d76af`; typecheck (app y scripts) sin errores; 6.470 / 6.470 tests; auditoría i18n sin problemas (13.800 × 7); `economy:verify` 60 / 60 |

El commit 3 es un estado intermedio que nunca se desplegó por separado (identificador `d4f4675f`).

El commit 5 cambia siete scripts de QA que también viajan en el tar (`scripts/lib/cdp.ts`,
`scripts/_f75-smoke-public.ts`, `scripts/_f82-qa.ts`, `scripts/_fase68-lib.ts`, `scripts/multiplayer/_f75-qa.ts`,
`scripts/multiplayer/_qa.ts`, `scripts/ops/_f85-stage.sh`): son las versiones con las que se hizo la QA. Ninguno
entra en el build. Es la única diferencia entre la cabeza de la rama y el tar publicado, junto con
`.next-server.log` (registro de ejecución que iba dentro del tar y no se versiona).

## 4. Para repetir la comprobación

```bash
# identificador de build de cualquier commit
git archive <commit> src public/sw.js package.json next.config.mjs tailwind.config.ts tsconfig.json version.json \
  | tar -x -C <carpeta vacía>
node -e "import('file:///<carpeta>/next.config.mjs').then(async m => console.log(await m.default.generateBuildId()))"

# fichero a fichero frente al tar extraído
git ls-tree -r <commit>            # sha de cada fichero en git
git hash-object --no-filters <f>   # sha del mismo fichero en el tar extraído
```

## 5. Qué queda sin versionar y por qué

| Grupo | Motivo |
|---|---|
| `logs/` (salvo `logs/icon-data/activacion/`) | registros de operación, instantáneas `.tgz`, evidencias y trabajo intermedio de traducción |
| Capturas, audio, PDF y fuentes dentro de `docs/` (131) | evidencia pesada; criterio de F70 |
| 24 capturas de `docs/product/qa/` ya versionadas y regeneradas | mismo criterio; el patrón está ignorado, pero siguen con seguimiento |
| `.claude/settings.local.json` | configuración local del PC |
| `mapas/` nuevos, `puente.png`, `PropuestaJuego (1).pdf` | material fuente pesado en la raíz |
| 18 ficheros de backups off-site (F78) | nunca desplegados: guardados en la rama local `wip/f78-offsite-backups` |

Nada se ha borrado ni descartado: todo sigue en el árbol de trabajo.

Rama `wip/f78-offsite-backups`: un commit sobre la cabeza de la release con los 18 ficheros de F78 tal como están
en el árbol de trabajo. Con ellos el identificador de build pasa a `747d2f1e`; por eso no están en la línea de la
release.

## 6. Revisión de secretos y datos sensibles

Sobre todos los ficheros de los commits y de la rama F78 (unos 9.500 de texto, contando las dos versiones de los que
cambian entre releases):

- Claves privadas, tokens de servicios, claves `sb_secret_`, credenciales de almacenamiento, tokens de túnel:
  **0**.
- JWT: 3 ficheros de test con tokens de juguete (`{"sub":"1"}`, firma inventada). Ninguno real.
- Asignaciones de contraseña o secreto: solo valores de prueba (`rc-gate-not-production-…`, `w09-qa-invalid`,
  `harness-fake-secret-…`) y lecturas de variables de entorno.
- Ficheros `.env` (salvo la plantilla `.env.example`, sin valores), volcados, backups y claves: **ninguno**.
- Correo personal: 1 fichero, `scripts/_f77-recovery-e2e.ts` (dirección con sufijo de QA). Va en el tar publicado,
  así que se conserva para que el commit reproduzca la release. Conviene parametrizarlo antes de un push.
- IP del VPS: 75 ficheros, todos de operación o QA (scripts de túnel y despliegue, informes de fase); ninguno en
  `src/`. No es un secreto, pero conviene decidir si el remoto debe verla antes de un push.

## 7. Siguiente actualización

Tareas registradas en `siguiente-actualizacion-2026-10-13.md`. Partir de la cabeza de `arch/stabilization`.
