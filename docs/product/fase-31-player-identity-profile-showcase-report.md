# Fase 31 · PLAYER IDENTITY 2.0 — Perfil de jugador + vitrina de cartas + logros + estadísticas + actividad

Fecha: 2026-09-14 · Rama `arch/stabilization` (HEAD `48dac2a`, sin commit) · Sin deploy, sin VPS, sin Docker, sin migraciones aplicadas.

## 1. Estado inicial encontrado

- El «perfil» vivía repartido: `/cuenta` (ficha privada con créditos, puntos, ajustes y una vitrina automática de 4 cartas) y `/duelos/competitivo/jugador/[id]` (perfil competitivo de la Fase 28, con login obligatorio y acciones sociales de la Fase 29 en un hueco).
- Seis sitios enlazaban a la ruta competitiva: escalera, historial, detalle de partida, `PlayerProfile`, `profileHref` de Social y el post-partida privado.
- `profiles` es legible por todos (id, username, avatar, xp, equipped…). `user_cards` y `user_achievements` solo los lee su dueño bajo RLS. `profiles.distinct_cards` nunca se escribe.
- Avatar = emoji de una lista de 12 escrita en `/cuenta`; la BD acepta cualquier texto. El nombre de usuario no se puede editar en la app (sufijo `_xxxx` del trigger de alta).
- No existía sitio para guardar preferencias públicas de perfil ni ningún helper de compartir.
- Serie = número de acuñación global por carta (`user_cards_serial_uniq (card_id, serial)`). Rareza real = `RarityBucket` (`bucketForRank`). Logros = 7 del catálogo `ACHIEVEMENTS`, «conseguido» = fila en `user_achievements`.

## 2. Identidad pública canónica elegida

Una sola ruta: **`/jugador/[id]`**, por id estable (el nombre puede no ser estable). `/jugador/me` resuelve al perfil propio. La ruta antigua `/duelos/competitivo/jugador/[id]` es un `redirect` (307) a la canónica: los enlaces guardados no se rompen y no hay dos perfiles públicos. Todos los enlaces pasan por `playerHref()` (`src/lib/player/href.ts`).

## 3. Sistemas reutilizados

`getCompetitivePlayer` (Fase 28) para rating, posición, récord, forma e historial; `RecentForm`, `outcomeTone`, `OUTCOME_LABEL`; `h2hSplit` y `h2hText` (Fase 29); `SocialActions` / `SocialActionsPanel` (Fase 29); `accountLevel` / `levelFromXp`; `ACHIEVEMENTS`; `equippedDefs` (cosméticos: título, marco, banderín); `CollectionEngine` + `applyFilter` + `instancesOf` + `isLowSerial`; `buildTeamCollection`; `bucketForRank` + `BUCKET_LABEL`; `serverCatalog` (`instance(cardId, minted_version)`); `PlayerCard` + `Card3D` + `CardViewer` + `CardThumb`; `takeRate`; `getSession`; primitivas UI.

## 4. Qué se ha construido

Dominio puro `src/domain/profile/{identity,avatars}.ts`; migración local `0049_player_profile_customization.sql`; servicio `src/server/services/playerIdentity.ts`; API `/api/game/player`; cliente, telemetría y enlace canónico en `src/lib/player/*`; 7 piezas en `src/components/player/*`; página `/jugador/[id]`; redirección de la ruta antigua; tarjeta «TU PERFIL» en `/cuenta`; navegación separada «Mi perfil» / «Cuenta»; arnés `/design-system/fase31`; script de capturas; 58 tests nuevos.

## 5. Player Profile Hero

`PlayerHero`: avatar grande con el anillo del marco equipado, nombre (`h1`), banderín y título equipados (cosméticos reales), «Nivel N», rating y posición ranked («Sin clasificar» si no hay) y «Ranked provisional» si aplica. Acento y resplandor de la paleta de la carta destacada. Perfil propio: EDITAR PERFIL, COMPARTIR PERFIL, CUENTA Y AJUSTES, barra de XP. Perfil ajeno: COMPARTIR PERFIL y las acciones sociales de la Fase 29.

## 6. Nivel / XP

`accountLevel(profiles.xp)` → `levelFromXp`, sin otra fórmula. Público: solo el NIVEL. Propio: además XP dentro del nivel y XP para el siguiente.

## 7. Ranked identity

Datos de `getCompetitivePlayer`: rating, posición y total, V–D–E, winrate, forma, racha, provisional. Rating máximo = mayor `new_rating` en `duel_pvp_rating_events` (comparado con el actual). Sin partidas ranked no hay bloque. Sin tiers: nada de Bronce, Plata, Oro, Platino, Diamante, Inmortal ni Radiante, y ni `RankBadge` ni `RankEmblem` (test).

## 8. Card Showcase

`CardShowcase`: 3 slots (pequeño y premium: una protagonista y dos acompañantes, igual que la vitrina de la home). Cada slot es una INSTANCIA real de `user_cards` con su serie y su variante. Se pinta con `PlayerCard` dentro de `Card3D`: el slot 1 al frente y más grande, con halo «legendary» solo si su rareza es legendaria; los otros dos inclinados. Bajo cada carta, texto con rareza, serie `#3 / 100`, «Serie baja» y variante con equipo. Al pulsar se abre el `CardViewer` canónico. La serie no da valor ni cambia rareza.

## 9. Showcase persistence / model

Tabla `player_profile_customization (user_id PK, showcase_card_uids uuid[], featured_achievement_ids text[], version, updated_at)` con CHECK de máximo 3, sin nulos y sin duplicados (funciones inmutables `_uuid_array_is_unique` y `_text_array_is_unique`). RLS sin políticas, solo `service_role`. Escribe únicamente el RPC `player_profile_set`, que valida propiedad (`user_cards` del jugador), logros reclamados (`user_achievements`) y versión dentro de la misma transacción (`for update`).

## 10. Showcase editor

`ShowcaseEditor`: hoja inferior en móvil y diálogo en escritorio (`role="dialog"`, Escape, foco al cerrar), con pestañas VITRINA / LOGROS / AVATAR. Slots con botones Subir, Bajar y Quitar (sin arrastrar). Rejilla de la colección real vía `CollectionEngine(owned).ownedViews()` + `applyFilter`. Filtros: buscar, equipo, rol, rareza real y duplicadas. Paginación de 48 y aviso de vitrina llena. GUARDAR VITRINA se deshabilita si no hay cambios.

## 11. Instance / serial selection

Si la carta tiene varias copias, `instancesOf(owned, cardId)` abre el selector de instancia: cada copia con serie, variante, rareza y fecha de obtención (solo la ve el dueño), y el botón «Exponer esta copia». Elegir otra copia de una carta ya expuesta la sustituye en su slot. Así se puede exponer la #3 aunque también se tenga la #211.

## 12. Featured card

Sin campo nuevo: el slot 1 es la carta destacada. Marca el acento del perfil con `variant.palette.primary` (token existente, no color extraído de ninguna imagen) y la rareza del resplandor. Sin vitrina se usa el acento de la casa.

## 13. Collection summary

`collectionSummary`: cartas (ejemplares), distintas (definiciones; se mantiene la corrección de la Fase 27), % completado sobre distintas / catálogo del servidor, y equipos completos y empezados vía `buildTeamCollection`. Sin colección pública completa (P2).

## 14. Rarity summary

`raritySummary`: distribución por `RarityBucket` real (Legendaria · Épica · Rara · Poco común · Común) sobre cartas distintas, sin cubos vacíos, con barra relativa y cifra.

## 15. Featured achievements

Hasta 3 trofeos elegidos entre los logros CONSEGUIDOS del catálogo real (`ACHIEVEMENTS`), en el orden guardado. Un logro bloqueado, repetido o desconocido se rechaza (servicio + RPC). La foto solo muestra los que siguen reclamados. Sin badges nuevos. Destacar un logro no paga nada.

## 16. Profile stats

Públicas: partidas ranked, V–D–E, winrate, rating máximo, cartas, distintas y logros x/7. Solo el dueño: duelos privados y sobres abiertos, marcados «solo tú lo ves» porque revelan actividad privada o gasto. Nada inventado (sin «Skill», «Prestigio» ni «Collector Score»; test).

## 17. Match history / recent form

Últimas 5 partidas ranked públicas (letra, rival enlazado al perfil canónico, marcador, fecha) con `RecentForm` de la Fase 28 sin recalcular. VER HISTORIAL → `/duelos/competitivo/historial` solo en el perfil propio. Las partidas privadas nunca aparecen en el historial público.

## 18. H2H

`H2HPanel` «Cara a cara contigo» con RANKED / PRIVADOS / TOTAL vía `h2hSplit` sobre `duel_matches` entre espectador y jugador. Solo con espectador con sesión y distinto del jugador. Funciona sin 0048 (columna `mode` de texto). El panel social del perfil ya no repite su propio cara a cara (`showH2H={false}`).

## 19. Social actions

`SocialActions` de la Fase 29 en el hero de perfiles ajenos: añadir, aceptar, retar, eliminar, bloquear y desbloquear. En el propio, EDITAR PERFIL. Si el social no está operativo (0048 sin aplicar), `SocialActions` captura el error y no pinta nada: el perfil sigue. Si el jugador te ha bloqueado (y la tabla existe), su perfil responde 404 igual que uno inexistente.

## 20. Pick'ems identity / privacy

Resumen solo de `pickem_scores` (filas ya corregidas, lectura pública por RLS): Pick'ems jugados, puntos, aciertos, precisión y los 3 más recientes con su título. Nunca se leen `pickem_answers`, `pickem_submissions` ni `pickem_questions`, así que nunca se revela una elección antes de su cierre (test).

## 21. Event identity

La sección «EVENTOS · PICK'EMS» enseña los últimos Pick'ems corregidos por evento (título, aciertos, puntos), sin convertir el perfil en Event Hub. Los jugadores esports de la Fase 30 no se enlazan a usuarios NEXUS (test).

## 22. Recent activity

`profileActivity` (≤ 6) con hechos públicos fechados de verdad: resultados ranked, logros conseguidos y Pick'ems corregidos. Fechas de logro y Pick'em redondeadas al día. Sin compras, créditos, recompensas, objetivos, amistades, bloqueos ni mazos. «Subió de nivel» y «cambió la vitrina» no tienen fecha fiable: no se inventan (P2).

## 23. Profile customization

Editable: vitrina (3 instancias), logros destacados (3) y avatar (conjunto existente). Acento derivado de la carta destacada y cosméticos equipados existentes. Sin bio, enlaces, subidas ni texto libre.

## 24. Avatar / username

Avatar = emoji del conjunto cerrado, centralizado en `src/domain/profile/avatars.ts` (que `/cuenta` ahora importa). Se guarda por `set_avatar`, validado en servidor. `safeAvatar` sirve el avatar por defecto si la BD trae otra cosa. Nunca se pinta como `<img>`: sin `javascript:`, `data:` ni SSRF. Nombre de usuario sin cambios de semántica: sigue sin edición en la app.

## 25. Share profile

COMPARTIR PERFIL: `navigator.share` en táctil o portapapeles con `playerShareUrl(origin, id)` (URL canónica por id) y aviso «Enlace del perfil copiado». Sin servidor ni acortador.

## 26. Account integration

`/cuenta` sigue siendo cuenta (sesión, avatar, región, ajustes, herramientas) y añade `ProfilePreviewCard` «TU PERFIL» (avatar, nombre, nivel, vitrina en miniatura) con VER PERFIL y EDITAR (`?editar=1` abre el editor). Navegación: Progreso › «Mi perfil» (`/jugador/me`) y «Cuenta» (`/cuenta`); la barra móvil «Perfil» va a `/jugador/me`; `/jugador/*` pertenece a Progreso; zona de telemetría `account`.

## 27. Social / Competitive integrations

Escalera (`Leaderboard`, incluye «alrededor de ti»), historial, detalle de partida, `PlayerProfile` de la Fase 28 (solo arnés), filas de Social (`profileHref` → `playerHref`) y post-partida privado enlazan al perfil canónico. Test: ningún componente conserva la ruta antigua.

## 28. Read model / API

`PlayerIdentitySnapshot { view SELF|PUBLIC, player, self|null, accent, ranked, showcase, featured, achievements, collection, rarity, recentMatches, h2h, pickems, activity, serverNow }`.

- `GET /api/game/player?id=<uuid>`: foto pública, o SELF si el Bearer es de ese jugador.
- `GET ?me=1`: foto SELF; 401 sin sesión.
- `POST { action: set_showcase | set_featured_achievements | set_avatar }`: cuerpo estricto con lista blanca de claves por acción; claves desconocidas → 400.

## 29. Data model / migration

`0049_player_profile_customization.sql` (siguiente número libre; aditiva e idempotente; **NO APLICADA**; no toca `schema_migrations` ni `profiles`). Sin ella el perfil se ve con vitrina y logros destacados vacíos, y guardar responde 503 «La personalización del perfil todavía no está disponible». 0046 gana la reserva del flujo `'player_profile'` (sigue sin aplicar).

## 30. Concurrency / idempotency

- **Mismo contenido** → `UNCHANGED`, sin mover la versión, aunque la versión esperada sea vieja. Guardar dos veces es idempotente.
- **Versión esperada distinta** → `CONFLICT` (409). La pestaña recarga la foto y avisa, y no se pisa lo guardado por la otra pestaña.
- **Sin versión** → último en escribir gana, documentado.
- **Carrera** → `for update` + `insert … on conflict do nothing` serializan en BD. `applySave` replica la regla en puro para los tests.

## 31. Privacy

- **Proyección fija de `profiles`**: `id, username, avatar, xp, equipped, packs_opened`. XP exacta y sobres solo en SELF; `equipped` y `packs_opened` nunca viajan en crudo.
- **El servicio nunca lee** email, créditos, `is_admin`, ledger, `economy_ops`, `user_pass`, `duel_decks`, respuestas de Pick'ems, `auth.users` ni `last_seen_at`.
- **La foto pública no lleva** XP exacta, versión, uids guardados, logros reclamables, duelos privados, sobres, fechas de obtención ni horas exactas.
- **Lo privado se decide en el servidor** (`self: isSelf ? …`), nunca con CSS. Test con hechos «sucios» (email, créditos, `is_admin`, rol) que no aparecen en la foto.

## 32. Security / rate limiting

- **Mutaciones**: sesión obligatoria y `userId` del token; el cuerpo nunca dice de quién es el perfil.
- **Validación**: UUID en ruta y servicio; propiedad y logros en servicio y otra vez en el RPC (defensa en profundidad).
- **Rate limit**: cubetas `profile_read` 60/min (por usuario, o por hash SHA-256 de la IP sin sesión) y `profile_write` 20/min, sin migración.
- **Errores y claves**: los 5xx del servicio responden 503 con la frase de producto; sin service key en cliente.

## 33. Performance

- **Perfil**: 1 lectura de perfil + `getCompetitivePlayer` + 7 consultas en paralelo (máximo rating, ejemplares paginados de 1.000 en 1.000 con tope 20.000, personalización, logros del catálogo, `pickem_scores` ≤ 100, H2H ≤ 100, recuento de privados propios). Después, las ≤ 3 instancias de la vitrina y ≤ 3 títulos de Pick'em.
- **Sin N+1**: ninguna consulta por carta, logro o partida (test).
- **Render**: 3 `Card3D` como mucho y un solo halo.

## 34. Responsive / mobile

390: hero en columna (avatar + nombre, rating y ranked 2×2, acciones), vitrina en carrusel con snap y la destacada primero con asomo de la siguiente, estadísticas 2×2, trofeos apilados, ranked, cara a cara y Pick'ems. El editor es hoja inferior con filtros apilados y el selector de instancia a pantalla completa y opaco.

## 35. Accessibility

Cartas como botones con etiqueta (jugador, variante, serie), serie y rareza en texto, pestañas `tablist/tab/aria-selected`, diálogos modales con Escape, ordenación por botones sin arrastrar, filtros con `label`, foco visible, táctil ≥ 44 px, W/L/D con letra además de color, `h1` en el hero, avatar con `role="img"` y etiqueta, sin `aria-live` agresivo, `motion-reduce` en las inclinaciones.

## 36. Game feel / visual system

Escenario con rejilla y resplandor del acento de la carta destacada; vitrina en abanico con `Card3D` (flotar/halo) y `PlayerCard` a tamaño real; trofeos como placas doradas con icono grande; cifras con `Readout`; barras de rareza con tonos del sistema; cosméticos equipados (marco, banderín, título). Sin tarjetas SaaS iguales.

## 37. QA visual

**61 capturas** en `docs/product/qa/fase31/` + README (1440/1024/390):

- **Perfil**: propio completo, público completo, jugador nuevo, sin cartas, vitrina vacía (propia y ajena), vitrina con 1 carta y completa, serie baja destacada, slot no disponible.
- **Editor**: copias duplicadas, editor de vitrina, selector de instancia, guardando, editor de logros y de avatar.
- **Secciones**: logros, sin logros, ranked, sin ranked, forma reciente, historial, cara a cara, Pick'ems, sin Pick'ems, resumen de colección.
- **Social**: amigo, desconocido, solicitud pendiente, bloqueo, social no disponible.
- **Integraciones y estados**: tarjeta de cuenta, escalera → perfil, búsqueda → perfil, compartir, error de backend, no encontrado, sin sesión, reduced-motion y la ruta real `/jugador/me`.

0 errores de consola propios. La revisión encontró y corrigió tres defectos (§39).

## 38. Tests / gates

- **Nuevos**: `identity.test.ts` 32 (perfil 1–10, vitrina 11–24, logros 25–30, privacidad 31–40, social/H2H 41–48, competitivo, Pick'ems 54–56, avatar, actividad) · `profile.contract.test.ts` 26 (identidad canónica, 0049 y RPC, servicio, instancias reales, render canónico, editor, privacidad, seguridad 57–65, competitivo 49–53, social, Pick'ems, sin estadísticas inventadas, regresión 66–84, telemetría, accesibilidad, móvil, arnés) = **58**.
- **Tests existentes modificados**: se adaptaron para reflejar la consolidación y la nueva migración, sin rebajar lo que protegen.
  - `social.contract.test.ts`: la página y el enlace del perfil pasan a la ruta canónica (tests 18 y 73); «0048 es la migración de Social» en lugar de «0048 es la última» (test 65).
  - `liveEvents.contract.test.ts`: «Live Events sin migración propia» en lugar de «la última es 0048».

| Gate | Resultado |
|---|---|
| `npm test` | **1611 / 1611** (1553 previos + 58), 0 fallos |
| `tsc -p tsconfig.json` · `tsc -p tsconfig.scripts.json` | 0 errores |
| `next build` | OK (`/api/game/player`, `/jugador/[id]`, `/duelos/competitivo/jugador/[id]` → redirect, `/design-system/fase31`) |
| `eslint` (ficheros de la fase) | 0 errores (1 aviso previo en `cuenta/page.tsx`) |
| `security:verify` · `pack:verify` · `content:verify` · `distribution:verify` · `competitive:verify` · `importer-vlr:verify` | exit 0 |
| Humo en servidor | ruta antigua 307 → `/jugador/<id>`; `/jugador/me` 200; `GET ?id=nope` 400; `POST` sin sesión 401 |
| Suites de perfil, vitrina, colección, logros, privacidad, social y competitivo | verdes dentro de `npm test` |
| Guardado real contra BD (RPC 0049, propiedad, conflicto), `pvp-*:verify`, `events:verify` | **NO EJECUTADO — REQUIERE BD DE PRUEBAS** (sin Supabase local; no se apunta a producción) |

## 39. Bugs reales encontrados / corregidos

- **Selector de instancia transparente en móvil**: `bg-[#0b0e17]/97` no genera clase y la capa dejaba ver el editor debajo. Ahora es opaca.
- **Cara a cara duplicado**: en el perfil ajeno salía dos veces (panel social y panel del perfil). `SocialActions` gana un `showH2H` opcional (por defecto `true`, Social no cambia) y el perfil lo apaga.
- **Etiqueta truncada**: «Equipos completos» se cortaba en escritorio. Ahora es «Equipos · completos».
- **Tests con número de migración fijo**: la Fase 29 y la Fase 30 fijaban «la última migración es 0048» y rompían con cualquier migración legítima posterior. Se reescribieron a su intención.

## 40. P2 reales

- **Aplicar 0049**: hasta entonces la vitrina y los logros destacados no se pueden guardar (503 `NOT_READY`) y se ven vacíos.
- **Artwork subido**: `PlayerCard` / `CardRenderer` no pintan el artwork por instancia (`CardVisual` depende del store del usuario conectado). La vitrina usa el dibujo por capas, como `/cuenta` y la home.
- **Rating delta** por partida en el historial público: `getCompetitivePlayer` no lo proyecta y no se cambió la Fase 28.
- **Colección pública completa**: descartada en esta fase por privacidad y scraping.
- **Actividad** «subió de nivel» y «actualizó su vitrina»: sin fecha fiable persistida.
- **Edición del nombre de usuario**: no existe en la app ni se añadió.
- **Metadatos Open Graph** por perfil: las páginas son cliente, sin `generateMetadata`.
- **Límite de lectura anónima** por hash de IP: detrás de un proxy sin `x-forwarded-for` todos comparten sujeto.

## 41. Migraciones creadas / no aplicadas

Creada **0049_player_profile_customization** (local, **NO APLICADA**). 0046 solo gana la reserva `'player_profile'` (**NO APLICADA**). 0047 y 0048 siguen **NO APLICADAS**. `schema_migrations` intacto.

## 42. Archivos creados / modificados

**Creados:**
- `supabase/migrations/0049_player_profile_customization.sql`
- `src/domain/profile/{identity,avatars,identity.test,profile.contract.test}.ts`
- `src/server/services/playerIdentity.ts`
- `src/app/api/game/player/route.ts`
- `src/lib/player/{href,client,telemetry}.ts`
- `src/components/player/{bits,PlayerHero,CardShowcase,ProfileSections,ShowcaseEditor,PlayerIdentityView,ProfilePreviewCard}.tsx`
- `src/app/jugador/[id]/page.tsx`
- `src/app/design-system/fase31/{page.tsx,fixtures.ts}`
- `scripts/_fase31-visual-qa.ts`
- `docs/product/qa/fase31/*` (61 PNG + README)
- este informe

**Modificados:**
- `src/app/duelos/competitivo/jugador/[id]/page.tsx` (redirect a la ruta canónica)
- `src/components/competitive/{Leaderboard,MatchHistoryList,MatchDetailView,PlayerProfile}.tsx`, `src/components/social/bits.tsx`, `src/app/duelos/pvp/page.tsx` (`playerHref`)
- `src/components/social/SocialActions.tsx` (`showH2H` opcional)
- `src/app/cuenta/page.tsx` (`AVATARS` importado + `ProfilePreviewCard`)
- `src/design/nav.ts` (Mi perfil / Cuenta, barra móvil, alias `/jugador`)
- `src/lib/telemetry/contract.ts` (zona `jugador` → `account`)
- `src/server/services/rateLimit.ts` (`profile_read`, `profile_write`)
- `supabase/migrations/0046_telemetry_flows_progression.sql` (reserva `'player_profile'`)
- `src/domain/social/social.contract.test.ts`, `src/domain/liveEvents/liveEvents.contract.test.ts` (ver §38)
