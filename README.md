# Balatro Copilot

A small MCP middleware and Codex plugin for playing the real Steam version of Balatro. Built on the unchanged [Arcadi4/balatro-agent](https://github.com/Arcadi4/balatro-agent) v0.2.4 bridge. Inspired by [Spire Copilot](https://github.com/FengJPC/spire-copilot).

三个入口：`get_state` 读取紧凑局面，`act` 执行动作并回读，`inspect` 按需读取详细信息。保留卡牌 ID、左右顺序、修饰效果、Boss 限制和合法操作；减少重复工具说明和结果包装。不包含策略引擎或自动动作重试。

## Requirements

Windows x64, Node.js 20+, Steam Balatro, Lovely and Steamodded. No npm dependencies or additional model API key are needed. This package pins the Balatro Agent v0.2.4 release tested against Balatro 1.0.1o-FULL.

## Install

Clone and prepare the runtime before installing the plugin:

```powershell
git clone https://github.com/FengJPC/balatro-copilot.git
cd balatro-copilot
powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
node --test scripts\copilot.test.mjs
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

## MCP interface

| Tool | Purpose |
| --- | --- |
| `get_state` | Full compact snapshot with `instance_index`, `phase`, `view`, `hand_levels`, `state_id`; includes current shop, booster or blind choices and actual hand levels/base chips/mult. |
| `act` | One action against the supplied `state_id`; returns a receipt and a fresh decision surface. |
| `inspect` | On-demand sections, individual action schemas and Wiki lookup. |

Example calls:

```json
{"name":"get_state","arguments":{}}
{"name":"act","arguments":{"action":"play_hand","state_id":"<from latest snapshot>","args":{"card_ids":[239,213,226]}}}
{"name":"act","arguments":{"action":"buy_card","state_id":"<from latest snapshot>","args":{"card_id":264}}}
{"name":"inspect","arguments":{"section":"tools","action":"buy_consumable"}}
```

Actions keep the upstream names without the `balatro_` prefix. Arguments remain upstream-compatible, except `play_hand` and `discard_hand` explicitly require 1-5 distinct `card_ids`; the middleware selects these cards and then executes once. This is a sequence, not a transaction or a guarantee against manual input or another MCP client. The upstream game bridge still validates IDs, resources and phase legality.

Snapshots are complete compact views, not state diffs. The middleware serializes requests within one server, checks the current snapshot before acting and refuses a stale `state_id`. It reads current state after each action. This trades a little local IPC work for fewer model-visible round trips. It does not guarantee a final score before playing.

Version 0.3.1 waits for the actual `cash_out` legal action during round evaluation, rather than treating the phase name alone as ready. A bounded wait that expires returns state unavailable; it never repeats the accepted action. Hand levels, base chips/mult and play counts are included in the fingerprint, so a level-only change also invalidates an old scoring snapshot.

An uncertain action is never resent automatically. `action_may_have_executed: true` requires examining fresh state. A successful receipt with `state_unavailable` still means the action was accepted; read again before proceeding, do not repeat the action.

Multiple games require an explicit, current **0-based** `instance_index`; `inspect(section: "instances")` lists them. Upstream resources and handbook prompts remain available. Wiki search uses `inspect(section: "wiki", query: "...")`; an article uses `title`.

## Validation and measurement

```powershell
node --test scripts\copilot.test.mjs
node scripts\check.mjs --live
node scripts\benchmark.mjs --live
```

The live check and benchmark only read game state. Benchmark reports JSON character counts, not billed token savings. The full snapshot may contain more information than a bare upstream turn because it includes current shop/pack/blind choices. See [VALIDATION.md](VALIDATION.md) for tested scope and limitations.

## Layout and licensing

- `scripts/copilot.mjs`: compact views, instance selection, action sequencing and readback.
- `scripts/upstream.mjs`: JSON-RPC transport to the original executable.
- `scripts/server.mjs`: stdio MCP entrypoint, with three tools and upstream resource compatibility.
- `upstream-lock.json`: fixed release URLs, source commit and archive checksums.
- `licenses/balatro-agent-MIT.txt`: full upstream MIT license, Copyright (c) 2026 4rcadia.
- [LICENSE](LICENSE): MIT license for local middleware, Copyright (c) 2026 FengJ.
- [NOTICE.md](NOTICE.md): provenance and attribution. Balatro, Lovely and Steamodded have separate licenses; their game assets and source are not committed here.

MIT requires retaining the original copyright notice and license text when redistributing covered code. A thank-you sentence alone does not replace them.
