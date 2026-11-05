# Fase 32 — Deck Builder 2.0 + Team Management

Fecha: 2026-09-14 · Rama `arch/stabilization` · **sin commit, sin push, sin VPS, sin Docker, sin deploy**.
Migraciones 0046–0049 **sin aplicar**; 0050 creada **sin aplicar**; `schema_migrations` intacta. Marketplace sigue OFF.

---

## 1. Estado inicial encontrado

- «Mis mazos» (`/duelos/mazos`, Fases 8 · 9G · 9.6): una lista y un constructor de una sola columna. El constructor calculaba sus propios bloqueos de interfaz (rol lleno, jugador usado) **sin mirar la temporada** (`dataVersion`) y solo enseñaba los errores del mazo **guardado**, no del borrador.
- Hoja «Añadir al equipo» (Fase 25, `AddToDeckSheet` + `planDeckInsert`) desde la colección y el resumen de sobre. Proponía siempre `decks[0]`.
- **No existía el concepto de equipo activo.** Pre-partida, PvP, retos y vestíbulo elegían cada uno «el primer mazo legal» por su cuenta.
- API `/api/game/duels`: `GET { decks, collection }` y `POST save | delete`.
  - Sin versión: el último guardado pisaba.
  - Sin cubeta de ritmo.
  - Cartas no-UUID descartadas **en silencio**.
  - Los 5xx devolvían el mensaje crudo.
  - Borrar no pedía confirmación.
- `loadOwned` leía `user_cards` **sin paginar**: PostgREST corta en 1.000 filas.
- `MAX_DECKS = 8`. Estado de partida: **1611/1611 tests**.

## 2. Modelo canónico de deck encontrado

- Tabla `duel_decks` (0014): `id`, `user_id`, `name` (1–40), `card_uids uuid[]` (≤ 10), `created_at`, `updated_at`. `updated_at` lo pone un trigger en cada UPDATE.
- **Guarda INSTANCIAS** (`user_cards.uid`), nunca definiciones ni estadísticas. Se permite guardar incompleto.
- RLS: SELECT del dueño. Toda escritura pasa por el servidor.
- Dominio `DuelDeck { id, name, cards: uid[], … }`. `validateDuelDeck(deck, resolver)` resuelve cada uid contra la propiedad y la versión con la que se acuñó (`makeDeckResolver`).
- Al jugar se congela un `DuelDeckSnapshot` (`takeDeckSnapshot`). PvE, PvP y retos pasan por `startMatch` / `resolveDeckSnapshot`, que revalidan.

## 3. Reglas reales encontradas

- **10 cartas** (`DUEL_DECK_SIZE`).
- **Exactamente 2 por rol** (`DUEL_COMPOSITION`): Duelista, Controlador, Iniciador, Centinela, **Flex**.
- **Flex es un ROL de jugador** (`RoleId`), no un hueco comodín: un hueco Flex solo admite jugadores Flex. El brief sospechaba lo contrario; manda el código.
- `DUPLICATE_CARD`: misma instancia o misma definición dos veces.
- `DUPLICATE_PLAYER`: mismo jugador, **aunque sean variantes distintas** (`ALLOW_SAME_PLAYER_TWICE = false`).
- `CARD_NOT_OWNED`, `CARD_NOT_FOUND`, `CARD_NO_COMBAT`.
- `INCOMPATIBLE_DATA_VERSION`: temporadas mezcladas.
- `ROLE_COUNT` exacto y `DECK_SIZE`.
- Estados: `EMPTY / INCOMPLETE / INVALID / READY_FOR_DUEL`.
- Estadísticas de combate: Stronghold, Gamesense, Entryfrag y OVR, ya derivados en la carta. **El serial no interviene** en combate ni en la huella.

## 4. Sistemas reutilizados

- **Validación y mutaciones.** `validateDuelDeck`, `duelDeckStatus`, `addCard`, `replaceCard` y `removeCard` para el borrador; `explainDeckError` para los textos.
- **Comparación.** `compareCards` de la Fase 25 (OVR, trío y rareza).
- **Collection 2.0.** `applyFilter` sobre una proyección `CardView` de cada ejemplar del servidor; rareza con `bucketForRank` y `getVariant`.
- **Piezas visuales.** `DuelCard` (renderer ligero), `Card3D` (solo equipo activo y comparador), `STAT_INFO`, `Badge`, `NxButton`, `Surface` y `ConfirmSheet` de la Fase 29.
- **Pre-partida.** `deckReadiness` y `pickStartableDeck` (Fase 26).
- **Servidor.** `takeRate` (tabla y RPC existentes), `serverCatalog`, y de `duels.ts`: `loadOwned`, `toDeckDTO` y `saveDeck`.
- **Legalidad al jugar.** `startMatch` y `resolveDeckSnapshot`, intactos.
- **Telemetría.** `trackFlow`.

## 5. Qué has construido

1. Dominio de presentación `src/domain/deckBuilder/`:
   - `builder.ts`: tablero, frases, operaciones, estadísticas, comparador, sugerencia, autocompletado y nombres.
   - `pool.ts`: filtro del panel de colección.
   - `request.ts`: cuerpo estricto.
2. Servicio `src/server/services/deckTeams.ts`:
   - la foto de trabajo;
   - guardado atómico con versión;
   - crear, renombrar, duplicar, borrar y activar.
3. API extendida `/api/game/duels`: acciones nuevas, cubetas `deck_read`/`deck_write` y 5xx genérico.
4. Migración **0050** `duel_active_deck` + RPC `duel_deck_activate`, sin aplicar.
5. Hub **MIS EQUIPOS** y **NEXUS TEAM BUILDER** en `/duelos/mazos`, más el alias `/equipo`.
6. Integraciones: pre-partida, PvP, reto social, colección, perfil propio, vestíbulo, FTUE y hub de duelos.
7. Telemetría con puerta (`deck_management`).
8. Arnés QA `/design-system/fase32`, script de capturas y capturas en `docs/product/qa/fase32/`.
9. Tests: 52 de dominio, 18 de servicio con Supabase en memoria y 50 contract tests.

## 6. Deck Hub

`TeamHub`, en `/duelos/mazos`:

- **Cabecera** «Mis equipos» con las reglas escritas a partir de `DUEL_ROLES` × `DUEL_COMPOSITION`, el contador «Equipos N/8 · Listos X» y el botón «+ Nuevo equipo».
- **ACTIVO arriba**: escenario con sus 3 cartas de mayor OVR en `Card3D`, OVR medio, pips de composición y las acciones Jugar, Editar equipo, Duplicar, Renombrar y Eliminar.
- **OTROS**: tarjetas con nombre, «n/10 cartas», «Editado hace…», estado del servidor (Listo para duelo / Incompleto / Revisar) y 3 cartas destacadas en `DuelCard`, no diez `Card3D`. Llevan pips por rol, la causa en humano y las acciones Editar, **Activar** (solo si es legal), Jugar, Duplicar, Renombrar y Eliminar.
- **Tarjeta «Crear equipo»** mientras quede cupo.
- **Sin activo**: aviso explícito, con su variante cuando 0050 no está aplicada.
- **Sin equipos**: FTUE en 4 pasos (consigue cartas, crea, completa roles, juega) con «Crear mi primer equipo» y enlace a sobres si faltan cartas.

## 7. Deck Builder

`DeckBuilder`, a pantalla completa y sin modal pequeña:

- **Cabecera**: nombre editable validado en vivo, «N / 10 CARTAS», estado guardado (Listo para duelo / Guardado incompleto / Sin guardar), «Equipo activo» y «Cambios sin guardar». Acciones: **Guardar equipo**, **Activar** (desactivado con motivo si está sucio o no es legal), Duplicar y Eliminar.
- **Avisos**:
  - conflicto de versión, con Recargar / Revisar / Guardar mi versión;
  - error de guardado que conserva el borrador;
  - cartas no disponibles, con Quitar;
  - «Tienes X de 10», con camino a sobres;
  - carta elegida para colocar;
  - avisos humanos.
- **Tres zonas**: COLECCIÓN → TU EQUIPO → ANÁLISIS.
- **Hojas**: colección (tableta y móvil), hueco, comparador y confirmación de salida.

## 8. Team Board/slots

`TeamBoard`:

- Diez huecos agrupados por rol, en 5 columnas desde 1024 px y 5 filas en móvil. Cada rol muestra «n/2» y se marca completo en verde.
- Cada hueco es un botón con nombre propio («Centinela 2: vacío. Pulsa para elegir carta») y estado **EMPTY / FILLED / INVALID**. Con INVALID, el motivo va debajo y enlazado con `aria-describedby`.
- Resaltado cian «Colocar aquí» si la carta elegida puede añadirse; oro «Sustituir» si puede sustituir.
- Marca «Libre» si el autocompletado puede cambiar esa carta.
- La carta recién colocada entra con un muelle suave, sin animación con movimiento reducido.
- Teclado: Enter abre el hueco, Supr/Retroceso quita y Alt+↑/↓ mueve dentro del rol.

## 9. Collection panel

`CollectionPanel`:

- **Solo ejemplares que el servidor resolvió como tuyos.** Filtros: buscar (`applyFilter` de Collection 2.0), rol con cuántos faltan de cada uno, equipo, rareza (`bucketForRank`), OVR mínima y «Solo repetidas».
- **Orden**: OVR, Nombre, Rareza o Recientes (fecha de obtención).
- **Carga**: 36 cartas y «Ver más», sin cien cartas ricas a la vez.
- **Etiqueta de cada carta**: «+ Añadir», «⇄ Sustituir», «✓ En el equipo» o el motivo si no es compatible (entonces no es un botón). Copias «×N» y serie visibles.
- **Estados vacíos**: sin cartas (con enlace a sobres) y sin coincidencias (con «Quitar filtros»).

## 10. Card adding/removal/replacement

- **Añadir**:
  - pulsar una carta con hueco legal la coloca en el primer hueco libre de su rol (`addCard`);
  - o hueco → candidatas → «Elegir».
- **Sustituir**:
  - carta con rol lleno o jugador repetido → se elige y se iluminan los huecos donde puede sustituir → comparador → «Confirmar cambio» (`replaceCard`, conserva la posición);
  - o hueco ocupado → candidatas → «Cambiar».
- **Quitar**: botón en el hueco o Supr (`removeCard`). Siempre posible.
- **Mover**: ↑/↓ (o Alt+↑/↓) dentro del rol. Es el único movimiento que existe, porque el hueco lo decide el rol.
- **Sin arrastrar**: drag & drop no se implementó; queda como mejora P2.

## 11. Slot compatibility

- `compatibleSlots` prueba cada hueco del rol con la operación canónica y solo ilumina los legales, en modo añadir o sustituir.
- Un hueco donde el validador rechazaría la carta nunca se resalta.
- `tryPlace` en otro rol devuelve «Este hueco es de Flex; X juega de Duelista.».

## 12. Duplicate-player/variants

- Añadir otra variante de un jugador que ya está devuelve **«Ya tienes otra carta de este jugador en el equipo.»** y señala la carta en conflicto. Desde la colección la acción es «Sustituir» en su hueco.
- Si un equipo antiguo ya lo trae, los dos huecos salen INVALID con la frase y el nick, y guardar se rechaza: 422 en servidor y precomprobación en cliente.
- Nunca se muestra `DUPLICATE_PLAYER` al jugador.

## 13. Live validation

En cada cambio corre `checkDraft`, que es el validador canónico sobre el borrador:

- «6 / 10 CARTAS», barra de 10 segmentos y «Faltan: 1 Controlador · 1 Iniciador · 2 Flex».
- Lista de «qué sobra» («Sobra 1 Centinela: solo caben 2.»), «qué choca» (jugador repetido, temporadas) y cartas perdidas, cada una con «Ver» para ir a su hueco.
- El servidor vuelve a validar al guardar, activar y jugar.

## 14. Ready state

- Con el borrador legal aparece el bloque verde **«✓ EQUIPO LISTO»**, con entrada en muelle y halo.
- Si aún no está guardado: «Cumple las reglas. Guárdalo para poder jugar con él.».
- El estado guardado del servidor se lee en la cabecera: «Listo para duelo».
- **Sin «Team Power».**

## 15. Team stats

Medias con un decimal de las cartas presentes:

- **OVR medio**, **Stronghold**, **Gamesense** y **Entryfrag**, en barras con cifra y etiqueta; la barra es decoración y el número se lee siempre.
- Tabla de OVR medio **por rol**.
- «Medias parciales: faltan N cartas» si está incompleto.
- Las únicas claves de `TeamStats` son `count`, `complete`, `ovr`, `stronghold`, `gamesense`, `entryfrag` y `byRole` (hay test).

## 16. Strengths/weaknesses

- «Media más alta» y «Media más baja» del trío. En empate gana la primera en `COMBAT_STAT_ORDER`; si las tres son iguales se dice.
- «Rol con menor OVR media».
- Siempre acompañado de: «Comparación matemática de las medias de tus cartas. No predice resultados.».
- Nada de «dominará Lotus».

## 17. Card comparison

`ComparePanel`, a pantalla completa en móvil:

- **ACTUAL vs CANDIDATA** en `Card3D` (o «Hueco vacío»).
- Tabla OVR / Stronghold / Gamesense / Entryfrag / Rareza con **diferencia en texto**: «▲ +4», «▼ −2», «=».
- Tabla **«Medias del equipo si confirmas»**: antes → después (Δ), por ejemplo OVR 77,5 → 77 (−0,5).
- Si el cambio es ilegal se muestra el motivo y no se puede confirmar.

## 18. Suggest Card

- **Regla documentada**: entre las candidatas **legales y poseídas** para ese hueco, la de mayor OVR. Empate: nick y después uid.
- En un hueco ocupado solo se sugiere si mejora la OVR actual.
- Frase: «Mejor OVR disponible para este hueco.».
- Sin IA, sin red, sin texto estratégico.

## 19. Autocomplete

- **Búsqueda con retroceso**:
  - combinaciones por rol en orden de OVR;
  - el rol con menos candidatas primero;
  - con restricciones de jugador único, carta única y temporada;
  - una pasada por temporada si ninguna carta fijada la fija, quedándose con la solución de mayor OVR total.
- **Respeta las fijadas**: por defecto, todas las cartas ya colocadas; «Autocompletar puede cambiar esta carta» las libera.
- El resultado pasa por `validateDuelDeck` antes de devolverse.
- **Fallo honesto**: «No tienes suficientes cartas compatibles para completar este equipo.» con el déficit por rol («Centinela: necesitas 2 y tienes 1 jugador compatible.»).
- Un test demuestra un caso donde el voraz ingenuo produce un equipo ilegal (temporadas y variantes) y la búsqueda encuentra uno legal.

## 20. Multiple decks

El modelo ya lo permitía (`MAX_DECKS = 8`) y la fase lo aprovecha: hub con activo y otros, contador N/8, «Crear equipo» mientras haya cupo y aviso al llegar al máximo.

## 21. Create/rename

- **Crear.** «+ Nuevo equipo» abre un borrador «Equipo N» (primer N libre) **sin escribir nada**, igual que antes, para no falsear el embudo `deck_builder`. El primer guardado hace `create`; el servidor pone «Equipo N» si no llega nombre y valida el nombre.
- **Renombrar**:
  - `NameSheet` y la cabecera del constructor, con la misma función en cliente y servidor (`checkDeckName`);
  - reglas: texto plano, espacios normalizados, 1–40 caracteres, solo letras, números, espacio y `. _ ' # & -`, sin HTML;
  - con versión: conflicto si otra pestaña cambió; «sin cambios» si repites el mismo nombre.
- Sin descripción libre.

## 22. Duplicate/delete

- **Duplicar** copia las REFERENCIAS con nombre «<nombre> copia» (o «copia 2»…) dentro de 40 caracteres, sin crear cartas. Revalida la propiedad: si alguna carta ya no es tuya, 409 «Quítalas antes de duplicarlo».
- **Borrar** siempre con confirmación (`ConfirmSheet`). Tus cartas no se tocan.
  - Si es el **equipo activo**, el servidor exige `confirmActive` (409 `ACTIVE_DECK` sin él).
  - El texto avisa de que te quedarás sin activo.
  - `on delete cascade` borra la referencia y el hub pide elegir otro. No se elige por el usuario.

## 23. Active deck

- Tabla `duel_active_deck` (una fila por usuario, solo servidor) y RPC `duel_deck_activate(p_user, p_deck, p_expected_updated_at)`. El RPC bloquea la fila del mazo, comprueba dueño y versión y hace upsert.
- El servicio valida **propiedad + completo + legal** con el validador canónico antes de llamar; si no, 409 `DECK_NOT_READY` «Solo puedes activar un equipo completo y legal.».
- **Por qué una tabla nueva**:
  - `profiles` es pública, y el activo quedaría expuesto;
  - el trigger de `duel_decks` cambia `updated_at`, y activar daría falsos «cambió en otra pestaña».
- Sin 0050: `activeSupported:false`, aviso honesto en hub y constructor, y 503 `NOT_READY` al activar. Todo lo demás funciona.
- Un activo que deja de ser legal (carta perdida) sigue marcado, pero no se propone para jugar.

## 24. PreMatch integration

- `PreMatch` marca **«Activo»**, y la página de jugar propone primero el activo: `pickStartableDeck(d.decks, d.activeDeckId)`.
- **Selección rápida** entre todos los equipos, como antes.
- Con un equipo listo elegido aparece **«Editar equipo»**, que lleva a `/duelos/mazos?deck=<id>` sin duplicar el constructor.
- Los textos fijados («Preparación», «Comenzar duelo», «Completar equipo», «No tienes ningún mazo listo») no cambian.
- PvP (`PvpLobby`) marca «Activo», propone el activo legal y renombra «Mis mazos» a «Mis equipos». La cola sigue validando con `resolveDeckSnapshot`.

## 25. Collection integration

- La ficha de carta de `/coleccion` conserva **«Añadir al equipo»** (`AddToDeckSheet`), que ahora propone el **equipo activo**.
- Ofrece «Abrir en el constructor con esta carta», que lleva a `/duelos/mazos?deck=<id>&add=<uid>`. El constructor abre con esa carta elegida y sus huecos compatibles iluminados.
- «Ver el equipo» abre ese equipo. No hay flujo paralelo.

## 26. Social Challenge integration

- `ChallengeSheet` propone el **equipo activo si es legal**, marca «Activo» y solo deja elegir equipos legales (`d.valid`, sin cambios).
- El id del activo no sale del cliente y la vista de un reto no lleva mazos (hay test).
- Degradable: sin 0048, el social ya degrada como en la Fase 29, y la Fase 32 no depende de él.

## 27. Profile/Home/FTUE integration

- **Perfil.** Solo en TU perfil, enlace **«Editar equipo»** → `/duelos/mazos`. La foto del perfil (SELF o PUBLIC) y `/api/game/player` no llevan composición (tests 66–67).
- **Vestíbulo.**
  - Muestra el activo si está listo.
  - Sin equipos, la acción principal es **«Crear mi primer equipo»** (`?nuevo=1`).
  - Con equipos pero ninguno legal sigue «Completar equipo» (texto fijado por test).
  - La acción secundaria es «Mis equipos».
- **Loop.** El paso de NextUp dice **«Termina tu equipo»** o «Crea tu primer equipo», con la misma prioridad y el mismo destino.
- **FTUE.** El paso es **«Crear mi primer equipo»**, con el mismo `done` y el mismo href.
- **Hub de duelos.** «Mis equipos» y «Tus equipos».

## 28. Read model/API

`GET /api/game/duels` devuelve la **foto de trabajo** `DeckWorkspaceDTO`, equivalente a DeckHubSnapshot + DeckBuilderSnapshot, compatible con la forma anterior:

- `decks`: `DuelDeckDTO` + `version` + `active`;
- `collection`: `DeckBuilderCardDTO` = carta + `dataVersion` + `statBoost` + `obtainedAt`;
- `activeDeckId`, `activeSupported`, `maxDecks` y `serverNow`.

`POST` con cuerpo estricto por acción:

- `save`: el de la Fase 25, sin cambios de semántica;
- `save_composition`, `create`, `rename`, `duplicate`, `delete` y `set_active`.

Las mutaciones conceptuales `set_card`, `remove_card` y `reorder` no existen como llamadas: el constructor edita en borrador y persiste de una vez con `save_composition`.

## 29. Persistence/data model

- Sin cambios en `duel_decks` ni en `user_cards`.
- Nueva `duel_active_deck(user_id PK → auth.users cascade, deck_id → duel_decks cascade, updated_at)` con índice único por `deck_id`.
- RLS activado sin políticas, `revoke all` a anon/authenticated y RPC `security definer` ejecutable solo por `service_role`.
- La legalidad **no** se codifica en SQL: vive en `validateDuelDeck`.

## 30. Atomic save

- `save_composition` = **un único `UPDATE`** de nombre + las 10 referencias, condicionado a `id`, `user_id` y `updated_at = baseVersion`. Nunca hay diez escrituras parciales.
- Antes se revalidan todas las cartas: propiedad (403) y errores duros del validador (422).
- Guardar incompleto se permite; guardar ilegal, no.

## 31. Concurrency/idempotency

- **Versión = `updated_at` exacto** (cadena con microsegundos), devuelta en cada `DuelDeckDTO`.
- Si el `UPDATE` no afecta filas: no existe o no es tuyo → 404; mismo nombre y mismas referencias → **«sin cambios»** (idempotente ante doble clic o reintento); otra composición → **409 «Este equipo cambió en otra pestaña.»** con la versión vigente.
- El cliente conserva el borrador y ofrece **Recargar**, **Revisar** (diferencias) o **Guardar mi versión**.
- Renombrar, borrar y activar también aceptan versión.
- En el cable el campo se llama `baseVersion`: el contrato D4 prohíbe la subcadena «xp» en los cuerpos del cliente.

## 32. Ownership/security

- El usuario sale **siempre del token** (`getSession`), y cada consulta filtra por `user_id`.
- **Tests con dos usuarios**: A no lee, edita, activa, duplica ni borra los equipos de B. Todo responde 404 y la fila de B queda idéntica.
- Carta de otro usuario o inexistente → 403 con el **mismo mensaje**, sin oráculo.
- Jugador repetido o rol ilegal → 422. Incompleto no se activa. Uid repetido → 400.
- **Cuerpo estricto**: claves desconocidas, UUID inválido, cartas no-UUID (antes descartadas en silencio), más de 10 cartas o versión mal formada → 400.
- Sin clave de servicio en ningún fichero de cliente (test).
- **Propiedad perdida**: el equipo sale inválido con «Esta carta ya no está disponible.», **no se borra**, y guardarlo con esa carta se rechaza.

## 33. Privacy

- Ni la foto del perfil ni `/api/game/player` contienen equipos, y no hay ninguna ruta para pedir los equipos de otro.
- `duel_active_deck` no tiene políticas: ni el propio usuario la lee con su token.
- La vista de un reto no lleva mazos.
- La pre-partida no lee cartas del rival y `rivalRemaining` sigue saliendo del invariante del dominio.

## 34. Rate limiting

- Cubetas nuevas **solo en TypeScript** (misma tabla y RPC `app_rate_take`, sin migración):
  - `deck_read`: 90/min;
  - `deck_write`: 30/min.
- 429 con `Retry-After` y mensaje anodino.

## 35. Performance

- **Foto en 3 lecturas en paralelo**: propiedad paginada, mazos del usuario y activo. La resolución de la colección y la validación de cada mazo se hacen en memoria, **sin N+1**.
- **`loadOwned` paginado** (1.000 por página, techo 50.000). Antes truncaba en silencio.
- **Cliente**:
  - `useMemo` por borrador;
  - las acciones de carta solo se calculan para las 36 visibles;
  - candidatas por hueco bajo demanda;
  - la búsqueda del autocompletado tiene tope de nodos, que con 10 huecos no se alcanza.
- **Card3D**: 3 en el hub activo y 2 en el comparador; nunca en la colección.

## 36. Telemetry

- Los seis contextos (`deck_builder_view`, `deck_created`, `deck_saved`, `deck_activated`, `deck_autocomplete`, `deck_compare`) se envían como `flow_started` en el flujo **`deck_management`**. Ese flujo está reservado en 0046, sin aplicar: es un **no-op honesto** que no toca el CHECK y deja `FLOWS` en 4.
- **Por qué no `deck_builder`**: ya está activo, y `analytics_flows` (0030) mide su abandono como «abrió el constructor y no creó un mazo después». Editar o activar equipos existentes lo falsearía.
- El inicio de CREAR se sigue midiendo como siempre (`first` / `additional`).

## 37. Responsive/mobile

- **1440**: colección (300 px, con scroll propio) + tablero de 5 columnas + análisis (300 px).
- **1024**: tablero protagonista + análisis; la colección en hoja con «+ Añadir cartas».
- **390**: diseño propio.
  - Cabecera con estado.
  - Tablero en 5 filas de rol con 2 huecos cada una.
  - «+ Añadir cartas» abre la colección en hoja inferior.
  - Tocar un hueco abre sus candidatas.
  - Comparador a pantalla completa y análisis debajo.
- Hub en una columna; tarjetas en 2 columnas desde 768 px y 3 desde 1280 px.

## 38. Accessibility

- No hay nada que dependa de arrastrar.
- Cada hueco es un botón con nombre, estado y problema asociado; también responde a Supr y Alt+↑/↓.
- Las cartas se eligen por teclado (botones con `aria-label`/`aria-pressed`).
- **Estado textual siempre visible**: «6 / 10 CARTAS», «EQUIPO LISTO» y «Faltan…».
- Botones de al menos 44 px en las acciones y foco visible (`nx-focus`).
- **Hojas con `role="dialog"`, `aria-modal`, foco inicial, foco devuelto y Escape**, que con varias abiertas solo cierra la de arriba.
- Deltas con signo y flecha en texto; tablas con `caption` y `scope`; estadísticas con etiqueta.
- `MotionConfig reducedMotion="user"` y `motion-reduce`.
- La rareza nunca va sola en color: lleva etiqueta.

## 39. Game feel/visual system

- Escenario con halo en el tablero y columnas por rol con glifo y contador.
- Huecos vacíos con forma de carta que dicen su rol; resaltado cian/oro al elegir carta.
- Entrada en muelle al colocar y bloque «EQUIPO LISTO» con halo.
- `Card3D` con inclinación en el activo y en el comparador.
- Lenguaje NEXUS existente: `nx-stage`, `nx-clip`, `DuelCard`, paleta de variante y `STAT_INFO`. Diseño original, no una copia de Ultimate Team.

## 40. QA visual

- **Carpeta**: `docs/product/qa/fase32/`, con **64 capturas** y `README.md`, generadas por `scripts/_fase32-visual-qa.ts` contra la build servida en `:3005`.
- **Anchos**: **1440, 1024 y 390**.
- **Cobertura**: los **60 escenarios mínimos del brief**, numerados 01–60.
  - Hub, sin equipos, varios equipos, activo.
  - Constructor vacío, parcial, 9/10, completo e inválido.
  - Huecos de cada rol; panel, búsqueda y filtros de rol, equipo y rareza; orden por OVR.
  - Añadir, quitar y sustituir; huecos compatibles e ilegales; jugador repetido.
  - Comparador y deltas; medias; fortaleza y punto bajo; sugerencia; autocompletado con éxito e imposible.
  - Renombrar, duplicar, confirmación de borrado, activar y no poder activar incompleto.
  - Cambios sin guardar, error de guardado, versión obsoleta y propiedad perdida.
  - Pre-partida, colección → constructor, perfil → constructor, reto social, FTUE y error de backend.
  - Siete escenas móviles, tableta, movimiento reducido, flujo de teclado, sin sesión y ruta real, más el alias `/equipo`.
- **Datos**: el arnés `/design-system/fase32` usa datos **QA SYNTHETIC** (ejemplares y equipos inventados, cartas y estadísticas reales, validador canónico). La ruta real se capturó sin sesión.
- **Consola**: solo aparece un tipo de mensaje, `Failed to load resource: 404`, en las 55 capturas que pintan cartas, y **0 en las que no pintan ninguna** (reto, FTUE, error, sin sesión y ruta real).
  - Son los retratos `/players/{id}.png`: `public/players/` solo contiene un `README.md`, y `PlayerPhoto` dibuja su sigilo de reserva documentado.
  - Es preexistente y ajeno a esta fase: no hay errores de JavaScript ni de React.
- **Revisión visual** (hallazgos corregidos y recapturados):
  1. En 390, la etiqueta «CONTROLADOR» invadía la columna de cartas. Se amplía la columna del rol y se compacta la tipografía en móvil.
  2. «Necesitas una cuenta» componía «crear tus equipos de duelo se guarda en el servidor». Ahora dice «Tu equipo de duelo se guarda en el servidor…».
- **Revisado sin incidencias**:
  - resaltado cian/oro de huecos compatibles, estados INVALID con motivo, «EQUIPO LISTO»;
  - comparador con «▲ +5 / ▼ −6» e impacto en las medias, a pantalla completa en móvil;
  - banner de conflicto con diferencias, carta perdida con «Quitar», fallo honesto del autocompletado con el déficit por rol;
  - pre-partida con «Activo» y «Editar equipo», reto con «Activo · Elegido», anillo de foco en el flujo de teclado.

## 41. Tests/gates

| Gate | Resultado |
|---|---|
| `npm test` | **1735 / 1735** (1611 previos + 124 nuevos), 0 fallos |
| Tests nuevos | `builder.test.ts` 56 (1–52 + mover, nombres, cuerpo estricto, panel) · `deckTeams.service.test.ts` 18 (53–65 + seguridad A/B, degradación sin 0050, paginación) · `deckBuilder.contract.test.ts` 50 (63, 66–99, 0050, API, ritmo, rendimiento, telemetría, accesibilidad, responsive, estados) |
| Typecheck web (`tsconfig.json`) | exit 0 |
| Typecheck scripts (`tsconfig.scripts.json`) | exit 0 |
| `next build` | OK (rutas `/duelos/mazos`, `ƒ /equipo`, `ƒ /api/game/duels`, `/design-system/fase32`) |
| `eslint` (ficheros nuevos y tocados) | 0 errores, 0 avisos |
| `security:verify` | exit 0 · todas las comprobaciones pasan |
| `pack:verify` | exit 0 |
| `content:verify` | exit 0 |
| `distribution:verify` | exit 0 · 30 ✓ / 0 ✗ |
| `competitive:verify` | exit 0 |
| `importer-vlr:verify` | exit 0 · 69/69 |
| Humo HTTP (build servida en :3005) | `/equipo` → 307 `/duelos/mazos` (conserva `deck`, descarta parámetros ajenos) · `GET/POST /api/game/duels` sin sesión → 401 (también con cuerpo malicioso) · `/duelos/mazos` y el arnés → 200 |
| Regresión dirigida | combate, stats/OVR, validador, rating, liquidación, matchmaking, sobres, RNG, propiedad, perfil, social, Pick'ems, eventos, progresión, worker: sin cambios (tests 80–95); PvE/PvP/Ranked/Social revalidan igual (74–77); `gameplay`, `duel`, `social`, `packLoop`, `meta`, `competitive`, `profile`, `liveEvents`, `telemetry` contract tests en verde |
| Guardado/activación contra Postgres real, RLS de 0050, RPC `duel_deck_activate`, precisión de `timestamptz` | **NO EJECUTADO — REQUIERE BD DE PRUEBAS** |
| `duel-e2e-browser`, `ftue-audit`, `card-artwork-client-verify`, `demo-rehearsal` (con sesión real) | **NO EJECUTADO — REQUIERE BD DE PRUEBAS** (solo se adaptaron sus selectores de texto) |

Tests de la suite que se tocaron, y por qué:
- `profile.contract.test.ts` 80–84: fijaba «la última migración es la 0049». Se reescribe a su intención («la 0049 es la del perfil, única y sin aplicar»). El mismo criterio aplicado en la Fase 31 a Social.
- `duel.test.ts`: `UI_FILES` se amplía con los 8 componentes nuevos. Añade cobertura; no quita ninguna comprobación.

## 42. Bugs reales encontrados/corregidos

1. **`loadOwned` truncado a 1.000 ejemplares** (límite de PostgREST). Con más de mil cartas, la colección del constructor salía incompleta y un mazo con la carta 1.001 se declaraba «no es tuya» al jugar. Ahora pagina, con test de 2.345 ejemplares.
2. **Cartas no-UUID descartadas en silencio** en `POST save`: un cuerpo malformado se guardaba «a medias». Ahora da 400.
3. **Errores 5xx con el mensaje interno** en `/api/game/duels`. Ahora dan 503 genérico con log en servidor.
4. **Sin concurrencia**: dos pestañas se pisaban sin aviso. Ahora hay versión optimista e idempotencia.
5. **Borrar un mazo sin confirmación** y sin tratar el activo. Ahora hay confirmación y `confirmActive`.
6. **El constructor anterior no tenía en cuenta la temporada** al bloquear cartas: dejaba componer un mazo con temporadas mezcladas que el servidor declaraba ilegal. Ahora todo pasa por el validador canónico.
7. **`AddToDeckSheet` proponía `decks[0]`**, el último editado. Ahora propone el activo.
8. **QA visual, 390 px**: la etiqueta de rol «CONTROLADOR» se salía de su columna. Corregido y recapturado.
9. **QA visual, texto de cuenta**: «crear … se guarda en el servidor» era agramatical (el texto anterior de «Mis mazos» ya lo era). Corregido a «Tu equipo de duelo se guarda en el servidor…».

Fallos propios encontrados durante la fase, antes de cerrarla:

- expectativa del test 15, que olvidaba la sustitución legal;
- cuerpo `expectedVersion` contra el contrato D4, renombrado a `baseVersion`;
- regex demasiado amplia en el contract test 69;
- el contract 0050 leía la cabecera comentada.

## 43. P2 reales

- **Winrate por equipo: no se ha construido.** `duel_matches.state` guarda el snapshot (`checksum`), pero no está indexado por equipo ni sobrevive a ediciones del mazo con la misma id. Una estadística fiable exige persistir la huella por partida.
- **`loadOwned` no lee `minted_version`** (preexistente). El resolver cae a la versión vigente de la carta en vez de la acuñada. Corregirlo cambiaría estadísticas de mazos existentes, así que se deja como **decisión de producto** y no se ha tocado.
- **Tope de 8 equipos** comprobado con count + insert: no es atómico ante dos creaciones simultáneas.
- **Arrastrar y soltar** como mejora opcional. Hoy no existe y no hace falta.
- **La guarda de navegación** no intercepta el botón «atrás» del navegador (popstate); sí cierre de pestaña, enlaces y «‹ Mis equipos».
- **Revancha privada desde `/duelos/pvp`**: su `ChallengeSheet` no recibe todavía el activo, así que propone el primer equipo legal, como antes.
- **Navegación**: no hay entrada «Mis equipos» en «Jugar» (el test fija un máximo de 7). Se llega por Duelos, vestíbulo, pre-partida, perfil y colección.
- **Colección muy grande**: se pagina de 36 en 36 en cliente, sin virtualización.
- **RLS y RPC reales** de 0050, y precisión de `timestamptz` en `.eq("updated_at")`: **NO EJECUTADO — REQUIERE BD DE PRUEBAS**.

## 44. Migraciones creadas/no aplicadas

- **0050_duel_active_deck.sql**: creada, **NO APLICADA**. Solo añade `duel_active_deck` y `duel_deck_activate`; no toca `duel_decks`, `user_cards` ni `schema_migrations`.
- **0046**: el fichero local se amplía con el flujo `'deck_management'`. Sigue **NO APLICADA**; al aplicarla hay que añadirlo a `FLOWS` en el mismo cambio.
- **0047, 0048 y 0049**: sin tocar y **NO APLICADAS**.

## 45. Archivos creados/modificados

**Creados**

- `supabase/migrations/0050_duel_active_deck.sql`
- `src/domain/deckBuilder/builder.ts`, `pool.ts`, `request.ts`
- `src/domain/deckBuilder/builder.test.ts`, `deckBuilder.contract.test.ts`
- `src/server/services/deckTeams.ts`, `deckTeams.service.test.ts`
- `src/lib/deckBuilder/telemetry.ts`
- `src/components/duel/deck/bits.tsx`, `TeamBoard.tsx`, `CollectionPanel.tsx`, `AnalysisPanel.tsx`, `ComparePanel.tsx`, `SlotSheet.tsx`, `NameSheet.tsx`, `TeamHub.tsx`
- `src/app/equipo/page.tsx`
- `src/app/design-system/fase32/page.tsx`, `fixtures.ts`
- `scripts/_fase32-visual-qa.ts`
- `docs/product/qa/fase32/*` y `docs/product/fase-32-deck-builder-team-management-report.md`

**Reescritos**: `src/components/duel/DeckBuilder.tsx` y `src/app/duelos/mazos/page.tsx`. Hay copia de las versiones anteriores en el scratchpad de la sesión.

**Modificados**

- **Servidor y API.**
  - `src/server/services/duels.ts`: `loadOwned` paginado y exportado; `DeckRow`/`DECK_COLS`/`toDeckDTO` exportados con `version`/`active`.
  - `src/app/api/game/duels/route.ts`.
  - `src/server/services/rateLimit.ts`.
  - `src/server/services/loop.ts`: textos.
- **Cliente y tipos.** `src/lib/duel/types.ts` y `src/lib/duel/client.ts`.
- **Dominio.** `src/domain/progression/meta.ts` (texto FTUE).
- **Componentes.** `PreMatch.tsx`, `pvp/PvpLobby.tsx`, `social/ChallengeSheet.tsx`, `deck/AddToDeckSheet.tsx` y `player/PlayerHero.tsx`.
- **Páginas.** `app/duelos/jugar/page.tsx`, `app/duelos/pvp/page.tsx`, `app/social/page.tsx`, `app/page.tsx` y `app/duelos/page.tsx`.
- **Migración.** `supabase/migrations/0046_telemetry_flows_progression.sql`: flujo reservado.
- **Tests.**
  - `src/lib/duel/duel.test.ts`: UI_FILES ampliado con los 8 componentes nuevos, lo que amplía la cobertura.
  - `src/domain/profile/profile.contract.test.ts`: el test 80–84 fijaba «la última migración es la 0049» y se reescribe a su intención, que la 0049 sea la del perfil (mismo criterio que la Fase 31 con Social).
- **Scripts de verificación en navegador** (selectores de texto `mazo` → `mazo|equipo`, misma aserción; requieren BD y no se ejecutaron): `scripts/duel-e2e-browser.ts`, `scripts/ftue-audit.ts`, `scripts/card-artwork-client-verify.ts` y `scripts/demo-rehearsal.ts`.
