# Validation100 patch

- Uses current `main.py` raw-indicator logic and current `index.html` `evaluate()` / `multiSignalRank()`.
- Recomputes +1/+3/+5; does **not** reuse the old +20 WIN/LOSS labels.
- WIN > +1%, FLAT -1%..+1%, LOSS < -1%.
- Excludes earnings-contaminated windows and unverified US-company earnings coverage.
- Merges `signals.json` recent hist and gives it priority over overlapping historical rows.
- Keeps the most recent **100 valid samples per strategy × horizon** for displayed statistics.
- Raw historical/backtest source is marked `BACKTEST`; recent hist is `RECENT_HIST`.

Required repo files: `main.py`, `index.html`, `signals.json`, `private_earnings_history.csv`, `private_earnings_coverage.csv`.
