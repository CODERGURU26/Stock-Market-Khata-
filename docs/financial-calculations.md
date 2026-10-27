# Financial calculations

Instrument examples may correspond to real listed securities, but seeded holdings, quantities, prices, fees, and computed values are illustrative sample data, not live market information. Values are expressed in the portfolio currency. Quantities, prices, fees, and computed cash flows use Python `Decimal`; JSON outputs are decimal strings.

- BUY: increase units by quantity; add `quantity × unit price + fee` to remaining cost basis.
- Weighted-average cost: remaining cost basis divided by remaining units.
- SELL: reject if requested units exceed confirmed units; reduce remaining cost basis using the pre-sale weighted average; realized P&L is `quantity × sale price − sale fee − quantity × average cost`.
- Current value: units held × latest manually entered simulated price.
- Unrealized P&L: current value − remaining cost basis.
- Total invested: cumulative confirmed buy gross value plus buy fees.
- Realized P&L: sum of confirmed sale proceeds less sale fees and allocated weighted-average basis.
- Total fees: sum of fees for all confirmed buys and sells.
- Allocation: current value grouped by stock. Portfolios in a single account share a base currency because currency conversion is not implemented; this keeps account-wide totals meaningful.

New positions only reflect `CONFIRMED` transactions. A simulated valuation update changes current value and unrealized P&L but never rewrites an original transaction digest.
