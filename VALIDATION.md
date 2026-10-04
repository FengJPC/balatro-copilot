# Validation

This repository adds middleware to Balatro Agent v0.2.4 and, starting in 0.4.0, an optional small Lua extension. Its native executable remains unchanged. One real run completed Ante 8; this does not establish reliability across seeds, decks or every recovery path. Sections below are version-specific historical evidence.

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

## Completed run and 0.3.3 victory handling

2026-10-04: that same Red Deck / White Stake run completed Ante 8 through 0.3.2. Amber Acorn was beaten in one hand with 330,960 chips against 100,000, and the actual victory dialog was visually observed. Two Pair reached Lv.12 (240 base chips, 13 base mult). Several ordinary action acknowledgement stalls were recovered during play without automatic resends. This is one completed run, not coverage of all decks or recovery predicates.

Attempting to enter Endless exposed two issues: the snapshot waited indefinitely for a finished blind to disappear behind the victory dialog, and incorrectly passing `card_ids` to a reorder action produced an uncertain-action report despite native argument rejection. Version 0.3.3 keeps the legal-action and 600 ms stability checks but removes the blind-disappearance requirement; reorder arguments are checked before sending, and JSON-RPC Invalid params errors explicitly report that the action did not execute. It also prevents calling `continue_game` during a run; that action only loads a save from the main menu.

All 35 unit and transport tests passed. New regressions cover a permanently retained final blind, stable repeated fingerprints on that screen, incorrect reorder fields/IDs/duplicates, canonical opaque-ID order forwarding, native parameter rejection and correct menu-only continuation. The skill frontmatter validator and Git whitespace check passed. A real packaged stdio read-only check passed with three tools, 29 resources and verified original binary hash, returning instance 0 in ROUND_EVAL, Ante 9, $18, Round Dollars 14 and Two Pair Lv.12. At the time of that live check the native turn no longer contained the old blind, so permanent-blind behavior was verified by the regression fixture, not that live read. No gameplay action was sent during this repair validation.

The native bridge does not expose victory-dialog visibility or an Endless-button command. Its `Endless Mode: true` field is derived from Ante > 8 and cannot verify a UI choice. The updated skill directs continuation through the actual game UI and fresh state readback; automatic Endless selection through MCP remains unsupported. The game Mod and native executable are unchanged.

## 0.4.0 game UI extension and explicit state references

2026-10-04: fixes for the limitations found in that run. The optional Lua extension identifies the real victory dialog, reads the actual reward cash-out button, chooses Endless through the existing UI callback and sells an owned Joker inside an open pack through the game's existing sale validation. The installer adds one loader hook and the extension file to v0.2.4, preserving the checksum-verified original. The upstream executable and downloaded base artifact remain unchanged. No Balatro game source or assets are redistributed.

Successful action replies explicitly reference unchanged Joker and hand-level facts with `state.delta.base_state_id` / `unchanged`. Full internal state still determines stale-state checks; changed effects, IDs, order and levels are sent in full. Errors and unknown bases use full state, and `get_state` resynchronizes. The feature reduces repeated state text; it is not a measured reduction in billed tokens or entire conversational context.

- All **51 Node tests** passed, including delayed reward buttons despite a legal cash-out action, retained final blinds, overlay blocking, custom action routing, ambiguous game identity, lost/rejected extension replies, correlated fragmented protocol replies and chains of state references with full resynchronization.
- All **9 LuaJIT tests** passed using the actual extension in a mocked game environment: visible victory versus options, exact cash-out readiness, callback closure, full-slot pack sales, eternal/hidden/missing targets, phase restrictions and settlement uncertainty. `lupa` is a developer-only dependency; the shipped plugin remains dependency-free.
- Installer checks verified the original backup checksum, identical repeated installation and refusal to overwrite an unknown main-file edit. Skill frontmatter and Git whitespace validation passed.
- The real stdio package check passed with exactly **3 tools**, **24 action schemas**, **20 static resources**, handbook/resource compatibility and the original executable checksum. Tool-catalog JSON is 47,020 -> 2,594 characters (**94.5%** reduction); this is character count, not billed token usage.
- Local installation verified `balatro-agent@balatro-local` 0.4.0 is installed and enabled, with all 31 tracked source files matching the cache. The installed game extension matches its source hash, the original main-file backup retains its upstream checksum, and the patched main file passes LuaJIT syntax validation with exactly one loader hook. The installed cache's real stdio package check also passed.

The attempted read-only live check found no running game instance, including when using the host registry directory. Therefore new extension actions, the reward-button gate and state-reference compression have **not yet been validated during live gameplay**. Balatro and Codex must be restarted to load the installed extension and plugin. The bridge refuses extension actions when no matching extension or unambiguous game is available; multiple-game binding remains unsupported for these new actions. Ordinary upstream actions remain usable with explicit instance selection. Animation/acknowledgement stalls still have bounded waits and never trigger automatic retries.
