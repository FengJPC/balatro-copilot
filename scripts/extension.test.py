"""Run the actual extension in LuaJIT; mocks game UI, not scoring rules.
Development-only dependency: lupa (or BALATRO_LUA_TEST_RUNTIME wheel directory).
"""
import os
import sys
import unittest
from pathlib import Path

if os.environ.get('BALATRO_LUA_TEST_RUNTIME'):
    sys.path.insert(0, os.environ['BALATRO_LUA_TEST_RUNTIME'])
from lupa.luajit21 import LuaRuntime

SOURCE = (Path(__file__).resolve().parent.parent / 'bridge/copilot-extension.lua').read_text(encoding='utf-8')
BASE = '''
actions = {}; calls = {sale=0, endless=0}; button = nil
G = {STATE=3, STATES={ROUND_EVAL=1, SHOP=2, SMODS_BOOSTER_OPENED=3}, GAME={won=true}, FUNCS={}, jokers={cards={}}}
G.FUNCS.exit_overlay_menu = function() calls.endless=calls.endless+1; G.OVERLAY_MENU=nil end
G.FUNCS.sell_card = function(e) calls.sale=calls.sale+1 end
state = {connect_info=function() return {phase=G.STATE==1 and 'ROUND_EVAL' or G.STATE==2 and 'SHOP' or 'SMODS_BOOSTER_OPENED'} end}
round_eval = {cash_out_button=function() return button end}
instance = {id=function() return 'game-1' end}
card_ids = {resolve=function(area,id) for _,c in ipairs(area.cards) do if c.id==id then return c end end end,
 hidden=function(area,c) return c.hidden==true end}
function joker(id, allowed) return {id=id, sell_cost=4, can_sell_card=function() return allowed end} end
function win_overlay() G.STATE=1; G.OVERLAY_MENU={get_UIE_by_ID=function(self,id) return id=='from_game_won' and {} or nil end} end
'''

class ExtensionTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime()
        self.lua.execute(BASE)
        self.lua.execute(SOURCE)(*[self.lua.globals()[n] for n in ['actions', 'state', 'round_eval', 'card_ids', 'instance']])

    def check(self, code):
        self.lua.execute(code)

    def test_cash_out_waits_for_actual_button(self):
        self.check("G.STATE=1; assert(not actions.copilot_ui_state().data.cash_out_ready); button={}; assert(actions.copilot_ui_state().data.cash_out_ready)")

    def test_victory_blocks_cash_out(self):
        self.check("win_overlay(); button={}; local s=actions.copilot_ui_state().data; assert(s.overlay=='victory' and not s.cash_out_ready)")

    def test_endless_calls_once_and_observes_close(self):
        self.check("win_overlay(); local r=actions.copilot_continue_endless({}); assert(r.ok and calls.endless==1); assert(r.settle.on_game_update().data.endless_chosen)")

    def test_won_run_options_are_not_victory(self):
        self.check("G.STATE=1; G.OVERLAY_MENU={get_UIE_by_ID=function() return nil end}; assert(actions.copilot_ui_state().data.overlay=='other'); assert(not actions.copilot_continue_endless({}).ok); assert(calls.endless==0)")

    def test_not_won_and_invalid_arguments_never_close(self):
        self.check("win_overlay(); G.GAME.won=false; assert(not actions.copilot_continue_endless({}).ok); G.GAME.won=true; assert(not actions.copilot_continue_endless({foo=1}).ok); assert(calls.endless==0)")

    def test_full_pack_sale_uses_owned_card_and_observes_removal(self):
        self.check("for i=1,5 do G.jokers.cards[i]=joker(i,true) end; local r=actions.copilot_sell_card_in_pack({card_id=3}); assert(r.ok and calls.sale==1); assert(r.settle.on_game_update()==nil); table.remove(G.jokers.cards,3); assert(r.settle.on_game_update().data.sold_in_pack)")

    def test_eternal_hidden_missing_and_extra_arguments_reject(self):
        self.check("G.jokers.cards={joker(1,false),joker(2,true)}; G.jokers.cards[2].hidden=true; for _,args in ipairs({{card_id=1},{card_id=2},{card_id=999},{card_id=1,foo=1},{}}) do assert(not actions.copilot_sell_card_in_pack(args).ok) end; assert(calls.sale==0)")

    def test_outside_pack_and_overlay_never_sell(self):
        self.check("G.jokers.cards={joker(1,true)}; G.STATE=2; assert(not actions.copilot_sell_card_in_pack({card_id=1}).ok); G.STATE=3; G.OVERLAY_MENU={}; assert(not actions.copilot_sell_card_in_pack({card_id=1}).ok); assert(calls.sale==0)")

    def test_settlement_timeouts_are_uncertain(self):
        self.check("G.jokers.cards={joker(1,true)}; local r=actions.copilot_sell_card_in_pack({card_id=1}); assert(r.settle.on_timeout().error_code=='ACTION_UNCERTAIN'); win_overlay(); r=actions.copilot_continue_endless({}); assert(r.settle.on_timeout().error_code=='ACTION_UNCERTAIN')")

if __name__ == '__main__':
    unittest.main()
