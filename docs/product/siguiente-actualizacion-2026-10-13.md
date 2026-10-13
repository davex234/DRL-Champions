# Siguiente actualización — tareas pendientes tras `drl-0.1.1-1-b48d76af`

Fecha: 2026-10-13. Producción sirve `drl-0.1.1-1-b48d76af` (ocho idiomas + sobres ICON). Este documento solo
**registra** lo que queda para la siguiente versión. Nada de esto está implementado ni forma parte de los commits
de la release.

Punto de partida: la rama `arch/stabilization` contiene exactamente el código publicado (ver
`git-cierre-b48d76af-2026-10-13.md`). La siguiente release se prepara desde ahí.

## 1. Lectura de cartas limitada a 1.000 por cuenta

> **Hecho en la rama local `feat/collection-pagination`** (candidata `drl-0.1.1-1-4b1f4c01`, sin desplegar). Causa,
> arquitectura, mediciones y riesgos en `colecciones-ilimitadas-2026-10-13.md`. Lo que sigue es el planteamiento
> original, conservado como registro.

- **Qué pasa.** `loadGameState` (`src/server/services/inventory.ts`) lee `user_cards` en una sola petición, sin
  paginar. PostgREST corta en `max_rows = 1000`, así que una cuenta con más de 1.000 cartas recibiría la colección
  incompleta. Las cartas no se pierden: siguen en la base, pero la aplicación no las ve todas.
- **Alcance hoy.** Ninguna cuenta real se acerca (35 y 78 cartas). Se detectó con la cuenta sintética de QA
  (1.125 cartas) durante el ensayo de rollback. El fallo ya existía en `e5db60b6`.
- **Arreglo previsto.** Paginación segura con el ayudante que ya existe (`src/server/db/pageAll.ts`, usado en los
  pools y cartas de administración): orden estable por clave, páginas hasta agotar y error si una página falla
  (nunca devolver una colección parcial como si fuera completa).
- **Revisar a la vez.** Cualquier otra lectura por cuenta que pueda superar 1.000 filas (sobres, historial,
  operaciones) y las pantallas que cuentan cartas a partir de esa foto.
- **Prueba.** Test de servicio con más de 1.000 cartas y repetición del ensayo de rollback sin el rodeo por base de
  datos que hoy usa `rollback-rehearsal.sh`.

## 2. Copias de seguridad externas automáticas

- **Estado.** El backup local del VPS funciona y la restauración está probada. La copia fuera del VPS es manual
  (se copió al PC en este despliegue). `production:check` marca cuatro fallos por este motivo.
- **Qué hay hecho.** El trabajo F78 (copia off-site cifrada, simulacro de restauración desde el destino remoto y
  programación cada 6 h) está construido y ensayado, pero nunca desplegado. Queda guardado en la rama local
  `wip/f78-offsite-backups`, fuera de la línea de la release.
- **Qué falta.** Crear el almacenamiento externo (Backblaze B2) con la cuenta del propietario, ejecutar
  `node scripts/ops/b2-provision.mjs`, instalar credenciales en el VPS, primera copia, simulacro desde B2 y activar
  la programación. Después, desplegar el código F78 como una release propia.
- **Pendiente de decidir.** Incluir el almacenamiento de Supabase (imágenes subidas) en la copia diaria.

## 3. Revisión nativa de francés, portugués y japonés

- Los catálogos `fr`, `pt-PT`, `pt-BR` y `ja` pasaron la auditoría automática y una revisión asistida, pero no los
  ha leído un hablante nativo.
- Material: guía y glosario en `docs/i18n/TRANSLATION-BRIEF-8.md`; revisiones previas en
  `logs/i18n/final/review-*.json`.
- Prioridad: tienda, fichas de sobre, compra, crafteo y mensajes de error (donde un mal texto cuesta dinero o
  confianza); después el resto.
- Las correcciones entran por los catálogos de `src/i18n` y se validan con `npm run i18n:audit`.

## 4. Japonés en Safari de iPhone

- Medido con los motores de Playwright (Firefox, WebKit y Chromium): 396 PASS · 0 FAIL, sin recortes ni desbordes.
  WebKit en Linux no es Safari en un iPhone: falta mirarlo en un dispositivo real. Donde no existe
  `word-break: auto-phrase` (Safari y Firefox) los saltos de línea son menos naturales; hay que valorar si molesta.
- Pantallas mínimas: portada, tienda, ficha de los dos sobres ICON, apertura, colección, crafteo y cuenta.

## 5. Aviso de mantenimiento durante el rollback

- Con la barrera del rollback puesta (`ops_icon_pack_freeze`), comprar, abrir o craftear sobres ICON se rechaza sin
  cobrar ni consumir nada, pero el jugador ve un error genérico.
- Mejora: que el servidor reconozca ese rechazo y devuelva un mensaje propio («sobres ICON en mantenimiento, tus
  sobres y créditos están a salvo»), traducido a los ocho idiomas, y que la tienda lo muestre antes de intentar la
  compra.
- No cambia la economía ni el procedimiento de rollback; solo el texto y su código de error.

## 6. Contenedores Supabase con reinicios continuos (investigación aparte)

- En el VPS hay contenedores `supabase_edge_runtime_*` y `supabase_vector_*` reiniciándose en bucle. Es anterior a
  esta release; la aplicación de Valorosters responde con normalidad (salud correcta, 0 reinicios, 0 errores).
- Investigar por separado: a qué stack pertenece cada uno, causa del reinicio, consumo de CPU y disco, y si se
  pueden parar. Pueden pertenecer a otros proyectos NEXUS: no tocarlos sin identificar al dueño.

## Otras notas menores

- `cloudflared` avisa de versión antigua.
- `production:check` avisa de la autoconfirmación de correo (pendiente desde F77).
- Antes de un `git push`: `scripts/_f77-recovery-e2e.ts` contiene una dirección de correo personal y hay 75
  ficheros de operación con la IP del VPS (ver `git-cierre-b48d76af-2026-10-13.md`).
