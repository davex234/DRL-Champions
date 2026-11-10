# F79.3 — QA cleanup (deck reference)

2026-10-02. Only the cleanup that was asked for. No code change, no deploy, no migration, no commit/push.

**A. QA account** — `40a1e10d-c1d3-4c38-9114-3d021ddb119e` (QA "C": `@example.invalid` email, not an admin).

**B. Damaged deck** — "Mi primer equipo" (`e7a40076-85ae-4e1f-a32e-c75b634e133e`), 10 copies. Position 4 pointed to `ebab0564-5511-46d0-8172-864f85aea4c1`, which no longer existed.

**C. Root cause confirmed** — the F79.1 QA salvage on the old app.
- The pre-0061 backup (08:09Z) has `ebab0564` = `artzin__base` owned by C, and the deck contains it.
- C received a second copy `9210e759` at 08:22:36Z (`pack:open:…f791-…`).
- 3 s later, the F79.1 salvage on the **old** app (`salvage:…f791-muqp3mnq`, 08:22:39Z, 1 copy) kept the lowest uid and destroyed the deck copy. That is the deck bug F79.1 fixed.
- It was the only broken reference in production.

**D. State before**
- 1 broken reference (position 4).
- C still owned `9210e759` (`artzin__base`, unlocked, in no deck).
- Credits 235.

**E. Repair method** — The normal application mechanism: `POST /api/game/duels { action: "save_composition", id, name, cardUids, baseVersion }` with the QA session. Same name and order; position 4 points to **C's own copy of the same card** (`9210e759`).

The server's canonical validator (ownership, composition, optimistic version) accepted it: 200. Nothing was fabricated, granted or forced. Instrument: `scripts/_f79-3-deck-repair.ts`.

The first attempt sent `expectedVersion` (the field name is `baseVersion`) and got a 400 with nothing written.

**F. State after**
- 10 copies, 10 distinct, 0 broken references.
- The API reports the deck `valid: true`.
- `updated_at` 09:19:23Z.

**G. Inventory consistency** — All 10 deck uids exist, belong to C and are unlocked. C has 99 copies. No ledger entry during the repair (0 `economy_ops`).

**H. Broken QA deck references remaining** — 0.

**I. Broken real-user deck references** — 0. Across the whole production DB: 0.

**J. Protected-card invariant** — On the repaired deck copy (`9210e759`):
- salvage → 409, and it doesn't appear in the salvage preview (neither salvageable nor "protected confirmable");
- the Forge attempt returned 400 `WRONG_COUNT` because C doesn't have 6 other usable copies, so it doesn't prove protection. That path was already proven in F79.2 (test I: `NOT_ELIGIBLE`), plus `IN_DECK` in the DB (0061).

**K. Credits changed** — NO (235 before and after). The credits QA spent on legitimate tests were not refilled.

**L. Production code changed** — NO. Only two local instruments were added: `scripts/_f79-3-deck-repair.ts` and `_f79-3-verify.ts`.

**M. Deployment** — NO.

**N. Commit/push** — NO.

**O. Final result** — **F79 QA CLEANUP = GO**
