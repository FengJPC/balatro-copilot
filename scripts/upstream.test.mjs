import test from 'node:test';
import assert from 'node:assert/strict';
import { Upstream } from './upstream.mjs';

test('RPC timeout removes its pending call; a late reply cannot satisfy the next request', async () => {
  const script = `require('node:readline').createInterface({input:process.stdin}).on('line', l => {
    const m=JSON.parse(l); setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tag:m.params.tag}})+'\\n'),m.params.delay);
  });`;
  const upstream = new Upstream(process.execPath, ['-e', script], 1000);
  try {
    await assert.rejects(upstream.rpc('test', { tag: 'late', delay: 40 }, { timeoutMs: 15 }), error => error.code === 'UPSTREAM_TIMEOUT');
    assert.equal(upstream.pending.size, 0);
    const result = await upstream.rpc('test', { tag: 'next', delay: 80 });
    assert.equal(result.tag, 'next');
    assert.equal(upstream.pending.size, 0);
  } finally { await upstream.close(); }
});
