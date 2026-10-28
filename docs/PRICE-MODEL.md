# Price model

How prices move, in enough detail to tune them. Every number here lives in [`scripts/engine/config.js`](../scripts/engine/config.js) and the model itself is [`scripts/engine/marketModel.js`](../scripts/engine/marketModel.js). Both are pure (no Foundry), so the whole market can be run and tested in Node.

## One tick

The market advances one tick at a time, normally one in-world day. One tick is a function of the previous state, a world seed, the GM's controls and any queued impacts. The same inputs always give the same prices, which is what makes undo and previews possible.

For each company *i* the log return is:

```
r_i = drift_i                      slow growth (default 0.02% a day)
    + beta_i  * M                  market factor
    + sbeta_i * S_sector           sector factor
    + eps_i                        fat-tailed noise, scaled by recent volatility
    + jump_i                       rare jump
    + impact_i                     queued events (gigs, shocks)
    + bias_i                       GM steering
    + kappa * ln(F_i / P_i)        weak pull back toward fair value

P_i' = max(minPrice, P_i * exp(r_i))
```

The return is clamped to ±50% in one tick. A raw move beyond 25% flags a circuit breaker.

### The market factor and regimes

`M = regimeDrift + sigmaMarket * regimeVolMult * N(0,1)`, with `sigmaMarket` = 1.2%. The regime is a sticky Markov chain. Each tick a regime ends with probability 1 / meanDuration, and the next one is drawn from its own weights.

| Regime | Drift per day | Volatility x | Mean length (days) | Goes to |
|---|---|---|---|---|
| bull | +0.15% | 0.9 | 45 | sideways 60%, bear 30%, crash 10% |
| sideways | 0 | 1.0 | 35 | bull 45%, bear 50%, crash 5% |
| bear | -0.20% | 1.3 | 30 | sideways 50%, crash 15%, recovery 35% |
| crash | -1.5% | 2.5 | 8 | recovery 80%, bear 20% |
| recovery | +0.40% | 1.5 | 25 | bull 60%, sideways 40% |

Players see a soft "mood" label, not the regime. The GM can force a regime for a number of days.

### Noise and volatility

`eps = sigma * sqrt(h) * z`, where `z` is Student-t with 5 degrees of freedom (fat tails) and `h` is a volatility ratio that follows a GARCH(1,1)-style update, so quiet and wild stretches cluster:

```
h' = (1 - a - b) + (a * z^2 + b) * h        a = 0.08, b = 0.88, h kept between 0.25 and 9
```

A company's volatility rating (1 to 5) sets its daily sigma:

| Rating | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Daily sigma | 0.6% | 1.1% | 1.8% | 3.0% | 4.5% |

A jump happens with probability 0.4% a tick and has size `N(0,1) * 4 * sigma`.

### Fair value

Each company has a hidden fair value `F` that follows the systematic parts (drift, market, sector) and the permanent part of any impact, but not the noise. The pull `kappa = 0.02` per day gives roughly a 35-day half-life, so a price that wanders off drifts back. Players never see `F`.

### Quotes

A quote is the price with a spread that depends on the company's liquidity rating (1 to 5): 4%, 2.5%, 1.5%, 1% and 0.6% of the price in total, split evenly either side (bid = price x (1 - spread/2), ask = price x (1 + spread/2)). Buys fill at the ask, sells at the bid.

## Game days, not ticks

In the in-world clock mode a tick is a small slice of a game day (10 minutes by default), so the model works in game days and a tick is `dt = interval / 1440` of one. A game day has the same effect however it is sliced:

- **Rates scale with `dt`**: drift, the pull toward fair value, a sentiment bias, and a fund's expense ratio. **Random movement scales with the square root of `dt`**: the market, sector and company noise. The chance of a jump or a change of regime is per day, and the volatility ratio's memory decays as `b^dt`. Ten days of ten-minute ticks therefore spread out and drift like ten day-sized ticks (the tests check it), and one ten-minute tick moves a price a small fraction of a day tick.
- **Events are timed in days**: an impact's delay, a bias's length, a glide, a forced regime, a gig's one to three days. The kernel adds the change in `H` over each tick, so the same total arrives over the same days.
- **The chart has one close a day**, and "today's move" is against the previous game day's close.

With a whole-day tick (the day and manual modes) `dt = 1` and the per-tick numbers on this page are as written.

## Events: delay and decay

A queued impact (a gig outcome, a GM shock) has an amount, an onset (a game day), a rise time, a fade time and a permanent fraction `p`. Its cumulative effect at time *t* days after onset is:

```
H(t) = A * (1 - e^(-t/up)) * ( p + (1 - p) * e^(-t/down) )
```

and each tick receives the change in `H` over the days it covers. Defaults: rise time 1.5 days, fade time 12 days, permanent share 35%. A GM shock's "persistence" picks temporary (10% permanent, fades in 6), standard (35%, 12) or lasting (80%, 20); a gig outcome uses 35% and 12 for a success and 50% and 14 for a failure. So the price starts to move after the delay, rises to a peak, and settles to the permanent share. The permanent share also moves fair value. Each impact has a source key (for example `gig:<id>:done`), so the same event can never apply twice.

A gig's size comes from its reward: about +1.5% for a 1,000 eb job, rising with the reward, a failure 1.3 times as strong, capped at 8% before the "Gig impact strength" setting, and with a diminishing effect when one company has several gigs in a week.

## GM steering

- **Bias:** a number of sigmas of drift added each tick for a duration, to the market, a sector or a company. A bias of +1 adds one day's sigma to each tick's return.
- **Volatility multiplier:** scales sigma and market noise, globally or per company.
- **Force regime:** replaces the Markov chain for N ticks.
- **Halt:** a halted company, or the whole market, keeps its price.
- **Glide:** steers a company toward a target over N ticks, taking an even share of the remaining distance each tick, with a chosen share of the usual noise on top, and landing exactly on the last tick.

## Preview

The **Preview** button runs 200 simulated futures from the current state, with and without a planned bias, shock or glide, and shows the median and range of each. It uses the same model with different seeds, so it shows what is *likely*, not what the real world seed will do.

## Calibration

`node tools/simulate.mjs` (or `npm run simulate`) runs many seeds over many ticks and reports annualised volatility, maximum drawdown, correlation and time in each regime. The tuning goals are that movement is visible within one session, and that a company does not lose 90% in a week by chance. Change numbers in `config.js`, rerun the simulation, and check the tests (`node --test`).
