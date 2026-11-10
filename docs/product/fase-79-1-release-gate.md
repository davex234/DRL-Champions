# F79.1 — Production hardening & release gate

2026-10-02. **0061 is APPLIED in production; the F79 code is NOT deployed.** No commit, no push. Evidence:
`docs/product/qa/f79-1/` (apply, dry-run, smoke, post-migration, admin and salvage QA).

## A. F79 BASELINE
F79 was preserved (not rebuilt). Starting point: 5676/5676, types/lint clean, build OK, UI QA 108/108, 0061 written but
not applied, head 0060. After F79.1: **5693/5693** (+17 new tests), UI QA still **108/108**.

## B. PROTECTED CARD MODEL
One canonical rule, `src/domain/cards/protection.ts`, applied to every path that destroys copies. It has two levels:

- **ABSOLUTE.** Never consumed, even with confirmation:
  - `NOT_OWNED`;
  - `MARKET_LISTED` (`user_cards.locked`);
  - `IN_DECK`;
  - `LAST_COPY` (at least one unlocked copy of each card stays).
- **CONFIRMABLE.** Only consumed if the player confirms each copy (`confirmProtected`):
  - `FAVORITE` (0052, per card);
  - `SHOWCASE` (0049, per copy).

`confirmProtected` can only **restrict**:
- a protected copy that isn't confirmed rejects the **whole** operation (`PROTECTED_COPY`);
- confirming a different copy changes nothing;
- confirmation never lifts an absolute block.

Where the rule is enforced:
- **Server (Node):** one loader, `server/services/cardProtection.ts`.
- **Database (0061):** `_card_consume_guard`, inside the transaction, via the new `app_craft_card_guarded` and `app_salvage_cards_guarded`. They wrap the existing RPCs, whose signatures are unchanged.

## C. SALVAGE PROTECTION
Before F79.1, salvage ignored favorites and the showcase, **and also decks** (it could salvage a copy that was in a deck). Found in the audit; fixed.

Preview:
- excludes favorite/showcase copies and lists them separately (`protectedCopies`);
- copies in a deck are never salvaged, and they count as "the copy you keep";
- if there is a showcase copy, it is the one kept.

Salvage:
- choosing a protected copy without confirmation → 409 `PROTECTED_COPY`, with nothing deleted or paid;
- it calls the guarded RPC.

UI (`/inventario`):
- a "Copias protegidas" block with a per-copy checkbox;
- the button only counts unprotected copies plus the ones the player ticked.

## D. CRAFT PROTECTION / E. EXCHANGE PROTECTION
- **Forge:** keeps the F79 per-copy confirmation, and now goes through `app_craft_card_guarded` with `p_confirm`.
- **F73 exchange:** has no confirmation step, so it rejects protected copies. It uses the guarded RPC with an empty confirmation, so the database rejects them too.

## F. PROJECT PROTECTION
Claiming a project **does not consume** any copy; it only delivers the target card (test X3). There is nothing to protect. The F79 project stages (`OWN`) only check, they never consume.

## G. AUTO-SELECT / H. SERVER BYPASS TESTS
- The selector uses `copyProtection` from the canonical model.
- **Property test (300 random inventories):**
  - auto-select always returns something the rule accepts without confirmation;
  - for **any manual selection**, the server and the rule accept and reject **the same thing**.
- Hand-crafted payloads against the Forge (test X2), all rejected without consuming anything:
  - a market-listed copy;
  - a copy in a deck;
  - another user's copy;
  - the last copy;
  - a duplicate uid;
  - too few or too many copies;
  - an unconfirmed favorite;
  - "confirming a different copy";
  - a nonexistent recipe;
  - a `forge-…` recipe through F73.

## I. LAST-COPY · J. FAVORITES · K. SHOWCASE · L. MARKET-LISTED
- **Last copy:** absolute in Node + in the DB (0060 for salvage, 0061 for exchange). Real Postgres: F1/F2/F3.
- **Favorites:** confirmable. Serialized with the favorite insert (the same advisory lock as the 0052 trigger). Real Postgres: G1/G2.
- **Showcase:** confirmable. Serialized with `player_profile_set` (`FOR SHARE` on its row). Real Postgres: G3/G4.
- **Market-listed:** absolute, and it does not count as "the copy you keep" (0061 aligns exchange with 0060). Real Postgres: F3. The market is still OFF.

## M. XP CURVE SAFETY / N. PROGRESSION POLICY
Architecture: progression is **still derived** from the ledger (no mutable stored XP). A pure policy was added, `domain/forge/policy.ts`.

**What it detects as REGRESSIVE:**
- lower XP for an action;
- a harder curve (more cumulative XP for any level);
- a lower maximum level;
- higher or removed mastery thresholds;
- a changed mastery metric;
- a live chain or objective sent back to DRAFT, deleted, or changed (steps, target, metric, period);
- changed unlock conditions of a live recipe;
- a removed or changed blueprint source.

**How regressive changes are handled:**
- The server **rejects them** (409 `PROGRESSION_REGRESSION`) unless they come with `confirmRegression: true` **and** a reason of at least 8 characters.
- The `impact` action (read-only) computes, **over the real ledger**, how many players would drop and by how many levels.
- The save is audited as `f79_forge_progression_recalc`, with the regressions and the impact.

**Objective windows:** `activeFrom` became `activeWindows`, which **only the server stamps**.
- Retiring an objective **freezes** it: nothing is lost and nothing more is gained. Before, a retired objective kept adding XP.
- Reactivating it opens a new window and never pays out the past.

**Monotonic changes** save without extra steps.

**Determinism:** the policy depends only on the two documents. The property test (500 random histories) shows that "monotonic" ⇒ nobody drops.

**Admin UI:**
- a panel explains what is dangerous;
- "Revisar y guardar" calls the server preview first;
- regressive changes show a red panel with the impact ("X of N players would drop a level");
- the recalculate button requires typing **RECALCULAR** plus a reason.

**No schema change needed** for any of this: it lives inside the 0061 document. No 0062.

## O. 0061 FINAL REVIEW / P. 0061 CHANGES
Reviewed and amended **before** applying it.

`forge_config`:
- `revoke all` from public/anon/authenticated;
- explicit grants to service_role;
- RLS with no policies;
- `CHECK` constraints on id, doc and version.

New guarded RPCs (§B):
- 4 new functions;
- the helpers can't be called even by service_role;
- the existing signatures are untouched (backward compatible).

Hardened final guard. It aborts the transaction if:
- `forge_config` lacks RLS or is visible to the browser;
- any `forge-…` recipe is ACTIVE;
- 0060 is missing.

Other properties:
- no `BEGIN`/`COMMIT` inside the file (pinned by a test);
- forward-only, idempotent;
- no seeded content.

Sizes and checksums:
- 0061 sha256 `a1d82cda825bbc2057aac95718d9a7a480809aeb0e708e936f1449e1251bddb0`;
- operational rollback in `docs/operations/rollback/0061_forge_progression.ROLLBACK.sql`.

## Q. RLS
- Verified in the dry run and in production: anon/authenticated have no `select`/`insert` on `forge_config`, and execute nothing new. PostgREST: anon → 401 on the RPC and on the table.
- Existing RLS untouched.
- Cross-user: another user's copies → `NOT_ELIGIBLE` (F10, X2).

## R. BACKUP / S. BACKUP VERIFIED
- Mechanism: `scripts/ops/backup-drlcards.sh` (F67).
- Location: `/opt/nexus/backups/supabase-drlcards/pre-0061/20261002T080938Z`.
- Dump: 3,498,664 B, sha256 `2db9413f…5d44c`, TOC 2003 entries, 40 auth users; manifest sha256 `298122190f…bdd11`. SHA256SUMS verified.
- **Restore drill** (disposable Postgres, same image `supabase/postgres:17.6.1.165`, `--network none`): **DRILL_OK**, 25/25 tables with 0 mismatches, 331 cards, 29 agents, 1 admin, Storage checksums OK, 27 s. The 23 `pg_restore` errors are the Supabase roles missing from the image (the known F67 baseline).
- Off-site: not configured (F78, untouched).

## T. MIGRATION DRY RUN
`scripts/ops/_f79-1-dryrun.sh` runs against a disposable copy restored from the pre-0061 backup (same image, no network). Result: **DRYRUN_OK 53/53**.
- **0060 → 0061** in one transaction (174 ms).
- **Identical md5 fingerprints across 26 tables:** auth.users, profiles, user_cards, user_packs, user_game, user_pass, economy_ops, credit_transactions, craft_recipes, missions/projects/progress/claims, mission_events, content_cards (+versions), agents, packs, decks, favorites, showcase, audit, sanctions, ratings, matches, achievements.
- Content: `forge_config` empty, 0 `forge-…` recipes, recipe economy frozen.
- Idempotent (a second application succeeds).

Logs: `dryrun-0061.log`, plus the two previous attempts with bugs **in my harness**, kept for honesty:
- wrong `content_cards` column;
- a user counter lost in a subshell;
- a wrong expectation on a signup ledger entry.

## U. ROLLBACK STRATEGY
- The system is **forward-only**: there is no SQL "down", and none is claimed.
- The **operational rollback** is tested in the dry run. It:
  - restores the **exact** 0059 body of `app_craft_card` (md5 `63c5e91e…`);
  - leaves 0060 intact;
  - removes `forge_config` and the 4 functions.
- After it, the old app keeps exchanging, and 0061 re-applies cleanly.
- Mandatory order: first redeploy the code from before F79.1.
- Plus the verified backup.

## V–AC. REAL POSTGRES CONCURRENCY
Parallel `psql` processes, synthetic users, inside the dry-run copy. The real state is checked after every race.

| | Scenario | Result |
|---|---|---|
| **W/A** | one-time recipe from 2 requests, shared once key, material for two | 1 ledger entry, 1 consumption (9→6), 1 output, the other gets `repeated` with **the same card** |
| B | repeatable: 2 legitimate | 2 crafts, correct counts |
| B | 6 tabs on the same 3 copies | 1 craft, 5 `NOT_ELIGIBLE`, nothing negative |
| **X/C** | craft + salvage of the same copies | one wins, never 0 copies, credits match what was applied |
| **Y/D** | Forge + F73 exchange, same copies | 1 operation |
| **Z/E** | new guarded exchange + **old** RPC (deployed app) at once | 1 operation |
| **AA/F** | two salvages of different copies (2 copies) | 1 left, the loser gets `LAST_COPY` |
| **AA/F** | craft of 3 + salvage of the 4th | one wins, never 0 |
| **AA/F** | listed copy | does not count → `LAST_COPY` |
| **AB/G1** | favorite in flight, then craft | the craft **waited for the lock** (2161 ms) and rejected `PROTECTED_COPY`; with confirmation it goes through |
| **AB/G2** | craft in flight, then favorite | the favorite waited (2162 ms); legitimate consumption, last copy kept |
| **AB/G3** | showcase in flight, then craft | `PROTECTED_COPY`, nothing consumed |
| **AB/G4** | craft in flight, then showcase | the showcase waited and saw `NOT_OWNED` (no dangling uid) |
| **AB/G5** | deck copy, even confirmed | `IN_DECK` |
| **AC/H** | same key ×3 (including different copies) | 1 craft, retries return the stored result |
| **AC/H** | salvage retried | 1 charge, 1 entry |
| **I** | 4 identical tabs | 1 craft, 3 `repeated` |

Invariants: no synthetic inventory negative, and **real data intact** after the races.

## AD. ECONOMY
Frozen and verified before and after in production:
- **Packs:** Bronce→Plata 4, Plata→Oro 2, Oro→Masters 2, Masters→Champions 3, Champions→Icon 2.
- **Card exchange (real ladder):** 7 / 3 / 8 / 14 / 10, with Prime→Icon 5 **DISABLED**.

No price, probability, credit or reward changes. Market and payments OFF. Pity OFF.

## AE. PRODUCTION DATA COMPATIBILITY
Real state:
- **331** cards (331 PUBLISHED);
- **196** players with cards;
- **29** agents;
- 40 users, 1 admin;
- 836 copies, 0 market-locked;
- 490 operations, 424 credit entries;
- 16 missions, 4 projects;
- 0 favorites, 1 showcase, 28 decks.

All counts are identical before and after 0061.

## AF. PRE-MIGRATION HEAD
`0060_salvage_last_copy_atomic`, confirmed by real state:
- no `forge_config`;
- 0 guarded functions;
- `app_craft_card` md5 = the 0059 body, with no drift;
- 0060 present.

## AG. 0061 APPLY
- **Applied once**, 2026-10-02T08:19:43Z, as `postgres` (the owner of the existing functions), in a single transaction: exit 0, 181 ms.
- The script refuses (and touches nothing) if the sha256 doesn't match or the head isn't 0060.
- Post-checks: 11/11 PASS on schema, grants, ownership, recipes, catalog and counts.
- PostgREST exposes the new RPCs. The probe gets `400 P0001 «…clave de idempotencia»` from inside the function, without writing.
- The log shows 2 «FAIL» lines from **my grep**: the output was cut at 90 characters before the word "idempotencia". The response itself is the correct one. Recorded in `apply-0061.log`.

## AH. POST-MIGRATION HEAD
**`0061_forge_progression`** by real state (`forge_config` present and empty, 4 functions). 0059 and 0060 were not reapplied.

The deployed app's `/api/ready` still says 0060 because that is the **constant in its old code**. The F79.1 code reports the head by state (a new `forge` probe).

## AI. OLD APP AGAINST 0061
- The deployed code (`drl-0.1.1-1-99bda6f0-f77s1`) works against the new schema: smoke 74/74 plus real writes 15/15.
- **QA account C** bought and opened standard packs with its own QA credits (18,220 → 9,225) to have material. No admin grant was used.

## AJ–AR. HEALTH · READY · AUTH · COLLECTION · PACKS · CRAFTING · SALVAGE · MISSIONS · RANKED

| Area | Result |
|---|---|
| Health | 200 |
| Ready | `ready` (all green) |
| Auth | QA login over the public API |
| Collection | 200 |
| Packs | buy+open 200 |
| Crafting | state OK, the exchange ladder is unchanged, **real exchange** `card-plata-oro` through the 0061-redefined RPC: OK; retry idempotent (same card) |
| Salvage | real salvage of a duplicate (0060) OK; retry `repeated` (one charge) |
| Missions | 200 |
| Ranked / competitive | 200 (read) |

The smoke also covers pages, headers, admin denial, privilege escalation and RLS. The ranked queue was not exercised with writes.

## AS–AV. ADMIN CRAFTING BROWSER · 1440 · 1024 · 390
`scripts/_f79-1-admin-qa.ts` runs the local production build with the **real** handlers (`forgeCmsHandlers`/`craftingCmsHandlers`) over MemSupabase. Result: **56/56**.

At each width:
- the existing config loads (version 1);
- the 14 content items show as **DRAFT**, 0 ACTIVE, pity disabled;
- the policy is explained;
- **invalid JSON** and non-object JSON block saving, and nothing reaches the server;
- validation errors are readable (path + reason) and nothing is written;
- a **regressive** change shows the real impact ("1 de 1 jugadores");
- recalculating stays disabled without RECALCULAR and the reason; once confirmed: version 2, audited as a recalc;
- a monotonic change saves on its own (version 3);
- **nothing published**;
- **no secrets** in the HTML;
- no horizontal scroll;
- keyboard navigation works.

Non-admin user:
- the page shows "Acceso restringido";
- the API returns **401 identical to anonymous** (no oracle);
- nothing is written.

Also checked:
- **Salvage UI** (`_f79-1-salvage-qa.ts`): **18/18** at all 3 widths.
- **F79 player UI QA:** **108/108** at all 3 widths with the guarded RPCs.

## AW. FULL TEST SUITE
**5693/5693**, 0 failures (`npm test`). Added:
- `protection.test.ts` (3);
- `policy.test.ts` (4);
- `f79-1.protection.service.test.ts` (9);
- an updated F14 contract test;
- the ops test for the 0061 head.

No existing coverage was removed. Pinned assertions were updated to the new contract:
- the guarded RPC names;
- 0061 marked as applied.

## AX. TYPES · AY. LINT · AZ. BUILD
- `tsc --noEmit`: **0**.
- ESLint on everything touched: **0**.
- `next build`: **OK**. Its only warning is the pre-existing F67 one (`process.exit` in instrumentation).
- Local `production:check`: **17 PASS · 0 WARN · 0 FAIL** (migrations: last file 0061 = expected head).

## BA. F77/F77-S1 · BB. SPORTCOACH · BC. F78
**Not touched.** No auth or SMTP configuration changed, no emails sent, no Resend, no keys rotated. The anon key was only read, in order to run the public smoke (it is public). Nothing in SportCoach. F78 off-site still not configured.

## BD. MARKETPLACE · BE. PAYMENTS
`GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false`. Unchanged.

## BF. COMMIT/PUSH — **NO**
## BG. PRODUCTION CODE DEPLOYED — **NO**
Active release: `drl-0.1.1-1-99bda6f0-f77s1` (same as before).

## BH. REMAINING DEBT
1. **Deploy F79/F79.1** (needs your GO). On deploy:
   - `/api/ready` will report 0061 by real state;
   - exchange and salvage start rejecting unconfirmed favorites/showcase copies (a behaviour change, by design);
   - salvage stops touching copies in decks.
2. Concurrency was proven on a real copy at the **RPC level**. The full Node service → PostgREST path against real Postgres will be exercised by the post-deploy E2E.
3. The ranked queue was not exercised with writes in this gate (read only).
4. `backup-drlcards.sh` default head → 0061 **in the repo**. The VPS copy, if it is used by cron, still writes `expectedMigrationHead: 0060` in the manifest. That field is informational; I did not touch VPS configuration.
5. **Pre-existing, not fixed:**
   - showcase/deck writes validate in Node before their RPC (showcase in the DB);
   - a deck saved at the same instant as a craft can reference a consumed copy (it already could before F79).
6. Everything in F79 BA that wasn't closed here: an admin form instead of JSON, analytics for pack crafts, daily objectives expiring.
7. QA accounts in production:
   - C spent 8,995 QA credits on packs, plus the exchange and salvage done in this gate;
   - the F77 accounts are still there, as before.

## BI. F79.1 RELEASE GATE GO/NO-GO

**F79.1 RELEASE GATE = GO**
**F79 CODE DEPLOYMENT = WAITING FOR USER AUTHORIZATION**
