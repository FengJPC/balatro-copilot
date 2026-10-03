# Validation

This repository adds middleware to the unchanged Balatro Agent v0.2.4 release. It does not establish reliable full-run play.

## Before middleware

2026-10-04, real Steam Balatro 1.0.1o-FULL with Steamodded 26.1002.0: Red Deck, White Stake, completed Ante 1. Small Blind: Full House, 332 chips. Big Blind: High Card plus Straight, 710 total. The Goad: Three of a Kind, 792 chips. Left at the Ante 2 shop with $18 and five jokers. These actions used the original upstream interface, not the new middleware.

## Middleware checks

- `npm test`: compact views preserve IDs, order, debuffs and descriptions; phase-specific surfaces are included; ambiguous instances and stale snapshots block actions; combined selection/play is sequenced; lost receipts are not retried; post-read failures preserve accepted receipts.
- `node scripts/check.mjs`: the real stdio server must expose exactly three tools; verifies plugin manifests, downloaded binary checksum, upstream resources and handbook.
- `node scripts/check.mjs --live`: read-only game discovery and compact snapshot verification. Does not send gameplay actions.
- `node scripts/benchmark.mjs --live`: compares actual tool catalog and turn formatting by JSON character count, not billed tokens. Complete snapshots can grow because they include the required shop/pack/blind surface.

Synthetic tests validate middleware control flow; live reads validate transport and current formatting. They do not substitute for a real game test of the new combined play/discard path.

2026-10-04 results: 15/15 tests passed. Real stdio check passed with exactly three tools, compatibility resources and verified binary hash. Read-only live check found instance 0 in SHOP, Ante 2, $18, five jokers. Tool catalog JSON shrank from 47,020 to 2,469 characters (94.7%); the observed turn text shrank from 604 to 514 characters (14.9%). These are character measurements, not total token savings. No gameplay actions were sent by the new middleware during this validation.

## Live middleware play and 0.3.1 follow-up

2026-10-04: real game actions through 0.3.0's three-tool interface completed Ante 2. Small Blind: Two Pair, 2,090 chips. Big Blind: Two Pair, 2,860 chips. The Wall: Three of a Kind plus Straight, 5,037 total against 3,200. Buying/selling jokers, rerolling, opening/selecting packs, consuming a generated Uranus and cashing out all succeeded. Left at the Ante 3 shop with $51; this is not full-run validation.

The returned ROUND_EVAL snapshot lacked `cash_out` on three winning hands until the reward animation finished. 0.3.1 waits for that legal action and includes actual hand levels/base chips/mult/play counts in the snapshot and its fingerprint. Tests increased to 18, including delayed round readiness and hand-level-only stale-state rejection. Repeated joker descriptions and external-client interleaving remain limitations.

## 0.3.2 acknowledgement recovery

2026-10-04: the same live run reached the Ante 7 shop before The Hook with five jokers, Two Pair Lv.11 and $40. Ante 5's The Head scored 104,208; Ante 6's The Manacle scored 40,582; Ante 7's Big Blind scored 117,344. The run remains unfinished. During live play, several non-scoring actions took the full 65-second transport timeout although fresh state showed their completed effects. Upstream's generic settlement checks keep waiting for all new transient queued events; recurring events are a potential cause, not proven by queue instrumentation.

0.3.2 keeps the upstream Mod/executable unchanged, adds per-call acknowledgement budgets and action-specific stable-state reconciliation, and distinguishes observed completion from native receipts. Round cash-out readiness includes blind cleanup and stable reward dollars. All 30 unit and transport tests passed, covering lost acknowledgements, unrelated changes, incomplete redraws, unchanged Tarot targets, mismatched blind/pack identity, explicit rejection and late-response correlation.

Real-game fault injection: exactly one `cash_out` was sent. Its successful native acknowledgement was deliberately discarded. Stable state confirmed ROUND_EVAL -> SHOP, $28 -> $40, and the middleware returned `completion: "observed"` / `round_reward_received` in 2,447 ms with no resend. A real stdio read-only check also passed with three tools, 29 resources, verified original binary hash and correct live hand levels. This establishes real cash-out recovery, not live validation of every recovery predicate. Naturally recurring acknowledgement stalls and scoring timeouts still need further run testing; uncertain effects remain errors rather than guessed successes.
