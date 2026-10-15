# Colecciones por equipo · los 16 logos que faltaban (2026-10-15)

**Estado: terminado en local. Sin push, sin desplegar, sin migraciones, sin tocar producción ni el CMS de producción.**
Producción sigue en `drl-0.1.1-1-d523a42a`. Sigue a `colecciones-cierre-2026-10-14.md` §8 («Logos: siguen faltando los 16»).

## 1. Auditoría inicial

- **Lista de los 16** (informe de cierre §8, test `f723.hintAssets.test.ts` `PENDING_LOGOS`, `docs/product/qa/fase72-3/teams.json`):
  All Gamers, DetonatioN FocusMe, DRX, EDward Gaming, FULL SENSE, GE, Gen.G, NS, Paper Rex, Rex Regum Qeon, T1,
  Team Secret, TYL, VL, XLG, ZETA DIVISION — claves `all-gamers`, `detonation-focusme`, `drx`, `edward-gaming`,
  `full-sense`, `ge`, `gen-g`, `ns`, `paper-rex`, `rrq`, `t1`, `team-secret`, `tyl`, `vl`, `xlg`, `zeta-division`
  (126 cartas). Las otras 25 identidades de las cartas ya tenían logo.
- **Cómo llega un logo a la pantalla**: `logo = CMS team_logo vigente y aprobado (subject = clave) ?? hintTeamLogoSrc(clave)`
  (`server/services/teamCollections.ts`). `hintTeamLogoSrc` = `HINT_TEAM_LOGOS` + `public/hints/teams/<clave>.png`
  (`src/data/teamLogos.ts`): es la fuente de «logos del producto» de Colecciones (sala y detalle, `TrophyBadge` sobre
  escudo oscuro, sin filtros), perfil/equipo favorito, walkout, panel `/admin/teams` y pistas de cartas ocultas del duelo.
- **Convención real**: PNG 200×200 con alfa, nombre = `canonicalId`, hash en `public/hints/teams/README.md`, registro y
  carpeta comparados por test. Los 25 existentes son **byte a byte el logo de VLR** (comprobado: Sentinels y Fnatic
  idénticos al fichero de `owcdn.net`; Team Heretics difiere porque VLR lo ha cambiado después). DRG es la excepción
  histórica (900×1022).
- **Ningún fichero de los 16** en el repositorio, en `NEXUSFICHAJES/players/EQUIPOS/` (las carpetas de esos equipos solo
  tienen fotos de jugadores) ni en el resto de `C:/NEXUS-CENTRAL`.
- **Subida por CMS**: existe (`/admin/teams/<id>`, asset `team_logo`), pero escribe en la BD y el Storage de
  producción: no se ha usado (fuera de lo autorizado). La vía local es la del producto, que el CMS puede sustituir
  cuando un admin suba otro.

## 2. Fuentes y verificación de identidad

1. **VLR** (`vlr.gg/team/<id>`), la fuente de los rosters del proyecto y de los 25 logos. Para cada equipo se comprobó
   el roster de VLR frente a los jugadores de las cartas diseñadas (`cartas/`): p. ej. VL = **VARREL** (C1ndeR, Klaus,
   XuNa, oonzmlp, Zexy), NS = Nongshim RedForce, GE = Global Esports, TYL = TYLOO, XLG = Xi Lai Gaming, Gen.G = Gen.G
   (Ash, Karon, ZynX…), DRX = la ficha «KIWOOM DRX» (BeYN, MaKo, free1ng, HYUNMIN).
2. **Marca**: cada logo se comparó con el logo IMPRESO en una carta diseñada de ese equipo (hoja de contraste).
   15/16 coinciden con el de VLR. **DRX no**: VLR sirve ya el logo de KIWOOM DRX (rayas rosa y azul) y la carta imprime
   el clásico de DRX (X azul con franjas). Se usa el clásico.
3. **Legibilidad**: el escudo de Colecciones es casi negro (`rgba(7,8,14,.96)`) y el logo se pinta sin filtros. Medido
   el % de píxeles con contraste ≥ 3:1 contra ese fondo: Paper Rex 0 %, Team Secret 0 %, ZETA 0 %, VARREL 3 % (logos
   negros), DRX clásico a color 0 % (azul marino). Los 25 existentes van del 25 % al 100 %. Para esos casos y para
   DetonatioN FocusMe (letras «DF» negras) se usa la **variante oficial para fondo oscuro** publicada en Liquipedia
   Commons (misma marca en blanco; no se ha recoloreado nada a mano).

## 3. Los 16 logos

| Equipo (clave) | Estado inicial | Fuente | Fichero integrado | Verificación visual | Resultado |
|---|---|---|---|---|---|
| All Gamers (`all-gamers`) | sin logo (etiqueta AG) | VLR team/1119 | `public/hints/teams/all-gamers.png` (VLR, byte a byte) | = carta; sala y detalle, 8 idiomas × 3 anchos | ✅ integrado |
| DetonatioN FocusMe (`detonation-focusme`) | sin logo (DFM) | Liquipedia `DetonatioN_FocusMe_2022_darkmode.png` (VLR team/278 tiene «DF» negro) | `detonation-focusme.png` (200×200) | = carta (DF blanco + azul) | ✅ integrado |
| DRX (`drx`) | sin logo (DRX) | Liquipedia `DRX_2023_darkmode.png` (VLR team/8185 = logo de KIWOOM DRX, no el de la carta) | `drx.png` (200×200) | = carta (X con franjas), en blanco | ✅ integrado |
| EDward Gaming (`edward-gaming`) | sin logo (EDG) | VLR team/1120 | `edward-gaming.png` (byte a byte) | = carta | ✅ integrado |
| FULL SENSE (`full-sense`) | sin logo (FS) | VLR team/4050 | `full-sense.png` (byte a byte) | = carta | ✅ integrado |
| GE (`ge`) | sin logo (GE) | VLR team/918 (Global Esports) | `ge.png` (byte a byte) | = carta (variante con texto) | ✅ integrado |
| Gen.G (`gen-g`) | sin logo (GENG) | VLR team/17 | `gen-g.png` (byte a byte) | = carta (emblema GG) | ✅ integrado |
| NS (`ns`) | sin logo (NS) | VLR team/11060 (Nongshim RedForce) | `ns.png` (byte a byte) | = carta | ✅ integrado |
| Paper Rex (`paper-rex`) | sin logo (PRX) | Liquipedia `Paper_Rex_darkmode.png` (el de VLR es negro) | `paper-rex.png` (200×200) | = carta (la carta lo imprime en blanco) | ✅ integrado |
| Rex Regum Qeon (`rrq`) | sin logo (RRQ) | VLR team/878 | `rrq.png` (byte a byte) | = carta | ✅ integrado |
| T1 (`t1`) | sin logo (T1) | VLR team/14 | `t1.png` (byte a byte) | = carta | ✅ integrado |
| Team Secret (`team-secret`) | sin logo (TS) | Liquipedia `Team_Secret_darkmode.png` (el de VLR es negro) | `team-secret.png` (200×200) | = carta | ✅ integrado |
| TYL (`tyl`) | sin logo (TYL) | VLR team/731 (TYLOO) | `tyl.png` (byte a byte) | = carta | ✅ integrado |
| VL (`vl`) | sin logo (VL) | Liquipedia `VARREL_darkmode.png` (el de VLR es negro; el escudo «VARREL 2026» no es el de la carta) | `vl.png` (200×200) | = carta (V) | ✅ integrado |
| XLG (`xlg`) | sin logo (XLG) | VLR team/13581 (Xi Lai Gaming) | `xlg.png` (byte a byte) | = carta | ✅ integrado |
| ZETA DIVISION (`zeta-division`) | sin logo (ZETA) | Liquipedia `ZETA_DIVISION_darkmode.png` (el de VLR es negro) | `zeta-division.png` (200×200) | = carta (Z con franjas) | ✅ integrado |

Hashes, URLs exactas y tratamiento de cada fichero: `public/hints/teams/README.md` (segunda tabla). Los seis de
Liquipedia: recorte al canal alfa, LANCZOS al lado largo de 200 px y centrado en un lienzo transparente de 200×200
(la convención de los demás). Sin marcas de agua, fondos ni deformaciones; transparencia conservada. Tamaños 3–30 KB.

**Ningún logo queda pendiente.** El respaldo (etiqueta con el acento de la región) sigue en el código para los equipos
que se den de alta desde el panel sin logo, y las identidades del registro sin cartas (GEN, KRX, BLG, TE, JDG, G2 Gozen)
siguen sin logo: no se les pinta el de otra entidad (Gen.G ≠ GEN, DRX ≠ KRX).

## 4. Cambios

| Tipo | Archivo |
|---|---|
| Logos | 16 PNG nuevos en `public/hints/teams/`; `public/hints/teams/README.md` (procedencia y hashes) |
| Registro | `src/data/teamLogos.ts` (`HINT_TEAM_LOGOS`: 25 → 41) |
| Arreglo i18n | `src/components/trophies/TrophyRoomScreen.tsx`: la etiqueta «✓ Completada» de cada tarjeta salía en español en los 7 idiomas (ver §6) |
| Pruebas | `src/lib/duel/f723.hintAssets.test.ts` (41 esperados, 200×200 de los añadidos, ninguna identidad de carta sin logo), y 7 pruebas que usaban un equipo de los 16 como ejemplo de «sin logo»: ahora usan GEN o fuerzan `logo: null` sobre uno real, y comprueban que el real tiene el suyo (`f722`, `f71.statHints`, `walkout`, `f89.profile` + `design-system/fase89/fixtures.ts`, `teamCollections`, `cms/teams`, `f82` dominio y servicio) |
| Arnés de QA | `src/app/design-system/colecciones-equipos/page.tsx`: `?team=` opcional para el detalle (404 en producción, como todo `/design-system`) |
| Instrumento | `scripts/_team-logos-qa.ts` (nuevo, fuera de CI) |
| Release | `docs/operations/drlcards-release-checklist.md`: el punto de logos pasa a 41 y el de «16 restantes» se cierra |

No cambian: claves ni identidades de equipos, regiones, cartas, ediciones, probabilidades, precios, créditos, XP,
recompensas, reglas de compleción, RLS, permisos, validación de subidas, auditoría, CMS, migraciones. Sin dependencias
nuevas.

## 5. Efectos colaterales (previstos por el diseño)

- **Pistas del duelo**: las cartas ocultas de esos 16 equipos ya pueden mostrar la pista de equipo (logo), con el
  mismo reparto ~50/50 país/equipo que las otras 25 (`A6`). El algoritmo no cambia: antes el tipo TEAM se saltaba como
  campo vacío.
- **Generador de sets F82** (`/admin`, solo bajo demanda de un admin): sin descartes por `NO_LOGO`, propone 36 sets de
  equipo en vez de 23 (5 descartes por identidad o pocos jugadores). No crea ni publica nada solo; los sets publicados
  no cambian.
- **Panel `/admin/teams`**: esos 16 dejan de marcarse «sin logo» (logo «del producto»). Un logo subido al CMS sigue
  teniendo prioridad.
- **Perfil (equipo favorito) y walkout**: muestran el logo real de estos equipos.

## 6. Pruebas

| Prueba | Resultado |
|---|---|
| Suite completa (`node --test` sobre `src/**/*.test.ts(x)`, incluye el trabajo F78 ajeno sin confirmar) | **6.596/6.596** |
| `npm run typecheck` (app + scripts) | 0 errores |
| `npm run lint` | 0 errores, 30 avisos (los mismos 30 de antes) |
| `npm run i18n:audit` | 13.825/13.825 por idioma, 0 ausentes/vacíos/huérfanas: «sin problemas» |
| `npm run build` | OK (único aviso: `src/instrumentation.ts`, `process.exit` en Edge — trabajo F78 ajeno sin confirmar, preexistente) |
| QA en navegador, build local + `next start` (:3019, arnés), `scripts/_team-logos-qa.ts` | **496 PASS · 0 FAIL** (§7) |

**Fallo encontrado y corregido**: en la sala de Colecciones la etiqueta de estado de las tarjetas completadas salía
como «✓ COMPLETADA» en alemán, inglés, japonés… (`td("✓ Completada")` no es una clave de ningún catálogo; el auditor
no ve las claves dinámicas de `td`). Está en producción desde `d523a42a`. Ahora el «✓» va fuera y el texto sale de
`trophies` («Completed», «Abgeschlossen», «完了»…); la QA lo comprueba en las 41 tarjetas por idioma.

## 7. QA en navegador

Build de producción local servida con `next start -p 3019` y `NEXUS_QA_HARNESS=1` (nunca :3005 ni producción), Chrome
headless, arnés `/design-system/colecciones-equipos` = pantallas reales (`TrophyRoomScreen`, `TeamDetailScreen`) sobre
el modelo real y el catálogo de las 331 cartas. 8 idiomas (es, en, de, it, fr, pt-PT, pt-BR, ja) × 390/768/1440 px.

| Comprobación | Resultado |
|---|---|
| Sala con los 41 equipos desplegados (24 pasadas) | 41/41 en cada una |
| Cada escudo: `<img>` de `/hints/teams/<clave>.png`, cargado, añadidos 200×200, `object-fit: contain`, caja cuadrada (proporción intacta), `alt` | 41/41 × 24 |
| Detalle de cada uno de los 16 (390 y 1440 en los 8 idiomas; muestra de 3 a 768) | 280/280 |
| Etiqueta «✓ Completada» traducida en las 41 tarjetas | 24/24 |
| Idioma del documento y sin desborde horizontal | 24/24 salas + 280 detalles |
| Respuestas ≥ 400 de logos o estáticos (ningún 404) | 0 |
| Errores de consola | 0 (descontados los 503 de `/api/content/agents|packs`: sin BD en local; no tienen que ver con logos) |

Total: **496 PASS · 0 FAIL**. Capturas en `logs/team-logos-qa/<idioma>-<ancho>/` y `report.json` (no se versionan).

## 8. Pendiente / fuera de esta tarea

- **Despliegue**: no hecho (no autorizado). Para que lo vean los jugadores hace falta una release nueva con estos
  ficheros; sin migración. Rollback = volver a `d523a42a`.
- **Marca**: los 41 logos siguen con los derechos de marca para release pública **sin resolver** (igual que los 25 de
  antes; `drlcards-release-checklist.md`). Si no se confirma, vaciar `HINT_TEAM_LOGOS` devuelve las etiquetas.
- **Alternativa por CMS**: si se prefiere no versionar marcas, los mismos 16 ficheros se pueden subir desde
  `/admin/teams/<id>` en producción (requiere autorización: escribe en la BD y el Storage de producción).
- **Humo con sesión real** de Colecciones en producción: sigue pendiente desde el despliegue de `d523a42a`.

## 9. Release `drl-0.1.1-1-baddbaed` (2026-10-15, preparada; activación pendiente del propietario)

**Derechos de uso.** No existe licencia escrita para ninguno de los 41 logos, y este documento no la afirma. La
checklist (`drlcards-release-checklist.md` §F) los sitúa como bloqueo de la **primera release pública**. Comprobado en
producción: `DRL_PUBLIC_RELEASE` no está activado (Closed Alpha, 2 cuentas admin), y los 25 logos con el mismo estado
ya se sirven hoy. Por eso la política no impide esta release, pero el punto sigue abierto antes de abrir al público.

| Paso | Resultado |
|---|---|
| Commit local (sin push) | `8fe0e57`: solo los ficheros de esta tarea; F78, capturas y `settings.local.json` siguen sin confirmar y fuera |
| Overlay | 30 ficheros del commit (16 PNG nuevos + 14 modificados), byte a byte el commit, sin CRLF; la versión anterior de los 14 = producción |
| `_team-logos-rc-stage.sh stage` | base `d523a42a` (solo lectura): BOUNDARY_OK (30, 0 borrados) · F78 = producción · NO_MIGRATIONS_OK (cabeza 0076 = producción) · ECONOMY_RULES_OK (sin economía, catálogo, identidades, modelo de Colecciones ni middleware) · LOGOS_OK (16 PNG 200×200 registrados; los 25 anteriores intactos) |
| Artefacto | `valorosters-i18n-qa/rc/drl-0.1.1-1-baddbaed.tar`, sha256 `2d19ca561919cf3fd967642ab02aa45f1036afada59c67aeba5f90273b1294cc`; no sobrescribe nada |
| Puerta (contenedor desechable, entorno del stack de QA) | **GATE_OK**: `npm ci` + `next build` + `tsc` (app) + ESLint 0 errores (30 avisos) + i18n «sin problemas» + **6.587/6.587** pruebas; BUILD_ID = nombre. La build no contiene el literal «✓ Completada» y lleva los 41 PNG |
| TypeScript de `scripts/` | falla en dos instrumentos `_` que ya vienen así en la fuente de `d523a42a` (`_f82-qa.ts`, `_fase70-1-uncached.ts`, idénticos en base y candidata); no los usa la app y la puerta original nunca lo ejecutó. Deuda previa |
| Artefacto anterior | `incoming/drl-0.1.1-1-d523a42a.tar` sha256 `4acdf145…a2df6` = el registrado |
| Copia de seguridad | `pre-logos-deploy/20261015T092513Z`: BACKUP_OK, `SHA256SUMS` OK, `COMPLETE` (BD 2.977.689 B). Configuración en `pre-logos-deploy-config/20261015T092513Z` (600/700, huellas OK). Sin simulacro de restauración: la checklist lo exige solo con migración |
| Logos en producción antes | 25 OK por huella, 16 en 404, arneses 404 (`scripts/_team-logos-prod-check.ts`) |
| **Activación** | **NO HECHA**: el clasificador de seguridad de Claude Code bloqueó `bin/deploy.sh` en producción. Preparado `/tmp/tl-rc/_team-logos-deploy.sh` (sha256 `7bed787b…bd71`), que hay que ejecutar a mano |

Activar: `ssh nexusadmin@212.95.40.144 'bash /tmp/tl-rc/_team-logos-deploy.sh'`. Comprobar después:
`BASE_URL=https://valorosters.com npx tsx scripts/_team-logos-prod-check.ts` (41 OK y 3 × 404) y el humo de invitado
`scripts/_i18n-prod-guest-smoke.ts`. Vuelta: `bin/deploy.sh --activate drl-0.1.1-1-d523a42a`, sin tocar la base.
