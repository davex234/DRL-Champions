# Fase 60 — Admin Content Management System 5.0

Estado: **GO** (2026-09-24). Migración `0057_admin_cms` aplicada en producción 2026-09-24T19:13:56Z. Sin commit, sin push, sin deploy.

## 1. Qué es

`/admin` pasa de consola de operación (F58) a CMS: lo que es **contenido** se crea, edita, publica y retira desde el panel y llega al juego **sin reiniciar**; lo que es **regla de juego** o **de seguridad** se enseña pero no se edita.

| Sección | Ruta | Qué permite |
|---|---|---|
| Contenido (hub) | `/admin/content` | recuentos, salud de contenido (referencias rotas), matriz de fuentes |
| Agentes | `/admin/agents`, `/new`, `/[id]` | alta, edición, cara/cuerpo, publicar, retirar, borrar borrador sin referencias |
| Cartas | `/admin/cards/new` (asistente de 9 pasos), `/admin/cards/[id]` | borrador con arte + impreso, vista previa con `CardFace`, publicar, retirar |
| Jugadores | `/admin/players`, `/new`, `/[id]` | alta y edición con concurrencia; sin borrado (retiro por estado); equipo impreso de las cartas inmutable |
| Equipos | `/admin/teams` | solo lectura (identidades en código: GAME_RULE) |
| Sobres | `/admin/packs`, `/new`, `/cms-…` | sobre desde plantilla (economía heredada, congelada), arte, pool propio, simulación en servidor, puerta de publicación, retirar |
| Eventos | `/admin/events/[id]` | imagen (`event_art`) y descripción; publicación v2 |
| Assets | `/admin/assets` (`/legacy` = gestor anterior) | subidas seguras, versiones, uso, huérfanos, limpieza explícita |
| Mapas | `/admin/maps` | solo lectura, con NOT READY cuando falta algo |

## 2. Matriz de fuentes

La matriz completa (20 filas) vive en código, `src/domain/cms/sourceMatrix.ts`, y se exporta a `qa/fase60-admin-cms/content-source-matrix.json`. Clases:

- **CONTENT**: agentes, arte de agentes, cartas, jugadores, sobres del panel, pools de sobres del panel, eventos e imagen, y assets. Es editable y su fuente es la BD.
- **CONFIGURATION**: flags como `GLOBAL_MARKET_ENABLED`, pagos o `ESPORTS_AUTO_SYNC_ENABLED`, y las ventanas de venta. Se muestran pero no se tocan.
- **GAME_RULE**: economía congelada (F57.3–F57.6), plantillas de sobre, equipos, temporadas, recompensas, ediciones y mapas del coach. Solo se leen.
- **SECURITY_RULE**: `profiles.is_admin`, el log de auditoría inmutable y las reglas de subida. No se editan.

## 3. Arquitectura

- **BD como fuente del contenido dinámico.**
  - Cada entidad lleva `lifecycle` DRAFT / PUBLISHED / RETIRED (en los sobres del panel: DRAFT / ACTIVE / RETIRED) y un campo `version` para concurrencia optimista.
  - Todas las escrituras pasan por RPC `security definer` concedidas solo a `service_role`, con `_require_admin(actor)`.
  - La auditoría se escribe en `content_audit_log` dentro de la misma transacción.
  - `_bump_entity` avanza `content_entity_version`.
- **HTTP.** `src/server/cms/handlers.ts` usa `runAdmin` de F58: `verifyAdmin`, límite de tasa, lista blanca de campos (asignación masiva ⇒ 400), `no-store` y mapeo de códigos de error sin detalle interno. Las rutas están en `src/app/api/admin/cms/*`.
- **Runtime sin reinicio.**
  - **Servidor:** cargadores con TTL de 5 s más la versión de entidad (`loadAgentCatalog`, `loadPackCatalog`), y `ensureServerAgents` / `ensureServerPacks` en las rutas de juego.
  - **Cliente:** `ContentSync` (en `GameShell`) lee `/api/content/agents` y `/api/content/packs`. Son públicas, sin borradores, y se consultan cada 60 s con la pestaña visible.
  - **Registros vivos:** `applyRuntimeRoster`, `applyRuntimeAgentArt` y `applyRuntimePacks`, con los hooks `useRosterVersion` y `usePacksVersion`.
  - **Fallos de red:** una lista vacía o caída nunca vacía el roster; se queda la instantánea.
- **Una sola fuente de agentes.**
  - `valorantRoster.ts` es una instantánea derivada de la BD (`npm run agents:snapshot`; con `--check` comprueba que coincide).
  - El espejo de esports y el importador VLR se derivan de ella; ya no hay listas a mano.
- **Cartas.**
  - Las 331 siguen usando el manifiesto de código (`presentation` NULL no las toca).
  - Las cartas del panel guardan lo impreso en `content_cards.presentation`.
  - El trigger `content_card_publish_guard` impide publicar una carta del panel sin presentación completa, entre por donde entre.
  - `CardArt` / `CardFace` es el único renderizador; no hay renderizador de admin.
- **Sobres.**
  - Un `content_packs` hereda precio, número de cartas y distribución de una plantilla de código y tiene su propio pool EXPLICIT `pack-<id>`.
  - La simulación se hace en servidor, no escribe nada y reutiliza los invariantes existentes: liquidación < 70 %, EV/precio ≤ banda principal (salvo Icon), sin clases vacías, elegibles > 0.
  - La publicación re-simula, guarda `sim_summary` y pasa a ACTIVE. La RPC exige arte, simulación y pool utilizable.
  - Tras publicar, la economía queda congelada (`ECONOMY_FROZEN`).
  - Solo se venden por créditos del juego.
- **Subidas.**
  - Formato detectado por firma de bytes (PNG/WEBP/JPEG/AVIF). SVG y HTML se rechazan, igual que la doble extensión o un MIME falso.
  - Dimensiones leídas de la cabecera y decodificación completa con `sharp` (si falla, se rechaza).
  - Derivados WEBP: cara 256/96 px, cuerpo 704 px.
  - La ruta la genera el servidor: `cms/<kind>/<uuid>/<variant>.<ext>`.
  - Deduplicación por sha256 y versiones por `group_id`.
  - Si algo falla a mitad, se compensa sin dejar objetos ni filas.
  - Los huérfanos se detectan y solo se borran con limpieza explícita; un asset en uso no se borra. La ruta legada `/api/admin/assets` quedó endurecida con las mismas firmas.
- **Dependencias.** No hay borrado físico de contenido referenciado. Cada entidad tiene su RPC `*_references`, y las FK `restrict` protegen el arte de los agentes. El inspector aparece en cada ficha.

## 4. Pruebas

- **Gates:**
  - tests: 5113 → **5144** (+31: `src/server/cms/cms.test.ts` 20 y `src/domain/cms/cms.domain.test.ts` 11);
  - tsc web 0 y tsc scripts 0;
  - `npm run lint` 0 errores (27 avisos, los mismos de antes);
  - `next build` PASS.
- **Catálogos:** `qa/fase60-admin-cms/{security,crud,dependency,runtime}-tests.json` (qué prueba cubre qué, más los pasos de la QA de producción).
- **QA de producción:** `prod-qa-lifecycles.json`, 38/38.
  - La hizo la cuenta QA con `is_admin` temporal, concedido y revocado, ambas cosas auditadas.
  - Se crearon un agente, una carta y un sobre en borrador: invisibles en runtime y borrados después.
  - Assets subidos, reemplazados y deduplicados; los huérfanos se limpiaron.
  - Los recuentos finales son idénticos a los de partida.
- **QA visual:** `scripts/_fase60-shots.ts` hizo 19 rutas × 1440/1024/390 = 57 capturas en `screenshots/`: 0 desbordes, 0 imágenes rotas, 0 errores de consola (`visual-qa.json`). Los datos salen de los handlers GET reales. El borrador de agente, el borrador de sobre y la biblioteca de assets son **sintéticos** (en la BD no queda ninguno) y así se indican.
- **Salud real:** `content-health.json` da HEALTHY en los 5 checks y 0 referencias rotas.

## 5. Rollback

1. **Código.** La funcionalidad es aditiva: las rutas nuevas quedan sin usar si se revierte el código. Los registros vivos arrancan de la instantánea, así que el juego sigue funcionando sin 0057.
2. **BD.** 0057 no borra ni reescribe datos existentes: solo añade tablas, columnas, checks, RPC y una política. Para revertirla:
   - `drop function` de las 17 RPC y helpers nuevos;
   - `drop table content_packs, content_entity_version`;
   - `alter table … drop column` de las columnas añadidas (primero las FK del arte de agentes);
   - restaurar los checks anteriores de `assets` y la política `agents` de lectura pública;
   - `drop trigger content_card_publish_guard`.
3. **Copia previa.** `/opt/nexus/backups/supabase-drlcards/pre-0057/20260924T191344Z/`: volcado completo, 10 tablas tocadas, CSV de `agents` y `SHA256SUMS`.
4. **Ensayo.** El rollback se ensayó en seco (BEGIN … ROLLBACK): 25 valores idénticos. Todo está en `production-migration-evidence/`.

## 6. Storage: copia y recuperación

La copia diaria de la BD **no incluye los objetos de Storage**. Los ficheros viven en el volumen de `supabase-storage` del stack `supabase-drlcards`; en la BD solo están sus filas `storage.objects` y `assets`.

- **Estrategia:**
  1. `tar` del volumen de storage junto a cada copia de BD (misma marca de tiempo), o `rclone`/S3 del bucket;
  2. sumas sha256 de ambos lados. `assets.checksum` guarda el sha256 del original, lo que permite verificar una restauración.
- **Recuperación:**
  1. restaurar el volumen;
  2. comprobar que cada `assets.storage_path` existe (`/admin/assets` y la salud de contenido lo detectan);
  3. un asset sin objeto se re-sube como nueva versión del grupo.
- **Estado hoy:** 0 assets del panel en producción. La QA borró los suyos, y Storage responde 400 al pedirlos.

## 7. Limitaciones (honestas)

- Equipos, temporadas, recompensas, ediciones y mapas del coach son **solo lectura** (GAME_RULE): editarlos es cambiar reglas o gameplay, fuera de alcance.
- La imagen de evento se guarda en `events.logo`, pero el juego todavía no pinta el logo de los eventos.
- `sharp` llega como dependencia transitiva de `next`, no declarada. Si falta, las subidas se rechazan (fail closed).
- Exportar e importar: se mantienen la exportación de cartas y la importación en seco de F58. No hay exportación nueva de agentes ni sobres.
- `ContentSync` refresca cada 60 s con la pestaña visible; el servidor, a los ≤ 5 s.
- Las migraciones 0026+ siguen sin registrarse en `schema_migrations` (convención del proyecto).
- Mercado y pagos siguen OFF. No se ha tocado economía, gameplay, `drlcards-sync`, el cron ni la flag de autosync.
