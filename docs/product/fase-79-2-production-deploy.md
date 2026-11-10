# F79.2 — Production deploy + final E2E

2026-10-02. **F79 is deployed to production.** Release `drl-0.1.1-1-bb759037` was built and activated with the canonical F75 `bin/deploy.sh` (VPS, no PC dependency). 0061 was not reapplied. No commit, no push. Evidence: `docs/product/qa/f79-2/`.

**A. PRE-DEPLOY RELEASE** — `releases/drl-0.1.1-1-99bda6f0-f77s1` (BUILD_ID `drl-0.1.1-1-99bda6f0`, the post-F77-S1 build).

**B. PRE-DEPLOY HEALTH** — health 200 and ready OK. The old app reported `migrationHead: 0060` (stale, see D).

**C. REAL MIGRATION STATE** — read-only (`scripts/ops/migration-state.sh`): all 5 fingerprints `=t`:
- 0059 tables;
- `LAST_COPY` in salvage (0060);
- `forge_config`;
- guarded RPCs;
- `app_craft_card` with the unlocked-copy rule.

→ **0061, unambiguous**. The pre-0061 backup still verifies (SHA256SUMS OK, `COMPLETE`).

**D. ROOT CAUSE OF THE STALE 0060**

1. The deployed code (pre-F79) **hard-coded** `MIGRATION_HEAD = 0060`, and its state probe only knew 0059. It could never report 0061.
2. `production:check --app` **never compared** the head the app reported with the expected one, and it read nothing about the real DB state. The mismatch went unnoticed.

**E. CHECKER FIX** — Nothing hides or hard-codes PASS.

- `headFromDbState()` in `release.ts` derives the head **from real schema facts**. A half-applied state reports `inconsistente`, never a head.
- `scripts/ops/migration-state.sh` reads those facts (read-only).
- `production:check` adds three checks:
  - `app-migration-head` (`--app`): the head the app reports vs the expected head;
  - `db-migration-head` (`--vps`): **the DB's real state** vs the expected head;
  - `app-vs-db-head`: app vs DB.
- The app's readiness uses the 0061 probe (`forge`) from F79.1.
- Tests: two new ones (derivation for every milestone and partial state; the checker contract).

| | app-migration-head | db-migration-head | app-vs-db-head |
|---|---|---|---|
| Before the deploy (old app) | **FAIL** (app 0060) | **PASS** (BD 0061) | **FAIL** |
| After the deploy | PASS | PASS | PASS |

**F. RELEASE BUILT** — `drl-0.1.1-1-bb759037`:
- packaged with the F76 recipe (working tree, no docs, no `.env*`): 3,535 files, 0 secret-like names;
- tar sha256 `91232044…183f7f5`, identical on PC and VPS;
- the VPS build (throwaway container, `secrets/app.env`) produced exactly that BUILD_ID, which `deploy.sh` requires before activating.

**G. RELEASE ACTIVATED** — 08:52:14Z via `bin/deploy.sh`. Only `valorosters-app` was recreated; the tunnel, Cloudflare and Supabase were not touched. The previous releases are kept.

**H. PUBLIC SITE** — `https://valorosters.com` probed every second during the deploy:
- 191 samples: **189 × 200**, **2 × 502** (08:52:14–15, the known single-connector swap);
- no prolonged 5xx;
- `/`, `/misiones`, `/misiones/crafting`, `/coleccion`, `/inventario`, `/admin/crafting` → 200.

**I. HEALTH** — 200.

**J. READY** — `ready`; config, database, schema, crafting, **forge**, privacy, catalog (331/331) and storage all OK.

App logs: 0 errors and 0 secret-like strings. The startup log only has the known optional-key WARN (ANTHROPIC/VLR).

**K. POST-DEPLOY MIGRATION STATE** — DB 0061 = app 0061 = expected 0061. There is no 0060 anywhere on the active readiness path.

**L. PRODUCTION:CHECK** (`--app --vps` against production): **27 PASS · 1 WARN · 1 FAIL**. Every head, build, health and ready check passes. The FAIL and the WARN are pre-existing, external, and items I was told not to touch:
- `backup-offsite` NOT_CONFIGURED (F78);
- `auth-email` autoconfirm (F77, product decision).

Local (no `--vps`): see AW.

**M. APPLICATION-PATH CONCURRENCY** — `scripts/_f79-2-e2e.ts`. Path: real API (Cloudflare → Next → PostgREST → Postgres), QA accounts, **real DB state read after every race**. Result: 25/27, plus G re-run 1/1. The 2 FAILs are explained in S and in BQ-1; neither is a defect in the deployed code.

Material: QA accounts C, A, G and F bought standard packs **with their own QA credits** (no admin, nothing published). The available material set the shape of the races (see N and BQ).

**N. DOUBLE CRAFT**
- **A (one-time recipe):** not runnable through the app without **publishing** an advanced recipe (all F79 content is DRAFT, and publishing was forbidden). Covered by the F79.1 real-Postgres run (A ✓) and by service test F8b.
- **B (repeatable craft concurrency):** through the app with F73 pack crafting. 4 tabs with material for 1 → **1 applied**, 3 × `409 INSUFFICIENT_PACKS`, packs 4→0 (never negative), premium +1, 1 ledger entry. Retrying the winner → `repeated`, nothing more consumed.
- B with material for two (two legitimate crafts): there wasn't enough QA material through the app. It was covered in F79.1 against real Postgres (B1 ✓).

**O. CRAFT/SALVAGE** — **One race** over the same 7 copies (account C): Forge, F73 exchange ×2 with the **same gesture** (two identical tabs), another exchange, and a **salvage of one of those copies**, all at once.
- Result: **exactly 1 operation**. A Forge craft won.
- The 7 copies vanished once.
- 0 salvage credits.
- Losers: 409 `NOT_ELIGIBLE` / "Ninguna…", never 500.

**P. CRAFT/EXCHANGE** — Same race: Forge vs exchanges → 1.

**Q. EXCHANGE/EXCHANGE** — Same race: two exchanges with different gestures plus two identical tabs (K) → 1. The identical tabs saw the same thing (both rejected, because the Forge won).

**R. LAST-COPY RACE**
- Asking to salvage the **only** copy of a card → 409 `NOT_ELIGIBLE`, and the copy stays.
- Asking for **both** copies of a card → only the salvageable one goes, and 1 copy stays.
- The two-concurrent-salvages variant was not possible because the first call already left 1 copy. Covered in F79.1 against real Postgres (F1 ✓).

**S. FAVORITE**
- Favorite marked through the real API. The server selector marks it `FAVORITE`.
- Forge without confirmation → 409 `PROTECTED_COPY`. Exchange → 409 `PROTECTED_COPY`.
- Salvage of the **non-kept** favorite copy without confirmation → **409 `PROTECTED_COPY`** (G re-run).
- The salvage preview lists it separately. **Confirmed copy by copy** → only that copy is salvaged.
- Cleanup: favorite removed.
- The first run's FAIL was my test picking the **kept** copy (the lowest uid). That copy is never salvageable, so it got a generic 409; nothing was consumed. Re-run with a non-kept copy: PASS.

**T. SHOWCASE**
- A copy was put in the showcase through the real API.
- Forge without confirmation → 409 `PROTECTED_COPY`; salvage doesn't touch it; the copy stays.
- The showcase was restored to what it was before.

**U. DECK PROTECTION** — A deck copy: salvage → rejected; Forge → `NOT_ELIGIBLE`; the copy stays. The DB rejects `IN_DECK` (F79.1). See BQ-1.

**V. MARKET-LISTED PROTECTION** — The market is OFF and production has **0 listings**: there is no way to list a copy through the app. Covered by the guarded RPCs plus the F79.1 real-Postgres test (F3 ✓: a listed copy doesn't count as "the copy you keep").

**W. IDEMPOTENCY**
- Retrying the winning gesture after success → `200 repeated` with **the same card**, and no new ledger entry (O race and pack race).
- Hand-crafted payloads rejected:
  - a field injected into the forge craft request (`xp`) / an invalid uid / an invalid confirmation → 400;
  - a DRAFT recipe → 404 `RECIPE_UNAVAILABLE`;
  - another user's copy → rejected, and it stays intact.

**X. SMART SELECTOR** — In production (C, 390): auto-select never picked protected copies (0). In the API, the selector's protection matches the server's. In the UI, the 390 rail shows the materials.

**Y–AH. FORGE (production UI)** — `scripts/_f79-2-prod-ui.ts`. Real Chrome, **no interception**, real QA session. Result: run 1 **96/106** (2 checks of mine fixed, no product defect); **run 2 103/103**.

| Area | Result |
|---|---|
| Forge level (Y) | the core and the level come from the server |
| XP (Z) | bar with `aria-valuenow`/`max` |
| Mastery (AA) | 4 branches |
| Recipes, chains, blueprints (AB–AD) | the advanced zone shows **0 recipes** to the player (F79 content in DRAFT, correct) |
| Projects (AE) | real projects render without overflow |
| OWN vs CONSUME (AF) | covered by service tests (production has no active content with OWN) |
| History (AG) | real ledger entries (C: 2; D: 1 after its real craft), plus the correct empty state |
| Objectives/achievements (AH) | DRAFT → not visible (correct) |

Pack confirmation, real UI:
- the dialog's CONFIRM is reachable and on top at **390/1024/1440**;
- Escape closes it without crafting;
- at 1440, **a real craft from the production UI**, with the result coming from the server.

**AI. PROGRESSION SAFETY** — Changing the config requires admin. In production the **only admin is your account**, which I must not use, and granting temporary admin to a QA account wasn't authorized. So:
- In production I checked that a normal user **cannot get in** (UI "Acceso restringido" at all 3 widths; API 401 in F79.1/F14).
- The positive flow (impact panel, RECALCULAR plus reason, audit) was verified with the **real handlers** in F79.1 (56/56) and in tests (M1/M2, policy R1–R4).

The production `forge_config` is still empty: nothing was recalculated or published.

**AJ. ADMIN CRAFTING** — Same constraint. Production: non-admin denied (UI and API). Admin allowed, config loads, invalid config rejected, DRAFT visible, safety, no secrets: 56/56 with the real handlers (F79.1). Secret scan of `/admin/crafting` as served: clean (AX).

**AK. SALVAGE** (new code, production):
- deck copies: never;
- favorite and showcase: only with confirmation;
- last copy: protected;
- retries: `repeated` (F79.1 old-app path plus this E2E).

**AL. CARD EXCHANGE**
- Works (the winning race was a Forge craft; the F73 exchange returned 200 `repeated` and 409 by inventory).
- Protected-copy semantics: favorite/showcase → `PROTECTED_COPY`.
- Ladder unchanged: **7/3/8/14/10**, with Prime→Icon 5 **DISABLED**.

**AM. ECONOMY** — Pack recipes **4/2/2/3/2** in production, unchanged. Pack prices and probabilities, credits and rewards: no changes (the code wasn't touched). `GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false` (code constants). 0 active listings.

**AN. AUTH** — QA logins over the public API; smoke 74/74 (anonymous 401, admin 401/403, escalation rejected). Nothing in GoTrue touched.

**AO. COLLECTION** — 200 (smoke); collection isolation (AW).

**AP. PACKS** — Buying, opening and buy+open: dozens of real QA operations, 200. Pack crafting: race B.

**AQ. PVE** — F72.8 QA in a real browser against production (1440): PvE match, turns, autoplay. **20/20**.

**AR. RANKED F76** — `scripts/_f76-live.ts` against production: **29/29**.
- Queue lifecycle and concurrent joins; F5 with an active match; 409 `ACTIVE_MATCH` with resume.
- **Stale MATCHED** → IDLE; terminal match readable but not playable (`MATCH_CLOSED`); rematch.
- 10× join / 10× cancel; cancel vs matchmaker; cross-user 404/403.
- **0 live searches at the end.**
- The matches were between QA personas and closed by abandoning, the normal player action. Ranked history for those QA personas was unavoidable.

**AS. F72.8**
- PvP (inside F76): 30 s deadline, autoplay when it expires, the match **continues** (no EXPIRED).
- PvE: countdown, autoplay when attacking and defending (~1.1 s after the server deadline), F5 keeps the original deadline, two clients resolve once, 0 console errors.

**AT. MISSIONS F73** — 200 (F79.1 smoke and API). Pack opening and crafting progress the missions through the same hooks.

**AU. FORGE F74 REGRESSION** — Production UI 103/103: home, packs (4/2/2/3/2 ladder), exchange, history, inventory; 0 console/hydration errors.

**AV. RLS** (production, player session):
- another user's `user_cards`, `economy_ops` and favorites → empty;
- `forge_config` → 403;
- guarded RPC → 403;
- queue table → 403 (F76 X6).

**AW. CROSS-USER**
- Another player's public profile: no `self`, credits, email or `is_admin`.
- Another user's copies: rejected and intact.
- Another user's match: 404.
- The Forge snapshot always comes from the token. Isolation: **7/7**.

**AX. SECRET SCAN** — Run on the VPS without printing values:

| Type checked | Result |
|---|---|
| Served assets | 44 |
| Source maps served | **0** |
| Server secrets (`secrets/app.env`, not public) | **0 hits** in `.next/static`, `public/`, served HTML/JS and app logs |
| `sb_secret_`, Resend keys, private keys, secret env-var names | **0** |
| JWT in served code | only **1 `anon`** (public browser key); **0 `service_role`** |
| Recovery/SMTP | 0 exposures |

Build-side `client-secrets` check in `production:check`: PASS.

**AY–BA. 1440 · 1024 · 390** — Production UI, run 2: 103/103.
- 0 horizontal overflow (elements inside scroll rails are counted as reachable, as F74 intends);
- 0 clipped CTAs;
- 0 broken images (CardArt included);
- 0 raw JSON;
- unnamed buttons: 0;
- reduced motion at 390.

**BB. ACCESSIBILITY**
- Keyboard: Tab moves through controls with visible focus; Escape closes the modal.
- ARIA: the XP bar has `aria-valuenow`/`max`; the dialog has a role; every button has a name.
- Reduced motion at 390.
- No formal contrast audit (unchanged since F79).

**BC. CONSOLE/HYDRATION** — 0 console errors and 0 hydration errors at all 3 widths (production).

**BD. FULL TEST SUITE** — `npm test` **5695/5695** (+2 F79.2 ops tests).

**BE. TYPES** — 0.

**BF. LINT** — 0.

**BG. BUILD** — Local OK (BUILD_ID `drl-0.1.1-1-bb759037`); VPS build OK with the same BUILD_ID.

**BH. PRODUCTION SMOKE** — Post-deploy: **74/74**.

**BI. PREVIOUS RELEASE ROLLBACK READY** — `releases/drl-0.1.1-1-99bda6f0-f77s1`: build, `node_modules` and prerender present; proven on 0061 in F79.1 (smoke 74/74 plus real writes 15/15). `bin/deploy.sh --activate drl-0.1.1-1-99bda6f0-f77s1` (code only; the DB is **not** rolled back). **Not executed** (everything passed).

**BJ. F77/F77-S1** — Not touched (the public anon key was only read to run the public tests, without printing it).

**BK. SMTP/Resend** — Not touched.

**BL. SPORTCOACH** — Not touched.

**BM. F78** — Not touched (offsite is still NOT_CONFIGURED).

**BN. MARKETPLACE** — OFF.

**BO. PAYMENTS** — OFF.

**BP. COMMIT/PUSH** — NO.

**BQ. REMAINING DEBT**

1. **A QA deck damaged by the old bug, before this deploy.** QA account C's deck "Mi primer equipo" points to a copy (`artzin__base`, uid `ebab0564…`) that no longer exists.
   - Forensics (pre-0061 backup plus ledger) show it was destroyed **at 08:22:39Z by my F79.1 compatibility test running on the OLD app**. That salvage didn't exclude deck copies — exactly the bug F79.1 fixed.
   - Three seconds earlier that account had received a second copy (08:22:36), so the old preview kept the lowest uid and scrapped the deck copy.
   - It is the **only** dangling deck reference in all of production.
   - The deployed code prevents it (U, plus `IN_DECK` in the DB).
   - It's QA data: I didn't patch it without authorization. **Repairing it means re-saving that QA deck.**
2. The **one-time recipe (A)** and **market-listed copies (V)** can't be exercised through the app without publishing content or opening the market. Covered against real Postgres in F79.1 and in tests.
3. **The positive admin flow in production** (config load and editing, safety panel) needs an admin account other than yours. Covered with the real handlers locally.
4. QA material:
   - C, A, G and F spent almost all their QA credits on standard packs;
   - D did a real pack craft in the UI;
   - F79.2 created QA ranked matches (abandoned).
5. Inherited and external:
   - offsite backup (F78);
   - email autoconfirm (F77);
   - the pre-existing debt listed in F79/F79.1 BA/BH.

**BR. FINAL VERDICT**

**F79 PRODUCTION = GO**

No post-deploy invariant failed for operations run by the deployed code. The only invariant breach found (BQ-1) predates the deploy and was caused by the old code; the new code blocks it.
