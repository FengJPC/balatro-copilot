import test from 'node:test';
import assert from 'node:assert/strict';
import { observedCompletion } from './completion.mjs';
import { Copilot } from './copilot.mjs';

const state = (view, extra = {}) => ({ instance_index: 0, phase: 'SELECTING_HAND', state_id: 'before', hand_levels: 'Two Pair: Lv.3 60×4', view, ...extra });
const before = state('Money: $20\nHands Left: 4\nDiscards Left: 4\nHand (left to right)\n[1] A♠\n[2] A♥\n[3] 3♦\nConsumables (1/2)\n1. [9] Tarot Justice');
test('A missing discard receipt requires both the discard decrement and dealt replacement cards', () => {
  const after = state('Money: $20\nHands Left: 4\nDiscards Left: 3\nHand (left to right)\n[2] A♥\n[3] 3♦\n[4] 5♣\nConsumables (1/2)\n1. [9] Tarot Justice', { state_id: 'after' });
  assert.equal(observedCompletion('discard_hand', { card_ids: [1] }, before, after).data.evidence, 'discard_and_redraw_observed');
  for (const view of [after.view.replace('Discards Left: 3', 'Discards Left: 4'), after.view.replace('[4] 5♣\n', '')]) {
    assert.equal(observedCompletion('discard_hand', { card_ids: [1] }, before, { ...after, view }), undefined);
  }
});
test('A consumed Tarot without its target changing remains uncertain', () => {
  const after = { ...before, state_id: 'after', view: before.view.replace('1. [9] Tarot Justice', '(empty)') };
  assert.equal(observedCompletion('use_consumable', { card_id: 9, targets: [3] }, before, after), undefined);
  const changed = { ...after, view: after.view.replace('[3] 3♦', '[3] 3♦ (Glass)') };
  assert.equal(observedCompletion('use_consumable', { card_id: 9, targets: [3] }, before, changed).data.evidence, 'consumable_effect_observed');
});
test('An unrelated fingerprint or money change cannot establish purchase or scoring completion', () => {
  const after = { ...before, state_id: 'after', view: before.view.replace('$20', '$19') };
  assert.equal(observedCompletion('buy_consumable', { card_id: 9, use: true }, before, after), undefined);
  assert.equal(observedCompletion('play_hand', { card_ids: [1] }, before, after), undefined);
  assert.equal(observedCompletion('discard_hand', { card_ids: [1] }, before, { ...after, instance_index: 1 }), undefined);
});
test('Blind start must match the selected blind; a different blind never counts', () => {
  const before = state('Turn\nPhase: BLIND_SELECT\nAnte: 7\nMoney: $40\nHand (left to right)\n(empty)\n\nAnte\nAnte: 7\nBlind Select\nBig Blind (Big) — 52500 chips (on deck)', { phase: 'BLIND_SELECT' });
  const after = state('Blind: Big Blind — 0 / 52500 chips\nHand (left to right)\n[1] A♠', { state_id: 'after' });
  assert.equal(observedCompletion('select_blind', {}, before, after).data.evidence, 'blind_started');
  assert.equal(observedCompletion('select_blind', {}, before, { ...after, view: after.view.replace('Big Blind', 'The Hook') }), undefined);
});
test('Booster recovery requires the purchased pack and exact cost, not just any open pack', () => {
  const before = state('Money: $40\nHand (left to right)\n(empty)\n\nShop\nBoosters\n[12] Arcana Pack (booster) — $4', { phase: 'SHOP' });
  const after = state('Money: $36\nHand (left to right)\n[1] A♠\n\nBooster Pack\nPack: Arcana Pack\nPicks Remaining: 1\nOptions\n1. [13] Tarot Death', { state_id: 'after', phase: 'SMODS_BOOSTER_OPENED' });
  assert.equal(observedCompletion('buy_booster', { card_id: 12 }, before, after).data.evidence, 'booster_opened');
  for (const view of [after.view.replace('Pack: Arcana', 'Pack: Celestial'), after.view.replace('$36', '$35')]) {
    assert.equal(observedCompletion('buy_booster', { card_id: 12 }, before, { ...after, view }), undefined);
  }
});
test('Pack picks, planet use and rerolls are verified through their specific state changes', () => {
  const packBefore = state('Booster Pack\nPack: Mega Celestial Pack\nPicks Remaining: 2\nOptions\n1. [12] Planet Uranus\n2. [13] Planet Earth', { phase: 'SMODS_BOOSTER_OPENED' });
  const packAfter = { ...packBefore, state_id: 'after', view: packBefore.view.replace('Remaining: 2', 'Remaining: 1').replace('1. [12] Planet Uranus\n', '') };
  assert.equal(observedCompletion('select_booster_card', { card_id: 12 }, packBefore, packAfter).data.evidence, 'booster_pick_completed');
  assert.equal(observedCompletion('select_booster_card', { card_id: 12 }, packBefore, { ...packAfter, view: packAfter.view.replace('Remaining: 1', 'Remaining: 2') }), undefined);
  const shopBefore = state('Money: $40\nShop\nReroll Cost: 5\nCards\n1. [12] Planet Uranus Buy $3 / Sell $1\n2. [13] Joker', { phase: 'SHOP' });
  const planetAfter = { ...shopBefore, state_id: 'after', hand_levels: 'Two Pair: Lv.4 80×5', view: shopBefore.view.replace('$40', '$37').replace('1. [12] Planet Uranus Buy $3 / Sell $1\n', '') };
  assert.equal(observedCompletion('buy_consumable', { card_id: 12, use: true }, shopBefore, planetAfter).data.evidence, 'purchase_and_use_observed');
  assert.equal(observedCompletion('buy_consumable', { card_id: 12, use: true }, shopBefore, { ...planetAfter, hand_levels: shopBefore.hand_levels }), undefined);
  const rerolled = { ...shopBefore, state_id: 'after', view: shopBefore.view.replace('$40', '$35').replace('Cost: 5', 'Cost: 6').replace('[12]', '[22]').replace('[13]', '[23]') };
  assert.equal(observedCompletion('reroll_shop', {}, shopBefore, rerolled).data.evidence, 'shop_reroll_observed');
});

function fixture({ change = 'purchased', errorCode = 'UPSTREAM_TIMEOUT' } = {}) {
  let mutated = false;
  const mutations = [];
  const reads = [];
  const upstream = { async rpc(method, params, options) {
    reads.push({ method, options });
    if (method === 'tools/call') {
      mutated = true; mutations.push(params);
      throw Object.assign(new Error('Native acknowledgement unavailable'), { code: errorCode });
    }
    if (params.uri === 'balatro://instances') return { contents: [{ text: 'balatro://instances/0/turn' }] };
    if (params.uri.endsWith('/run')) return { contents: [{ text: '## Hand Levels\n- Two Pair: Lv.3 — 60 chips × 4 mult' }] };
    if (params.uri.endsWith('/shop')) return { contents: [{ text: `# Shop\n\n## Cards\n\n${mutated && change === 'purchased' ? '(empty)' : '1. [44] Planet Uranus Buy $3 / Sell $1'}\n\n## Boosters\n(empty)` }] };
    return { contents: [{ text: `# Turn\n\n**Phase:** SHOP\n**Money:** $${mutated ? 1 : 4}\n\n## Legal Actions\n- \`leave_shop\`\n\n## Hand (left to right)\n(empty)\n\n## Jokers (0/5)\n(empty)\n\n## Consumables (1/2)\n${mutated && change === 'purchased' ? '1. [44] Planet Uranus' : '(empty)'}` }] };
  } };
  return { copilot: new Copilot(upstream), mutations, reads };
}
test('A purchase with a lost acknowledgement is recovered by stable owned-card evidence without resend', async () => {
  const { copilot, mutations, reads } = fixture();
  const current = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'buy_consumable', state_id: current.state_id, args: { card_id: 44, use: false } });
  assert.equal(result.ok, true);
  assert.equal(result.completion, 'observed');
  assert.equal(result.receipt.source, 'state_readback');
  assert.equal(result.receipt.data.evidence, 'consumable_purchased');
  assert.equal(mutations.length, 1);
  assert.equal(reads.find(r => r.method === 'tools/call').options.timeoutMs, 8000);
  assert.ok(reads.filter(r => r.method === 'resources/read').every(r => r.options.timeoutMs <= 5000));
});
test('Money moving with no purchased card remains uncertain and is never retried', async () => {
  const { copilot, mutations } = fixture({ change: 'money_only' });
  const current = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'buy_consumable', state_id: current.state_id, args: { card_id: 44, use: false } });
  assert.equal(result.ok, false);
  assert.equal(result.action_may_have_executed, true);
  assert.equal(mutations.length, 1);
});
test('Explicit native rejection is never replaced by observed success', async () => {
  const { copilot, mutations } = fixture({ errorCode: 'SLOTS_FULL' });
  const current = await copilot.invoke('get_state');
  const result = await copilot.invoke('act', { action: 'buy_consumable', state_id: current.state_id, args: { card_id: 44, use: false } });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'SLOTS_FULL');
  assert.equal(mutations.length, 1);
});
test('Unstable reconciliation never supplies evidence for a next mutation', async () => {
  const copilot = new Copilot({});
  let counter = 0;
  copilot.snapshot = async () => ({ ...before, state_id: String(counter++) });
  await assert.rejects(copilot.reconcile(0, Date.now() + 25), error => error.code === 'STATE_NOT_SETTLED');
});
