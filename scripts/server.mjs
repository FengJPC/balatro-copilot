#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Upstream } from './upstream.mjs';
import { Copilot, TOOLS, VERSION } from './copilot.mjs';
import { GameBridge } from './bridge.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  process.stderr.write('This package contains the Windows x64 Balatro Agent binary.\n');
  process.exit(1);
}

const binary = fileURLToPath(new URL('../bin/balatro-mcp.exe', import.meta.url));
try {
  await access(binary);
} catch {
  process.stderr.write('Missing upstream binary. Run scripts/bootstrap.ps1 before installing the plugin.\n');
  process.exit(1);
}

if (process.argv.length > 2) {
  const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit', windowsHide: true });
  child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  const upstream = new Upstream(binary);
  const copilot = new Copilot(upstream, { bridge: new GameBridge() });
  const ready = copilot.initialize();
  ready.catch(error => process.stderr.write(`Upstream initialization: ${error.message}\n`));
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
  let queue = Promise.resolve();
  async function dispatch(request) {
    if (request.id === undefined) return;
    try {
      const init = await ready;
      let result;
      switch (request.method) {
        case 'initialize':
          result = { protocolVersion: init.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'balatro-copilot', version: VERSION },
            instructions: 'Use get_state, then act with its state_id. A returned state.delta explicitly references unchanged sections of its base_state_id; retain them. get_state restores full context. inspect provides details on demand.' };
          break;
        case 'ping': result = {}; break;
        case 'tools/list': result = { tools: TOOLS }; break;
        case 'tools/call': {
          let value;
          try { value = await copilot.invoke(request.params.name, request.params.arguments); }
          catch (error) { value = { ok: false, error_code: String(error.code ?? error.data?.error_code ?? 'READ_FAILED'), message: error.message }; }
          result = { content: [{ type: 'text', text: JSON.stringify(value) }], ...(value?.ok === false && { isError: true }) };
          break;
        }
        case 'resources/list': case 'resources/templates/list': case 'resources/read':
        case 'prompts/list': case 'prompts/get':
          result = await upstream.rpc(request.method, request.params);
          break;
        default: throw Object.assign(new Error('Method not found.'), { code: -32601 });
      }
      send({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      send({ jsonrpc: '2.0', id: request.id, error: { code: Number.isInteger(error.code) ? error.code : -32603, message: error.message } });
    }
  }
  input.on('line', line => {
    let request;
    try { request = JSON.parse(line); }
    catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }); return; }
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      send({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Invalid request.' } }); return;
    }
    queue = queue.then(() => dispatch(request));
  });
  input.on('close', () => { queue.finally(() => upstream.close()); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { upstream.child.kill(signal); process.exit(0); });
}
