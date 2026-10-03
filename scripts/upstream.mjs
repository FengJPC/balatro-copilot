// MIT: transport adapter. The upstream executable remains unmodified.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class Upstream {
  constructor(command, args = [], timeout = 65_000) {
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    this.done = new Promise(resolve => this.child.once('exit', resolve));
    const fail = error => {
      this.closed = true;
      for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
      this.pending.clear();
    };
    this.child.on('error', fail);
    this.child.on('exit', (code, signal) => fail(new Error(`Upstream exited: ${code ?? signal}`)));
    this.child.stdin.on('error', fail);
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', line => {
      try {
        const message = JSON.parse(line);
        const call = this.pending.get(message.id);
        if (!call) return;
        this.pending.delete(message.id);
        clearTimeout(call.timer);
        if (message.error) {
          const error = new Error(message.error.message);
          error.code = message.error.code;
          error.data = message.error.data;
          call.reject(error);
        } else call.resolve(message.result);
      } catch (error) { fail(error); this.child.kill(); }
    });
  }
  rpc(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('Upstream is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`Upstream request timed out: ${method}`), { code: 'UPSTREAM_TIMEOUT' }));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  notify(method) { this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`); }
  async close() {
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 2000);
    await this.done;
    clearTimeout(timer);
  }
}
