# DRL Champions — Desktop (Tauri 2)

Cliente de escritorio AAA que **reutiliza íntegramente** la app Next existente (mismo
código, mismos motores). Tauri solo cambia *cómo se distribuye y ejecuta*: usa el WebView
del SO (sin Chromium empaquetado) → ligero, arranque rápido, poca RAM.

## Requisitos (máquina de build)
- Rust + `cargo` (https://rustup.rs)
- Tauri CLI: ya en devDependencies (`@tauri-apps/cli`), o `cargo install tauri-cli`
- Windows: WebView2 (preinstalado en Win10/11) · macOS: Xcode CLT · Linux: webkit2gtk + librsvg

## Desarrollo
```bash
npm run tauri:dev      # abre la ventana nativa apuntando a next dev
```

## Build de instaladores
```bash
npm run brand                       # (re)genera iconos desde la identidad visual
npm run tauri icon src-tauri/app-icon.png   # genera el set completo (incl. icon.icns macOS)
npm run tauri:build                 # → src-tauri/target/release/bundle/{nsis,msi,dmg,appimage,deb,rpm}
```
`tauri:build` ejecuta `npm run build:desktop` (`NEXT_DESKTOP=1 next build` → export estático en `out/`) y empaqueta. Resultado en Windows: **DRLChampionsSetup.exe** (NSIS) + `.msi`.

## ⚠️ Único paso manual pendiente (export estático)
Las **5 API routes** server-only (`src/app/api/**`: admin/esports/market) requieren Supabase
y **no forman parte del juego** (que es 100% cliente/localStorage). El export estático
(`output: "export"`) **no admite route handlers**, así que para el bundle de escritorio hay
que excluirlas (moverlas fuera de `src/app/api` en el build desktop, o servirlas aparte como
backend). El build **web** (`npm run build`) las mantiene intactas.

## Auto-update
`tauri.conf.json > plugins.updater`: sustituir `pubkey` por la clave pública de firma
(`tauri signer generate`) y `endpoints` por el servidor de releases. Flujo ya cableado en
`src/platform/update.ts` (buscar → descargar → verificar → aplicar → reiniciar).

## Capa de plataforma (TS, reutilizable)
`src/platform/` abstrae config, logs, paths, offline, update y crash con `window.__TAURI__`
cuando corre en escritorio y *fallback* web/localStorage en navegador. Validado por
`npm run -s tsx scripts/desktop-verify.ts` (22/22).
