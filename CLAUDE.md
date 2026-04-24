# CLAUDE.md — Master Reference for Polymarket AI Trading Bot

**This is the definitive reference for any AI working on this codebase. Read before making ANY changes.**

---

## SYSTEM OVERVIEW

**What:** Autonomous AI trading bot for Polymarket (prediction markets) with Python backtest validation.

**Architecture:** 
- **TypeScript/Node.js** (src/) — Live trading engine, dashboard, APIs
- **Python** (backtest/) — Historical backtesting, semantic matching, robustness validation

**Core Philosophy:** 
> Assume NO edge exists until proven by robust statistics. One system-invalidating bug = entire system invalid.

---

## PART 1: CRITICAL INVARIANTS (READ FIRST)

### Safety Constraints (NEVER VIOLATE)

| Rule | Why | Location |
|------|-----|----------|
| Never trade without PRIVATE_KEY when DRY_RUN=false | Prevents accidental live trading | Config.ts:122-126 |
| Never use current time in backtest signals | Lookahead bias kills validation | data_collector.py, strategy.py |
| Consensus snapshots must predate price observation | Temporal order is causal | data_collector.py:metaculus_prob_history |
| Always include 2% Polymarket taker fee in edge calcs | Fee is real cost, not optional | EdgeCalculator.ts, backtest/strategy.py |
| Max position size = MIN(5% bankroll, Kelly×0.25) | Kelly is theoretical, reality is worse | KellyCalculator.ts, RiskManager.ts |
| Drawdown circuit breaker: 15% trigger, 25% hard stop | Catastrophe defense, no auto-reset | RiskManager.ts |
| Never permute outcomes globally in shuffle test | Breaks correlation structure in negRisk | robustness.py:shuffle_test() |

### Data Quality Rules

| Rule | Why | When |
|------|-----|------|
| Filter markets: price 3%-97% only | Avoid near-certain outcomes | MarketScanner.filter() |
| Require liquidity ≥ MIN_LIQUIDITY (5k default) | Execution slippage scales with size/liq | EdgeCalculator.ts |
| Require quality score ≥ 40/100 | Low-quality markets = unreliable signals | MarketQualityAnalyzer.ts |
| Embargo 14 days before market close | Avoid noisy/crowded endgame signals | backtest.py:run() |
| Concordance ≥ 70% on matched pairs | Semantic matching alone is insufficient | question_matcher.py |

### Probability Rules

| Rule | Why | Implementation |
|------|-----|-----------------|
| No blended P_true (sim×cp + (1-sim)×market) | Invalid formula, no statistical basis | Use direct edge = cp - market_price |
| Consensus only from pre-resolution snapshots | Post-resolution consensus is ~1.0 or ~0.0 | get_metaculus_prob_at(as_of=price_date) |
| Min forecasters = 20 for Metaculus signals | <20 is too noisy to trust | strategy.py:MIN_FORECASTERS |
| Min days to resolution = 7 | Short-horizon signals are crowded | strategy.py:MIN_DAYS_TO_RESOLUTION |

### NegRisk Markets (Special Handling)

| Rule | Why | Code |
|------|-----|------|
| Group by neg_risk_group_id, NOT end_date | Different events can share end_date | strategy.py:NegRiskArbitrage |
| Mutually exclusive outcomes = 1 signal per group | All outcomes in group are correlated | backtest.py:event_exposure |
| Cluster-stratified shuffle in tests | Global shuffle breaks within-group structure | robustness.py:shuffle_test() |

---

## PART 2: VALIDATION REQUIREMENTS

### Backtest Must Pass ALL Criteria (OR: EDGE NÃO COMPROVADO)

**Primary (7 checks):**
- N_trades ≥ 1500 (statistical power requirement)
- Skill Score > 0.05
- Skill Score 95% CI lower > 0.02 (bootstrap)
- Mean EV > 0.5% per trade
- Drawdown < 20% of bankroll
- WR excess > 3 percentage points (vs market price expectation)
- Sharpe proxy ≥ 1.5

**Integrity (3 checks):**
- Match concordance ≥ 70% (semantic matching validated empirically)
- Shuffle test z > 2.576 (cluster-stratified, p≈0.005)
- Threshold stable (skill ±20% across similarity 0.75–0.90)

**Robustness (10 tests, 4 must pass):**
1. Threshold sensitivity — skill stable
2. Shuffle null-model — skill > 2.576 sigma
3. Ablation by source — ≥1 source positive alone
4. Placebo matching — skill collapses on random p_true
5. Noise injection — monotone degradation
6. Execution stress — survives 2× slippage
7. Latency stress — survives 30s latency
8. Edge decay — horizon distribution not <7d heavy
9. Cluster concentration — PnL not >70% in top 20% events
10. Forecaster density — no availability bias

**Any failure = EDGE NÃO COMPROVADO. No exceptions.**

### Backtest Design Rules

| Component | Rule | Code |
|-----------|------|------|
| Walk-forward split | 60% train (by resolution_date), 40% test | backtest.py:run() |
| Embargo period | 14 days between last train signal and first test signal | backtest.py:embargo_days=14 |
| Signal deduplication | One per (market_id, side) per week | strategy.py:generate_all_signals() |
| Event exposure cap | Max 10% bankroll per event_group_id | backtest.py:MAX_EVENT_EXPOSURE_PCT |
| Execution simulation | Dynamic spread, depth proxy, fill probability, latency, impact | backtest.py:_simulate_execution() |
| Bootstrap CI | 1000 resamples, 95% CI on Skill Score | backtest.py:run() |

---

## PART 3: ARCHITECTURE & FILE RESPONSIBILITIES

### TypeScript/Node.js (Live Trading)

**Core Orchestration:**
- `src/index.ts` — Entry point, starts TradingEngine + DashboardServer
- `src/engine/TradingEngine.ts` — Main loop (every 60s): scan → analyze → execute → monitor
- `src/engine/MarketScanner.ts` — Fetch markets from Gamma API, apply quality filters
- `src/engine/TradeAnalyzer.ts` — Chain: ProbabilityEstimator → EdgeCalculator → rank signals

**Execution & Monitoring:**
- `src/engine/TradeExecutor.ts` — Execute top 3 signals after risk checks + optional Claude veto
- `src/engine/PositionMonitor.ts` — Trailing stops, time decay, momentum exits, edge reversal
- `src/engine/HealthMonitor.ts` — API health, order latency, sync status

**Analysis (Probability & Risk):**
- `src/analysis/ProbabilityEstimator.ts` — 8 signals: liquidity, spread, time decay, extremity, volume, age, calibration, consensus
- `src/analysis/EdgeCalculator.ts` — edge = p_true - p_market (after 2% fee)
- `src/analysis/KellyCalculator.ts` — Position sizing: Kelly×0.25 (conservative)
- `src/analysis/BayesianCalibrator.ts` — Online calibration of signal weights
- `src/analysis/CorrelationAnalyzer.ts` — Multi-leg arbitrage detection (negRisk groups)
- `src/risk/RiskManager.ts` — Drawdown guard, daily loss, position limits, category caps

**External APIs:**
- `src/services/GammaApiClient.ts` — Polymarket markets + prices + liquidity
- `src/services/ClobApiClient.ts` — Order placement + book queries
- `src/services/ClaudeAnalyzer.ts` — LLM probability veto (optional, rate-limited)
- `src/services/ConsensusClient.ts` — Metaculus + Manifold lookups (budget-limited)
- `src/services/NewsApiClient.ts` — Recent news by keyword

**Dashboard & Auth:**
- `src/dashboard/DashboardServer.ts` — Express + Socket.IO, live events, read-only monitoring
- `src/auth/AuthService.ts` — JWT + bcrypt password hashing
- `public/` — HTML/CSS/JS frontend

**Utilities:**
- `src/utils/Logger.ts` — Structured JSON logging, emoji icons
- `src/utils/TradeJournal.ts` — Persistent trade history (data/trade_history.json)
- `src/utils/PerformanceMetrics.ts` — PnL, Sharpe, Brier, win rate
- `src/engine/Config.ts` — Config loading + validation from .env

### Python (Backtesting)

**Pipeline:**
- `backtest/run.py` — Orchestrator: collect → match → signal → backtest → validate → robustness
- `backtest/data_collector.py` — Fetch Polymarket, Metaculus, Manifold; store in SQLite
- `backtest/question_matcher.py` — Semantic matching (similarity, dates, entities, structure)
- `backtest/strategy.py` — Signal generators: ConsensusArbitrage + NegRiskArbitrage
- `backtest/backtest.py` — Walk-forward engine: execution simulation, metrics
- `backtest/validator.py` — Verdict logic (9 primary + 3 integrity checks)
- `backtest/robustness.py` — 10-test suite

**Database (SQLite):**
```
poly_markets, poly_prices, poly_resolutions
metaculus_questions, metaculus_prob_history
manifold_markets, manifold_prob_history
matched_pairs
```

---

## PART 4: DEVELOPMENT PRINCIPLES

### Before Touching Code

1. **Understand the failure mode.** What exact condition breaks the system?
2. **Know your invariant.** What rule would prevent the failure?
3. **Implement the check.** Add validation, not just the fix.
4. **Test with backtest.** Does historical data expose the failure?
5. **Add robustness test.** Can we catch this failure in the future?

### What NOT to Do

| Anti-Pattern | Why It's Bad | Counter |
|--------------|-------------|---------|
| Tune parameters to improve backtest results | Overfitting: parameters fit noise, not signal | Justify params from external domain knowledge only |
| Use current time in backtest analysis | Lookahead bias invalidates entire backtest | Timestamp all data explicitly; use price_date |
| Trust semantic similarity alone | High similarity ≠ same outcome | Require concordance ≥ 70% empirically |
| Blend probabilities arbitrarily | No statistical basis for weighting | Use direct edge formula or ensemble with proven weights |
| Ignore Polymarket 2% taker fee | Fee is real, reduces EV significantly | Include in all EV / Kelly calculations |
| Smooth over execution friction | Slippage is real cost, hides fragility | Simulate realistic spread + fill probability + latency |
| Force a trade based on "feeling" | Removes edge discipline | ALL trades must pass edge > MIN_EDGE filter |
| Assume previous data applies to future | Markets regime-shift; edge decays | Backtest on historical-only data; validate live ≠ backtest |

### Code Style & Structure

**TypeScript:**
- Use strict mode (`"strict": true` in tsconfig.json)
- All external API calls have retry logic + exponential backoff
- Rate limits tracked as budgets (e.g., CLAUDE_MAX_CALLS_PER_CYCLE)
- Events emitted for side effects (trades, exits, alerts) → dashboard via Socket.IO

**Python:**
- Type hints on all function signatures
- No global state; pass conn (SQLite) explicitly
- Anti-lookahead: use `as_of` timestamps in all lookups
- Deterministic RNG (np.random.default_rng(seed=42)) for reproducibility

---

## PART 5: RUNNING & TESTING

### Start Live Bot
```bash
npm run dev      # Development
npm start        # Production (after npm run build)
```
Bot opens dashboard at http://localhost:3000 (login required).

### Run Unit/Integration Tests
```bash
npm test
```
All tests in `tests/` must pass before commit.

### Run Backtest
```bash
cd backtest
python run.py                    # Full pipeline
python run.py --skip-collect --skip-match  # Reuse data (fast)
```

**First run:** Returns EDGE NÃO COMPROVADO (no Metaculus history). Run `python price_recorder.py &` for 2-4 weeks, then re-run.

---

## PART 6: ENVIRONMENT VARIABLES

**Required (MUST SET):**
- `PRIVATE_KEY` — Wallet key (live only)
- `CLAUDE_API_KEY` — If CLAUDE_ENABLED=true

**Important Defaults:**
- `DRY_RUN=true` — Simulation mode (safe default)
- `BANKROLL=1000` — Starting capital in USDC
- `MIN_EDGE=0.01` — 1% edge filter
- `KELLY_FRACTION=0.25` — 1/4 Kelly (conservative)
- `MAX_POSITION_PCT=0.05` — 5% per trade
- `SCAN_INTERVAL_MS=60000` — 60s scan loop

See `src/engine/Config.ts` for all variables and validation ranges.

---

## PART 7: COMMITS & PULL REQUESTS

**Commit Message Format:**
```
<type>: <description>

Detailed explanation if needed. Include issue/PR numbers.

https://claude.ai/code/session_<SESSION_ID>
```

**Types:**
- `feat:` New feature
- `fix:` Bug fix (always explain: what was broken, why, what's the fix?)
- `refactor:` Code reorganization (no behavior change)
- `test:` Add/update tests
- `docs:` Documentation only

**Before Pushing:**
1. `npm test` — All tests pass
2. `npm run build` — No TypeScript errors
3. Review backtest.py syntax: `python -m py_compile backtest/*.py`
4. One commit per logical change (no "Fix fix fix" chains)

---

## PART 8: DEBUGGING CHECKLIST

**Bot won't start:**
- Check `.env` has PRIVATE_KEY (or DRY_RUN=true)
- Run `npm run build` — any TypeScript errors?
- Check `src/index.ts` — entry point calls `engine.start()`

**No trades executing:**
- Check decision log in dashboard ("Decision Log" tab)
- Look for edge filter reasons (edge too low? liquidity too low?)
- Review RiskManager.checkTrade() rejection reasons in logs
- Verify MIN_EDGE in .env (default 1%)

**Wrong edge calculation:**
- Check ProbabilityEstimator.estimate() — is P_true reasonable?
- Check EdgeCalculator.calculateEdge() — does it include 2% fee?
- Verify market price from Gamma API (check ClobApiClient.getBook())

**Backtest shows EDGE NÃO COMPROVADO:**
- Check which criterion failed (look at validator.py output)
- If N_trades too low: need more historical data (run price_recorder.py longer)
- If shuffle z too low: edge may be noise; try harder ensemble or drop weak signals
- If concordance low: matching quality insufficient; increase threshold or add manual validation

**API rate limit errors:**
- Check CLAUDE_MAX_CALLS_PER_CYCLE (default 5)
- Check NEWS_API_KEY usage (100 req/day free tier)
- Check Metaculus budget (CONSENSUS_MAX_PER_CYCLE)
- Implement caching if hitting limits (SettingsService model)

---

## PART 9: FORBIDDEN OPERATIONS

🚫 **Never do any of these without explicit approval:**
1. Disable PRIVATE_KEY check in live mode
2. Use future data (prices, resolutions, news) in signal generation
3. Skip the 2% taker fee in any cost calculation
4. Modify validator.py thresholds without re-running full robustness
5. Change SCAN_INTERVAL_MS < 30s (API rate limit risk)
6. Commit config with real private keys (use .env.example only)
7. Trade real money without 2+ weeks of paper trading first
8. Assume edge persists forever (revalidate quarterly)

---

## PART 10: VEREDITO FINAL

**Any AI working on this codebase must:**

✅ Know this CLAUDE.md before coding
✅ Assume NO edge exists until backtest proves it
✅ Catch AND prevent lookahead bias (not just detect it)
✅ Include execution realism (spread, fill prob, latency)
✅ Pass all 9 validator checks + 10 robustness tests
✅ Write tests before changing logic
✅ Commit clear, traceablechanges
✅ Document why, not just what

**For any code change:**
1. Diagnose exactly what was broken
2. Explain why the fix prevents it
3. Add a test that would catch it again
4. Update this document if you discover a new invariant

**For any feature:**
1. Does it improve edge detection or reduce risk?
2. Can we backtest it historically?
3. Is it testable? (If not, it's a guess)
4. What would break it? (Then prevent that)

---

**Last Updated:** 2026-04-24  
**Maintained By:** Quantitative AI Engineering  
**Status:** ACTIVE — Enforced on all code changes
