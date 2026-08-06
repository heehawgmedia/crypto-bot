"""Stop-loss / take-profit / cooldown rules, shared by every execution surface.

Semantics (identical in backtest, paper, and live — this is the point):

- Levels are set from the actual entry fill price: stop = entry*(1 - sl%),
  target = entry*(1 + tp%).
- The trigger is evaluated on each COMPLETED bar while holding: bar low at or
  below the stop, or bar high at or above the target. The exit executes at the
  next opportunity (next bar open in the backtest; the current poll in
  paper/live) — never at the stop price itself, because this system works from
  closed candles and does not rest stop orders on the exchange.
- If both stop and target are touched within one bar, the STOP wins
  (worst-case assumption).
- After a stop or target exit, re-entry requires the strategy signal to drop
  to 0 first (a fresh rising edge) — otherwise a still-long signal would
  instantly re-buy into the same move.
- ``cooldown_bars`` additionally blocks new entries for N bars after any
  stop/target exit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from quant_lab.config import StrategyInstanceConfig


@dataclass(frozen=True)
class TradeRules:
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None
    cooldown_bars: int = 0

    @property
    def active(self) -> bool:
        return (
            self.stop_loss_pct is not None
            or self.take_profit_pct is not None
            or self.cooldown_bars > 0
        )

    @classmethod
    def from_strategy(cls, scfg: StrategyInstanceConfig) -> TradeRules:
        return cls(
            stop_loss_pct=scfg.stop_loss_pct,
            take_profit_pct=scfg.take_profit_pct,
            cooldown_bars=scfg.cooldown_bars,
        )

    def stop_level(self, entry_price: float) -> float | None:
        if self.stop_loss_pct is None:
            return None
        return entry_price * (1.0 - self.stop_loss_pct / 100.0)

    def target_level(self, entry_price: float) -> float | None:
        if self.take_profit_pct is None:
            return None
        return entry_price * (1.0 + self.take_profit_pct / 100.0)

    def exit_trigger(
        self, entry_price: float, bar_low: float, bar_high: float
    ) -> str | None:
        """'stop_loss' / 'take_profit' if the completed bar touched a level
        (stop wins when both), else None."""
        stop = self.stop_level(entry_price)
        if stop is not None and bar_low <= stop:
            return "stop_loss"
        target = self.target_level(entry_price)
        if target is not None and bar_high >= target:
            return "take_profit"
        return None


NO_RULES = TradeRules()
