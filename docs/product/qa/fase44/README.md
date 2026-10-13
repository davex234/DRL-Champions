# Fase 44 · Game Experience 4.0 — evidencias de QA

Todo lo de esta carpeta sale de instrumentos `_fase44-*` (fuera de CI) y del verificador `game-experience:verify`.

| Carpeta / fichero | Qué es | Cómo se generó |
|---|---|---|
| `before/` | 118 capturas BEFORE (1440 + 390): 24 pantallas reales con la cuenta QA + 35 escenas de arnés, sobre la build de la Fase 43 | `scripts/_fase44-shots.ts before <creds>` |
| `after/` | 333 capturas AFTER sobre la build de producción de la fase: escritorio 102, móvil 102, tablet 1024 ×50, movimiento reducido ×59, panorámico 1920 ×24 (+48 reales repetidas en serie para descartar 429 de la propia QA) | `F44_RUN=… F44_GROUPS=… scripts/_fase44-shots.ts after <creds>` |
| `real/` | 37 capturas de la QA real (recorridos A–F) + `real-qa.json`, `real-nav.json` | `scripts/_fase44-real-qa.ts`, `scripts/_fase44-real-nav.ts` |
| `game-experience-map.json` | mapa pantalla → propósito, acción, problema, objetivo, nivel de movimiento | verificador (shell) |
| `navigation-fuzz.json` | 100.000 secuencias de navegación | verificador (navigation) |
| `motion-fuzz.json` | 10.000 × momentos, ceremonia, draft y XP | verificador (motion) |
| `dead-end-report.json` | salidas por pantalla core + profundidad de clic | verificador (navigation) |
| `play-visibility.json` | JUGAR visible por captura AFTER | verificador (play) |
| `responsive-matrix.json` | 11 anchos × pantallas reales y de arnés | `scripts/_fase44-responsive.ts` |
| `accessibility-matrix.json` | teclado real (Tab/Enter/Escape), foco, lectores | `scripts/_fase44-a11y.ts` |
| `performance-before.json` / `performance-after.json` / `performance-before-after.json` | tareas largas, CLS, fotogramas lentos, DOM, JS por pantalla (build de producción, 3 pasadas, mediana) | `scripts/_fase44-perf.ts` + verificador |
| `bundle-before.json` / `bundle-after.json` | tamaño de `.next/static` | medido tras cada `next build` |
| `prefetch-evidence.json` | atribución del JS extra de Home a rutas precargadas por `<Link>` | CDP + client-reference-manifest |
| `gates*.json` | resultado de los verificadores de regresión | `node scripts/_fase44-gates.mjs` (túnel cerrado) |

Cuenta QA: `8c326e52` (credenciales fuera del repo). Escrituras reales de la QA (legítimas, por las API normales del juego):
2 PvE Fácil + 1 nodo de Road to Champions (c1-n2) + compra y apertura de 1 Sobre Estándar. Libro: +120 +120 −750 +120 +50.
Las capturas BEFORE/AFTER y las matrices son de solo lectura (huella de BD idéntica antes/después; la única variación
observada en BEFORE fue la materialización de la rotación de misiones al abrir Objetivos, comportamiento de la Fase 42).
