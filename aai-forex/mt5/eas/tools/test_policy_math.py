#!/usr/bin/env python3
"""Independent Python policy arithmetic model, NOT execution of MQL5 source."""
from decimal import Decimal, ROUND_FLOOR, ROUND_CEILING
import unittest

D=lambda x: Decimal(str(x))
def floor_volume(lots,step):
    return (D(lots)/D(step)).to_integral_value(rounding=ROUND_FLOOR)*D(step)
def price_round(price,tick,direction):
    rounding=ROUND_CEILING if direction>0 else ROUND_FLOOR
    return (D(price)/D(tick)).to_integral_value(rounding=rounding)*D(tick)
def size(equity,loss_per_lot,minimum=.01,step=.01,maximum=100,target=1,cap=2,fixed=0,allow_min=True):
    if not (0<target<=cap<=2) or loss_per_lot<=0:return None
    lots=floor_volume(fixed if fixed else D(equity)*D(target)/100/D(loss_per_lot),step)
    if lots<D(minimum):
        if fixed or not allow_min:return None
        lots=D(minimum)
    lots=floor_volume(min(lots,D(maximum)),step)
    if lots<D(minimum) or lots*D(loss_per_lot)>D(equity)*D(cap)/100:return None
    return lots

def in_hours(hour,start,end):
    return start==end or (start<=hour<end if start<end else hour>=start or hour<end)

class PolicyMath(unittest.TestCase):
    def test_default_target_floor_with_minimum_allowed(self):
        # AUDUSD 12pip SL: 120 per lot + 5 per lot (.5pip) reserve + 7 commission.
        self.assertEqual(size(100,132),D('.01'))
    def test_strict_target_skip(self):
        self.assertIsNone(size(100,132,allow_min=False))
    def test_unaffordable_minimum(self):
        self.assertIsNone(size(100,212))
    def test_gold_atr_stop_unaffordable(self):
        self.assertIsNone(size(100,2007))
    def test_fixed_volume_not_risk_bypass(self):
        self.assertIsNone(size(100,132,fixed=.02))
    def test_fixed_below_minimum_not_forced_up(self):
        self.assertIsNone(size(100,50,fixed=.005))
    def test_step_floor(self):
        self.assertEqual(floor_volume('.037','.01'),D('.03'))
    def test_non_decimal_step(self):
        self.assertEqual(floor_volume('.37','.25'),D('.25'))
    def test_non_decimal_minimum(self):
        self.assertEqual(size(100,2,minimum=.25,step=.25),D('.50'))
    def test_equity_growth_step(self):
        self.assertEqual(size(1000,132),D('.07'))
    def test_equity_loss_can_stall(self):
        self.assertIsNone(size(60,132))
    def test_lot_maximum(self):
        self.assertEqual(size(100000,10,maximum=2),D('2'))
    def test_long_stop_round_outwards(self):
        self.assertEqual(price_round('0.699947','.00001',-1),D('.69994'))
    def test_short_stop_round_outwards(self):
        self.assertEqual(price_round('0.700053','.00001',1),D('.70006'))
    def test_gold_tick_round(self):
        self.assertEqual(price_round('4050.13','.25',-1),D('4050.00'))
    def test_stress_fee_crosses_cap(self):
        self.assertEqual(size(100,199),D('.01'))
        self.assertIsNone(size(100,201))
    def test_cannot_configure_three_percent(self):
        self.assertIsNone(size(100,50,cap=3))
    def test_target_above_cap_invalid(self):
        self.assertIsNone(size(100,50,target=2,cap=1))
    def test_session_wraps_midnight(self):
        self.assertTrue(in_hours(23,22,3));self.assertTrue(in_hours(2,22,3));self.assertFalse(in_hours(3,22,3))
    def test_equal_session_is_all_day(self):
        self.assertTrue(all(in_hours(h,0,0) for h in range(24)))
    def test_normal_session_half_open(self):
        self.assertTrue(in_hours(8,8,11));self.assertFalse(in_hours(11,8,11))
    def test_planned_risk_bound_for_many_accounts(self):
        for eq in range(10,10000,17):
            for loss in (20,50,99,132,199,212,500,2007):
                lots=size(eq,loss)
                if lots is not None:
                    self.assertLessEqual(lots*D(loss),D(eq)*D('.02'))
                    self.assertEqual(lots%D('.01'),0)
    def test_floor_never_increases_valid_fixed_volume(self):
        for value in ('.01','.019','.025','.2','1.003'):
            lots=size(100000,1,fixed=value)
            self.assertLessEqual(lots,D(value))
    def test_conservative_risk_cross_check(self):
        # Actual conversion/contract estimate can be larger than broker-reported tick estimate.
        calc_loss,tick_loss,fee,reserve=D(130),D(120),D(7),D(5)
        self.assertEqual(max(calc_loss,tick_loss)+fee+reserve,D(142))

if __name__=='__main__':unittest.main(verbosity=2)
