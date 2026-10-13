# FASE 21.4 — TIENDA + CICLO ECONÓMICO DE PACKS

**Estado: ciclo cerrado de extremo a extremo, sobre lo existente.** La tienda, la economía, el
ledger y la idempotencia YA existían y son maduros; la Fase 21.4 los **integra y termina** —añade
el puente a las categorías y bloquea el bucle con tests— sin economía paralela ni segundo sistema
de compra. `npm test` 933/933, typecheck, build y verifiers en verde. Validación real del bucle
completo en navegador.

## Objetivo
Cerrar `DRL Credits → Tienda → Compra → Sobre → Apertura → Cartas → Colección` usando la
infraestructura existente, y dejar `/tienda` terminada.

## Arquitectura reutilizada (lo que YA existía — no se reescribió)
- **`/tienda`** («La armería»): saldo real, sobres pendientes, **ShopHero** (vitrina: comprar /
  comprar y abrir) + **ShopRail** (carril) + banda de eventos. `purchase()` usa el flujo existente
  —con sesión `buyPackOnline` (el servidor cobra y valida), sin ella `useGameStore.buyPack`—.
  Filtra por `isStoreVisible` (solo ACTIVE).
- **Economía**: `app_buy_pack`/`app_apply_pack_open` (RPC, servidor), ledger `economy_ops`,
  idempotencia por gesto/ref, saldo `profiles.credits`. **Historial visible** ya existe en
  `/tienda/creditos` («Tus movimientos», el libro mayor real) y en `/recompensas`.
- **Ciclo de vida** (Fase 20.4): `guardPurchase`/`guardPublicOpen` server-side; ShopHero: precio de
  `PackDef`, `alcanza`/`faltan`, CTA deshabilitado sin saldo o mientras compra (`busy`).
- **Precio canónico**: `PackDef.price` (única fuente).

**Conclusión:** el bucle económico ya estaba construido y probado. El hueco real era la
**organización por categorías en la experiencia comercial** (§5/§20) y **cerrar el bucle con
tests + validación**.

## Qué se ha añadido
1. **Puente al catálogo por categoría (§5/§20):** una fila «Explorar · Todos · Rareza · Regiones ·
   Equipos» en `/tienda` que enlaza al catálogo categorizado `/packs` (Fase 21.1) por **hash
   deep-link** (`/packs#equipos`). No se duplica la rejilla: `/tienda` = compra, `/packs` =
   descubrimiento, coherente con §20.
2. **Deep-link por categoría en `/packs`:** lee `window.location.hash` (sin `useSearchParams`, apto
   para export estático) para preseleccionar la pestaña. Escucha `hashchange`.
3. **Test del cableado económico:** `tienda/storeEconomy.behavior.test.ts` fija las propiedades del
   bucle que no cubría ningún test (visibilidad por ciclo de vida, compra por el flujo existente,
   sin decidir precio ni mutar saldo en React, puente que no duplica, precio canónico).

## Tienda / Categorías / Saldo
`/tienda` muestra saldo real (🪙, de `useGameStore.credits`, sincronizado del servidor), sobres
ACTIVE (vitrina + carril), banda de eventos y el puente de categorías. Solo ACTIVE aparecen
(`isStoreVisible`); DRAFT y RETIRED, no.

## Flujo de compra
`/tienda` (o `/packs` → ficha) → «Comprar y abrir» → `purchase()` → **el servidor valida sesión,
lifecycle, saldo, cobra, registra ledger y aplica idempotencia** → entrega el sobre → `/abrir/:id`
→ ceremonia (Fase 21.2) → cartas → colección (Fase 21.3). El frontend nunca descuenta créditos ni
decide precio; solo pide la operación y refleja el estado sincronizado.

## Saldo / Ledger / Idempotencia
- **Saldo**: fuente única el sistema económico; se relee del servidor tras cada operación. Sin
  balance local paralelo.
- **Ledger**: `economy_ops` (RPC), visible en `/tienda/creditos`. No se creó otro historial.
- **Idempotencia**: la existente (gesto/ref + guardián `busy` en la UI). No se añadió un segundo
  sistema.

## Ciclo de vida (§17) — sin cambios
`isStoreVisible` (ACTIVE) para la tienda; `guardPurchase`/`guardPublicOpen` en servidor. No se tocó
`lifecycle.ts`.

## Errores (§12)
No autenticado, saldo insuficiente, DRAFT, RETIRED, inexistente, error de servidor/red: mensajes
legibles vía `Toast`/estados; el servidor rechaza y el frontend traduce. Sin stack traces ni IDs
internos.

## Team Heretics
Aparece en la tienda y en `/packs#equipos` (junto a Fnatic, NAVI, G2) usando `team-heretics`, por
el mismo flujo que cualquier pack. Sin segundo pack, sin tocar su pool ni sus probabilidades, sin
`if team === …`.

## Integración con apertura / colección
«Comprar y abrir» → `/abrir/:id` (ceremonia existente, Fase 21.2) → las cartas quedan en
`user_cards` (servidor, misma transacción) → aparecen en la colección y en «Colección por equipo»
(Fase 21.3). No se toca mint, seriales ni colección.

## Historial (§14)
Ya existe y es visible (`/tienda/creditos` «Tus movimientos», ledger real). No se creó otro; no se
inventaron registros.

## Responsive / Diseño
`/tienda` es la vitrina premium existente (design system NEXUS), con saldo destacado, cards de
sobres, CTA claros y estados de compra. El puente de categorías usa `flex-wrap`. Sin overflow
horizontal. Desktop principal, verificado a 1440.

## Seguridad (§22)
Precio, pack, lifecycle, saldo y resultado son **server-authoritative** (RPC + guardas + RLS
existentes). El usuario solo gasta sus créditos; no puede comprar DRAFT/RETIRED (404/409
server-side); no puede alterar el precio (sale de `PackDef`, la ruta ignora cualquier `body.price`
—verificado en `security:verify`—); doble compra protegida por `busy` + idempotencia del servidor.
No se añadió ningún endpoint.

## Tests
- **Nuevos (7):** `storeEconomy.behavior.test.ts` — visibilidad (solo ACTIVE, Team Heretics sí,
  DRAFT/RETIRED no), compra por el flujo existente + encadena a `/abrir`, no decide precio ni muta
  saldo en React, insuficiente (ShopHero), doble-compra (`busy`), puente sin duplicar, precio
  canónico.
- **Ya cubierto (sin duplicar):** `shop.test.tsx` (vitrina, saldo, insuficiente, doble clic),
  `packLifecycle.test.ts` (compra ACTIVE/DRAFT/RETIRED server-side, buy_and_open), `packCatalog.test.ts`
  (visibilidad por ciclo de vida, precio=backend, Team Heretics). Los 13 escenarios del §23 quedan
  cubiertos entre estos ficheros.
- **Suite:** `npm test` **933/933** ✅ · typecheck ✅ · build ✅ · `security:verify` ✅ ·
  `pack:verify` ✅ · `content:verify` ✅ · `distribution:verify` ✅ (30/0). Ningún test existente
  modificado para forzar verde.

## Validación REAL (navegador, `next start`, usuario demo)
1. `/tienda`: saldo **🪙 3.000**, cabecera «La armería», puente de categorías. ✅
2. «EQUIPOS» → **`/packs#equipos`** con la pestaña preseleccionada: 4 Team Packs ACTIVE
   (Team Heretics, Fnatic, NAVI, G2); DRAFT ocultos. ✅
3. Ficha Team Heretics (Precio 3.000, saldo 3.000) → **«Comprar y abrir»** → ceremonia de apertura. ✅
4. **Saldo descontado 3.000 → 0** (flujo del servidor; «TU SALDO 0», «SIN ABRIR 4»). ✅
5. **Saldo insuficiente:** ficha Premium (2.500) con saldo 0 → **«Créditos insuficientes»**
   deshabilitado + «Te faltan 2.500 créditos · Conseguir créditos». ✅
6. **DRAFT:** los Team Packs DRAFT no aparecen en la tienda ni en Equipos, y el acceso directo se
   rechaza («Sobre no disponible», Fases 21.1/21.2). ✅
7. **Apertura → colección** (COMEBACK/EXIT/ALFAJER de la compra) verificado en Fases 21.2/21.3. ✅
Créditos gastados por el flujo normal (§25), sin datos ficticios. Capturas en el scratchpad.

## P2 reales restantes
- **Compra directa desde el carril de `/tienda` sin abrir ficha:** ShopHero compra el sobre
  seleccionado; para otro sobre hay que seleccionarlo en el carril o abrir su ficha en `/packs`. Es
  la UX existente; no es un defecto, pero una compra 1-clic por card del carril sería una mejora
  futura.
- **Historial filtrado «solo compras de sobres»:** el ledger muestra todos los movimientos; un
  filtro por tipo «compra de sobre» sería aditivo (P2), no se amplía el alcance.
- **Rareza declarada sin cartas** en algunos Team Packs: heredado, fuera de alcance (§26).

## Cambios NO realizados
Sin tocar RNG, pack draw engine, probabilidades, pools, minting, `user_cards`, `card_mints`,
market, mastery, PvP, Pick'ems, Trainer, roster, `teamIdentities`, Team Packs, artwork, lifecycle
ni economía global. No se resolvieron los 6 BLOCKED, no se hizo Ola 4, no se corrigió la rareza P2,
no se modificó Fnatic. Sin commit/push/deploy.

## Archivos modificados
| archivo | cambio |
|---|---|
| `src/app/tienda/page.tsx` | +puente de categorías al catálogo (`/packs#…`) |
| `src/app/packs/page.tsx` | +deep-link por hash para la categoría inicial |
| `src/app/tienda/storeEconomy.behavior.test.ts` | **nuevo** — 7 tests del cableado del bucle |
| `docs/product/fase-21-4-store-pack-economy-report.md` | este informe |
