Validation100 v2

1. Replace index.html with included index.html. Other UI/strategy code is unchanged.
2. Put validation100_prepare.py and validation100.js in repository root.
3. Put .github/workflows/validation100.yml in the same path.
4. Existing private_earnings_history.csv AND private_earnings_coverage.csv are required for the initial seed. If coverage is missing, the initial seed intentionally aborts instead of assuming no earnings.
5. First Action run performs one heavy historical seed build. Later runs skip yfinance historical backfill and only merge recent signals.json hist, re-score with current evaluate(), and update the tiny summary.
6. WIN > +1%, FLAT -1%..+1%, LOSS < -1%; BMO/AMC/UNKNOWN affected closes are treated separately; max 100 valid samples per strategy×horizon.
