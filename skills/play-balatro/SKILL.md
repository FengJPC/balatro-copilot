---
name: play-balatro
description: Inspect, discuss or play a live local Balatro run through Balatro Copilot. Use when the user asks to operate or understand their current 小丑牌 game.
---

# Play Balatro

Use `get_state`, `act` and `inspect` on `balatro_agent`. Upstream resources remain available for detailed reference. Plugin identity stays `balatro-agent` for existing installations.

## State and identity

- Call `get_state` first. Its `view` contains the turn and current shop, pack or blind choices; `state_id` identifies this decision surface. With several games, use `inspect(section: "instances")` and choose the user's intended **0-based** `instance_index`. Indices can shift when games open or close.
- Keep card IDs and left-to-right order from the view. Do not replace an ID with a display position, infer face-down cards or ignore debuffs and modifiers.
- Use `inspect(section: "tools", action: "...")` only when an action's arguments are unfamiliar. Other sections (`deck`, `run`, `hand`, etc.) provide detail on demand. This avoids loading the full upstream catalog.

## Actions and feedback

- Pass the latest `state_id` to `act`. For example: `act(action: "play_hand", state_id: "...", args: {card_ids: [239, 213, 226]})`. Play/discard select those IDs first, then execute once. They require 1-5 distinct IDs; no implicit use of an old selection. This sequence is serialized within this server, but manual input or another client can still intervene.
- Other action names drop upstream's `balatro_` prefix; arguments stay the same. Buy/sell use `card_id`; reorder uses `order`; hand-targeting consumables use `targets`; `buy_consumable` requires `use`. Booster consumables are used immediately, so pass targets to `select_booster_card`.
- Prefer the returned `state` for the next decision instead of calling `get_state` again. `STALE_STATE` sends no gameplay action and returns a fresh snapshot: decide again from it.
- Successful action replies can include `state.delta`: sections listed in `unchanged` are retained from `base_state_id`, not empty or missing game facts. Keep those Joker effects and hand levels across successive replies. Changed sections are sent in full; the new `state_id` always covers full internal facts. If that base is unavailable, call `get_state` for the complete view before deciding.
- An uncertain action is never retried automatically. `action_may_have_executed: true` requires checking the returned state or reading again. `ok: true` with `state_unavailable` means the action was accepted: read state before proceeding and do not resend it. If the outcome stays unclear, stop mutations and explain it.
- `ok: true, completion: "observed"` means the native acknowledgement timed out but stable state showed the specific effect. The receipt has `source: "state_readback"` and an evidence name; it is not a native acknowledgement or a scoring receipt. Use the returned state and do not repeat the action. A changed fingerprint alone is never enough; unsupported or ambiguous effects remain uncertain.
- `inspect(section: "wiki", query: "...")` searches; `title` reads an article. Base chips/mult are only a partial score preview before cards, jokers and blind effects.

## Victory and Endless

With the 0.4.0 game extension, snapshots include `ui` (also available from `inspect(section: "ui")`). If `ui.available` and `ui.overlay == "victory"`, authorized continuation uses `act(action: "continue_endless", state_id: "...")` with no arguments. The action calls the existing Endless button callback and observes dialog closure. Other overlays block gameplay. Round evaluation waits for the actual cash-out button; do not send `cash_out` to close a dialog. `continue_game` only loads a saved run from the main menu. The run resource's Ante-derived `Endless Mode` field does not confirm the UI choice.

If `ui.available == false`, the matching game extension is missing, not loaded or cannot be bound safely to a single game. Endless and pack sales are refused. Explain the limitation; use the actual game UI only within the user's authorization and the computer-use skill's boundaries, or let the user choose the button. Installing the extension requires restarting Balatro; updating the plugin requires restarting Codex.

## Making room inside a pack

The extension permits `sell_card` with an owned face-up Joker's `card_id` while a pack is open, including a full Buffoon pack. Inspect the replacement and explain the tradeoff before selling, then use returned fresh state to `select_booster_card`. These are two separate actions, not a transaction. The game validates sellability, including eternal Jokers. Never sell an owned Joker merely because a pack has no free slot: compare the actual offered effects first.

## Collaboration

Explain consequential choices, including the hand being played, the scoring assumptions, economy, joker ordering and Boss restrictions. Follow the user's requested scope and pause boundaries. Explicit continuous-play authorization permits ongoing blind, shop and pack decisions without routine confirmation. Inspect-only requests do not authorize starting, restarting or replacing a run. Do not unlock content or modify saves as part of play.

Save a review only when requested. Optional upstream handbook prompts and resources remain available; routine play does not require loading them.
