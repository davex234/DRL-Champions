# Adaptación del juego al catálogo diseñado — informe final (2026-09-21)

**Veredicto: GO.** Las 329 cartas nuevas son el catálogo oficial y el resto del juego está adaptado a ellas. Se han
resuelto los bloqueos 30–34 de `catalog-replace-report.md`. No se ha creado ninguna carta, no se ha restaurado nada
antiguo y no hay migraciones.

Queda una salvedad que **no** depende del catálogo (punto 6): las misiones de comprar o vender en el mercado no se
pueden cumplir mientras el Marketplace siga cerrado. Es así desde la Fase 44 y tocar el mercado estaba prohibido.

## 1. Road to Champions antes/después

| | Antes (`rtc-1`) | Después (`rtc-2`) |
|---|---|---|
| Nodos jugables | 2/15. c1-n3 (BLG) no tiene rival y la cadena es lineal | **15/15** |
| Tests de campaña | 8 en rojo | 140/140 |

La estructura se mantiene: 3 capítulos × 5 nodos, mismos ids, tipos, dificultades y recompensas. Como el contenido
cambia, la definición pasa a `rtc-2`: los intentos registran con qué definición se jugaron.

## 2. Equipos sustituidos y razón

BLG, TE y JDG no tienen ninguna carta en el catálogo diseñado. Se sustituyen por identidades **verificadas** que la
campaña no usaba y cuyo roster actual sí tiene cartas:

| Nodo | Antes | Después | Núcleo |
|---|---|---|---|
| c1-n3 (MATCH, ROOKIE) | BLG | **100T** | 4 |
| c1-n4 (ELITE, PRO) | TE | **M8** | 5 |
| c1-n5 (BOSS, PRO) | JDG | **Team Heretics** | 5 |

Otros datos:
- China sigue representada en la campaña por XLG (c2-n3) y TYL (c3-n3).
- No quedaba ninguna identidad china verificada libre con cartas.
- Se ha actualizado el fixture de QA que nombraba a «JD Gaming».

## 3. Legalidad de los 15 nodos

Instrumento `_postreplace-campaign-qa.ts`, con motor real y sin base de datos. `campaign:verify` da además 33/33
(servicio real sobre MemorySupabase, incluido el recorrido completo con pagos).

| Nodo | Tipo | Dificultad (bot) | Rival | Núcleo | OVR total | Legal | Cartas inexistentes | Turnos |
|---|---|---|---|---|---|---|---|---|
| c1-n1 | MATCH | ROOKIE (EASY) | NAVI | 4 | 827 | sí | 0 | 10 |
| c1-n2 | MATCH | ROOKIE (EASY) | LOUD | 4 | 833 | sí | 0 | 10 |
| c1-n3 | MATCH | ROOKIE (EASY) | 100T | 4 | 818 | sí | 0 | 10 |
| c1-n4 | ELITE | PRO (NORMAL) | M8 | 5 | 833 | sí | 0 | 10 |
| c1-n5 | BOSS | PRO (NORMAL) | Team Heretics | 5 | 862 | sí | 0 | 10 |
| c2-n1 | MATCH | PRO (NORMAL) | FUT | 5 | 845 | sí | 0 | 10 |
| c2-n2 | MATCH | PRO (NORMAL) | GE | 5 | 836 | sí | 0 | 10 |
| c2-n3 | MATCH | PRO (NORMAL) | XLG | 5 | 862 | sí | 0 | 10 |
| c2-n4 | ELITE | CHAMPION (HARD) | Karmine Corp | 5 | 848 | sí | 0 | 10 |
| c2-n5 | BOSS | CHAMPION (HARD) | Fnatic | 4 | 856 | sí | 0 | 10 |
| c3-n1 | MATCH | CHAMPION (HARD) | NS | 5 | 882 | sí | 0 | 10 |
| c3-n2 | MATCH | CHAMPION (HARD) | G2 | 5 | 904 | sí | 0 | 10 |
| c3-n3 | MATCH | CHAMPION (HARD) | TYL | 5 | 879 | sí | 0 | 10 |
| c3-n4 | ELITE | CHAMPION (HARD) | Paper Rex | 5 | 889 | sí | 0 | 10 |
| c3-n5 | BOSS | CHAMPION (HARD) | Leviatán | 5 | 912 | sí | 0 | 10 |

Resultado:
- Cada mazo tiene 10 cartas, 2 por rol, sin jugador repetido, y pasa el validador canónico.
- Las 15 partidas terminan.
- La progresión abre cada nodo solo al completar el anterior y cierra 15/15.
- El OVR del rival sube de 818 a 912. Los cinco últimos nodos los gana el bot del nodo frente a un bot NORMAL:
  la curva de dificultad se mantiene.

## 4. Recompensa de nivel 50

Las cartas MVP de evento ya no existen. Mismo escalón, una legendaria concreta, que `grantCard` puede entregar:

| Evento | Antes (no existe) | Después |
|---|---|---|
| Masters Toronto | `derke__masters-mvp` | `mada__moments` (legendaria, Americas: sede Toronto) |
| Champions Paris | `aspas__champions-mvp` | `marteen__record-breaker` (legendaria, EMEA: sede París) |
| EWC 2026 | `wo0t__ewc-mvp` | `patmen__record-breaker` (la legendaria restante; EWC no tiene edición) |

- Valor: una legendaria por evento, igual que antes (las MVP estaban en la franja de rango 12–13). No hay inflación.
- Nivel 25 sin cambios: el sobre del evento.

## 5. Logros corregidos

Los ids se mantienen, porque los reclamos existentes dependen de ellos.
- **`primer-icon`** («Consigue un Icon», imposible) → **«Consigue una leyenda»**: tu primera legendaria (Record Breaker
  o Moments; el Sobre Icon la garantiza). Recompensa sin cambios, 10 000.
- **`primer-mvp`** (grupo `mvp`, imposible) → **«Consigue una Champions S»**: épica, 20 cartas. Recompensa sin cambios,
  3000.
- **`completa-heretics`** contaba 4 cartas (solo el alias «Team Heretics»). Ahora cuenta las **11 cartas con TH impreso**.
- El simulador económico mide las mismas condiciones.
- Hay test: con el catálogo completo, todos los logros se cumplen.

## 6. Misión semanal y misiones de evento

- **`w_mvp`** «Consigue 2 cartas MVP» → **«Consigue 2 cartas épicas o superiores»** (`get_epic`). La recompensa no
  cambia (1 Sobre Prime).
  - No es trivial: Estándar da un 2 % por carta de épica o superior y Premium, un 10,5 %.
  - No es imposible: hay 23 cartas.
- Misiones de evento:
  - «Consigue un MVP» → «Consigue una carta legendaria».
  - «Consigue un Winner» → «Consigue una carta épica o superior».
  - «Consigue una carta Masters/Champions» cuenta las ediciones de verdad: Masters L/SDC y Champions S
    (`domain/events/editions.ts`).
  - EWC no tiene edición: su misión «Consigue una carta EWC» deja de ofrecerse en lugar de quedarse imposible.
- Salvedad, **no relacionada con el catálogo**: con el Marketplace cerrado (`GLOBAL_MARKET_ENABLED=false`, Fase 44) no
  se pueden cumplir:
  - «Compra 3 cartas en el mercado» (semanal);
  - las misiones de compra y venta de los eventos;
  - `d-buy` y `w-sell` del pase local antiguo.

  Existían antes del reemplazo y tocar el mercado estaba prohibido; queda documentado. Las misiones vivas del pase
  (`data/season.ts`) no dependen del catálogo y se pueden cumplir; «150 cartas distintas» cabe en 329.

## 7. Sobres activos

- 15 sobres en venta: Inicial, Estándar, Premium, Masters, Champions, EWC, 4 regionales, 4 Team Packs e Icon.
- Prime sigue retirado, pero se entrega como recompensa.
- 15 Team Packs en DRAFT.
- Todos tienen pool mayor que 0.
- **Precios idénticos a HEAD.** Pesos y garantías sin cambios.

## 8. Pools

- Masters, Champions y EWC filtraban por grupos antiguos (`internacional/base/regional`). Así dejaban fuera Future Star
  y las legendarias y no podían dar ni raras ni legendarias. Se quita el filtro.
- Ahora sortean las 7 ediciones con sus pesos de siempre, y el nombre vuelve a tener sentido:
  - las poco comunes son todas Masters L/SDC, así que el Sobre Masters es sobre todo Masters;
  - las épicas son todas Champions S.
- Base de datos: 8 pools actualizados con la RPC oficial, en una transacción (ensayo ROLLBACK y luego COMMIT):
  - Masters, Champions y EWC: 306 → 329;
  - sesgos de equipo al equipo impreso: Heretics 4 → 11, Karmine 5 → 4, FUT 16 → 15; Fnatic y NAVI con las mismas
    cifras, pero ahora son las cartas correctas.
- Total: 4664 entradas, 0 rotas, distribución v926.
- `_postreplace-packs-qa.ts` confirma que, en los 31 sobres, el pool persistido es igual al que deduce el juego.

## 9. Probabilidades (tienda = motor)

Tienda frente a 20 000 cartas abiertas por sobre con el motor real. Desvío máximo: 0,4 puntos. «Imposible» coincide con
el pool real.

| Sobre en venta | Precio | Pool | % C / PC / R / E / L (tienda) | Desvío máx. | Imposible |
|---|---|---|---|---|---|
| estandar | 750 | 329 | 55,3 / 34,8 / 8,0 / 1,8 / 0,2 | 0,004 | — |
| premium | 2500 | 329 | 25,2 / 37,4 / 26,8 / 9,0 / 1,5 | 0,001 | — |
| masters | 5000 | 329 | 8,1 / 32,2 / 23,9 / 30,4 / 5,4 | 0,003 | — (antes: rara, legendaria) |
| champions | 8000 | 329 | 4,0 / 24,1 / 28,1 / 32,1 / 11,7 | 0,004 | — (antes: rara, legendaria) |
| ewc | 6000 | 329 | 6,5 / 30,4 / 25,6 / 32,3 / 5,1 | 0,004 | — (antes: rara, legendaria) |
| emea / americas / pacific | 3000 | 98 / 100 / 97 | 35,2 / 40,0 / 17,8 / 6,0 / 1,0 | 0,003 | — |
| china | 3000 | 34 | 0 / 100 / 0 / 0 / 0 | 0 | común, rara (el texto ahora lo dice) |
| team-heretics / fnatic / navi / g2 | 3000 | 98 / 98 / 98 / 100 | 35,2 / 40,0 / 17,8 / 6,0 / 1,0 | 0,003 | — |
| icon | 20000 | 329 | 0 / 0 / 20,1 / 29,9 / 50,0 | 0,001 | — |

Las probabilidades de Masters, Champions y EWC son exactamente las que prometían antes del reemplazo. Textos
corregidos:
- Masters, Champions y EWC dicen qué dan de verdad.
- Icon: «legendaria garantizada».
- Prime: «épica o superior; llega como recompensa».
- Inicial: «de todas las ediciones».
- China: «todas poco comunes».

## 10. Team Packs desactivados o adaptados

| Team Pack | Estado | Motivo |
|---|---|---|
| BLG, TE, JDG | **BLOCKED** | Bloqueo derivado nuevo `NO_TEAM_CARDS`: 0 cartas del equipo. Siguen en **DRAFT**: no aparecen en la tienda y el servidor rechaza comprarlos o abrirlos. Hay test: un Team Pack a la venta siempre tiene cartas de su equipo, y uno sin cartas no puede venderse. |
| TYL (DRAFT) | Documentado, sin cambio | Sus 5 cartas son épicas y el regional China pesa 0 épicas, así que el sobre no puede darlas. |
| XLG (DRAFT) | Documentado, sin cambio | Con un pool de 34 cartas, el sesgo ×5 da P(≥1 carta de XLG) ≈ 100 %: sería una garantía. |
| Heretics, Fnatic, NAVI, G2 (vivos) | Adaptados | El sesgo sigue al **equipo impreso**. Heretics cubre ahora las 11 cartas TH. Fnatic cubre las 6 FNATIC: no entran Derke y Chronicle (VIT impreso) ni cloud (GX). |

TYL y XLG son decisiones de producto (pesos de China): no se activan y no se tocan.

La auditoría se ha re-medido contra el catálogo nuevo («declarado = medido» en los 24 equipos):
- NRG pierde `LEGACY_ROSTER` (demon1 ya no tiene carta) → PARTIAL, identidad `verified`.
- EDG pierde `LEGACY_ROSTER` y sigue BLOCKED por identidad dividida.

## 11. Normalización de equipos

- **Equipo de la CARTA = el impreso.** Es el prefijo del fichero de `Cartas\`, el mismo dato que el logo. Hay 41
  etiquetas y las 41 resuelven cada una a una identidad distinta (`PRINTED_TEAM_IDENTITY`); 0 cartas sin equipo. Ese
  equipo agrupa colección, filtros, maestría, logros, Team Packs, sets del sobre y el draft.
- **Roster actual = `Player.team`.** Lo usan los rivales de campaña, sin cambios.
- Lo que el arte prueba:
  - FNATIC = FNC más los semilla que VLR sitúa en FNC;
  - GenG = los jugadores GEN de VLR 2026 más t3xture;
  - DRX impreso = los jugadores KRX de VLR;
  - Derke y Chronicle llevan VIT; Meteor y BuZz, T1; cloud, GX; comeback (NAVI), TH; sociablee (FUT), NAVI; zekken,
    MIBR.
- 20 identidades nuevas en `unverified` (no son rival de campaña ni Team Pack): C9, EG, ENVY, FURIA, KRÜ, MIBR, BBL,
  Eternal Fire, GIANTX, PCIFIC, Vitality, DFM, FULL SENSE, KRX, RRQ, Team Secret, VL, ZETA, All Gamers y DRG. Nombre
  completo como alias cuando es inequívoco.
- **Mojibake:** la descarga de VLR guarda 13 campos rotos: el equipo y la etiqueta de los 6 jugadores de KRÜ
  («KRÃœ») y el nick de Rosé («RosÃ©»). `repairMojibake` los repara al entrar, en `data/players` y en `fromPlayerRow`,
  sin tocar ningún texto sano ni la carta impresa. `normalizeAlias` también los repara.
- **No se mezcla nada:** Gen.G ≠ GEN, DRX ≠ KRX y G2 ≠ G2 Gozen siguen separados como `Player.team` (decisión 10). Lo
  desconocido o ambiguo sigue sin resolver.
- Tests: `teamIdentities` (15), `catalogPostReplace` (7) y `teamPackCatalog`.

## 12. Ediciones finales

- 7 ediciones: Base 168 · Masters L 59 · Masters SDC 59 · Future Star 20 · Champions S 20 · Record Breaker 2 · Moments 1.
- La colección filtra y agrupa por edición, ordenada por rareza: Moments, Record Breaker, Champions S, Future Star,
  Masters L, Masters SDC, Base. Antes los chips mostraban grupos fantasma: Regional, MVP, Ganadores.
- También usan las ediciones: los sets del registro, las estadísticas por edición, los temas de la vitrina y la ficha
  («Edición» en lugar de «Colección: internacional»).

## 13. Rarezas finales

Sin cambios: base común; Masters L/SDC poco común; Future Star rara; Champions S épica; Record Breaker y Moments
legendaria. OVR, stats impresas y combate sin tocar. Sin bonus por edición.

## 14. Los 14 excluidos (siguen fuera)

| Fichero | Razón |
|---|---|
| `SEN KYU.png` | Kyu tiene 88 rondas (< 100): no hay trío de combate real. |
| `100T CRYO.png` | Sin jugador exacto. Candidato no confirmado: «Cryocells» (100T, 1048 rondas). |
| `EDG JIENI (MASTERSl).png` | Sin jugador exacto. Candidato no confirmado: «Jieni7» (EDG, 1429 rondas). |
| `BBL ROSÉ.png`, `BBL ROSÉ (MASTERSsdc).png` | **Hallazgo:** el jugador existe (`rosa`, BBL, 1197 rondas). Se excluyó solo porque su nick estaba guardado en mojibake («RosÃ©»). Ya reparado: importarlo es decisión tuya. |
| `ENVY CANEZERRA.png`, `ENVY INSPIRE.png`, `ENVY ION.png`, `FUT BAHA.png`, `FUT MRFALIN.png`, `KC SHEYDOS.png`, `LOUD PANCADA.png`, `NAVI SHAO.png`, `RRQ XFERRO.png` | Ningún jugador ni en `content_players` ni en la descarga VLR 2026. |

No se ha inventado ningún stat ni combate.

## 15. Cuenta QA antes/después

Cuenta `1ff2c0ef`.
- Tras la QA de importación: 15 cartas, 5760 créditos, XP 1880 y 7 sobres abiertos.
- **Revertida** en una transacción con guarda: 0 cartas, 7260 créditos, XP 1298, 4 sobres abiertos, 22 ops, 10
  movimientos, 558 eventos. Todo igual al backup previo.
- La QA de esta fase (1 Sobre Masters real) se revirtió igual, incluida la fila nueva de `user_packs`.
- La cuenta `NEXUSDemo_2f86` abrió un sobre real a las 17:25. Sus 3 cartas se respetan: no es QA.

## 16–18. Cartas, jugadores y referencias rotas

- Cartas: **329**, todas de las 7 ediciones.
- Jugadores con carta: **195**.
- **Referencias rotas: 0.**
  - 0 huérfanos.
  - 4664 entradas de pool válidas.
  - Las 3 `user_cards` reales apuntan al catálogo nuevo.
  - 0 IDs antiguos en código de producto: recompensas, logros y simulador usan cartas o condiciones reales.

## 19–25. Gates y entorno

| Gate | Resultado |
|---|---|
| Tests | **4566/4566** (100 %) |
| Tipos (web / scripts) | tsc web 0 errores · tsc scripts 0 errores |
| Lint | 0 errores (28 avisos anteriores, ninguno de esta fase) |
| Build | OK, 118/118 páginas |
| Producción | `npm run start` en :3005 · `/` 200 · `/coleccion` 200 · `/tienda` 200 · API 401 sin sesión |
| Migraciones | Head **0054**, 0 migraciones |
| Marketplace | OFF (`GLOBAL_MARKET_ENABLED=false`) |

Sobre los tests: `npm test` con la concurrencia por defecto agotó la RAM de la máquina. `UnrealEditor-Cmd` ocupa 3 GB
y otros procesos también; no son de esta tarea. Los mismos 186 ficheros se ejecutaron con `--test-concurrency=3`.

## 26. Backups

- `pre-catalog-replace` intacto, en `/opt/nexus/backups/supabase-drlcards/` y en el PC.
- Nuevo antes de tocar pools: `pre-postreplace-pools-2026-09-21` (dump completo y tablas de pools, con sha256).

## 27. Archivos modificados

### Producto
- **Datos:** `data/roadToChampions`, `teamIdentities`, `teamText` (nuevo), `teamPackCatalog`, `events`, `packs`,
  `packStats` (regenerado), `players`, `catalog`.
- **Dominio:**
  - `domain/cards/types`
  - `domain/events/{editions (nuevo), types}`
  - `domain/progression/achievements`
  - `domain/collection/{room, query, mastery}`
  - `domain/collections/teamCollection`
  - `domain/draft/{generate, snapshot}`
  - `domain/economy/simulator`
- **Colección y servidor:** `collection/{engine, registry, stats, types}`, `collection-presentation/showcase`,
  `server/catalog/rows`, `engine/eventGenerator`, `store/useEventsStore`.
- **UI:**
  - `components/cards/{CardViewer, cardLore}`
  - `components/collectionRoom/{CardBack, CardDetailView, CardCompareView, roomModel}`
  - `components/packs/{CardReveal, packCatalog, packIdentity}`
  - `app/coleccion/carta/[cardId]`
  - fixtures de QA fase35–38
- **Tests:** `campaign`, `campaign.service`, `teamIdentities`, `teamPackCatalog`, `packs`, `room`, `query`,
  `teamCollection`, `showcase`, `collectionScreen` y `catalogPostReplace` (nuevo).

### Scripts
- Modificados: `content-pools-boost`, `content-pools-verify`, `team-packs-ola1-pools`, `campaign-verify` (etiqueta),
  `cartas-db-replace`, `cartas-db-verify`.
- Nuevos: `cartas-db-pools` e instrumentos `_postreplace-*`.

### Sin tocar
- `src/design/tokens.ts` aparece modificado a las 20:14 por **otra sesión**; no es de esta fase.
- Tactical Coach: su última modificación es de las 13:59, anterior a esta fase.
- Sin commit, push ni deploy; ninguna operación git destructiva.

## 28. GO / NO-GO

**GO.** Se cumplen todos los puntos de la definición de hecho que dependen del catálogo. Las decisiones de producto
pendientes quedan documentadas y ninguna bloquea el juego:
- misiones de mercado mientras el Marketplace siga OFF;
- pesos de China para TYL y XLG (DRAFT);
- importar las 2 cartas de ROSÉ.
