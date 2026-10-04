# Balatro Copilot

A small MCP middleware and Codex plugin for playing the real Steam version of Balatro. Built on [Arcadi4/balatro-agent](https://github.com/Arcadi4/balatro-agent) v0.2.4, with an unchanged native executable and a small optional Lua extension. Inspired by [Spire Copilot](https://github.com/FengJPC/spire-copilot).

三个入口：`get_state` 读取紧凑局面，`act` 执行动作并回读，`inspect` 按需读取详细信息。保留卡牌 ID、左右顺序、修饰效果、Boss 限制和合法操作；减少重复工具说明和结果包装。不包含策略引擎或自动动作重试。

## Requirements

Windows x64, Node.js 20+, Steam Balatro, Lovely and Steamodded. No npm dependencies or additional model API key are needed. This package pins the Balatro Agent v0.2.4 release tested against Balatro 1.0.1o-FULL.

## Install

Clone and prepare the runtime before installing the plugin:

```powershell
git clone https://github.com/FengJPC/balatro-copilot.git
cd balatro-copilot
powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
npm test
node scripts\check.mjs
codex plugin marketplace add . --json
codex plugin add balatro-agent@balatro-local --json
```

The plugin keeps its original `balatro-agent` identifier for existing installations; its display name is **Balatro Copilot**. Bootstrap downloads the fixed native executable and Mod, verifies archive SHA-256 hashes, and writes local provenance. These downloads are excluded from Git. Install from the prepared local folder: adding the remote marketplace directly does not run bootstrap or include the downloaded binary.

Refresh or restart Codex and start a new chat to load the updated MCP tools. Launch modded Balatro, then ask: “使用 Balatro Copilot 查看我的小丑牌局面。”

### Game dependencies

Lovely must be installed in the game folder, and Steamodded plus Balatro Agent in `%AppData%\Balatro\Mods`. With the game closed, the optional installer adds missing dependencies:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-game.ps1 -GameDirectory "C:\path\to\Balatro"
```

The installer pins Lovely v0.10.0 (`winmm.dll`), Steamodded 26.1002.0 and Balatro Agent v0.2.4. It refuses to overwrite existing dependencies. Game setup receipts and user saves are not included in this repository.

### Updating an existing game Mod to 0.4.0

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-extension.ps1
```

This adds `copilot-extension.lua` and one loader hook to the installed Balatro Agent Mod. The installer verifies the original v0.2.4 `main.lua` checksum, preserves it as `main.lua.copilot-original`, refuses unknown modifications and can be run again. `-CheckOnly` validates without writing; `-ModDirectory` selects a different Mod installation. New `install-game.ps1` installations include the extension automatically. Restart **Balatro and Codex** to load both parts. The installer does not close the game or edit saves. Keep the original backup and the upstream license when redistributing a patched Mod.

## MCP interface

| Tool | Purpose |
| --- | --- |
| `get_state` | Full compact snapshot with `instance_index`, `phase`, `view`, `hand_levels`, `state_id`; includes current shop, booster or blind choices and actual hand levels/base chips/mult. |
| `act` | One action against the supplied `state_id`; returns a receipt and fresh state, with explicit references for unchanged sections. |
| `inspect` | On-demand sections, individual action schemas and Wiki lookup. |

Example calls:

```json
{"name":"get_state","arguments":{}}
{"name":"act","arguments":{"action":"play_hand","state_id":"<from latest snapshot>","args":{"card_ids":[239,213,226]}}}
{"name":"act","arguments":{"action":"buy_card","state_id":"<from latest snapshot>","args":{"card_id":264}}}
{"name":"inspect","arguments":{"section":"tools","action":"buy_consumable"}}
```

Actions keep the upstream names without the `balatro_` prefix. Arguments remain upstream-compatible, except `play_hand` and `discard_hand` explicitly require 1-5 distinct `card_ids`; the middleware selects these cards and then executes once. This is a sequence, not a transaction or a guarantee against manual input or another MCP client. The upstream game bridge still validates IDs, resources and phase legality.

`get_state` always returns the complete compact view. Successful `act` replies can omit unchanged Joker and hand-level sections: `state.delta = {base_state_id: "...", unchanged: ["jokers", "hand_levels"]}` explicitly refers to the previous delivered state. Retain those facts; omission does not mean empty slots or level zero. Changed descriptions, ordering, IDs and hand levels are sent in full. Unknown bases and failed actions return full state. Read `get_state` to resynchronize. The fingerprint is computed from the full internal snapshot, including omitted facts; action validation and readback use that full snapshot. This reduces repeated text without hiding changed scoring facts.

The middleware serializes requests within one server, checks current state before acting and refuses stale `state_id`. Manual input or another MCP client can still intervene. It does not guarantee a final score before playing.

Version 0.3.1 waits for the actual `cash_out` legal action during round evaluation, rather than treating the phase name alone as ready. A bounded wait that expires returns state unavailable; it never repeats the accepted action. Hand levels, base chips/mult and play counts are included in the fingerprint, so a level-only change also invalidates an old scoring snapshot.

An uncertain action is never resent automatically. `action_may_have_executed: true` requires examining fresh state. A successful receipt with `state_unavailable` still means the action was accepted; read again before proceeding, do not repeat the action.

Version 0.3.2 bounds ordinary native action acknowledgements to 8 seconds, scoring acknowledgements to 50 seconds, and each complete snapshot to 5 seconds. Some upstream v0.2.4 event-queue completion checks can keep waiting after the visible effect has finished. On acknowledgement timeout, the middleware reads stable state and checks action-specific evidence: the intended blind started, the purchased card entered its slot, a pack opened, a Tarot changed its targets, a discard consumed one discard and dealt replacement cards, or the round reward reached the shop. This returns `ok: true, completion: "observed"` with a `source: "state_readback"` receipt, explicitly distinct from a native acknowledgement. It does not resend the action or invent a scoring receipt. A changed fingerprint or money movement alone is insufficient. Unsupported or ambiguous outcomes remain uncertain. Manual input or another client can still interfere with observed evidence.

Version 0.3.3 waits for `cash_out` and at least 600 ms of stable reward information, without waiting for the finished blind to disappear: a victory dialog can retain that blind indefinitely. Further animations or external input can still invalidate a snapshot. Reorder actions require `args.order`; malformed orders are rejected before sending. Native JSON-RPC Invalid params errors are reported as validation failures, rather than uncertain gameplay.

Version 0.4.0's optional game extension exposes `ui` in snapshots and through `inspect(section: "ui")`. Reward readiness uses the actual visible cash-out button, with a bounded 15-second round-evaluation wait. A victory overlay is readable without waiting for cash-out. `continue_endless` (no arguments) calls the game's existing Endless callback only on the actual victory dialog and observes its closure. Other overlays block gameplay. `continue_game` still loads a saved run from the main menu; the Ante-derived `Endless Mode` field is not evidence that Endless was chosen.

When a pack is open, `sell_card` with an owned Joker's `card_id` uses the extension and the game's own sale checks. This permits making room in a full Buffoon pack. Selling and selecting the replacement are separate actions: inspect the offered card first, sell, then use fresh state to select it. Eternal and face-down Jokers cannot be sold through this extension. The original executable remains unchanged.

Without the matching extension, ordinary upstream actions remain available; `ui.available: false` identifies the limitation. Endless and pack sales are refused before sending. Legacy reward readiness falls back to legal cash-out plus 1.5 seconds of stable reward text and cannot establish overlay visibility. The extension connects only when exactly one fresh local registry record and one upstream game are present; with multiple games, it refuses to guess which pipe belongs to an index.

Multiple games require an explicit, current **0-based** `instance_index`; `inspect(section: "instances")` lists them. Upstream resources and handbook prompts remain available. Wiki search uses `inspect(section: "wiki", query: "...")`; an article uses `title`.

## Validation and measurement

```powershell
npm test
node scripts\check.mjs --live
node scripts\benchmark.mjs --live
# Optional developer check: install lupa for your Python, then:
python scripts\extension.test.py
```

The live check and benchmark only read game state. Benchmark reports JSON character counts, not billed token savings. The full snapshot may contain more information than a bare upstream turn because it includes current shop/pack/blind choices. See [VALIDATION.md](VALIDATION.md) for tested scope and limitations.

## Layout and licensing

- `scripts/copilot.mjs`: compact views, instance selection, action sequencing and readback.
- `scripts/upstream.mjs`: JSON-RPC transport to the original executable.
- `scripts/bridge.mjs`, `bridge/copilot-extension.lua`: optional local game UI protocol and guarded callbacks.
- `scripts/install-extension.ps1`: checksum-checked, backed-up extension installation.
- `scripts/server.mjs`: stdio MCP entrypoint, with three tools and upstream resource compatibility.
- `upstream-lock.json`: fixed release URLs, source commit and archive checksums.
- `licenses/balatro-agent-MIT.txt`: full upstream MIT license, Copyright (c) 2026 4rcadia.
- [LICENSE](LICENSE): MIT license for local middleware, Copyright (c) 2026 FengJ.
- [NOTICE.md](NOTICE.md): provenance and attribution. Balatro, Lovely and Steamodded have separate licenses; their game assets and source are not committed here.

MIT requires retaining the original copyright notice and license text when redistributing covered code. A thank-you sentence alone does not replace them.
