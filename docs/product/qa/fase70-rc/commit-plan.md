# F70 · Plan de commit de la release candidate

Fuente: `release-source.json` (inventario de rutas) y `evidence-audit.json` (tamaños y clases), en esta misma carpeta.
Nada se ha ejecutado: ni `git add`, ni `git rm --cached`, ni borrados. El árbol de trabajo sucio es la fuente de verdad.

## 0. Antes de empezar

- Esperar a que terminen los agentes concurrentes (credenciales QA, inventario de arte, acciones de lanzamiento, plantilla de entorno, informe F70).
- Volver a ejecutar el inventario si ha cambiado el árbol. `git status --porcelain | wc -l` debería rondar 1.100 entradas sin ignorar.
- El `.gitignore` ya deja fuera las capturas de QA, `raw/`, los logs, los vídeos y trazas, los backups y volcados, `/deploy/`, las claves y certificados, `.env*` (salvo `.env.example` y `.env.*.example`), el arte fuente (`/cartas/`, `/sobres/`, `/personajes/`) y las referencias sueltas de la raíz.

## 1. `git add` por grupos (en este orden)

```bash
# 1. Configuración raíz
git add .gitignore .env.example .eslintrc.json next.config.mjs package.json package-lock.json tailwind.config.ts .nvmrc eslint.config.mjs
#    + la plantilla de entorno de release si existe (p.ej. .env.production.example)

# 2. Base de datos
git add supabase/migrations supabase/tests

# 3. Código de producto
git add src

# 4. Scripts (sin instrumentos `_*` fuera de CI; _qa.ts sí, porque lo importa scripts/ops/smoke.ts)
git add scripts ':(exclude,glob)scripts/**/_*'
git add scripts/multiplayer/_qa.ts
git add scripts/ops/_secret-scan.mjs    # lo usa el paso 3 de drlcards-launch-actions.md (escaneo de secretos)
#    incluye scripts/lib/qaCredentials.ts y scripts/ops/qa-accounts*.sql (agente concurrente)

# 5. Assets de runtime y fuentes de mapas
git add public mapas/finalizados

# 6. Documentación (sin imágenes nuevas; json/md pequeños de QA sí)
git add docs ':(exclude,glob)docs/**/*.png' ':(exclude,glob)docs/**/*.jpg' ':(exclude,glob)docs/**/*.jpeg' ':(exclude,glob)docs/**/*.webp' ':(exclude,glob)docs/**/*.pdf'
#    incluye docs/operations/** (drlcards-qa-accounts.md, drlcards-art-release-inventory.md,
#    drlcards-launch-actions.md), docs/product/fase-6x/70*.md y docs/product/qa/fase70-rc/*.json|md
```

Una alternativa exacta al paso 6 es pasar la lista `include` de `release-source.json` a `git add --pathspec-from-file=-`.

## 2. Qué no entra

- Ya ignorado: `node_modules`, `.next`, `out`, `output`, `dist`, `deploy/` y `src-tauri/target|gen`. Tampoco entran unos 6.300 PNG de QA (≈2,4 GB), `raw/`, `_qa-*.html`, los logs, `cartas/` (652 MB), `sobres/`, `personajes/`, `referencia*.png` e `inventario.png`.
- Excluido por pathspec: 231 instrumentos `scripts/**/_*` (≈2,1 MB) y las imágenes nuevas de `docs/product/{visual,art,launcher}` (≈38 MB, opcionales: se archivan fuera o se añaden a mano).
- `.claude/settings.local.json`: son ajustes locales de la herramienta y no se deben añadir.

## 3. `git rm --cached` recomendado (NO ejecutado)

```bash
git rm --cached .next-server.log .claude/settings.local.json
git rm --cached docs/product/qa/*.png          # 24 capturas trackeadas y modificadas (≈6,9 MB)
# Opcional: git rm --cached "PropuestaJuego (1).pdf" docs/product/NEXUS-Duel-Gameplay-Product-Preview.pdf   (4,7 + 3,5 MB)
```

Los ficheros siguen en disco. Solo dejan de versionarse.

## 4. Checklist antes del commit

1. Escaneo de secretos sobre lo preparado: `git diff --cached --name-only | grep -iE '\.env|\.pem|\.key|\.p12|dump|id_rsa'` no debe devolver nada. Además hay que pasar `node scripts/ops/_secret-scan.mjs` (o el escáner de F69) sobre el índice y comprobar que `scripts/**` ya no lleva contraseñas QA literales, que ahora deben ir en `scripts/lib/qaCredentials.ts` y leerse del entorno.
2. `git diff --cached --stat | tail -1`: debe salir menos de unos 110 MB y ningún fichero de más de 5 MB (`git diff --cached --numstat` no sirve para binarios, así que hay que revisar el tamaño a mano).
3. `npm run typecheck` (proyecto web y scripts; comprueba que ningún script incluido importe un `_*` excluido).
4. `npm test` y `npm run lint`.
5. Opcional: `npm run build`.
6. `git status --porcelain --ignored`: nada pesado debe aparecer como `A`.
