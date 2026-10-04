import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GameBridge } from './bridge.mjs';

async function fixture(t, respond) {
  const folder = await mkdtemp(join(tmpdir(), 'copilot-bridge-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const registry = join(folder, 'balatro-mcp');
  const record = (id = 'game-1', age = 0) => writeFile(`${registry}-${id}`, `${id}\t\\\\.\\pipe\\balatro-test-${id}\t${Date.now() - age}`);
  await record();
  const writes = [];
  const bridge = new GameBridge({ registry, connect() {
    const socket = new EventEmitter();
    socket.setEncoding = () => {};
    socket.destroy = () => socket.emit('close');
    socket.write = line => { const request = JSON.parse(line); writes.push(request); respond?.(socket, request); };
    setImmediate(() => socket.emit('connect'));
    return socket;
  } });
  return { bridge, writes, record, registry };
}
const ui = { version: '0.4.0', instance_id: 'game-1', phase: 'ROUND_EVAL', overlay: 'none', pack_open: false, cash_out_ready: true };
const reply = (socket, request, data = ui) => socket.emit('data', JSON.stringify({ id: request.id, result: { ok: true, data } }) + '\n');

test('Extension correlates fragmented replies and checks game identity', async t => {
  const { bridge, writes } = await fixture(t, (s, r) => {
    s.emit('data', JSON.stringify({ id: 'late-other-reply', result: { ok: true } }) + '\n');
    const line = JSON.stringify({ id: r.id, result: { ok: true, data: ui } }) + '\n';
    s.emit('data', line.slice(0, 12)); s.emit('data', line.slice(12));
  });
  assert.deepEqual(await bridge.status(), { available: true, ...ui });
  assert.equal(writes.length, 1);
});
test('Registry ambiguity and stale heartbeats send no request', async t => {
  const { bridge, writes, record } = await fixture(t);
  await record('game-2');
  await assert.rejects(bridge.rpc('copilot_continue_endless'), e => e.code === 'BRIDGE_INSTANCE_AMBIGUOUS' && e.request_sent === false);
  await record('game-1', 10000); await record('game-2', 10000);
  assert.equal((await bridge.status()).available, false);
  assert.equal(writes.length, 0);
});
test('Old Mod unknown method reports extension required; no retries', async t => {
  const { bridge, writes } = await fixture(t, (s, r) => s.emit('data', JSON.stringify({ id: r.id, error: { code: -32601, message: 'Unknown method' } }) + '\n'));
  assert.deepEqual(await bridge.status(), { available: false, error_code: 'BRIDGE_EXTENSION_REQUIRED' });
  await assert.rejects(bridge.rpc('copilot_continue_endless'), e => e.action_rejected === true);
  assert.equal(writes.length, 2); // two explicitly requested calls, one write each
});
test('Mismatched identity or invalid UI fields cannot authorize actions', async t => {
  for (const data of [{ ...ui, instance_id: 'wrong' }, { ...ui, overlay: 'unexpected' }, { ...ui, cash_out_ready: 'true' }]) {
    const { bridge } = await fixture(t, (s, r) => reply(s, r, data));
    assert.deepEqual(await bridge.status(), { available: false, error_code: 'BRIDGE_PROTOCOL_ERROR' });
  }
});
test('A lost custom-action receipt is uncertain, with exactly one write', async t => {
  const { bridge, writes } = await fixture(t);
  await assert.rejects(bridge.rpc('copilot_sell_card_in_pack', { card_id: 264 }, { timeoutMs: 30 }), e => e.code === 'UPSTREAM_TIMEOUT' && e.request_sent === true);
  assert.equal(writes.length, 1);
});
test('Game settlement timeout remains uncertain, distinct from rejected sale', async t => {
  for (const [code, rejected] of [['ACTION_UNCERTAIN', false], ['CANNOT_SELL', true]]) {
    const { bridge } = await fixture(t, (s, r) => s.emit('data', JSON.stringify({ id: r.id, error: { code: -32032, message: code, data: { error_code: code } } }) + '\n'));
    await assert.rejects(bridge.rpc('copilot_sell_card_in_pack'), e => e.code === code && e.action_rejected === rejected);
  }
});
test('Malformed replies and disconnects fail without retry', async t => {
  for (const respond of [(s) => s.emit('data', 'invalid JSON\n'), (s) => s.emit('data', 'null\n'), (s) => s.emit('close')]) {
    const { bridge, writes } = await fixture(t, respond);
    await assert.rejects(bridge.rpc('copilot_continue_endless'));
    assert.equal(writes.length, 1);
  }
});
