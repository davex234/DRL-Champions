# Logos de equipo para las pistas (F72.3)

Fuente: biblioteca de trabajo existente `C:/NEXUS-CENTRAL/NEXUSFICHAJES/players/EQUIPOS/<región>/<TAG>/` (la misma de la que salió el diseño de las cartas). Copiados SIN modificar (byte a byte); los originales no se tocan.
Nombre del fichero = identidad CANÓNICA del equipo (`canonicalId` de `src/data/teamIdentities.ts`), nunca un tag ni un texto: TH y «Team Heretics» son `team-heretics`.

## Estado legal — IMPORTANTE

- **Integración técnica: APROBADA** (forman parte de nuestros assets de trabajo).
- **Derechos de marca / licencia para release pública: SIN RESOLVER.** Son marcas de cada equipo. No usar este README como prueba de licencia. Bloqueo de release en `docs/operations/drlcards-release-checklist.md`.

Registro: `HINT_TEAM_LOGOS` en `src/data/teamLogos.ts` (test `src/lib/duel/f723.hintAssets.test.ts`: carpeta, hashes, las 331 cartas). La pista usa el equipo IMPRESO de la carta (`canonicalCardTeam`), no el roster actual.
Desde 2026-10-15 no queda ninguno pendiente: las 41 identidades de las 331 cartas tienen logo (los 16 que faltaban, abajo).

| canonicalId | origen | sha256 |
|---|---|---|
| 100t | AMERICAS/100T/Logo.png | `fd5d45d56fdbe4b56c4f7d50f20880fe6130701a52327f741c3c908b28c010d3` |
| bbl | EMEA/BBL/LOGO.png | `8f5933d9e0b965fd4e55b99f9dea82edb8f6eaf46906ee304cda50fcf7275a65` |
| c9 | AMERICAS/C9/Logo.png | `1ee0c0d8ca01b52c7018b5411edfdcb62d5babfb640e5f90fc7339c9956291a3` |
| dragon-ranger-gaming | CHINA/DRG/logo.png | `a98127db96dca594b6237deb7d440b31e6790545f3d3ca103c8a70b0b0faaaee` |
| eg | AMERICAS/EG/Logo.png | `0dab48bd4f6c3f9f3cf6f81d5169c30dd7c1ff525de072873a991af9417c1a1e` |
| envy | AMERICAS/ENVY/logo.png | `485d7455ac4f7ce30713a45bac85386ba0a9f35c138dc656c913919f770bb60a` |
| eternal-fire | EMEA/EF/LOGO.png | `ca2e8dc2fcce221263e15daa1dff5c19d6eeb06ad6d03ab9c5f2d679a91e3952` |
| fnatic | EMEA/FNC/LOGO.png | `49f0fe43450fa4061e618e8d52c08f6e636a492750e3cedefc86af00352758e7` |
| furia | AMERICAS/FUR/logo.png | `d0716de12001a37a895e15feaf176612d4d6d60c254b7a7f3ee1f71f41478e91` |
| g2 | AMERICAS/G2/LOGO.png | `1ac2e2ba220fa33ebd59c51df220fae95c1078c9356df28b6dcbbebcb6c9d218` |
| kru | AMERICAS/KRÜ/logo.png | `39a209126d66f69aa23e815f392142f3607a982875dd5fd0acfb33685bf7b03a` |
| leviatan | AMERICAS/LEV/logo.png | `4405bd7b9b02edd8205edc0fcc46c993e07faa9b9f7950e17eda0652463f8c06` |
| loud | AMERICAS/LOUD/logo.png | `773fd17ed867ed9f93db1756b07f70ede917582c9d17aa055294fd39a5d413ac` |
| mibr | AMERICAS/MIBR/logo.png | `06c22e3dc342402c28d6030701e14de721cea5f15cd14ddab7c4f4064a8b4c2b` |
| nrg | AMERICAS/NRG/logo.png | `614b0dd6715a86403b2657ecfba6b11729090dec9802eb078164f193e3baf874` |
| sentinels | AMERICAS/SEN/logo.png | `edd3c040dc47b17544aeee8cd4dbebc326df3db42ae3dece508735a027816af1` |
| team-heretics | EMEA/TH/LOGO.png | `abbbd82f9efe4ef8fa9cdc655a5a421dfe6d398769800f4bd1b5467edb957e97` |
| team-liquid | EMEA/TL/LOGO.png | `193ab32ca870e1bc173e4a954263c3c256952d9a81d342cb2e521242f3384ae5` |
| vitality | EMEA/VIT/LOGO.png | `01ec0f9b086dc26ef40ad222b39793ff8931618d114011f85c07cd3a3209a0e7` |
| fut | EMEA/FUT/FUT.png | `6e0eb82cec1b301de794e21ef74fc6b572efe59e2cf8533789a1a53754fe8f5f` |
| giantx | EMEA/GX/GX.png | `2c00112f6b7331831a455c842ab0e1c1780fb923e42ceb07cfd5aabadc9594d7` |
| karmine-corp | EMEA/KC/KC.png | `3597fef97abda5d6dbe3ba5bec94b3977da87a19f6aa884e588038e175188a26` |
| m8 | EMEA/M8/M8.png | `2dd12f4db1540f6992715017d47f049a2ce0e74f84b0d5bac03e6148374f4c58` |
| navi | EMEA/NAVI/NAVI.png | `a64bd409a4504cc89d64b695c4057cbc0f9c25a3915a7d67c99a9effd3f4b179` |
| pcific | EMEA/PCF/PCF.png | `3c48203fc77ad2a96aee4e73b64baa6db8050dd021a231a57674f49cc3be50ff` |

## Los 16 que faltaban (2026-10-15)

Ni el repositorio ni NEXUSFICHAJES los tenían. Fuente: la ficha del equipo en VLR (la misma fuente de los rosters del
proyecto; los 25 de arriba son byte a byte el logo de VLR, comprobado con Sentinels y Fnatic). Identidad comprobada con
el roster de VLR frente a los jugadores de las cartas (VL = VARREL: C1ndeR, Klaus, XuNa, oonzmlp, Zexy) y la marca frente
al logo impreso en las cartas diseñadas de `cartas/`.

Seis se toman de su variante oficial para fondo oscuro publicada en Liquipedia Commons (`liquipedia.net/commons`), porque
la de VLR es negra (Paper Rex, Team Secret, ZETA DIVISION, VARREL), lleva letras negras (DetonatioN FocusMe) o, en DRX,
VLR ya sirve el logo nuevo de «KIWOOM DRX» y la carta imprime el clásico (cuya versión a color es azul marino, invisible
sobre el escudo oscuro de Colecciones). Misma marca, en blanco: no se recolorea nada a mano.

| canonicalId | origen | tratamiento | sha256 |
|---|---|---|---|
| all-gamers | VLR: https://www.vlr.gg/team/1119 → owcdn.net/img/6549c2b905061.png | byte a byte | `10548d85bbb8c2e5e2c0c4c796c7850340f1d584f9b3dd36b739d43dca9e45af` |
| detonation-focusme | Liquipedia: File:DetonatioN_FocusMe_2022_darkmode.png (3000×2306) | recorte al alfa + LANCZOS a 200 px, centrado en 200×200 | `5a4cd89304f776c7610efbeed0f70f317c693baab1b038027f897131fe259f76` |
| drx | Liquipedia: File:DRX_2023_darkmode.png (3000×3000; el logo clásico que imprimen las cartas, no el de KIWOOM DRX) | recorte al alfa + LANCZOS a 200 px, centrado en 200×200 | `92db1e843262251614c1a8cc2b85f13208be5fd6fbf3422e44733e27a68c5224` |
| edward-gaming | VLR: https://www.vlr.gg/team/1120 → owcdn.net/img/62c82049253b2.png | byte a byte | `68a1f16dbb9544885ccf41aab59f4333afa7ac26115955118c2d4f8703c0aff9` |
| full-sense | VLR: https://www.vlr.gg/team/4050 → owcdn.net/img/6537a7954d915.png | byte a byte | `6a5726529d8f604999183976d21f4f1fb95860b67552cfa9666b18d5471722bd` |
| ge | VLR: https://www.vlr.gg/team/918 (Global Esports) → owcdn.net/img/629f316ddd4dd.png | byte a byte | `e32266b7b5a5041a9d10874295d2f9c84bebca5caf28193cac342510dee69024` |
| gen-g | VLR: https://www.vlr.gg/team/17 (Gen.G) → owcdn.net/img/6970c986eddc6.png | byte a byte | `47fea696548740a35e30888693fd0f5041d803468110bb79fd7240badbb9af32` |
| ns | VLR: https://www.vlr.gg/team/11060 (Nongshim RedForce) → owcdn.net/img/6399bb707aacb.png | byte a byte | `db9ee3a538833e067d9bc5c618b2ed1144bc2f114e7a764209cf0a1ab71dcc9b` |
| paper-rex | Liquipedia: File:Paper_Rex_darkmode.png (1560×1314) | recorte al alfa + LANCZOS a 200 px, centrado en 200×200 | `785391c230b332920a04238ea30366267caf83b376e488dd795989311df5705b` |
| rrq | VLR: https://www.vlr.gg/team/878 (Rex Regum Qeon) → owcdn.net/img/629f17f51e7a3.png | byte a byte | `6824ab4ca772fe5767b10facb80647e982af455a347ec8db5f25eb3d25b4fd81` |
| t1 | VLR: https://www.vlr.gg/team/14 → owcdn.net/img/62fe0b8f6b084.png | byte a byte | `fb5b6699dfad215a3f84110abf0c8b371531515e5017c556262d844ea5047b3a` |
| team-secret | Liquipedia: File:Team_Secret_darkmode.png (1011×504) | recorte al alfa + LANCZOS a 200 px, centrado en 200×200 | `450cbf759e85ea0ee4c2bc07ff55d87375b4bdc25979a49fab956ea00ebf077e` |
| tyl | VLR: https://www.vlr.gg/team/731 (TYLOO) → owcdn.net/img/63eb60fb08390.png | byte a byte | `6cce4437482dc65cd5ddf81bb7ac8b51f2eb8c1159a7e7ecabd59555310dc58c` |
| vl | Liquipedia: File:VARREL_darkmode.png (2429×2000; VL = VARREL) | recorte al alfa + LANCZOS a 200 px, centrado en 200×200 | `e33b9d185d5e2d0a25d871db6d8783105c0eed931e1c31150237f127ab26a2a9` |
| xlg | VLR: https://www.vlr.gg/team/13581 (Xi Lai Gaming) → owcdn.net/img/671742f863b9b.png | byte a byte | `07161cf4edb4d91d195faa0c454d880cee8654efdb0fea16465fde759adb49d3` |
| zeta-division | Liquipedia: File:ZETA_DIVISION_darkmode.png (2000×2000) | recorte al alfa + LANCZOS a 200 px, centrado en 200×200 | `68c76b7640000e4bef1714df3b998849dfdd96e1110b71fe007f60a088ffbd26` |
