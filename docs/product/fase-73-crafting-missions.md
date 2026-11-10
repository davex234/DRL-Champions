# F73 · Crafting & Missions 1.0

**Estado (2026-09-30, cierre F73): F73 — GO (gates finales en `qa/fase73-final/gates.json`).**

- 0059 (crafteo y misiones) aplicada ~14:59Z; sin deriva de esquema (RPC idénticas por md5, columnas/políticas/índices).
- **0060 (desguace atómico)** aplicada 19:04:11Z con autorización expresa: la regla «te queda una copia» la impone la BD
  (mismas filas bloqueadas que `app_craft_card`). Carrera real reproducida por control (desguace del sobrante + intercambio
  que consume la copia conservada → 0 copias) y cerrada. Sin cambios de valores ni de pago.
- `award()`: el choque con `credit_tx_ref_uniq` (mismo usuario y ref) en reclamos simultáneos ya es «repetido», no 500.
- E2E real (UI → API → servicio → Postgres, sin intercepción) con cuentas QA y admin QA TEMPORAL autorizado (4 ciclos,
  todos revocados y auditados; admins = 1): partida real → progreso 0/5 → 1/5 (F5, relogin, reproceso ×5 = 1 evento),
  anti-AFK (≥5 humanas cuenta; autoplay, 4+auto y abandono no), condición TR ≥ 3 con el equipo CONGELADO al empezar,
  proyecto completado y reclamado (+1 exacto, F5, 2.º reclamo 0), 10 reclamos de proyecto y de misión → 1 recompensa y 0 × 500,
  rechazos del panel 15/15, cruce entre usuarios, 1440/1024/390 con movimiento reducido.
- Producción queda con **0 misiones y 0 proyectos publicados** (la configuración QA está RETIRED y no se ve).
- Economía: 40.000 simulaciones por receta, 0 exploits; ratios sin cambios (Prime → Icon sigue DISABLED).
- /misiones: resumen (activas · completadas · recompensas) y arte de recompensa; recetas con «Tienes / Necesitas / Recibes».

## 1. Antes

- Misiones del pase: definidas en código (`data/season.ts`), progreso derivado de hechos, estado en `user_pass.state`.
- Crafteo: solo local (`src/craft/*`, «Forja»), bloqueado para cuentas (F69 `ForgeGate`). Sin crafteo en servidor.
- Sobres sin abrir: `user_packs` (contador por tipo). Copias: una fila por copia en `user_cards` (`origin` ya admite
  `craft`). Ledger idempotente: `economy_ops` (ref PK) + `credit_transactions`. Recompensas: `award()` →
  `app_grant_reward` (créditos, XP, sobres, cartas concretas). Desguace: `app_salvage_cards` (no mira equipos).

## 2. Después

```
JUEGO (fin de partida persistido · apertura · crafteo)  ──evento con clave única──▶  app_mission_apply (0059)
   │                                                                                       │
   ▼                                                                                       ▼
/misiones  ◀── GET /api/game/missions (servidor calcula LOCKED/ACTIVE/COMPLETED/CLAIMED) ── user_mission_progress
   │  reclamar → award() idempotente (m73:mission:<id>)
   ▼
CRAFTING ─ Sobres:  POST craftPack → app_craft_pack  (N sobres → 1 superior, a «sin abrir»)
         └ Cartas:  Intercambio → POST craftCard → sorteo en Node (crypto) → app_craft_card (N duplicados → 1 aleatoria)
                    Proyectos  → misiones del proyecto → POST claimProject → award({cardId}) (m73:project:<id>)
ADMIN /admin/crafting ─ recetas · misiones · proyectos (validación pura + versión optimista + auditoría append-only)
```

Código: `domain/crafting/{types,economy,floors,cardExchange}.ts`, `domain/missionEngine/{types,evaluate,state,validate}.ts`,
`server/services/{f73Config,crafting,missionEngine}.ts`, `server/cms/crafting.ts`, rutas `api/game/{crafting,missions}`,
`api/admin/cms/crafting`, pantallas `app/misiones/**`, `app/admin/crafting`, `components/crafting/CraftingUi.tsx`.

## 3. Economía (sin cambiar precios, probabilidades, valores ni desguace)

Regla (`domain/crafting/economy.ts`): X = max(2, ⌈1,25 · salida/entrada⌉) a la vez en **precio**, **valor** (entrada en
el peor caso: la más barata de su clase; salida media) y **desguace**. El crafteo siempre es ≥ 20 % peor que la ruta
directa. Datos: `PACK_STATS` (20.000 aperturas del motor real), `marketValue`, `salvageValue`, `MAIN_PACK_DISTRIBUTION`.
Simulación de bucles con el motor real: `scripts/f73-economy-analysis.ts` → `qa/fase73/economy-analysis.json`.

| Receta | X | pérdida precio | bucle comprar→craftear→abrir→desguazar (neto/ciclo) | estado |
|---|---|---|---|---|
| Bronce → Plata | 4 | 37,5 % | −3.201 | ACTIVE |
| Plata → Oro | 2 | 20,0 % | −3.731 | ACTIVE |
| Oro → Masters | 2 | 37,5 % | −6.455 | ACTIVE |
| Masters → Champions | 3 | 46,7 % | −12.526 | ACTIVE |
| Champions → Icon | 2 | 21,9 % | −13.108 | ACTIVE |
| Base → Plata (cartas) | 7 | — | desguace in 35 > out 16 | ACTIVE |
| Plata → Oro | 3 | — | 45 > 26 | ACTIVE |
| Oro → Masters | 8 | — | 160 > 113 | ACTIVE |
| Masters → Champions | 14 | — | 420 > 337 | ACTIVE |
| Champions → Prime | 10 | — | 1.000 > 753 | ACTIVE |
| Prime → Icon | 5 | — | 2.150 > 1.433 | **DISABLED**: solo 3 cartas Icon (sería una garantía de Icon) |

Exploits encontrados: ninguno. El Sobre Inicial no es convertible. Las misiones F73 son de una vez (no rotan) y su
recompensa está acotada por validación (≤ 5.000 créditos, ≤ 2.000 XP, ≤ 3 sobres). El admin no puede activar una
receta por debajo de su suelo (`BELOW_FLOOR`) ni una salida escasa (`SCARCE_OUTPUT`).

## 4. Autoridad, idempotencia y concurrencia

- Crafteo: el cliente manda receta + (cartas) uids + gesto. Una RPC por operación, en transacción: bloquea la fila de
  sobres (la misma que bloquea la apertura) o TODAS las copias del usuario de las cartas implicadas, comprueba, consume
  exactamente las entradas, entrega exactamente la salida y guarda `economy_ops` (kind `craft_pack` / `craft_card`,
  ref `craft:<tipo>:<usuario>:<gesto>`, entradas y salidas). Misma ref → misma respuesta.
- Intercambio: copias tuyas, no bloqueadas, fuera de TODOS tus equipos, de la clase de entrada, y te queda al menos una
  copia de cada carta (duplicados, como el desguace). La salida la sortea el servidor (`randomInt`) entre las cartas
  PUBLICADAS de la clase; el cliente no puede mandar carta, OVR ni semilla.
- Misiones: `app_mission_apply` registra `(usuario, clave del evento)` y aplica las operaciones en la misma
  transacción; repetido → nada. Reclamos por `award()` con clave única.
- Probado (MemSupabase, servicios reales): 10 crafteos simultáneos con inventario para 1 → 1; doble clic/F5/reintento →
  1; apertura + crafteo del mismo sobre → 1; desguace + crafteo de la misma copia → 1; mismo evento ×10 → progreso 1;
  10 reclamos → 1 recompensa; 10 reclamos de proyecto → 1 carta.

## 5. Anti-AFK y anti-farm

- Una partida cuenta solo si terminó por reglas, no es PvP privado y la persona tomó ≥ 5 de sus 10 decisiones
  (`MIN_HUMAN_DECISIONS`; las del reloj F72.8 se leen de `state.timeouts`). Una partida AFK no suma ni rompe rachas. El
  autoplay no se toca.
- Abandono (propio o del rival) no cuenta. PvP privado no cuenta nunca. Una partida se procesa una vez por usuario
  (`match:<id>`), aunque haya F5, reintentos, dos pestañas o sondeos. El equipo evaluado es el snapshot congelado por
  el servidor al empezar (no el navegador ni el equipo guardado después). Dificultad mínima del bot configurable.

## 6. Condiciones soportadas (todas verificables en servidor)

MATCH_PLAY, MATCH_WIN, WIN_STREAK, TURN_WIN, USE_CARD, USE_PLAYER, USE_TEAM, USE_COUNTRY, USE_ROLE, DECK_CONTAINS_PLAYER,
DECK_MIN_TEAM, DECK_MIN_COUNTRY, DECK_MIN_ROLE, WIN_WITH_PLAYER, WIN_WITH_TEAM_COUNT, WIN_WITH_COUNTRY_COUNT,
WIN_WITH_ROLE_COUNT, WIN_PVE, WIN_PVP (= ranked), WIN_COMPETITIVE (= ranked), WIN_DRAFT, CRAFT_PACK, CRAFT_CARD,
OPEN_PACK. Filtros: modos (PVE/DRAFT/RANKED), dificultad mínima. Equipo = el IMPRESO en la carta (`canonicalCardTeam`);
país = el del jugador. «USE_CARD» = la carta está en el equipo de la partida (en una partida completa se juegan las 10).
Dependencias en cadena y en abanico (validación de ciclos).

## 7. Migración 0059 (pendiente de autorización)

Tablas `craft_recipes` (con semillas), `content_card_projects`, `content_missions`, `user_mission_progress`,
`mission_events`, `user_project_claims`; RPC `app_craft_pack`, `app_craft_card`, `app_mission_apply` (solo
service_role); RLS (cada jugador lee lo suyo); guardia final. No toca tablas anteriores. Rollback documentado en su
cabecera y probado. Dry-run: aplicar → sondas → rollback → reaplicar ×2 → ROLLBACK, todo PASS en el Postgres del VPS.

## 8. QA

- Tests: 5616/5616 (nuevos: `domain/crafting/crafting.test.ts`, `domain/missionEngine/missionEngine.test.ts`,
  `server/services/f73.crafting.service.test.ts`, `server/services/f73.contract.test.ts`, `server/cms/f73.crafting.cms.test.ts`).
- Navegador real contra :3005 (`scripts/_f73-ui-qa.ts`): 53/53 en 1440/1024/390 (390 con movimiento reducido).
  Producción tal cual enseña «todavía no disponible» (0059 sin aplicar). El flujo completo se probó con la interfaz y
  la sesión reales y las dos rutas F73 atendidas por los servicios reales sobre MemSupabase (CDP `Fetch`), con fixtures
  «QA ·». Capturas: `qa/fase73/ui/`.
- F72.8: reloj PvE 20/20, PvP 9/9, pistas 16/16, colores PASS. Smoke 74/74. Gate 56/56 (cuenta QA L; la H se quedó sin
  saldo: el gate gasta 3.000 por pasada). Production check: 16 PASS · 1 FAIL = «última migración 0059, esperada 0058»,
  que es exactamente el bloqueo de autorización (no se ha silenciado).

## 9. Deudas y notas

- (RESUELTO en el cierre) 0059 aplicada. La carrera de desguace la cierra 0060: desguace + desguace nunca podía dejarte a 0
  (la copia conservada es determinista, uid menor); desguace + intercambio sí, y ya no. El desguace sigue sin mirar equipos
  (regla previa, sin cambiar).
- PvE sin nadie mirando: una decisión vencida se resuelve cuando se vuelve a consultar la partida (F72.8).
- El gate de navegador consume ~3.000 créditos por pasada de su cuenta QA (Draft 2.000 + un sobre). Estrategia segura sin
  tocar la economía: rotar cuentas QA con saldo y, como mejora, un modo del gate que haga la compra y el Draft solo con
  `QA_GATE_SPEND=1` (el resto del gate no gasta). Sin recargas: no existe una vía segura y no se crea.
- Túnel SSH 54521 (Postgres/Kong del VPS): se cortó una vez (19:29:5x–19:30:14Z) y el supervisor lo relanzó solo; durante el
  hueco las llamadas del servidor fallan (vistas como 401 «No autorizado»). Punto único de fallo del sitio público.
- Cola ranked: una entrada MATCHED antigua se devuelve como estado actual (deuda separada, de hosting; no se tocó).
- (RESUELTO) La captura del proyecto completo a 390 ya es la real (`qa/fase73-closure/shots/proyecto-completo-390.png`).
