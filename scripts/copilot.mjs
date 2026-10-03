// MIT: compact views and orchestration; no scoring engine or automatic action retry.
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { observedCompletion } from './completion.mjs';
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '')).version;

export const ACTIONS = [
  'select_blind', 'skip_blind', 'play_hand', 'discard_hand', 'reroll_shop',
  'reroll_boss', 'leave_shop', 'cash_out', 'skip_booster', 'restart',
  'continue_game', 'sell_card', 'buy_card', 'buy_voucher', 'buy_booster',
  'select_hand_cards', 'sort_hand', 'reorder_hand', 'use_consumable',
  'buy_consumable', 'select_booster_card', 'reorder_jokers', 'new_game',
];
const sections = ['instances', 'turn', 'hand', 'jokers', 'consumables', 'deck',
  'shop', 'booster', 'run', 'ante', 'tools', 'decks', 'stakes', 'challenges', 'card_modifiers', 'wiki'];
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const instance = { type: 'integer', minimum: 0, description: 'Instance index; omit only with one game.' };
export const TOOLS = [
  { name: 'get_state', description: 'Read a compact decision surface and state_id. Includes shop, pack or blinds when relevant.',
    inputSchema: object({ instance_index: instance }), annotations: { readOnlyHint: true } },
  { name: 'act', description: 'Execute one action against state_id; returns receipt and fresh state. play_hand/discard_hand require args.card_ids and select first. Other args match upstream; inspect tools for schemas. Never auto-retries.',
    inputSchema: { ...object({ instance_index: instance,
      state_id: { type: 'string', pattern: '^[a-f0-9]{16}$' }, action: { type: 'string', enum: ACTIONS },
      args: { type: 'object', description: 'Upstream arguments without instance_index. play/discard: card_ids (1-5 IDs).' },
    }), required: ['state_id', 'action'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false } },
  { name: 'inspect', description: 'Read detail on demand. section=tools gives compact action schemas; action filters. wiki: query searches, title reads an article. Other sections read resources.',
    inputSchema: { ...object({ instance_index: instance, section: { type: 'string', enum: sections },
      action: { type: 'string', enum: ACTIONS }, query: { type: 'string' }, title: { type: 'string' },
    }), required: ['section'] }, annotations: { readOnlyHint: true } },
];
export function compact(text) {
  return text.replace(/\r/g, '').replace(/\*\*|`/g, '').split('\n')
    .map(line => line.trim().replace(/^#{1,6}\s+/, '').replace(/^-\s+/, ''))
    .filter(Boolean).join('\n').replace(/Legal Actions\n([\s\S]*?)(?=\n(?:Hand|Jokers|Consumables)\b|$)/,
      (_, actions) => `Actions: ${actions.trim().split('\n').join(' ')}`);
}
export const textOf = result => (result.contents ?? result.content ?? [])
  .filter(item => item.type === undefined || item.type === 'text').map(item => item.text ?? '').join('\n');
function fault(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
export function handLevels(run) {
  const block = run.match(/## Hand Levels\s*\n([\s\S]*?)(?=\n## |$)/)?.[1];
  if (!block) throw fault('UNRECOGNIZED_STATE', 'Run resource has no Hand Levels; inspect run before scoring.');
  return compact(block).split('\n').map(line => line.replace(/: (Lv\.\d+) — (\d+) chips × (\d+) mult/, ': $1 $2×$3')).join('; ');
}
function dataOf(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  try { return JSON.parse(textOf(result).split('\n\n---')[0]); }
  catch { return { message: compact(textOf(result).split('\n\n---')[0]) }; }
}
function successful(result) {
  const data = dataOf(result);
  if (result.isError || data.ok === false || data.error_code) throw fault(data.error_code ?? 'ACTION_FAILED', data.message ?? textOf(result), { details: data });
  return data;
}
function shortSchema(value) {
  if (Array.isArray(value)) return value.map(shortSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description' && key !== '$schema')
    .map(([key, item]) => [key, shortSchema(item)]));
}
function actionSchema(value) {
  const schema = shortSchema(value);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.properties) delete node.properties.instance_index;
    if (node.required) node.required = node.required.filter(key => key !== 'instance_index');
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }
  visit(schema);
  return schema;
}

export class Copilot {
  constructor(upstream) { this.upstream = upstream; }
  async initialize() {
    const init = await this.upstream.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'balatro-copilot', version: VERSION } });
    this.upstream.notify('notifications/initialized');
    this.catalog = (await this.upstream.rpc('tools/list')).tools;
    return init;
  }
  async read(uri, deadline = Date.now() + 5000) {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw fault('STATE_NOT_SETTLED', 'State read deadline expired; read again before acting.');
    return textOf(await this.upstream.rpc('resources/read', { uri }, { timeoutMs }));
  }
  async call(name, args) {
    // Scoring has a separate, longer animation. All other mutations have a
    // short acknowledgement budget, followed by evidence-based readback.
    const timeoutMs = name === 'balatro_play_hand' ? 50_000 : 8000;
    return successful(await this.upstream.rpc('tools/call', { name, arguments: args }, { timeoutMs }));
  }
  async resolve(index) {
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) throw fault('INVALID_ARGUMENT', 'Invalid instance_index.');
    const listing = await this.read('balatro://instances');
    const indices = [...new Set([...listing.matchAll(/balatro:\/\/instances\/(\d+)\/turn/g)].map(match => Number(match[1])))];
    if (!indices.length) throw fault('GAME_NOT_RUNNING', 'Launch modded Balatro first.');
    if (index === undefined && indices.length !== 1) throw fault('INSTANCE_SELECTION_REQUIRED', 'Choose an instance_index.', { instances: indices });
    if (index !== undefined && !indices.includes(index)) throw fault('INSTANCE_NOT_FOUND', 'Instance no longer exists.', { instances: indices });
    return index ?? indices[0];
  }
  async snapshot(instance_index) {
    const base = `balatro://instances/${instance_index}/`;
    let turn;
    const deadline = Date.now() + 5000;
    let stableTurn, stableSince;
    try {
      do {
        turn = await this.read(`${base}turn`, deadline);
        const phase = turn.match(/\*\*Phase:\*\*\s*(\S+)/)?.[1];
        if (turn !== stableTurn) { stableTurn = turn; stableSince = Date.now(); }
        // A victory overlay can retain the finished blind indefinitely. Blind
        // cleanup is not a readiness signal; neither is a legal action proof
        // that an overlay is closed (the native bridge does not expose it).
        const awaitingCashOut = phase === 'ROUND_EVAL' && (!/- `cash_out`\s*(?:\n|$)/.test(turn)
          || Date.now() - stableSince < 600);
        if (!awaitingCashOut && !['NEW_ROUND', 'HAND_PLAYED', 'DRAW_TO_HAND', 'PLAY_TAROT', 'SMODS_REDEEM_VOUCHER'].includes(phase)) break;
        if (Date.now() >= deadline) throw fault('STATE_NOT_SETTLED', 'Game is still animating; read again before acting.');
        await delay(100);
      } while (true);
    }
    catch (error) {
      if (error.data?.error_code !== 'UNAVAILABLE') throw error;
      const phase = (await this.call('connect', { instance_index })).phase;
      return this.stamp({ instance_index, phase, view: 'Outside a run. Use new_game or continue_game from MENU.' });
    }
    const phase = turn.match(/\*\*Phase:\*\*\s*(\S+)/)?.[1];
    if (!phase) throw fault('UNRECOGNIZED_STATE', 'Upstream turn format changed; use inspect turn.');
    let view = compact(turn);
    const section = phase === 'SHOP' ? 'shop' : phase === 'BLIND_SELECT' ? 'ante' : /BOOSTER|_PACK$/.test(phase) ? 'booster' : null;
    if (section) view += `\n\n${compact(await this.read(`${base}${section}`, deadline))}`;
    const hand_levels = handLevels(await this.read(`${base}run`, deadline));
    return this.stamp({ instance_index, phase, view, hand_levels });
  }
  stamp(state) { return { ...state, state_id: createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 16) }; }
  async reconcile(index, deadline = Date.now() + 3500) {
    let previous, stableSince;
    do {
      const state = await this.snapshot(index);
      if (state.state_id !== previous?.state_id) stableSince = Date.now();
      else if (Date.now() - stableSince >= 600) return state;
      previous = state;
      await delay(150);
    } while (Date.now() < deadline);
    throw fault('STATE_NOT_SETTLED', 'Post-action state kept changing; completion remains uncertain.');
  }
  async inspect(input) {
    if (input.section === 'tools') return this.catalog.filter(tool => ACTIONS.includes(tool.name.replace(/^balatro_/, '')))
      .filter(tool => !input.action || tool.name === `balatro_${input.action}`)
      .map(tool => {
        const schema = actionSchema(tool.inputSchema);
        if (['balatro_play_hand', 'balatro_discard_hand'].includes(tool.name)) {
          schema.properties ??= {};
          schema.properties.card_ids = { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: ['string', 'number'] } };
          schema.required = [...(schema.required ?? []), 'card_ids'];
        }
        return { action: tool.name.replace(/^balatro_/, ''), inputSchema: schema };
      });
    if (input.section === 'wiki') {
      if (input.title) return { view: compact(await this.read(`balatro://wiki/${encodeURIComponent(input.title)}`)) };
      if (input.query) return this.call('balatro_wiki_search', { query: input.query, limit: 5 });
      return { view: compact(await this.read('balatro://wiki/index')) };
    }
    if (!sections.includes(input.section)) throw fault('INVALID_ARGUMENT', 'Unknown section.');
    const staticSections = ['instances', 'decks', 'stakes', 'challenges', 'card_modifiers'];
    const uri = staticSections.includes(input.section) ? `balatro://${input.section}`
      : `balatro://instances/${await this.resolve(input.instance_index)}/${input.section}`;
    return { view: compact(await this.read(uri)) };
  }
  async act(input) {
    if (!ACTIONS.includes(input.action)) throw fault('INVALID_ARGUMENT', 'Unknown action.');
    if (input.args !== undefined && (!input.args || typeof input.args !== 'object' || Array.isArray(input.args))) throw fault('INVALID_ARGUMENT', 'args must be an object.');
    const index = await this.resolve(input.instance_index);
    const current = await this.snapshot(index);
    if (input.state_id !== current.state_id) return { ok: false, error_code: 'STALE_STATE',
      message: 'No action sent. Decide again from this fresh state.', state: current };
    const args = { ...(input.args ?? {}) };
    if ('instance_index' in args) throw fault('INVALID_ARGUMENT', 'Pass instance_index at the top level.');
    let selection;
    let sent = false;
    let receipt;
    const evidenceArgs = { ...args };
    try {
      if (['reorder_hand', 'reorder_jokers'].includes(input.action)) {
        const ids = args.order;
        if (Object.keys(args).some(key => key !== 'order') || !Array.isArray(ids) || ids.length > 50
          || ids.some(id => !(typeof id === 'string' && id.length > 0) && !Number.isSafeInteger(id))
          || new Set(ids.map(String)).size !== ids.length) {
          throw fault('INVALID_ARGUMENT', 'Reorder requires args.order: every current card ID exactly once, in left-to-right order; card_ids is not accepted.');
        }
      }
      if (input.action === 'continue_game' && !['MENU', 'MAIN_MENU'].includes(current.phase)) {
        throw fault('INVALID_ARGUMENT', 'continue_game loads a saved run from the main menu. It does not choose Endless on the victory dialog; use the game UI for that.');
      }
      if (['play_hand', 'discard_hand'].includes(input.action)) {
        if (Object.keys(args).some(key => key !== 'card_ids')) throw fault('INVALID_ARGUMENT', 'play/discard only accept card_ids.');
        const ids = args.card_ids;
        if (!Array.isArray(ids) || !ids.length || ids.length > 5 || new Set(ids.map(String)).size !== ids.length
          || ids.some(id => !(typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))))) {
          throw fault('INVALID_ARGUMENT', 'play/discard require 1-5 distinct args.card_ids.');
        }
        selection = await this.call('balatro_select_hand_cards', { card_ids: ids, instance_index: index });
        delete args.card_ids;
      }
      sent = true;
      receipt = await this.call(`balatro_${input.action}`, { ...args, instance_index: index });
    } catch (error) {
      // JSON-RPC Invalid params is rejected by the native tool layer before
      // any gameplay handler. Local validation also sends no action.
      if ((!sent && !selection && error.code === 'INVALID_ARGUMENT') || error.code === -32602) return { ok: false,
        error_code: String(error.code === -32602 ? 'INVALID_ARGUMENT' : error.code ?? 'ACTION_FAILED'),
        message: error.message, action_may_have_executed: false, ...(selection && { selection }), state: current };
      let state;
      try { state = await this.reconcile(index); } catch { /* Never resend an uncertain action. */ }
      if (sent && error.code === 'UPSTREAM_TIMEOUT' && state) {
        const observed = observedCompletion(input.action, evidenceArgs, current, state);
        if (observed) return { ok: true, action: input.action, completion: 'observed', receipt: observed, state,
          message: 'Native acknowledgement unavailable; stable state shows the effect. No retry was sent.' };
      }
      return { ok: false, error_code: String(error.code ?? 'ACTION_FAILED'), message: error.message,
        action_may_have_executed: sent, ...(selection && { selection }), ...(state && { state }) };
    }
    try { return { ok: true, action: input.action, receipt, state: await this.snapshot(index) }; }
    catch (error) {
      return { ok: true, action: input.action, receipt, state_unavailable: error.message,
        message: 'Action accepted; call get_state before further action. Do not repeat it.' };
    }
  }
  async invoke(name, args = {}) {
    if (name === 'get_state') return this.snapshot(await this.resolve(args.instance_index));
    if (name === 'act') return this.act(args);
    if (name === 'inspect') return this.inspect(args);
    throw fault('UNKNOWN_TOOL', 'Unknown tool.');
  }
}
