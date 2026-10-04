import test from 'node:test';
import assert from 'node:assert/strict';
import { Copilot } from './copilot.mjs';

function game({ phase = 'SHOP', overlay = 'none', extension = true, indices = [0], pendingCash = 0 } = {}) {
  let money = 29, joker = 'Spare Trousers +64 mult', level = 13, statusReads = 0;
  const native = [], custom = [];
  const upstream = { async rpc(method, params) {
    assert.equal(method, 'resources/read');
    if (params.uri === 'balatro://instances') return { contents: [{ text: indices.map(i => `balatro://instances/${i}/turn`).join('\n') }] };
    if (params.uri.endsWith('/run')) return { contents: [{ text: `## Hand Levels\n- Two Pair: Lv.${level} — 260 chips × 14 mult — played 32x` }] };
    if (params.uri.endsWith('/turn')) return { contents: [{ text: `**Phase:** ${phase}\n**Money:** $${money}\n**Blind:** Final Boss\n## Legal Actions\n- \`cash_out\`\n- \`reroll_shop\`\n## Jokers (1/5)\n- [264] ${joker}\n## Consumables (0/2)\n(empty)` }] };
    return { contents: [{ text: '## Booster\n- [356] Odd Todd' }] };
  } };
  const bridge = { async status() {
    statusReads++;
    if (!extension) return { available: false, error_code: 'BRIDGE_EXTENSION_REQUIRED' };
    return { available: true, version: '0.4.0', phase, overlay, pack_open: /PACK|BOOSTER/.test(phase), cash_out_ready: statusReads > pendingCash };
  }, async rpc(method, args) {
    custom.push({ method, args });
    if (method === 'copilot_continue_endless') overlay = 'none';
    if (method === 'copilot_sell_card_in_pack') joker = '(empty)';
    return { ok: true, data: { accepted: true } };
  } };
  const copilot = new Copilot(upstream, { bridge });
  copilot.call = async (name, args) => { native.push({ name, args }); money--; return { ok: true }; };
  return { copilot, bridge, native, custom, reads: () => statusReads, setJoker: text => { joker = text; }, setLevel: n => { level = n; } };
}

test('Round read waits for actual extension button despite legal cash_out and retained blind', async () => {
  const g = game({ phase: 'ROUND_EVAL', pendingCash: 4 });
  const state = await g.copilot.invoke('get_state');
  assert.equal(g.reads(), 5);
  assert.equal(state.ui.cash_out_ready, true);
  assert.match(state.view, /Final Boss/);
  assert.equal(g.native.length, 0);
});
test('Victory state is readable and blocks cash_out; Endless uses one extension action', async () => {
  const g = game({ phase: 'ROUND_EVAL', overlay: 'victory' });
  let state = await g.copilot.invoke('get_state');
  assert.match(state.view, /Actions: continue_endless/);
  const blocked = await g.copilot.invoke('act', { state_id: state.state_id, action: 'cash_out' });
  assert.equal(blocked.error_code, 'UI_BLOCKED');
  assert.equal(blocked.action_may_have_executed, false);
  const result = await g.copilot.invoke('act', { state_id: state.state_id, action: 'continue_endless' });
  assert.equal(result.ok, true);
  assert.equal(result.state.ui.overlay, 'none');
  assert.deepEqual(g.custom, [{ method: 'copilot_continue_endless', args: {} }]);
  assert.equal(g.native.length, 0);
});
test('Unrelated overlay cannot trigger Endless', async () => {
  const g = game({ phase: 'ROUND_EVAL', overlay: 'other' });
  const state = await g.copilot.invoke('get_state');
  const result = await g.copilot.invoke('act', { state_id: state.state_id, action: 'continue_endless' });
  assert.equal(result.error_code, 'INVALID_ARGUMENT');
  assert.equal(g.custom.length, 0);
});
test('Pack sale routes to extension and preserves a changed Joker block', async () => {
  const g = game({ phase: 'SMODS_BOOSTER_OPENED' });
  const state = await g.copilot.invoke('get_state');
  assert.match(state.view, /Actions:.*sell_card/);
  const result = await g.copilot.invoke('act', { state_id: state.state_id, action: 'sell_card', args: { card_id: 264 } });
  assert.equal(result.ok, true);
  assert.deepEqual(g.custom, [{ method: 'copilot_sell_card_in_pack', args: { card_id: 264 } }]);
  assert.match(result.state.view, /Jokers \(1\/5\)\n\[264\] \(empty\)/);
  assert.ok(!result.state.delta.unchanged.includes('jokers'));
  assert.equal(g.native.length, 0);
});
test('Missing extension and ambiguous game identity block extension actions before sending', async () => {
  for (const options of [{ extension: false }, { indices: [0, 1] }]) {
    const g = game({ phase: 'SMODS_BOOSTER_OPENED', ...options });
    const state = await g.copilot.invoke('get_state', { instance_index: 0 });
    const result = await g.copilot.invoke('act', { instance_index: 0, state_id: state.state_id, action: 'sell_card', args: { card_id: 264 } });
    assert.equal(result.error_code, 'BRIDGE_EXTENSION_REQUIRED');
    assert.equal(result.action_may_have_executed, false);
    assert.equal(g.custom.length + g.native.length, 0);
  }
});
test('Rejected custom action reports no execution; settlement timeout never retries', async () => {
  for (const rejected of [true, false]) {
    const g = game({ phase: 'SMODS_BOOSTER_OPENED' });
    let sent = 0;
    g.bridge.rpc = async () => { sent++; throw Object.assign(new Error('sale failed'), { code: rejected ? 'CANNOT_SELL' : 'ACTION_UNCERTAIN', action_rejected: rejected, request_sent: true }); };
    const state = await g.copilot.invoke('get_state');
    const result = await g.copilot.invoke('act', { state_id: state.state_id, action: 'sell_card', args: { card_id: 264 } });
    assert.equal(result.action_may_have_executed, !rejected);
    assert.equal(sent, 1);
    assert.equal(g.native.length, 0);
  }
});
test('Delta chains explicitly refer to full canonical state; get_state restores omitted facts', async () => {
  const g = game();
  let state = await g.copilot.invoke('get_state');
  const first = state;
  const fullChars = JSON.stringify(state).length;
  for (let i = 0; i < 3; i++) {
    const next = (await g.copilot.invoke('act', { state_id: state.state_id, action: 'reroll_shop' })).state;
    assert.deepEqual(next.delta, { base_state_id: state.state_id, unchanged: ['jokers', 'hand_levels'] });
    assert.equal(next.hand_levels, undefined);
    assert.doesNotMatch(next.view, /Spare Trousers/);
    assert.notEqual(next.state_id, state.state_id);
    state = next;
  }
  const restored = await g.copilot.invoke('get_state');
  assert.equal(restored.delta, undefined);
  assert.equal(restored.hand_levels, first.hand_levels);
  assert.match(restored.view, /Spare Trousers/);
  assert.equal(restored.state_id, state.state_id);
  assert.ok(fullChars > JSON.stringify(state).length);
});
test('Unknown delta base and failed actions always return full context', async () => {
  const g = game();
  const state = await g.copilot.snapshot(await g.copilot.resolve()); // never delivered
  const result = await g.copilot.invoke('act', { state_id: state.state_id, action: 'reroll_shop' });
  assert.equal(result.state.delta, undefined);
  assert.ok(result.state.hand_levels);
  const stale = await g.copilot.invoke('act', { state_id: state.state_id, action: 'reroll_shop' });
  assert.equal(stale.error_code, 'STALE_STATE');
  assert.equal(stale.state.delta, undefined);
  assert.match(stale.state.view, /Spare Trousers/);
});
test('Changed Joker effects and hand levels invalidate state and remain visible after actions', async () => {
  const g = game();
  const state = await g.copilot.invoke('get_state');
  g.setJoker('Spare Trousers +66 mult'); g.setLevel(14);
  const stale = await g.copilot.invoke('act', { state_id: state.state_id, action: 'reroll_shop' });
  assert.equal(stale.error_code, 'STALE_STATE');
  assert.equal(g.native.length, 0);
  // Compare with the previously delivered full state while the action changes effects.
  const base = await g.copilot.invoke('get_state');
  g.copilot.call = async () => { g.setJoker('Spare Trousers +68 mult'); g.setLevel(15); return { ok: true }; };
  const result = await g.copilot.invoke('act', { state_id: base.state_id, action: 'reroll_shop' });
  assert.equal(result.state.delta, undefined);
  assert.match(result.state.view, /\+68 mult/);
  assert.match(result.state.hand_levels, /Lv.15/);
});
