# F72.2 · Visual Card Hints

Fecha: 2026-09-29 · Sin migración (cabeza `0058_hardening_grants`) · Sin commit, push ni deploy.

## Qué cambia

- La pista de cada carta oculta del rival se pinta SOLO como imagen (bandera, icono de rol, icono de liga o logo del equipo): sin
  rótulo, sin código ISO, sin siglas. Un único renderer (`DuelCardBack`), usado por la mano del rival en todos los modos.
- El servidor sigue decidiendo la pista (mismo hash FNV `matchKey:uid`, mismo orden cíclico). Nuevo puerto `HintVisual`
  (`lib/duel/hintVisuals.ts`): campo crudo → id del asset o `null`; con `null` el tipo se salta igual que un campo vacío.
- Valor que viaja: ISO (país), `DUELIST|CONTROLLER|INITIATOR|SENTINEL`, `AMERICAS|EMEA|PACIFIC|CHINA`, o el slug del logo resuelto
  por la identidad CANÓNICA del equipo (TH ≡ Team Heretics). Una entrada por carta oculta; `null` = dorso normal (antes, una carta sin
  pista apagaba las de todas por la comprobación de recuento).
- FLEX: no es rol oficial; la fuente canónica (VLR 2026) marca a los 38 jugadores Flex con `roleSource: agents`, `roleConfidence: tie`
  → sin rol fiable: una carta Flex nunca lleva pista de rol (70/331 cartas).
- País válido: tabla del proyecto + `Intl.DisplayNames` (todas las regiones ISO).

## Inventario de assets (auditado, sin duplicar)

| Tipo | Fuente | Encontrados | Faltan |
|---|---|---|---|
| COUNTRY | `flagSrc()` → flagcdn PNG (las banderas de las cartas) | 40/40 países del catálogo | — |
| ROLE | `public/hints/roles/` | 0 | duelist, controller, initiator, sentinel |
| REGION | `public/hints/regions/` | 0 | americas, emea, pacific, china |
| TEAM | `public/teams/<slug>.png` + `TEAM_LOGOS_AVAILABLE` (F64) | 0 | las 47 identidades de `TEAM_IDENTITIES` |

No había en el repositorio ni en el CMS (tabla `assets`: 0 filas) iconos de rol de VALORANT, de liga VCT ni logos de equipo (solo
impresos dentro de las 331 imágenes de carta). No se inventó ni se recortó ningún sustituto. Hasta que lleguen, el servidor elige
otra pista con asset (hoy, la bandera); añadir un icono = dejar el fichero + su id en `HINT_ICONS_AVAILABLE` / `TEAM_LOGOS_AVAILABLE`
(`public/hints/README.md`; test V5 compara la lista con la carpeta).

## Pruebas

- `f722.visualHints.test.ts` (V1–V10): Flex, país, liga/rol sin icono, identidad de equipo, inventario, algoritmo, fugas PvE y PvP
  (ni uid, ni cardId, ni playerId, ni nick de lo oculto), determinismo, y que TODOS los caminos del servidor usan el resolvedor.
- Suite 5.527/5.527 · tsc web+scripts 0 · lint 0 errores · build OK · smoke 74/74 · production:check 17/0/0 ·
  gate:browser 56/56 (nuevo: «F72.2 pistas visuales: sin texto visible») · QA real `_f722-qa.ts` 40/40 (1440/1024/390, normal y
  reducido; banderas 42/35/19 px; 0 assets rotos; recargar = mismas pistas; API `{type,value}|null`).

## Ficheros

Nuevos: `src/lib/duel/hintVisuals.ts`, `src/lib/duel/f722.visualHints.test.ts`, `public/hints/README.md`, `scripts/_f722-qa.ts`,
`docs/product/qa/fase72-2/*`. Modificados: `src/domain/cardgame/hints.ts`, `src/domain/cardgame/pvp/{projection,sync}.ts`,
`src/lib/duel/{hintDisplay,matchView,types,qaSimulation}.ts`, `src/components/duel/DuelCard.tsx`, `src/components/duel/arena/HandFan.tsx`,
`src/server/services/{duels,duelsPvp,competitive}.ts`, `scripts/ops/browser-gate.ts` y pruebas (`hints.test.ts`, `pvp.test.ts`,
`duel.test.ts`, `f71.statHints.render.test.tsx`, `competitive.contract.test.ts`).

F72.2 — CERRADA (GO técnico; iconos de rol, liga y logos de equipo BLOQUEADOS por falta de assets oficiales)

---

# F72.3 · Assets locales de las pistas — banderas + 25 logos existentes

Fecha: 2026-09-29 · Sin migración (cabeza `0058_hardening_grants`) · Sin commit, push ni deploy. Evidencia: `docs/product/qa/fase72-3/`.

## Qué cambia

- **Banderas locales.** `public/flags/<iso>.svg`: 40 ficheros de [flag-icons](https://github.com/lipis/flag-icons) 7.5.0 (`flags/4x3`,
  MIT, © Panayiotis Lipiridis), copiados byte a byte del tarball npm (sha1/sha512 = los publicados en el registro); licencia en
  `LICENSE-flag-icons.txt`, hashes en `README.md`. Son exactamente los códigos de las 331 cartas (39 países + `un`). `flagSrc()` ya no
  compone `https://flagcdn.com/...`: devuelve `/flags/<iso>.svg` o `null`. Registro `LOCAL_FLAGS` (`src/data/flags.ts`).
- **`UN` no es pista.** VLR usa `UN` para «sin nacionalidad»; F72.2 la pintaba como Naciones Unidas. Su fichero existe solo para la capa
  `Flag` de la carta (que ya lo pintaba); `isNationalityFlag()` la excluye de las pistas.
- **25 logos de equipo.** `public/hints/teams/<canonicalId>.png`, copiados byte a byte de `NEXUSFICHAJES/players/EQUIPOS` (originales
  intactos; hashes en `public/hints/teams/README.md`). Registro `HINT_TEAM_LOGOS` (`src/data/teamLogos.ts`), por identidad canónica.
  `TEAM_LOGOS_AVAILABLE` (monogramas de `TeamLogo`, F64) no cambia.
- **Corrección: el equipo de la pista es el IMPRESO.** El resolvedor usaba `DuelDeckCard.team` = `Player.team` (roster actual). 24 cartas
  tienen otro equipo impreso; 11 de ellas con logo habrían enseñado el logo de OTRO club (p. ej. Derke: VIT impreso, Fnatic en el roster).
  Ahora el puerto `HintVisual` recibe la carta en el servidor y resuelve con `canonicalCardTeam` (la regla única del catálogo). El motor
  y `resolve.ts` no cambian; `cardId` solo lo lee el puerto y nunca viaja.
- ROLE y REGION siguen soportados y NO elegibles (sin assets con licencia). Flex sin rol. Sin texto como respaldo.

## Distribución (antes / después) — el algoritmo NO cambia

331 cartas × 2.000 claves de partida (`scripts/_f723-distribution.ts`, `_f723-mix.ts`):

| | COUNTRY | TEAM | ROLE | REGION | sin pista |
|---|---|---|---|---|---|
| Antes (F72.2) | 100 % | 0 % | 0 | 0 | 0 |
| Después (F72.3) | 68,88 % | 31,12 % | 0 | 0 | 0 |

En las 204 cartas con bandera y logo, TEAM sale exactamente el 50 % (mín = máx = 0,50): el inicio `hash % 4` y el salto cíclico
(REGION→TEAM, ROLE→COUNTRY) reparten a partes iguales. Manos de 10: 1.987/2.000 mezclan banderas y logos (media 3,47 logos). No se tocó.

## Identidades

41 identidades impresas en las 331 cartas: **25 con logo (205 cartas)** y **16 sin logo (126 cartas)**: All Gamers, DetonatioN FocusMe, DRX,
EDward Gaming, FULL SENSE, Global Esports, Gen.G, Nongshim RedForce, Paper Rex, Rex Regum Qeon, T1, Team Secret, TYLOO, VARREL,
**Xi Lai Gaming** (faltaba en la lista transcrita del encargo) y ZETA DIVISION. Su carta nunca lleva pista de equipo: cae a la bandera.

## Estado legal (no resuelto)

| Grupo | Fuente | Licencia / estado | Dependencia externa en runtime |
|---|---|---|---|
| FLAGS | flag-icons 7.5.0 | MIT | NO |
| TEAM LOGOS — 25 LOCAL | biblioteca NEXUSFICHAJES | integración técnica APROBADA · marca/licencia para release pública **SIN RESOLVER** | NO |
| TEAM LOGOS — 16 restantes | — | NOT IMPORTED (derechos/fuente pendientes) | — |
| Iconos de rol VALORANT | — | NOT IMPORTED (licencia Riot) | — |
| Iconos de liga VCT | — | NOT IMPORTED (licencia Riot) | — |

Checklist: `docs/operations/drlcards-release-checklist.md` §F; inventario: `docs/operations/drlcards-art-release-inventory.md` filas 13-14, §3.9-10.
Ajeno a las pistas: la app sigue cargando Google Fonts desde `layout.tsx` (ya inventariado, fila 12).

## Pruebas y QA

- `src/lib/duel/f723.hintAssets.test.ts` (A1–A7): registro ≡ carpeta ≡ hashes; 25 esperados; 16 pendientes no disponibles; alias y
  equipo impreso; 40 banderas para las 331; cero URL externa; reparto 50/50; fugas PvE/PvP con control negativo. Actualizados los pins de
  F72.2 que fijaban flagcdn/ES/SE y «fnatic sin logo» (`f722.visualHints`, `f71.statHints.render`). `gate:browser` gana un check F72.3.
- Navegador real (`scripts/_f723-qa.ts`, cuenta QA, :3005): **40/40** a 1440/1024/390 — bandera sola, logo solo, mezcla real, 0 texto,
  0 rotas, recargar y reconectar iguales; en 1440 la partida entera: las 10 cartas reveladas se recalculan con el algoritmo del servidor
  y coinciden con lo visto oculto; las de equipos sin logo (NS, Gen.G, DRX, T1, GE, AG…) salieron con bandera; al revelarse, su pista
  sale de la mano. 0 peticiones de pistas a otro host, 0 errores de consola, 0 «Failed to fetch».
- Suite 5.534/5.534 · tsc web+scripts 0 · lint 0 errores · build `drl-0.1.1-1-1288b7f9` (supervisor F70.2) · smoke 74/74 ·
  production:check 17/0/0 · gate:browser 57/57 · health 200 · ready (0058).

## Ficheros

Nuevos: `public/flags/*` (40 svg + LICENSE + README), `public/hints/teams/*` (25 png + README), `src/data/flags.ts`,
`src/lib/duel/f723.hintAssets.test.ts`, `scripts/_f723-{qa,evidence,distribution,mix}.ts`, `docs/product/qa/fase72-3/*`.
Modificados: `src/data/teamLogos.ts`, `src/lib/assets.ts`, `src/lib/duel/hintVisuals.ts`, `src/domain/cardgame/hints.ts` (firma del
puerto), `src/components/cards/layers/Flag.tsx`, `src/components/duel/DuelCard.tsx` (comentario), `public/hints/README.md`,
`scripts/ops/browser-gate.ts`, pruebas citadas, `docs/operations/drlcards-{release-checklist,art-release-inventory}.md`.

F72.3 — CERRADA (GO técnico; bloqueo legal de marcas para release pública SIN RESOLVER)
