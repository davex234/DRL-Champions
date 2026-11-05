# Banderas de VISTA PREVIA del Walkout (solo DEV)

`es.svg`: flag-icons **7.5.0** (MIT, © Panayiotis Lipiridis), `flags/4x3/es.svg`, copiada sin modificar del mismo
tarball que `public/flags/` (sha256 del tarball `c0b80bf0e08006a60f56621d6bc49f8c7131f4d1fef6737a165a673431f4b518`,
el mismo del README de `public/flags`). sha256 del fichero: `f9cfaff858e95f830733ade9591037b5322dfb5827a53b70956a3d190bb49b9a`.

Por qué aquí y no en `public/flags/`: ninguna carta del catálogo es de un jugador español (0 de 331), y
`LOCAL_FLAGS` debe coincidir con los países del catálogo (lo fija un test). Esta bandera SOLO la usa el panel DEV del
prototipo `/design-system/pack-walkout` para previsualizar el tema de país «España» de la arena; nunca se atribuye a
un jugador.

`pt.svg` (2026-10-12): flag-icons **7.5.0** (MIT), `flags/4x3/pt.svg`, copiada sin modificar desde
`cdn.jsdelivr.net/npm/flag-icons@7.5.0`. sha256 del fichero: `a7a2cf0b44aaaaf4f3bdc0ee0fa308ec7085bdfedd3f72da1473d43fd2a569fb`. La usa el selector de idioma
(«Português (PT)», `src/i18n/config.ts`); está aquí y no en `public/flags/` por el mismo motivo que `es.svg`.
