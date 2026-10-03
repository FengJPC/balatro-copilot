# Validation

This repository adds middleware to the unchanged Balatro Agent v0.2.4 release. It does not establish reliable full-run play.

## Before middleware

2026-10-04, real Steam Balatro 1.0.1o-FULL with Steamodded 26.1002.0: Red Deck, White Stake, completed Ante 1. Small Blind: Full House, 332 chips. Big Blind: High Card plus Straight, 710 total. The Goad: Three of a Kind, 792 chips. Left at the Ante 2 shop with $18 and five jokers. These actions used the original upstream interface, not the new middleware.

## Middleware checks

- `node --test scripts/copilot.test.mjs`: compact views preserve IDs, order, debuffs and descriptions; phase-specific surfaces are included; ambiguous instances and stale snapshots block actions; combined selection/play is sequenced; lost receipts are not retried; post-read failures preserve accepted receipts.
- `node scripts/check.mjs`: the real stdio server must expose exactly three tools; verifies plugin manifests, downloaded binary checksum, upstream resources and handbook.
- `node scripts/check.mjs --live`: read-only game discovery and compact snapshot verification. Does not send gameplay actions.
- `node scripts/benchmark.mjs --live`: compares actual tool catalog and turn formatting by JSON character count, not billed tokens. Complete snapshots can grow because they include the required shop/pack/blind surface.

Synthetic tests validate middleware control flow; live reads validate transport and current formatting. They do not substitute for a real game test of the new combined play/discard path.

2026-10-04 results: 15/15 tests passed. Real stdio check passed with exactly three tools, compatibility resources and verified binary hash. Read-only live check found instance 0 in SHOP, Ante 2, $18, five jokers. Tool catalog JSON shrank from 47,020 to 2,469 characters (94.7%); the observed turn text shrank from 604 to 514 characters (14.9%). These are character measurements, not total token savings. No gameplay actions were sent by the new middleware during this validation.

## Live middleware play and 0.3.1 follow-up

2026-10-04: real game actions through 0.3.0's three-tool interface completed Ante 2. Small Blind: Two Pair, 2,090 chips. Big Blind: Two Pair, 2,860 chips. The Wall: Three of a Kind plus Straight, 5,037 total against 3,200. Buying/selling jokers, rerolling, opening/selecting packs, consuming a generated Uranus and cashing out all succeeded. Left at the Ante 3 shop with $51; this is not full-run validation.

The returned ROUND_EVAL snapshot lacked `cash_out` on three winning hands until the reward animation finished. 0.3.1 waits for that legal action and includes actual hand levels/base chips/mult/play counts in the snapshot and its fingerprint. Tests increased to 18, including delayed round readiness and hand-level-only stale-state rejection. Repeated joker descriptions and external-client interleaving remain limitations.
