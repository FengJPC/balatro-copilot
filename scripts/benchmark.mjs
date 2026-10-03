// Read-only character measurements, not a token billing estimate.
import { fileURLToPath } from 'node:url';
import { Upstream } from './upstream.mjs';
import { Copilot, TOOLS, compact } from './copilot.mjs';

const upstream = new Upstream(fileURLToPath(new URL('../bin/balatro-mcp.exe', import.meta.url)));
try {
  const copilot = new Copilot(upstream);
  await copilot.initialize();
  const before = JSON.stringify({ tools: copilot.catalog }).length;
  const after = JSON.stringify({ tools: TOOLS }).length;
  const result = { metric: 'JSON characters, not tokens', upstream_tools: copilot.catalog.length,
    copilot_tools: TOOLS.length, tool_catalog: { before, after, reduction_percent: +(100 * (1 - after / before)).toFixed(1) } };
  if (process.argv.includes('--live')) {
    const state = await copilot.invoke('get_state');
    if (!['MENU', 'SPLASH'].includes(state.phase)) {
      const original = await copilot.read(`balatro://instances/${state.instance_index}/turn`);
      result.turn_format = { before: original.length, after: compact(original).length,
        reduction_percent: +(100 * (1 - compact(original).length / original.length)).toFixed(1) };
      result.complete_decision_surface_chars = JSON.stringify(state).length;
      result.phase = state.phase;
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally { await upstream.close(); }
