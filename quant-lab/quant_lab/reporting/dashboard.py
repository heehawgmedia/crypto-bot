"""Self-contained HTML dashboard rendered from the audit database.

Everything on the page comes from local data (SQLite audit DB + config): trade
history reconstructed from fills, cumulative realized PnL, the vault ledger,
strategy pipeline state, and recent audit events. The output is a single HTML
file with inline CSS/SVG — no external requests, safe to open anywhere.

Palette: validated categorical/status slots from the dataviz reference palette
(light and dark selected per mode via CSS custom properties).
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from quant_lab.audit.log import AuditLog
from quant_lab.config import AppConfig, StrategyInstanceConfig


@dataclass
class TradeRow:
    strategy: str
    mode: str
    symbol: str
    entry_time: str
    exit_time: str | None  # None -> open
    qty: float
    entry_price: float
    exit_price: float | None
    pnl_usd: float | None  # None while open
    pnl_pct: float | None
    exit_reason: str | None
    vault_skim: float


@dataclass
class _OpenPos:
    entry_time: str
    qty: float
    entry_price: float
    entry_fee: float
    symbol: str


def build_trades(audit: AuditLog) -> list[TradeRow]:
    """Pair buy/sell fills chronologically per (strategy, mode) into trades."""
    reasons = {row["id"]: row["reason"] for row in audit.orders()}
    skims: dict[int, float] = {}
    for row in audit.vault_ledger():
        if row["kind"] == "skim" and row["ref_order_id"] is not None:
            skims[int(row["ref_order_id"])] = float(row["amount_usd"])

    open_positions: dict[tuple[str, str], _OpenPos] = {}
    trades: list[TradeRow] = []
    for f in audit.fills():
        key = (f["strategy"], f["mode"])
        if f["side"] == "buy":
            open_positions[key] = _OpenPos(
                entry_time=f["ts_utc"],
                qty=float(f["qty"]),
                entry_price=float(f["price"]),
                entry_fee=float(f["fee_usd"]),
                symbol=f["symbol"],
            )
        else:
            entry = open_positions.pop(key, None)
            if entry is None:
                continue  # sell without a recorded entry (pre-existing book)
            cost = entry.qty * entry.entry_price + entry.entry_fee
            proceeds = float(f["qty"]) * float(f["price"]) - float(f["fee_usd"])
            pnl = proceeds - cost
            trades.append(
                TradeRow(
                    strategy=f["strategy"],
                    mode=f["mode"],
                    symbol=f["symbol"],
                    entry_time=entry.entry_time,
                    exit_time=f["ts_utc"],
                    qty=float(f["qty"]),
                    entry_price=entry.entry_price,
                    exit_price=float(f["price"]),
                    pnl_usd=pnl,
                    pnl_pct=(pnl / cost * 100.0) if cost else None,
                    exit_reason=reasons.get(f["order_id"]) or "signal",
                    vault_skim=skims.get(int(f["order_id"]), 0.0),
                )
            )
    for (strategy, mode), entry in open_positions.items():
        trades.append(
            TradeRow(
                strategy=strategy,
                mode=mode,
                symbol=entry.symbol,
                entry_time=entry.entry_time,
                exit_time=None,
                qty=entry.qty,
                entry_price=entry.entry_price,
                exit_price=None,
                pnl_usd=None,
                pnl_pct=None,
                exit_reason=None,
                vault_skim=0.0,
            )
        )
    trades.sort(key=lambda t: t.entry_time)
    return trades


def _fmt_ts(ts: str | None) -> str:
    if ts is None:
        return "—"
    return ts[:16].replace("T", " ")


def _money(v: float) -> str:
    sign = "-" if v < 0 else ""
    return f"{sign}${abs(v):,.2f}"


def _cumulative_pnl_svg(trades: list[TradeRow]) -> str:
    closed = [t for t in trades if t.pnl_usd is not None and t.exit_time]
    if len(closed) < 2:
        return '<p class="empty">Not enough closed trades to chart yet.</p>'
    closed.sort(key=lambda t: t.exit_time or "")
    cumulative: list[float] = []
    total = 0.0
    for t in closed:
        total += t.pnl_usd or 0.0
        cumulative.append(total)

    width, height, pad = 720, 220, 14
    lo = min(0.0, min(cumulative))
    hi = max(0.0, max(cumulative))
    span = (hi - lo) or 1.0
    n = len(cumulative)

    def x(i: int) -> float:
        return pad + i * (width - 2 * pad) / max(n - 1, 1)

    def y(v: float) -> float:
        return pad + (hi - v) * (height - 2 * pad) / span

    points = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(cumulative))
    zero_y = y(0.0)
    dots = "".join(
        f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="4" fill="var(--series-1)">'
        f"<title>{html.escape(closed[i].strategy)} · exit {_fmt_ts(closed[i].exit_time)} · "
        f"trade {_money(closed[i].pnl_usd or 0)} · cumulative {_money(v)}</title></circle>"
        for i, v in enumerate(cumulative)
    )
    return f"""<svg viewBox="0 0 {width} {height}" role="img"
      aria-label="Cumulative realized PnL across {n} closed trades">
      <line x1="{pad}" y1="{zero_y:.1f}" x2="{width - pad}" y2="{zero_y:.1f}"
            stroke="var(--grid)" stroke-width="1" stroke-dasharray="4 4"/>
      <polyline points="{points}" fill="none" stroke="var(--series-1)"
                stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      {dots}
      <text x="{pad}" y="{zero_y - 6:.1f}" class="axis-label">$0</text>
      <text x="{width - pad}" y="{y(cumulative[-1]) - 8:.1f}" text-anchor="end"
            class="chart-label">{_money(cumulative[-1])}</text>
    </svg>"""


def _per_trade_svg(trades: list[TradeRow]) -> str:
    closed = [t for t in trades if t.pnl_usd is not None][-40:]  # latest 40
    if not closed:
        return '<p class="empty">No closed trades yet.</p>'
    width, height, pad = 720, 180, 14
    hi = max(0.0, max(t.pnl_usd or 0 for t in closed))
    lo = min(0.0, min(t.pnl_usd or 0 for t in closed))
    span = (hi - lo) or 1.0
    n = len(closed)
    slot = (width - 2 * pad) / n
    bar_w = max(3.0, slot - 2)  # 2px surface gap between bars

    def y(v: float) -> float:
        return pad + (hi - v) * (height - 2 * pad) / span

    zero_y = y(0.0)
    bars = []
    for i, t in enumerate(closed):
        v = t.pnl_usd or 0.0
        top = min(y(v), zero_y)
        h = max(abs(y(v) - zero_y), 1.0)
        color = "var(--win)" if v >= 0 else "var(--loss)"
        bars.append(
            f'<rect x="{pad + i * slot:.1f}" y="{top:.1f}" width="{bar_w:.1f}" '
            f'height="{h:.1f}" rx="2" fill="{color}">'
            f"<title>{html.escape(t.strategy)} · exit {_fmt_ts(t.exit_time)} · "
            f"{_money(v)} ({t.pnl_pct:+.2f}%)</title></rect>"
        )
    return f"""<svg viewBox="0 0 {width} {height}" role="img"
      aria-label="Per-trade profit and loss, latest {n} closed trades">
      <line x1="{pad}" y1="{zero_y:.1f}" x2="{width - pad}" y2="{zero_y:.1f}"
            stroke="var(--grid)" stroke-width="1"/>
      {"".join(bars)}
    </svg>"""


def render_dashboard(
    cfg: AppConfig,
    audit: AuditLog,
    strategies: list[StrategyInstanceConfig],
) -> str:
    trades = build_trades(audit)
    closed = [t for t in trades if t.pnl_usd is not None]
    wins = [t for t in closed if (t.pnl_usd or 0) > 0]
    total_pnl = sum(t.pnl_usd or 0 for t in closed)
    totals = audit.vault_totals()
    vault_balance = audit.vault_balance()
    tripped, ks_reason, _ = audit.kill_switch_state()

    def stat(label: str, value: str, sub: str = "", cls: str = "") -> str:
        return (
            f'<div class="stat {cls}"><div class="stat-label">{label}</div>'
            f'<div class="stat-value">{value}</div>'
            f'<div class="stat-sub">{sub}</div></div>'
        )

    stats = "".join(
        [
            stat(
                "Realized PnL",
                _money(total_pnl),
                f"{len(closed)} closed trades",
                "good" if total_pnl >= 0 else "bad",
            ),
            stat(
                "Win rate",
                f"{(100 * len(wins) / len(closed)):.0f}%" if closed else "—",
                f"{len(wins)} wins / {len(closed) - len(wins)} losses",
            ),
            stat(
                "Vault balance",
                _money(vault_balance),
                f"{cfg.vault.skim_pct:g}% of each win" if cfg.vault.enabled else "vault disabled",
                "vault",
            ),
            stat(
                "Kill switch",
                "TRIPPED" if tripped else "Armed",
                html.escape(ks_reason or "all clear") if tripped else "all clear",
                "bad" if tripped else "good",
            ),
        ]
    )

    strategy_cards = []
    for scfg in strategies:
        stage = audit.get_stage(scfg.name)
        state = audit.get_paper_state(scfg.name)
        pos = "flat"
        equity = ""
        if state is not None:
            units = float(state["units"])
            if units > 0:
                pos = f"long {units:.6f}"
            equity = f"cash {_money(float(state['cash_usd']))}"
        started = audit.paper_started_at(scfg.name)
        paper_days = ""
        if started is not None and stage in ("paper", "live"):
            days = (datetime.now(UTC) - started).total_seconds() / 86_400
            paper_days = f"paper day {days:.0f}/{cfg.promotion.min_paper_days}"
        strategy_cards.append(
            f"""<div class="card strategy">
              <div class="strategy-head">
                <span class="strategy-name">{html.escape(scfg.name)}</span>
                <span class="badge badge-{html.escape(stage)}">{html.escape(stage)}</span>
              </div>
              <div class="strategy-meta">{html.escape(scfg.strategy)} · {html.escape(scfg.symbol)}
                · {html.escape(scfg.timeframe)} · {html.escape(scfg.exchange)}</div>
              <div class="strategy-meta">{pos}{" · " + equity if equity else ""}
                {" · " + paper_days if paper_days else ""}</div>
            </div>"""
        )

    trade_rows = []
    for t in reversed(trades):
        if t.pnl_usd is None:
            pnl_cell = '<td class="num open-tag">open</td><td class="num">—</td>'
        else:
            cls = "pos" if t.pnl_usd >= 0 else "neg"
            pnl_cell = (
                f'<td class="num {cls}">{_money(t.pnl_usd)}</td>'
                f'<td class="num {cls}">{t.pnl_pct:+.2f}%</td>'
            )
        skim_cell = _money(t.vault_skim) if t.vault_skim else "—"
        trade_rows.append(
            f"""<tr>
              <td>{html.escape(t.strategy)}</td>
              <td><span class="mode-{t.mode}">{t.mode}</span></td>
              <td>{html.escape(t.symbol)}</td>
              <td>{_fmt_ts(t.entry_time)}</td>
              <td>{_fmt_ts(t.exit_time)}</td>
              <td class="num">{t.qty:.6f}</td>
              <td class="num">{t.entry_price:,.2f}</td>
              <td class="num">{f"{t.exit_price:,.2f}" if t.exit_price else "—"}</td>
              {pnl_cell}
              <td>{html.escape(t.exit_reason or "—")}</td>
              <td class="num vault-cell">{skim_cell}</td>
            </tr>"""
        )
    trades_table = (
        """<table><thead><tr>
          <th>Strategy</th><th>Mode</th><th>Symbol</th><th>Entry</th><th>Exit</th>
          <th class="num">Qty</th><th class="num">Entry $</th><th class="num">Exit $</th>
          <th class="num">PnL $</th><th class="num">PnL %</th><th>Exit reason</th>
          <th class="num">Vault skim</th>
        </tr></thead><tbody>"""
        + "".join(trade_rows)
        + "</tbody></table>"
        if trades
        else '<p class="empty">No trades recorded yet — they appear here as paper/live fills happen.</p>'
    )

    ledger_rows = []
    for row in reversed(audit.vault_ledger()[-30:]):
        kind = str(row["kind"])
        sign = "+" if kind == "skim" else "−"
        who = row["strategy"] or "—"
        note = row["note"] or ""
        ledger_rows.append(
            f"""<tr><td>{_fmt_ts(row["ts_utc"])}</td>
            <td><span class="ledger-{kind}">{kind}</span></td>
            <td class="num">{sign}{_money(float(row["amount_usd"]))}</td>
            <td>{html.escape(str(who))}</td><td>{html.escape(str(note))}</td></tr>"""
        )
    ledger_table = (
        """<table><thead><tr><th>When (UTC)</th><th>Type</th><th class="num">Amount</th>
        <th>Strategy</th><th>Note</th></tr></thead><tbody>"""
        + "".join(ledger_rows)
        + "</tbody></table>"
        if ledger_rows
        else '<p class="empty">No vault activity yet — 15% of each winning trade lands here.</p>'
    )

    events_rows = "".join(
        f"""<tr><td>{_fmt_ts(row["ts_utc"])}</td><td>{html.escape(str(row["kind"]))}</td>
        <td>{html.escape(str(row["strategy"] or "—"))}</td></tr>"""
        for row in reversed(audit.events()[-15:])
    )

    generated = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    cap = cfg.risk.max_capital_usd
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Heehaw&#39;s Lab</title>
<style>
:root {{
  color-scheme: light dark;
  --surface: #fcfcfb; --card: #ffffff; --border: #e7e6e1; --grid: #d9d8d2;
  --ink: #0b0b0b; --ink-2: #52514e; --ink-3: #8a897f;
  --series-1: #2a78d6; --win: #1baf7a; --loss: #e34948;
  --vault: #4a3aa7; --good: #008300; --bad: #e34948;
}}
@media (prefers-color-scheme: dark) {{
  :root {{
    --surface: #131312; --card: #1a1a19; --border: #2c2b29; --grid: #3a3936;
    --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #8a897f;
    --series-1: #3987e5; --win: #199e70; --loss: #e66767;
    --vault: #9085e9; --good: #34c759; --bad: #e66767;
  }}
}}
* {{ box-sizing: border-box; margin: 0; }}
body {{
  background: var(--surface); color: var(--ink);
  font: 14px/1.5 -apple-system, "Segoe UI", system-ui, Roboto, sans-serif;
  padding: 28px; max-width: 1100px; margin: 0 auto;
}}
h1 {{ font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }}
h2 {{ font-size: 13px; font-weight: 600; text-transform: uppercase;
     letter-spacing: 0.06em; color: var(--ink-3); margin: 0 0 12px; }}
.header {{ display: flex; justify-content: space-between; align-items: baseline;
          margin-bottom: 20px; flex-wrap: wrap; gap: 8px; }}
.header .meta {{ color: var(--ink-2); font-size: 13px; }}
.stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
         gap: 12px; margin-bottom: 20px; }}
.stat {{ background: var(--card); border: 1px solid var(--border);
        border-radius: 12px; padding: 16px 18px; }}
.stat-label {{ font-size: 12px; color: var(--ink-3); font-weight: 600;
              text-transform: uppercase; letter-spacing: 0.05em; }}
.stat-value {{ font-size: 26px; font-weight: 700; letter-spacing: -0.02em;
              margin: 2px 0; font-variant-numeric: tabular-nums; }}
.stat-sub {{ font-size: 12px; color: var(--ink-2); }}
.stat.good .stat-value {{ color: var(--good); }}
.stat.bad .stat-value {{ color: var(--bad); }}
.stat.vault {{ border-color: var(--vault); }}
.stat.vault .stat-value {{ color: var(--vault); }}
.card {{ background: var(--card); border: 1px solid var(--border);
        border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }}
.grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
@media (max-width: 800px) {{ .grid-2 {{ grid-template-columns: 1fr; }} }}
svg {{ width: 100%; height: auto; display: block; }}
.axis-label, .chart-label {{ font-size: 11px; fill: var(--ink-3); }}
.chart-label {{ font-weight: 700; fill: var(--ink); }}
.table-wrap {{ overflow-x: auto; }}
table {{ border-collapse: collapse; width: 100%; font-size: 13px; }}
th {{ text-align: left; color: var(--ink-3); font-size: 11px; text-transform: uppercase;
     letter-spacing: 0.05em; padding: 6px 10px; border-bottom: 1px solid var(--border); }}
td {{ padding: 7px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }}
tr:last-child td {{ border-bottom: none; }}
.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
.pos {{ color: var(--win); font-weight: 600; }}
.neg {{ color: var(--loss); font-weight: 600; }}
.open-tag {{ color: var(--series-1); font-weight: 600; }}
.vault-cell {{ color: var(--vault); font-weight: 600; }}
.badge {{ font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px;
         text-transform: uppercase; letter-spacing: 0.04em; }}
.badge-candidate {{ background: var(--border); color: var(--ink-2); }}
.badge-validated {{ background: color-mix(in srgb, var(--series-1) 15%, transparent);
                   color: var(--series-1); }}
.badge-paper {{ background: color-mix(in srgb, var(--win) 15%, transparent);
               color: var(--win); }}
.badge-live {{ background: color-mix(in srgb, var(--loss) 15%, transparent);
              color: var(--loss); }}
.strategy-head {{ display: flex; justify-content: space-between; align-items: center; }}
.strategy-name {{ font-weight: 650; }}
.strategy-meta {{ color: var(--ink-2); font-size: 12.5px; margin-top: 3px; }}
.mode-paper {{ color: var(--win); font-weight: 600; }}
.mode-live {{ color: var(--loss); font-weight: 700; }}
.ledger-skim {{ color: var(--vault); font-weight: 600; }}
.ledger-withdraw, .ledger-redistribute {{ color: var(--ink-2); font-weight: 600; }}
.empty {{ color: var(--ink-3); padding: 18px 0; }}
.vault-actions {{ font-size: 12.5px; color: var(--ink-2); margin-top: 10px; }}
code {{ background: var(--surface); border: 1px solid var(--border);
       border-radius: 5px; padding: 1px 6px; font-size: 12px; }}
</style></head><body>
<div class="header">
  <h1>Heehaw&#39;s Lab</h1>
  <div class="meta">mode <strong>{cfg.mode.value}</strong>
   · capital cap <strong>{_money(cap) if cap is not None else "not set"}</strong>
   · generated {generated}</div>
</div>

<div class="stats">{stats}</div>

<div class="grid-2">
  <div class="card"><h2>Cumulative realized PnL</h2>{_cumulative_pnl_svg(trades)}</div>
  <div class="card"><h2>Per-trade PnL (latest 40)</h2>{_per_trade_svg(trades)}</div>
</div>

<div class="card">
  <h2>Vault · {_money(vault_balance)}</h2>
  <div class="stats" style="margin-bottom:12px">
    {stat("Total skimmed", _money(totals["skim"]), f"{cfg.vault.skim_pct:g}% of winning trades")}
    {stat("Withdrawn", _money(totals["withdraw"]), "left the system")}
    {stat("Redistributed", _money(totals["redistribute"]), "returned to trading capital")}
  </div>
  <div class="table-wrap">{ledger_table}</div>
  <div class="vault-actions">Manage: <code>quant-lab vault withdraw --amount X</code>
   · <code>quant-lab vault redistribute --amount X</code></div>
</div>

<div class="card"><h2>Strategies</h2>{"".join(strategy_cards) or '<p class="empty">No strategy YAMLs found.</p>'}</div>

<div class="card"><h2>Trades</h2><div class="table-wrap">{trades_table}</div></div>

<div class="card"><h2>Recent audit events</h2><div class="table-wrap">
<table><thead><tr><th>When (UTC)</th><th>Event</th><th>Strategy</th></tr></thead>
<tbody>{events_rows or '<tr><td colspan="3" class="empty">none yet</td></tr>'}</tbody></table>
</div></div>
</body></html>"""


def write_dashboard(
    cfg: AppConfig,
    audit: AuditLog,
    strategies: list[StrategyInstanceConfig],
    out: Path,
) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_dashboard(cfg, audit, strategies), encoding="utf-8")
    return out
