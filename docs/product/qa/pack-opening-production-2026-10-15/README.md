# QA visual de la apertura · 2026-10-15

Producción: `drl-0.1.1-1-2b8f8817`. Informe: `docs/product/pack-opening-atmosphere-2026-10-15.md` §9.

## Procedencia de cada carpeta

| Carpeta | De dónde sale | ¿Apertura real? |
|---|---|---|
| `produccion-invitado/` | **https://valorosters.com** (producción), sin sesión y sin pulsar «Abrir»: el sobre cerrado servido por la release activa. 390/768/1440 × movimiento normal/reducido. `report.json`: 18/0 | No (solo lectura) |
| `entorno-aislado/` | **Stack de QA aislado del VPS** (`valorosters-i18n-qa`: base de datos, auth y red propias), sirviendo la **build exacta de producción** (BUILD_ID `drl-0.1.1-1-2b8f8817`). Cuenta sintética `qa-player-i18n@example.invalid` (créditos sintéticos), inicio de sesión por el formulario. Compra de Sobre Oro y Sobre ICON por el endpoint de la tienda, y apertura por la interfaz normal (`/abrir/<sobre>`): **las cartas las decide el servidor del stack**. 390/768/1440 × normal/reducido. `report.json`: 192 PASS · 35 FAIL (los 35 son el hallazgo del dorso) | **Sí, en el entorno aislado** |
| `correccion-local/` | Build LOCAL con la corrección del dorso (sin desplegar), arnés con resultado fijo `/design-system/fase81?scene=r-mixed` | No (resultado fijo) |
| `entregables/` | Selección con los nombres pedidos (copias de `entorno-aislado/` salvo `hallazgo-dorso-antes-despues.png`, que compara aislado frente a corrección local) | ver origen abajo |

**Ninguna captura es de una apertura real en producción.** En producción solo existen las dos cuentas reales (propietario y socio); no hay cuenta de QA autorizada, y no se crearon usuarios, sobres ni transacciones.

## Entregables

| Fichero | Origen (todo «entorno aislado» salvo indicación) |
|---|---|
| `opening-start.png` · `opening-rupture.png` · `opening-tension.png` | 1440 normal, Sobre Oro: sobre, rotura y tensión (sala neutra; el dorso ya anticipa la rareza → hallazgo) |
| `gold-reveal.png` | 1440 normal · Trent (Base 88 → clase Oro): sala dorada |
| `champions-reveal.png` | 1440 normal · Stax (Champions S 88): negro con oro campeón y rayos |
| `masters-reveal.png` | 1440 **reducido** · hero Masters: sala lila |
| `masters-reveal-mobile.png` | 390 normal · Xavi8k (Masters L 81): sala lila |
| `icon-reveal.png` / `icon-reveal-mobile.png` | 1440 / 390 normal · Sobre ICON: Patmen (Record Breaker) / Mada (Moments): sala marfil |
| `transition-between-rarities.png` | 1440 normal: Oro → preparación → Champions S |
| `navigation-back.png` | 1440 normal: «Anterior» vuelve a la carta Oro, boca arriba y con su sala |
| `opening-summary.png` | 1440 normal: resumen con las acciones de siempre |
| `mobile-opening.png` · `tablet-reveal.png` | 390 sobre · 768 reducido (Masters) |
| `hallazgo-dorso-antes-despues.png` | izquierda: código de producción (entorno aislado); derecha: corrección local |
