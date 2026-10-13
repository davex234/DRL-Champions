# F79 — NEXUS FORGE 2.0 · Crafting progression, collection & endgame

Fecha: 2026-10-01 → 2026-10-02 (dos sesiones; la primera se cortó durante la QA visual y esta la retomó, revisó y cerró).
Sin commit, sin push, sin despliegue. Producción intacta. 0061 escrita y probada en memoria, **NO aplicada**.

---

## A. CURRENT FORGE AUDIT (antes de tocar nada)

- **F73 (backend):** `craft_recipes` (0059) con dos escaleras distintas que el brief mezclaba:
  - **Sobres** (`app_craft_pack`): Bronce→Plata **4**, Plata→Oro **2**, Oro→Masters **2**, Masters→Champions **3**, Champions→Icon **2**. Son estas las «4/2/2/3/2».
  - **Cartas / intercambio** (`app_craft_card`): Base→Plata 7, **Plata→Oro 3** (el «3 Plata → 1 Oro random» confirmado), Oro→Masters 8, Masters→Champions 14, Champions→Prime 10, Prime→Icon 5 **DISABLED**.
  - Nada de esto se ha cambiado.
- **Misiones / proyectos F73:** motor de eventos con progreso guardado y misiones de una vez; proyectos de carta con `user_project_claims`; `award()` es idempotente por `credit_transactions (user_id, ref)`.
- **Última copia:** 0060 la impone en el desguace dentro de la transacción. `app_craft_card` (0059) contaba como «copia que conservas» una copia **bloqueada en el mercado**; el desguace no. Inocuo hoy (mercado OFF), pero incoherente.
- **Bloqueo de cartas:** no existe un CARD LOCK de usuario. `user_cards.locked` es la reserva del mercado. Sí existen las favoritas (0052, por carta) y la vitrina (0049, por copia), y **ni el intercambio ni el desguace las respetaban**.
- **Telemetría:** conjunto cerrado de eventos con un CHECK en la BD; añadir eventos exigiría migración.
- **F74:** `components/crafting/Forge.tsx` + CSS module. Los testids que usan los instrumentos F73 se conservan.
- Todo F73/F74 está **sin seguimiento en git**. Se guardó una copia de los 14 ficheros que se tocaron (scratchpad de la sesión 1, `f79-pre/`).

## B. ARCHITECTURE

Forge 2.0 **no es otro sistema de crafteo**: es progresión sobre el que ya existe.

- **Dominio puro** `src/domain/forge/`:
  - `types`, `defaults` (la ÚNICA fuente de números);
  - `progression` (XP, nivel, maestría);
  - `discovery` (estados, cadenas, planos);
  - `requirements` (POSEER / CONSUMIR);
  - `selector` (materiales, auto-selección y validación del servidor);
  - `output` (pool y pity);
  - `objectives`, `projects`, `history`;
  - `snapshot` (ensamblador) y `events` (analítica de progresión, nuevo en la sesión 2);
  - `validate` (panel).
- **Servidor:**
  - `server/services/forge.ts` (foto, forjar, reclamos, puerta de proyectos);
  - `forgeConfig.ts` (lectura del documento con caché de 5 s; sin 0061 usa los valores por defecto);
  - `server/cms/forge.ts` (panel).
- **Rutas:**
  - `GET/POST /api/game/forge`, con acciones `craft`, `claimObjective`, `claimAchievement` y `view`;
  - `GET/POST /api/admin/cms/forge`.
- **Interfaz:**
  - `/misiones/crafting` (home rediseñada);
  - `/misiones/crafting/avanzado` (nueva: cadenas, recetas, selector);
  - `/misiones/crafting/cartas` (intercambio con selector y protección);
  - `/misiones/crafting/cartas/[project]` (etapas);
  - `/misiones/crafting/historial` (nueva);
  - `/admin/crafting`, pestaña «Forge 2.0».

## C. DATA MODEL

**Principio:** todo lo que el jugador «tiene» en la Forja se **deriva** en el servidor de tablas que ya son idempotentes:
- `economy_ops` (`craft_pack` / `craft_card`);
- `user_project_claims`;
- `credit_transactions` con ref `forge:*`;
- el inventario, las favoritas, la vitrina y los equipos.

Esto abarca XP, nivel, maestría, recetas descubiertas, cadenas, planos, objetivos y logros. **No hay ninguna tabla de progreso por usuario**, así que no hay nada que dos pestañas puedan duplicar ni desincronizar, y nada que el cliente pueda mandar.

Lo único nuevo en BD es **un documento de configuración versionado** (`forge_config`, fila `main`).

**Consecuencia (documentada):** si el admin cambia las reglas de XP o la curva, se recalcula el nivel de todos. Puede bajar. Las recetas ya hechas siguen hechas, porque salen del libro mayor.

## D. MIGRATION REQUIRED — **SÍ: `0061_forge_progression.sql` (escrita, NO aplicada)**

Por qué el modelo existente no basta, y solo para dos cosas:
1. **Configuración editable sin código.** No hay ninguna tabla genérica de configuración (solo `market_config` / `market_flags`), y `craft_recipes` no tiene dónde guardar desbloqueos, posesión, huecos, cadenas ni planos. Se resuelve con `forge_config`: RLS activado, `revoke all` a anon/authenticated y acceso solo para service_role.
2. **Última copia coherente.** `app_craft_card` pasa a exigir que quede al menos una copia **desbloqueada**, igual que 0060. El diff contra 0059 es de **una sola condición** (`c.locked = false and …`) más un comentario; firma, permisos, idempotencia y libro mayor quedan iguales.

Propiedades:
- Aditiva e idempotente (`if not exists`, `create or replace`).
- Va dentro de la transacción del operador, con una guardia final `DO` que aborta si algo no quedó bien.
- Rollback documentado en la cabecera: `drop table forge_config` + el cuerpo de `app_craft_card` de 0059.

**Compatibilidad sin aplicar:** con la tabla ausente, `loadForgeConfig` devuelve `MIGRATION_PENDING` y los valores por defecto, con todo el contenido nuevo en DRAFT. La Forja muestra nivel, XP, maestría e historial, y nada más cambia. La cabecera aplicada que comprueba `/api/ready` sigue siendo 0060.

**No se ha hecho** el dry-run `BEGIN … ROLLBACK` contra la BD del VPS: también tocaría producción, así que queda como primer paso del aplicado autorizado.

## E. FORGE LEVEL / F. FORGE XP

- XP por acción real ya registrada en el libro mayor. Todo sale de `DEFAULT_FORGE_CONFIG.xp` y el panel lo puede editar:
  - sobre 20;
  - intercambio 30;
  - receta avanzada 60;
  - cadena terminada 120 (una vez por cadena);
  - proyecto reclamado 150;
  - objetivo completado 25 (una vez por objetivo y periodo, y solo si el crafteo es posterior a la activación del objetivo, que **sella el servidor**: no hay XP retroactiva).
- Curva: `round(base · growth^(n−1))`, con base 100, growth 1,22 y nivel máximo 40.
- La foto incluye nivel, XP dentro del nivel, XP para el siguiente, XP total y `maxed`.
- Un reintento con la misma ref es la misma fila, así que no suma dos veces (test F2).
- **XP y nivel no dan nada económico.**

## G. MASTERY

Cuatro ramas con los nombres de las zonas: Forja de sobres, Forja de cartas, Proyectos y Colección. Cada rama tiene umbrales configurables (rango, siguiente objetivo y progreso). Los umbrales de Colección quedan por debajo de las 331 cartas reales.

## H. RECIPE DISCOVERY

- Estados: `LOCKED` / `DISCOVERED` / `AVAILABLE` / `COMPLETED`.
- Una receta LOCKED muestra silueta, pista y condiciones con su estado, pero **no** qué consume ni qué sale (son `null` en la foto: test E4 y captura 04).
- Las recetas fundamentales (escaleras F73 de sobres y de intercambio) no pasan por el descubrimiento y siguen siempre a la vista.

## I. RECIPE CHAINS

- Condiciones de desbloqueo: `RECIPE_DONE`, `FORGE_LEVEL`, `BLUEPRINT` y `MASTERY`.
- La cadena es estado derivado del libro mayor, no de `localStorage`, y el servidor revalida en cada forja.
- **Bug encontrado y corregido en esta sesión:** un paso **no repetible** lanzado desde dos pestañas a la vez, con gestos distintos, se forjaba **dos veces** (2 asientos, 8 copias consumidas), porque la puerta se evalúa en Node antes de la RPC. Reproducido con el test F8b, que falló con 2 ≠ 1.
  - **Arreglo:** para los pasos no repetibles, la clave del libro mayor es la de la receta (`craft:card:<user>:once:<receta>`). Como `economy_ops.ref` es la clave primaria, la segunda RPC espera y recibe el resultado de la primera, o choca con 23505, se revierte entera y se traduce a `repeated`.
  - Ahora sale 1 forja, las dos pestañas enseñan la **misma** carta y una pestaña rezagada recibe el mismo resultado sin consumir nada.

## J. BLUEPRINTS

- Un plano es un **estado de desbloqueo derivado de su fuente**, no una moneda: nivel de Forja, proyecto reclamado, misión completada o logro.
- No se «conceden», así que no se pueden duplicar.
- Un plano en DRAFT no lo tiene nadie.

## K. PROJECTS 2.0

- Etapas: `MISSIONS` (por profundidad de dependencias) → `OWN` (reunir) → `FABRICATE` (receta avanzada hecha) → `CLAIM`.
- El servidor exige las etapas extra **antes de pagar** (`projectForgeGate` dentro de `claimProject` → `PROJECT_REQUIREMENTS`, test F12).
- Un proyecto sin extras se comporta exactamente como en F73.
- Las cartas de recompensa son las de los proyectos F73: cartas reales del catálogo.

## L. COLLECTION REQUIREMENTS / M. OWN VS CONSUME

- **POSEER** (`OWN_EDITION` con una edición real, `OWN_DISTINCT_PLAYERS`, `OWN_CARD`) se comprueba y **nunca** se consume. Test F5: la Masters L que se pedía poseer sigue ahí.
- **CONSUMIR** son huecos por clase canónica, con filtros opcionales de edición real, equipo impreso o jugador real.
- La confirmación muestra «VAS A ENTREGAR · DESAPARECEN» con las copias exactas y, por separado, las notas de posesión.
- La propia protección de última copia garantiza que una forja no puede romper un requisito de POSEER: nunca reduce el conjunto de cartas que posees.

## N. LAST-COPY PROTECTION

- Se aplica en tres capas: el selector (`usable = desbloqueadas − 1`), la validación del servidor y la RPC (0060 en el desguace; 0061 la alinea en la forja).
- Test F7: una copia en venta no cuenta como «la que conservas».
- Test F9: desguace + forja de la misma carta a la vez nunca dejan 0 copias.

## O. CARD LOCK

- No se creó un sistema nuevo. Se **integraron las favoritas (0052) y la vitrina (0049)** como protección.
- La auto-selección nunca las coge. El servidor exige que el jugador **confirme copia a copia** (`confirmProtected`) o rechaza con `PROTECTED_COPY`.
- El intercambio F73 sin confirmación las rechaza siempre.
- La protección es distinta de la última copia: una favorita repetida se puede entregar si se confirma; la última copia, nunca.
- **Deuda:** el desguace sigue sin respetar favoritas ni vitrina.

## P. SMART SELECTOR / Q. AUTO-FILL / R. CONFIRMATION

- **Selector:** muestra solo copias entregables (tuyas, no en venta, fuera de equipos y sin la última copia), ordenadas con duplicados primero y luego menor OVR. Cada copia indica edición, OVR, jugador, protección y cuántas puedes dar.
- **AUTO-SELECCIONAR:** conservador. Nunca protegidas, nunca la última copia, y el tope por carta se comparte entre huecos. **No consume nada**: solo propone.
- **Confirmación:** «VAS A ENTREGAR» con las copias exactas, y «RECIBIRÁS» con la carta concreta o con la clase + «aleatoria (la decide el servidor)».
- **Validación del servidor:** número exacto, sin repetidas, entregables, tope por carta, protegidas confirmadas y reparto copias→huecos (emparejamiento bipartito).

## S. FORGE HISTORY

- Viene del libro mayor del servidor: fecha, tipo, materiales, resultado, receta o proyecto, y estado.
- Un intento rechazado no deja asiento, así que no aparece.
- No expone datos de otros usuarios.

## T. ACHIEVEMENTS / U. DAILY/WEEKLY

- Siete logros y dos objetivos en plantilla, **todos en DRAFT y sin recompensa**.
- Un objetivo es una **ventana sobre el libro mayor**: día UTC o semana ISO. Se calcula, no se guarda, así que **no hay segundo motor de misiones**.
- Reclamar usa `award()` con la clave `forge:obj:<id>:<periodo>` o `forge:ach:<id>`. Test F11: 10 reclamos simultáneos dan una sola recompensa.
- Las recompensas están acotadas por el mismo tope que las misiones F73.
- **Deuda:** un objetivo diario no reclamado caduca con su periodo (semántica diaria; no se guarda nada).

## V. PITY SUPPORT

- Auditoría: la única salida aleatoria es el intercambio (carta uniforme entre las publicadas de la clase, con `randomInt` criptográfico) y las recetas avanzadas con salida por clase. Lo frustrante posible es que salga una carta que ya tienes.
- Soporte añadido: `pity.preferUnowned`, **OFF por defecto** (`enabled: false`). Con él apagado, el pool es exactamente el de F73 (test P1).

## W. FORGE HOME / X. FORGE CORE / Y. CRAFT ANIMATION

- **Home:** núcleo hexagonal con el nivel, barra de XP segmentada, contadores, cuatro tarjetas de maestría, cuatro zonas (Sobres, Cartas, Avanzado, Historial), objetivos y actividad reciente. Mantiene el lenguaje F74.
- **Núcleo:** `LevelCore` reacciona al nivel con 5 tiers de color/anillo (`coreTier`) y una intensidad `--core-power` de 0 a 1. Solo CSS. Con `prefers-reduced-motion: reduce` no hay giros, pulsos ni desplazamientos.
- **Animación:** sigue el principio F74: **el servidor confirma, y entonces se anima** (materiales → núcleo → revelación). La carta revelada es la del servidor (comprobado en la QA: «la carta revelada es la del servidor», 1 asiento nuevo antes de mostrarla).

## Z. ERROR STATES

- Hay una frase legible para cada estado: éxito, `NOT_ELIGIBLE`, `PROTECTED_COPY`, `LAST_COPY`, `RECIPE_LOCKED`, `RECIPE_UNAVAILABLE` / `DISABLED`, `RECIPE_COMPLETED`, `OWN_UNMET`, `PROJECT_REQUIREMENTS`, `RATE_LIMITED`, 401, y red o 5xx.
- La ruta nunca devuelve el texto interno de un 500.
- La QA comprueba «selección caducada → frase legible (sin JSON) y nada consumido» (captura 06).
- **Corregido en esta sesión:** el texto de fallo de red prometía que «no se ha consumido nada», y eso no es cierto si la conexión cae después de que el servidor confirme. Ahora dice que reintentar no repite la forja, lo que sí se cumple: el gesto se conserva y es idempotente.

## AA. ADMIN

- `/admin/crafting` → «Forge 2.0»: documento completo (XP, curva, maestría, recetas, cadenas, planos, extras de proyecto, objetivos, logros y pity).
- Garantías: verificación de admin en el servidor, lista blanca de campos, versión optimista (409 si está obsoleta), auditoría append-only (`f79_forge_config_save`) y validación pura antes de escribir:
  - contenido real;
  - **suelo económico** de cada receta ACTIVA;
  - nada activo que dependa de un borrador;
  - sin ciclos;
  - recompensas topadas.
- Las plantillas piden siempre más material que la ruta F73 equivalente (test V2).
- Nada se publica solo: el contenido nuevo es DRAFT y su receta espejo queda DISABLED.
- Anónimo y usuario normal reciben **401 idéntico** (sin oráculo).
- **Deuda:** el editor es un documento JSON validado, no un formulario por campo, y no tiene QA de navegador (solo pruebas de servicio F13/F13b).

## AB. ANALYTICS

- `logForge` (scope `forge`, a la salida del servidor, sin PII: ni usuario, ni correo, ni token). Se usa el registro estructurado porque la tabla de telemetría tiene un CHECK cerrado.
- Eventos: `forge_open`, `recipe_view` (acción `view`, cupo de lectura, sin escrituras), `craft_attempt`, `craft_success`, `craft_failure`, `project_progress`, `project_complete`, `blueprint_unlock`, más `level_up`, `recipe_unlock`, `chain_complete` y `objective_claim` / `achievement_claim`.
- `recipe_view`, `project_*`, `blueprint_unlock`, `level_up`, `recipe_unlock` y `chain_complete` se añadieron **en esta sesión**. Faltaban.
- Las de progresión salen de comparar la foto pura de antes y de después de la forja (`domain/forge/events.ts`, test E6b).
- **Deuda:** un crafteo de **sobres** (ruta F73) no emite `level_up` ni `blueprint_unlock`.

## AC. SECURITY / AD. RLS / AE. CROSS-USER

- El cliente solo manda receta, uids, gesto y copias protegidas confirmadas. Cualquier otro campo da 400 (lista blanca fijada por el test F14).
- XP, nivel, desbloqueos, resultado, consumo, recompensa y finalización de proyecto los decide el servidor.
- `forge_config` no la ve el navegador. Las RPC solo las ejecuta service_role. La guardia de 0061 comprueba ambas cosas.
- No hay service_role en el cliente.
- RLS existente intacta.
- Usuario cruzado: copias de otro usuario → `NOT_ELIGIBLE` y nada se toca (test F10).

## AF. CONCURRENCY / AG. IDEMPOTENCY

- Misma ref = una forja (test F8).
- 10 forjas simultáneas con material para una = 1, sin errores 500 y nunca inventario negativo (F8).
- Paso no repetible desde dos pestañas = 1 (F8b, nuevo).
- Desguace + forja a la vez = nunca 0 copias (F9).
- 10 reclamos simultáneos = una sola recompensa (F11).
- Doble guardado del panel con la misma versión: gana uno (F13).
- Las pruebas usan MemSupabase, donde cada RPC es atómica y el `await` entre leer y escribir es el hueco real.
- **No** se ha probado contra Postgres real: 0061 no está aplicada.

## AH. TESTS

- **38 pruebas F79:** 22 de dominio (`src/domain/forge/forge.test.ts`) y 16 de servicio (`src/server/services/f79.forge.service.test.ts`).
- Cubren: XP, límites de nivel, maestría, descubrimiento, cadenas, planos, etapas de proyecto, POSEER/CONSUMIR, última copia, protegidas, auto-selección, validación del servidor, idempotencia, varias pestañas, concurrencia, desguace+forja, historial, objetivos, contrato de RLS/ruta, usuario cruzado, panel y analítica.
- **Corregido en esta sesión:** F5 era intermitente. La salida aleatoria de Oro podía coincidir con una de las cartas contadas. 6/6 pasadas tras el arreglo.
- Cobertura existente: no se ha reducido.

## AI. TYPES — `tsc --noEmit`: **0 errores**
## AJ. LINT — ESLint sobre todo lo tocado: **0 errores, 0 avisos** (`npm run lint` sigue roto con Next 16; se usa `ESLINT_USE_FLAT_CONFIG=false npx eslint`)
## AK. BUILD — `next build`: **OK** (dos veces; la segunda con el código final)

**Suite completa:** `npm test` → **5676/5676**, 0 fallos.

## AL/AM/AN. RESPONSIVE 1440 / 1024 / 390

- `scripts/_f79-ui-qa.ts` en Chrome headless contra el **build de producción local** (:3011):
  - sesión simulada;
  - `/api/game/*` atendido por los **servicios reales** sobre MemSupabase;
  - 390 con movimiento reducido, como el Chrome del usuario.
- Resultado: **108/108 PASS** en las tres anchuras. Capturas en `docs/product/qa/f79/ui/` (`01`–`09`) y matriz en `ui-qa.json`.
- Revisadas a mano: home, confirmación, bloqueada, intercambio con error y etapas de proyecto.
- Sin scroll horizontal en ninguna pantalla.
- **Arreglado (sesión 1, verificado ahora):** en 390, el aviso «Instalar NEXUS» tapaba CONFIRMAR FORJA. El modal compartido `GameOverlay` quedaba atrapado en el contexto de apilamiento de `PageTransition`. Ahora se pinta por **portal** en `body` (en SSR sigue en línea) y se desplaza por dentro con `max-height: 100dvh − 2rem`. Es un cambio en un componente **compartido**: la suite completa y la regresión de forja de sobres de la QA pasan.

## AO. ACCESSIBILITY

Probado en la QA:
- Teclado: Tab, Enter abre la confirmación y Escape cierra sin forjar.
- Foco visible (`nx-focus`).
- Diálogo con `aria`.
- Movimiento reducido en 390.

No hay auditoría formal de contraste.

## AP–AV. REGRESIONES

| Área | Evidencia | Nota |
|---|---|---|
| Packs (AP) | suite (packStats, economyFinal, packEconomy…) + QA «forja de sobres F73 intacta» | sin cambios de precio ni probabilidad |
| Collection (AQ) | suite | sin cambios |
| Ranked F76 (AR) | suite (contratos F55/F76) | sin cambios |
| F72.8 timer (AS) | suite | **sin** E2E de navegador contra la BD real |
| Missions F73 (AT) | suite + F12 | solo añade la puerta de proyecto y `project_complete` |
| Salvage (AU) | suite + F9 + salvageRace F73 | sin cambios |
| Auth (AV) | suite (sesión, 401 sin oráculo) | sin cambios |

Las regresiones de navegador contra la BD viva (smoke, `production:check`, timer, PvP) **no se han ejecutado**: el código no está desplegado, así que medirían producción, no esta fase.

## AW. F77 / F77-S1 / SMTP / SportCoach / F78 — **NO TOCADOS**

Ninguna llamada al VPS en esta sesión. F77 sigue en pausa donde estaba.

## AX. MIGRATION HEAD

- Aplicada: **0060_salvage_last_copy_atomic** (`release.ts`, sin cambios).
- Repositorio: 0061 es la última. Once ficheros de prueba que fijan «última del repo» se actualizaron a 0061 con el comentario «NO aplicada».

## AY. PRODUCTION DEPLOYED — **NO**
## AZ. COMMIT/PUSH — **NO** (ni commit ni push)

## BA. REMAINING DEBT

1. **Aplicar 0061** (requiere autorización): backup `pre-0061`, dry-run `BEGIN … ROLLBACK`, aplicado en una transacción y prueba de `/api/ready`.
2. **Desplegar** el código (requiere autorización). Es compatible sin 0061, pero cambia una conducta de F73: el intercambio rechaza favoritas y vitrina sin confirmación.
3. Concurrencia probada en MemSupabase, no en Postgres real: hay que repetir F8/F8b/F9 tras aplicar 0061.
4. El desguace no respeta favoritas ni vitrina.
5. El panel es un editor JSON validado; falta un formulario y la QA de navegador del panel.
6. Cambiar la curva o la XP recalcula (y puede bajar) el nivel de todos: avisarlo en el panel.
7. Los crafteos de sobres no emiten analítica de progresión.
8. Los objetivos diarios no reclamados caducan con su periodo.
9. Espejos `craft_recipes`: dos guardados de admin simultáneos podrían dejar un espejo DISABLED con el documento ACTIVE. Falla cerrado (la receta no se puede forjar), nunca abierto.
10. Todo el contenido nuevo (recetas, cadenas, planos, objetivos, logros) está en **DRAFT y sin recompensa**. Activarlo y ponerle recompensas es una decisión de balance pendiente, como el pity.

## BB. F79 — **GO PARCIAL (implementación) / NO-GO (producción)**

- **GO** de implementación: todo lo pedido está construido y validado con evidencia (5676/5676, 38 pruebas F79, tipos y lint limpios, build OK, QA de navegador 108/108 en 3 anchuras).
- **NO-GO** para producción hasta que autorices dos cosas:
  - (a) aplicar 0061;
  - (b) desplegar.
- Motivo: hay una migración nueva y un cambio de conducta del intercambio F73. La concurrencia está demostrada sobre el emulador, no sobre Postgres.

**FASE 79 — INCOMPLETA** (lista para aplicar y desplegar; bloqueada solo por autorización).
