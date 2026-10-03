// State evidence for a missing acknowledgement. Never infer completion from
// a changed fingerprint alone, and never reconstruct the game's scoring receipt.
const headings = ['Hand', 'Jokers', 'Consumables', 'Shop', 'Booster Pack', 'Ante', 'Vouchers', 'Boosters', 'Cards', 'Options', 'Discard Pile'];
const isHeading = (line, heading) => line === heading || (line.startsWith(`${heading} (`) && line.endsWith(')'));
function block(state, heading) {
  const lines = state.view.split('\n');
  const start = lines.findIndex(line => isHeading(line, heading));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => headings.some(title => isHeading(line, title)));
  return rest.slice(0, end < 0 ? undefined : end).join('\n');
}
const cards = text => new Map([...text.matchAll(/^(?:\d+\. )?\[([^\]]+)\] ([^\n]*)/gm)].map(m => [m[1], m[2]]));
const number = (state, label) => {
  const value = state.view.match(new RegExp(`(?:^|\\n)${label}: \\$?(-?[\\d,]+)(?:\\n|$)`))?.[1];
  return value === undefined ? undefined : Number(value.replaceAll(',', ''));
};
const has = (state, section, id) => cards(block(state, section)).has(String(id));
const pack = state => /BOOSTER|_PACK$/.test(state.phase);

export function observedCompletion(action, args, before, after) {
  if (before.instance_index !== after.instance_index || before.state_id === after.state_id) return;
  const handBefore = cards(block(before, 'Hand'));
  const handAfter = cards(block(after, 'Hand'));
  const moneyBefore = number(before, 'Money'), moneyAfter = number(after, 'Money');
  const id = String(args.card_id);
  const shopBefore = cards(block(before, 'Cards'));
  const shopAfter = cards(block(after, 'Cards'));
  const boosterBefore = cards(block(before, 'Boosters')).get(id);
  const boosterName = boosterBefore?.match(/^(.*?) \(booster\)/)?.[1];
  const boosterCost = boosterBefore?.match(/— \$(\d+)/)?.[1];
  const selectedBlind = block(before, 'Ante').split('\n').find(line => line.endsWith('(on deck)'))
    ?.match(/^(.*?) \((?:Small|Big|Boss)\)/)?.[1];
  const consumed = has(before, 'Consumables', id) && !has(after, 'Consumables', id);
  const targetChanges = args.targets?.length && args.targets.every(target =>
    handBefore.has(String(target)) && handBefore.get(String(target)) !== handAfter.get(String(target)));
  const levelsChanged = before.hand_levels !== after.hand_levels;
  let evidence;

  if (action === 'select_blind' && before.phase === 'BLIND_SELECT' && after.phase === 'SELECTING_HAND'
      && selectedBlind && handAfter.size > 0 && after.view.match(/^Blind: (.*?) —/m)?.[1] === selectedBlind) evidence = 'blind_started';
  if (action === 'leave_shop' && before.phase === 'SHOP' && after.phase === 'BLIND_SELECT') evidence = 'shop_left';
  if (action === 'cash_out' && before.phase === 'ROUND_EVAL' && after.phase === 'SHOP'
      && moneyAfter === moneyBefore + number(before, 'Round Dollars')) evidence = 'round_reward_received';
  if (action === 'buy_booster' && before.phase === 'SHOP' && pack(after)
      && boosterName && boosterCost !== undefined && cards(block(after, 'Options')).size > 0
      && after.view.match(/^Pack: (.*)$/m)?.[1] === boosterName
      && moneyAfter === moneyBefore - Number(boosterCost)) evidence = 'booster_opened';
  if (action === 'buy_card' && before.phase === 'SHOP' && after.phase === 'SHOP'
      && shopBefore.has(id) && !shopAfter.has(id) && has(after, 'Jokers', id)
      && moneyAfter < moneyBefore) evidence = 'joker_purchased';
  if (action === 'buy_consumable' && before.phase === 'SHOP' && after.phase === 'SHOP'
      && shopBefore.has(id) && !shopAfter.has(id)) {
    if (args.use === false && has(after, 'Consumables', id) && moneyAfter < moneyBefore) evidence = 'consumable_purchased';
    if (args.use === true && !has(after, 'Consumables', id)
        && (levelsChanged || targetChanges || moneyAfter > moneyBefore)) evidence = 'purchase_and_use_observed';
  }
  if (action === 'use_consumable' && consumed && before.phase === after.phase
      && (targetChanges || levelsChanged || moneyAfter !== moneyBefore)) evidence = 'consumable_effect_observed';
  if (action === 'select_booster_card' && pack(before) && has(before, 'Options', id)) {
    if (after.phase === 'SHOP') evidence = 'booster_pick_completed';
    if (pack(after) && !has(after, 'Options', id)
        && number(after, 'Picks Remaining') === number(before, 'Picks Remaining') - 1) evidence = 'booster_pick_completed';
  }
  if (action === 'discard_hand' && before.phase === 'SELECTING_HAND' && after.phase === 'SELECTING_HAND'
      && number(after, 'Discards Left') === number(before, 'Discards Left') - 1
      && number(after, 'Hands Left') === number(before, 'Hands Left')
      && args.card_ids?.every(card => handBefore.has(String(card)) && !handAfter.has(String(card)))
      && handAfter.size >= handBefore.size) evidence = 'discard_and_redraw_observed';
  if (action === 'reroll_shop' && before.phase === 'SHOP' && after.phase === 'SHOP'
      && number(after, 'Reroll Cost') === number(before, 'Reroll Cost') + 1
      && moneyAfter === moneyBefore - number(before, 'Reroll Cost')
      && shopAfter.size > 0 && [...shopAfter.keys()].every(card => !shopBefore.has(card))) evidence = 'shop_reroll_observed';
  if (!evidence) return;
  return { source: 'state_readback', data: { evidence, before_state_id: before.state_id, after_state_id: after.state_id } };
}
