-- MIT, Copyright (c) 2026 FengJ. Optional extension to Balatro Agent v0.2.4.
-- Calls the game's existing UI callbacks; never edits saves or scoring rules.
return function(actions, state, round_eval, card_ids, instance)
  local VERSION = '0.4.0'
  local function err(code, message)
    return {ok = false, error_code = code, error_message = message}
  end
  local function pack_open()
    if not G or not G.STATES then return false end
    for _, name in ipairs({'SMODS_BOOSTER_OPENED', 'TAROT_PACK', 'PLANET_PACK', 'SPECTRAL_PACK', 'STANDARD_PACK', 'BUFFOON_PACK'}) do
      if G.STATES[name] and G.STATE == G.STATES[name] then return true end
    end
    return false
  end
  local function overlay_kind()
    local overlay = G and G.OVERLAY_MENU
    if not overlay then return 'none' end
    -- IDs belong to the actual win UI, rather than an Ante-derived guess.
    if G.GAME and G.GAME.won and overlay.get_UIE_by_ID
        and (overlay:get_UIE_by_ID('from_game_won') or overlay:get_UIE_by_ID('win_cta')) then
      return 'victory'
    end
    return 'other'
  end
  actions.copilot_ui_state = function()
    return {ok = true, data = {version = VERSION, instance_id = instance.id(),
      phase = state.connect_info().phase, overlay = overlay_kind(), pack_open = pack_open(),
      cash_out_ready = G and G.STATES and G.STATE == G.STATES.ROUND_EVAL
        and overlay_kind() == 'none' and round_eval.cash_out_button() ~= nil or false}}
  end
  actions.copilot_continue_endless = function(args)
    if next(args) ~= nil then return err('INVALID_TARGET', 'continue_endless takes no arguments') end
    if overlay_kind() ~= 'victory' then return err('CANNOT_USE_NOW', 'No victory dialog is open') end
    if not G.STATES or G.STATE ~= G.STATES.ROUND_EVAL then return err('WRONG_PHASE', 'Not at a won round') end
    G.FUNCS.exit_overlay_menu()
    return {ok = true, settle = {timeout_seconds = 5, on_game_update = function()
      if not G.OVERLAY_MENU then return {ok = true, data = {endless_chosen = true}} end
    end, on_timeout = function() return err('ACTION_UNCERTAIN', 'Victory dialog did not close; do not resend') end}}
  end
  actions.copilot_sell_card_in_pack = function(args)
    if not pack_open() then return err('WRONG_PHASE', 'No booster pack is open') end
    if overlay_kind() ~= 'none' then return err('CANNOT_USE_NOW', 'An overlay blocks the pack') end
    for key in pairs(args) do
      if key ~= 'card_id' then return err('INVALID_TARGET', 'Only card_id is accepted') end
    end
    local card = card_ids.resolve(G.jokers, args.card_id)
    if not card then return err('INVALID_TARGET', 'Joker not found in owned slots') end
    if card_ids.hidden(G.jokers, card) then return err('CANNOT_USE_NOW', 'Face-down Jokers cannot be sold') end
    if not card:can_sell_card() then return err('CANNOT_SELL', 'Joker cannot be sold right now') end
    local value = card.sell_cost or 0
    G.FUNCS.sell_card({config = {ref_table = card}})
    return {ok = true, settle = {timeout_seconds = 5, on_game_update = function()
      for _, owned in ipairs(G.jokers.cards) do if owned == card then return nil end end
      return {ok = true, data = {sell_value = value, sold_in_pack = true}}
    end, on_timeout = function() return err('ACTION_UNCERTAIN', 'Pack sale did not finish; do not resend') end}}
  end
end
