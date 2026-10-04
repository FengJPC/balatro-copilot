// MIT. Optional game-extension RPC over the original local named pipe.
import { createConnection } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const fault = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
export class GameBridge {
  constructor({ registry = process.env.BALATRO_BRIDGE_REGISTRY ?? join(tmpdir(), 'balatro-mcp'), connect = createConnection } = {}) {
    this.registry = registry;
    this.connect = connect;
  }
  async endpoint() {
    const prefix = basename(this.registry) + '-';
    const records = [];
    for (const name of await readdir(dirname(this.registry))) {
      if (!name.startsWith(prefix) || name.endsWith('.tmp')) continue;
      let line;
      try { line = await readFile(join(dirname(this.registry), name), 'utf8'); } catch { continue; }
      const [id, endpoint, heartbeat] = line.trim().split('\t');
      if (!id || !endpoint?.startsWith('\\\\.\\pipe\\') || !Number.isFinite(Number(heartbeat))) continue;
      const age = Date.now() - Number(heartbeat);
      if (age < -5000 || age > 5000) continue;
      records.push({ id, endpoint });
    }
    // Upstream exposes indices but no endpoint identity. Do not guess a pipe
    // from oldest-first ordering when several games are running.
    if (records.length !== 1) throw fault('BRIDGE_INSTANCE_AMBIGUOUS', 'Game extension requires exactly one fresh local game registry record.');
    return records[0];
  }
  async rpc(method, params = {}, { timeoutMs = 2000 } = {}) {
    let record;
    try { record = await this.endpoint(); }
    catch (error) { throw Object.assign(error, { request_sent: false }); }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let sent = false, buffer = '', done = false;
      let socket;
      try { socket = this.connect(record.endpoint); }
      catch (error) { return reject(fault('BRIDGE_UNAVAILABLE', error.message, { request_sent: false })); }
      const finish = (error, data) => {
        if (done) return;
        done = true; clearTimeout(timer); socket.destroy();
        if (error) reject(Object.assign(error, { request_sent: sent }));
        else resolve(data);
      };
      const timer = setTimeout(() => finish(fault('UPSTREAM_TIMEOUT', 'Game extension acknowledgement timed out; no retry was sent.')), timeoutMs);
      socket.setEncoding('utf8');
      socket.once('connect', () => { sent = true; socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
      socket.on('error', error => finish(fault('BRIDGE_UNAVAILABLE', error.message)));
      socket.on('close', () => { if (!done) finish(fault('BRIDGE_UNAVAILABLE', 'Game pipe closed before its reply.')); });
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) return finish(fault('BRIDGE_PROTOCOL_ERROR', 'Oversized game-extension response.'));
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          let response;
          try { response = JSON.parse(line); } catch { return finish(fault('BRIDGE_PROTOCOL_ERROR', 'Invalid game-extension JSON.')); }
          if (!response || typeof response !== 'object' || Array.isArray(response)) return finish(fault('BRIDGE_PROTOCOL_ERROR', 'Invalid game-extension response object.'));
          if (response.id !== id) continue;
          if (response.error) {
            const code = response.error.code === -32601 ? 'BRIDGE_EXTENSION_REQUIRED' : response.error.data?.error_code ?? 'BRIDGE_ERROR';
            return finish(fault(code, response.error.message, { action_rejected:
              [-32601, -32602].includes(response.error.code) || ['WRONG_PHASE', 'INVALID_TARGET', 'CANNOT_SELL', 'CANNOT_USE_NOW'].includes(code) }));
          }
          if (response.result?.ok !== true) return finish(fault('BRIDGE_PROTOCOL_ERROR', 'Missing game-extension receipt.'));
          if (method === 'copilot_ui_state' && response.result.data?.instance_id !== record.id) return finish(fault('BRIDGE_PROTOCOL_ERROR', 'Game identity does not match its registry.'));
          finish(null, response.result);
        }
      });
    });
  }
  async status(options) {
    try {
      const result = await this.rpc('copilot_ui_state', {}, options);
      if (result.data?.version !== '0.4.0') throw fault('BRIDGE_EXTENSION_REQUIRED', 'Install the matching 0.4.0 game extension and restart Balatro.');
      if (!['none', 'victory', 'other'].includes(result.data.overlay) || typeof result.data.phase !== 'string'
        || typeof result.data.pack_open !== 'boolean' || typeof result.data.cash_out_ready !== 'boolean') {
        throw fault('BRIDGE_PROTOCOL_ERROR', 'Invalid game-extension status fields.');
      }
      return { available: true, ...result.data };
    } catch (error) { return { available: false, error_code: error.code ?? 'BRIDGE_UNAVAILABLE' }; }
  }
}
