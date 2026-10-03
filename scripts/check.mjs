#!/usr/bin/env node

// Read-only probe of the actual packaged stdio server; no gameplay actions.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse((await readFile(new URL(path, root), 'utf8')).replace(/^\uFEFF/, ''));
const manifest = await json('plugin.json');
const legacy = await json('.codex-plugin/plugin.json');
const portableMcp = await json('mcp.json');
const legacyMcp = await json('.mcp.json');
assert.equal(manifest.name, legacy.name);
assert.equal(manifest.version, legacy.version);
assert.deepEqual(portableMcp.mcpServers.balatro_agent.args, legacyMcp.mcpServers.balatro_agent.args);
assert.equal(portableMcp.mcpServers.balatro_agent.type, 'stdio');
const provenance = await json('provenance.json');
const executable = await readFile(new URL('bin/balatro-mcp.exe', root));
assert.equal(createHash('sha256').update(executable).digest('hex'), provenance.binary_sha256);
const mod = await json('game-mod/balatro-agent/manifest.json');
assert.equal(mod.id, 'balatro-agent');
assert.equal(mod.version, provenance.version);
await readFile(new URL('licenses/balatro-agent-MIT.txt', root));

const child = spawn(process.execPath, [fileURLToPath(new URL('scripts/server.mjs', root))], {
  stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
const pending = new Map();
let nextId = 1;
let stderr = '';
let exited = false;
let finishExit;
const exit = new Promise(resolve => { finishExit = resolve; });
const failPending = error => {
  for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error); }
  pending.clear();
};
child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-4000); });
child.on('error', error => { failPending(error); finishExit(); });
child.on('exit', (code, signal) => {
  exited = true;
  failPending(new Error(`Server exited (${code ?? signal}): ${stderr}`));
  finishExit({ code, signal });
});
createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
  try {
    const response = JSON.parse(line);
    if (response.id === undefined) return;
    const call = pending.get(response.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(response.id);
    if (response.error) {
      const error = new Error(`${response.error.code}: ${response.error.message}`);
      error.details = response.error.data;
      call.reject(error);
    } else call.resolve(response.result);
  } catch (error) { failPending(error); }
});
const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
function rpc(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    if (exited) return reject(new Error('Server is closed.'));
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Read-only probe timed out: ${method}. ${stderr}`));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    send({ jsonrpc: '2.0', id, method, params });
  });
}
const textOf = resource => resource.contents?.map(item => item.text ?? '').join('\n') ?? '';

try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'balatro-codex-package-check', version: manifest.version },
  });
  assert.equal(init.serverInfo.name, 'balatro-copilot');
  assert.equal(init.serverInfo.version, manifest.version);
  assert.equal(init.protocolVersion, '2025-06-18');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const tools = await rpc('tools/list');
  const toolNames = tools.tools.map(tool => tool.name);
  assert.equal(toolNames.length, 3);
  for (const required of ['get_state', 'act', 'inspect']) {
    assert.ok(toolNames.includes(required), `Missing tool: ${required}`);
  }
  const actionSchemas = await rpc('tools/call', { name: 'inspect', arguments: { section: 'tools' } });
  assert.ok(!actionSchemas.isError, JSON.stringify(actionSchemas));
  assert.equal(JSON.parse(actionSchemas.content[0].text).length, 23);
  const resources = await rpc('resources/list');
  assert.ok(resources.resources.some(resource => resource.uri === 'balatro://instances'));
  const templates = await rpc('resources/templates/list');
  assert.ok(templates.resourceTemplates.some(template => template.uriTemplate === 'balatro://instances/{instance_index}/{section}'));
  const modifiers = await rpc('resources/read', { uri: 'balatro://card_modifiers' });
  assert.ok(textOf(modifiers).length > 0);
  const handbook = await rpc('prompts/get', { name: 'balatro_play_handbook' });
  assert.ok(handbook.messages.some(message => message.content?.text?.length > 0));
  const instances = textOf(await rpc('resources/read', { uri: 'balatro://instances' }));
  const indices = [...new Set([...instances.matchAll(/balatro:\/\/instances\/(\d+)\/turn/g)].map(match => Number(match[1])))];
  const summary = {
    package: `${manifest.name}@${manifest.version}`,
    upstream: provenance.version,
    protocol: init.protocolVersion,
    tools: toolNames.length,
    resources: resources.resources.length,
    resourceRead: 'passed', handbookRead: 'passed', binaryHash: 'verified',
    liveInstances: indices,
  };

  if (process.argv.includes('--live')) {
    assert.ok(indices.length > 0, 'No modded Balatro instance found. Launch the game first.');
    const observations = [];
    for (const instance_index of indices) {
      const connected = await rpc('tools/call', { name: 'get_state', arguments: { instance_index } });
      assert.ok(!connected.isError, JSON.stringify(connected));
      const state = JSON.parse(connected.content[0].text);
      assert.ok(state.state_id, 'Missing state identifier.');
      const phase = state.phase;
      if (!['MENU', 'SPLASH'].includes(phase)) assert.ok(state.hand_levels?.length, 'Missing live hand-level facts.');
      const observation = { instance_index, phase, connection: 'verified', state };
      try {
        const turn = textOf(await rpc('resources/read', { uri: `balatro://instances/${instance_index}/turn` }));
        assert.ok(turn.length > 0);
        observation.turnRead = 'passed';
        observation.turnSnapshot = turn;
      } catch (error) {
        if (error.details?.error_code !== 'UNAVAILABLE') throw error;
        observation.turnRead = 'unavailable outside a run';
      }
      observations.push(observation);
    }
    summary.live = observations;
  }
  console.log(JSON.stringify(summary, null, 2));
} finally {
  child.stdin.end();
  const stopTimer = setTimeout(() => { if (!exited) child.kill(); }, 2500);
  await exit;
  clearTimeout(stopTimer);
}
