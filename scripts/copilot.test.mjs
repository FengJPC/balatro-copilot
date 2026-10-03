import test from 'node:test';
import assert from 'node:assert/strict';
import { Copilot, compact, TOOLS, handLevels } from './copilot.mjs';

const turn = phase => `# Turn\n\n**Phase:** ${phase}  \n**Ante:** 1\n**Money:** $4\n\n## Legal Actions\n\n- \`select_hand_cards\`\n- \`restart\`\n\n## Hand (left to right)\n\n- [1] A♥\n- [2] A♠ (Debuffed)\n\n## Jokers (1/5)\n\n1. [9] Abstract Joker\n   每有一张小丑牌 +3倍率\n\n## Consumables (0/2)\n\n(empty)\n`;
function setup({ phase = 'SELECTING_HAND', indices = [0], failSelect = false, failAction = false, failPost = false, pendingEvalReads = 0 } = {}) {
  const mutations = [];
  let played = false;
  let handLevel = 3;
  const upstream = { notify() {}, async rpc(method, params) {
    if (method === 'initialize') return { protocolVersion: '2025-06-18' };
    if (method === 'tools/list') return { tools: [
      { name: 'balatro_play_hand', inputSchema: { type: 'object', properties: { instance_index: { type: 'integer', description: 'long' } } } },
    ] };
    if (method === 'resources/read') {
      if (params.uri === 'balatro://instances') return { contents: [{ text: indices.map(i => `- **${i}** — balatro://instances/${i}/turn`).join('\n') }] };
      if (played && failPost) throw new Error('post-read unavailable');
      if (params.uri.endsWith('/run')) return { contents: [{ text: `# Run\n\n## Hand Levels\n\n- Two Pair: Lv.${handLevel} — 60 chips × 4 mult — played 2x\n\n## Discard Pile (0)\n` }] };
      if (params.uri.endsWith('/turn')) {
        if (phase === 'MENU') throw Object.assign(new Error('Outside a run'), { data: { error_code: 'UNAVAILABLE' } });
        let snapshot = turn(played ? 'ROUND_EVAL' : phase);
        if (played && pendingEvalReads-- <= 0) snapshot = snapshot.replace('`select_hand_cards`', '`cash_out`');
        return { contents: [{ text: snapshot }] };
      }
      return { contents: [{ text: '# Detail\n\n- [44] Planet $3\n  升级同花 +2倍率\n' }] };
    }
    if (method === 'tools/call') {
      if (params.name === 'connect') return { structuredContent: { ok: true, phase } };
      mutations.push(params);
      if (params.name === 'balatro_select_hand_cards' && failSelect) return { isError: true, structuredContent: { ok: false, error_code: 'CARD_NOT_FOUND', message: 'No card.' } };
      if (params.name === 'balatro_play_hand') {
        played = true;
        if (failAction) throw Object.assign(new Error('Lost receipt'), { code: 'UPSTREAM_TIMEOUT' });
      }
      return { structuredContent: { ok: true, data: { score: 792 } } };
    }
    throw new Error(`Unexpected method: ${method}`);
  } };
  return { copilot: new Copilot(upstream), mutations, setHandLevel: level => { handLevel = level; } };
}

test('Exactly three tool entrypoints', () => assert.deepEqual(TOOLS.map(t => t.name), ['get_state', 'act', 'inspect']));
test('Compression preserves IDs, ordering, hidden/debuff flags and effect text', () => {
  const view = compact(turn('SELECTING_HAND'));
  assert.match(view, /\[1\] A♥\n\[2\] A♠ \(Debuffed\)/);
  assert.match(view, /每有一张小丑牌 \+3倍率/);
  assert.match(view, /Actions: select_hand_cards restart/);
  assert.ok(view.length < turn('SELECTING_HAND').length);
});
for (const phase of ['SHOP', 'BLIND_SELECT', 'SMODS_BOOSTER_OPENED', 'TAROT_PACK']) {
  test(`${phase} includes its next decision surface`, async () => {
    const { copilot } = setup({ phase });
    const state = await copilot.invoke('get_state');
    assert.equal(state.phase, phase);
    assert.match(state.view, /\[44\] Planet \$3/);
  });
}
test('MENU can be read without starting a run', async () => {
  const { copilot, mutations } = setup({ phase: 'MENU' });
  assert.equal((await copilot.invoke('get_state')).phase, 'MENU');
  assert.equal(mutations.length, 0);
});
test('Missing and ambiguous instances never mutate', async () => {
  for (const [indices, code] of [[[], 'GAME_NOT_RUNNING'], [[0, 1], 'INSTANCE_SELECTION_REQUIRED']]) {
    const { copilot, mutations } = setup({ indices });
    await assert.rejects(copilot.invoke('get_state'), error => error.code === code);
    assert.equal(mutations.length, 0);
  }
});
test('Stale state rejects without selecting or playing', async () => {
  const { copilot, mutations } = setup();
  const result = await copilot.invoke('act', { action: 'play_hand', state_id: '0000000000000000', args: { card_ids: [1] } });
  assert.equal(result.error_code, 'STALE_STATE');
  assert.ok(result.state.state_id);
  assert.equal(mutations.length, 0);
});
test('Combined play selects once, plays once and returns the next phase', async () => {
  const { copilot, mutations } = setup();
  const state = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'play_hand', state_id: state.state_id, args: { card_ids: [1, 2] } });
  assert.equal(result.ok, true);
  assert.equal(result.state.phase, 'ROUND_EVAL');
  assert.deepEqual(mutations.map(m => m.name), ['balatro_select_hand_cards', 'balatro_play_hand']);
  assert.deepEqual(mutations[0].arguments.card_ids, [1, 2]);
  assert.deepEqual(mutations[1].arguments, { instance_index: 0 });
});
test('Invalid or duplicate selections never play', async () => {
  for (const card_ids of [undefined, [], [1, '1'], [1, 2, 3, 4, 5, 6]]) {
    const { copilot, mutations } = setup();
    const state = await copilot.invoke('get_state');
    assert.equal((await copilot.invoke('act', { action: 'play_hand', state_id: state.state_id, args: { card_ids } })).error_code, 'INVALID_ARGUMENT');
    assert.equal(mutations.length, 0);
  }
});
test('Selection rejection prevents the play stage', async () => {
  const { copilot, mutations } = setup({ failSelect: true });
  const state = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'play_hand', state_id: state.state_id, args: { card_ids: [1] } });
  assert.equal(result.error_code, 'CARD_NOT_FOUND');
  assert.equal(result.action_may_have_executed, false);
  assert.equal(mutations.length, 1);
});
test('Lost play receipt is never retried and fresh state is returned', async () => {
  const { copilot, mutations } = setup({ failAction: true });
  const state = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'play_hand', state_id: state.state_id, args: { card_ids: [1] } });
  assert.equal(result.error_code, 'UPSTREAM_TIMEOUT');
  assert.equal(result.action_may_have_executed, true);
  assert.equal(result.state.phase, 'ROUND_EVAL');
  assert.equal(mutations.filter(m => m.name === 'balatro_play_hand').length, 1);
});
test('Post-read failure preserves a successful action receipt', async () => {
  const { copilot, mutations } = setup({ failPost: true });
  const state = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'play_hand', state_id: state.state_id, args: { card_ids: [1] } });
  assert.equal(result.ok, true);
  assert.match(result.state_unavailable, /unavailable/);
  assert.equal(mutations.length, 2);
});
test('On-demand action schemas omit boilerplate and expose combined selection', async () => {
  const { copilot } = setup();
  await copilot.initialize();
  const schema = (await copilot.invoke('inspect', { section: 'tools', action: 'play_hand' }))[0].inputSchema;
  assert.equal(schema.properties.instance_index, undefined);
  assert.deepEqual(schema.required, ['card_ids']);
});
test('Hand levels retain base chips, multiplier and play counts', () => {
  assert.equal(handLevels('## Hand Levels\n\n- Two Pair: Lv.3 — 60 chips × 4 mult — played 2x\n\n## Discard Pile'), 'Two Pair: Lv.3 60×4 — played 2x');
});
test('Round evaluation waits until cash_out is actually available', async () => {
  const { copilot } = setup({ pendingEvalReads: 2 });
  const state = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'play_hand', state_id: state.state_id, args: { card_ids: [1] } });
  assert.equal(result.ok, true);
  assert.match(result.state.view, /Actions: cash_out/);
  assert.match(result.state.hand_levels, /Lv.3 60×4/);
});
test('A hand-level-only change invalidates the old scoring snapshot', async () => {
  const { copilot, mutations, setHandLevel } = setup();
  const state = await copilot.invoke('get_state');
  setHandLevel(4);
  const result = await copilot.invoke('act', { action: 'play_hand', state_id: state.state_id, args: { card_ids: [1] } });
  assert.equal(result.error_code, 'STALE_STATE');
  assert.equal(mutations.length, 0);
});

test('Cash-out readiness waits for stable reward dollars, not just the legal action', async () => {
  const { copilot, mutations } = setup();
  const originalRead = copilot.read.bind(copilot);
  let frames = 0;
  copilot.read = async (uri, deadline) => {
    if (!uri.endsWith('/turn')) return originalRead(uri, deadline);
    frames++;
    return turn('ROUND_EVAL').replace('`select_hand_cards`', '`cash_out`')
      .replace('## Legal Actions', `${frames < 3 ? '**Blind:** Big Blind\n' : ''}**Round Dollars:** ${frames < 5 ? 13 : 10}\n\n## Legal Actions`);
  };
  const result = await copilot.invoke('get_state');
  assert.doesNotMatch(result.view, /Blind: Big Blind/);
  assert.match(result.view, /Round Dollars: 10/);
  assert.ok(frames > 5);
  assert.equal(mutations.length, 0);
});

test('A victory screen retaining the finished blind stays readable without gameplay', async () => {
  const { copilot, mutations } = setup();
  const originalRead = copilot.read.bind(copilot);
  copilot.read = async (uri, deadline) => uri.endsWith('/turn')
    ? turn('ROUND_EVAL').replace('**Ante:** 1', '**Ante:** 9')
      .replace('`select_hand_cards`', '`cash_out`')
      .replace('## Legal Actions', '**Blind:** Amber Acorn — 330960 / 100000 chips\n**Round Dollars:** 14\n\n## Legal Actions')
    : originalRead(uri, deadline);
  const state = await copilot.invoke('get_state');
  assert.equal(state.phase, 'ROUND_EVAL');
  assert.match(state.view, /Amber Acorn/);
  assert.ok(state.state_id);
  const again = await copilot.invoke('get_state');
  assert.equal(again.state_id, state.state_id);
  const rejected = await copilot.invoke('act', { action: 'continue_game', state_id: state.state_id });
  assert.equal(rejected.action_may_have_executed, false);
  assert.match(rejected.message, /Endless/);
  assert.equal(mutations.length, 0);
});

test('Reorder preflight refuses incorrect fields, invalid IDs and duplicates without sending', async () => {
  const { copilot, mutations } = setup();
  const state = await copilot.invoke('get_state');
  for (const action of ['reorder_hand', 'reorder_jokers']) {
    for (const args of [{ card_ids: [1, 2] }, {}, { order: '1,2' }, { order: [1, '1'] },
      { order: [''] }, { order: [1.5] }, { order: [Number.MAX_SAFE_INTEGER + 1] },
      { order: Array.from({length: 51}, (_, i) => i) }, { order: [1], extra: true }]) {
      const result = await copilot.invoke('act', { action, state_id: state.state_id, args });
      assert.equal(result.error_code, 'INVALID_ARGUMENT');
      assert.equal(result.action_may_have_executed, false);
      assert.equal(result.state.state_id, state.state_id);
    }
  }
  assert.equal(mutations.length, 0);
});

test('Reorder forwards canonical order unchanged once, including opaque string IDs', async () => {
  const { copilot, mutations } = setup();
  const state = await copilot.invoke('get_state');
  const order = ['hidden-card-abc', 2];
  const result = await copilot.invoke('act', { action: 'reorder_jokers', state_id: state.state_id, args: { order } });
  assert.equal(result.ok, true);
  assert.deepEqual(mutations, [{ name: 'balatro_reorder_jokers', arguments: { order, instance_index: 0 } }]);
});

test('Native Invalid params is reported as unsent rather than uncertain gameplay', async () => {
  const { copilot, mutations } = setup();
  const state = await copilot.invoke('get_state');
  copilot.call = async () => { throw Object.assign(new Error('Input validation error'), { code: -32602 }); };
  const result = await copilot.invoke('act', { action: 'buy_card', state_id: state.state_id, args: { incorrect: 1 } });
  assert.equal(result.error_code, 'INVALID_ARGUMENT');
  assert.equal(result.action_may_have_executed, false);
  assert.equal(mutations.length, 0);
});

test('continue_game still loads a saved run from MENU', async () => {
  const { copilot, mutations } = setup({ phase: 'MENU' });
  const state = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'continue_game', state_id: state.state_id });
  assert.equal(result.ok, true);
  assert.deepEqual(mutations.map(m => m.name), ['balatro_continue_game']);
});
