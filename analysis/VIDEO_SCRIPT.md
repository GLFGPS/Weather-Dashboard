# Lead Forecast Dashboard — 2-Minute Walkthrough

## [0:00–0:15] Opening

"We built a lead prediction model into the dashboard. It uses 5 years of our lead data — about 48,000 leads from 2021 through 2025 — combined with historical weather to forecast how many leads we should expect on any given day. Let me walk you through how it works."

## [0:15–0:40] The Forecast Card

"At the top here, we have the Lead Forecast section. I can pick any date in the next 15 days — let's say March 10th, which is a Tuesday during our ramp-up phase."

"The model gives me a predicted lead count. It breaks the math into pieces so you can see exactly what's driving the number:"

- "First, the **Historical Average** — that's what we typically see for this calendar week based on 5 years of data, organic leads only."
- "Then the **day-of-week multiplier** — Mondays are our strongest day at 1.28x, Saturdays drop to 0.37x."
- "Then the **weather adjustment** — this pulls the actual weather forecast for that date from our priority markets. A sunny 65-degree day gives us a boost, a cold rainy day drags it down."

## [0:40–1:00] DM Toggle and Growth

"Now here's where it gets useful. This DM In Home toggle — when I flip it on, the model adds the historical DM contribution for that week. And it's not a flat number. Week 12, mid-March, our heaviest drop window, adds 112 DM leads per day. By May it's only adding 5. It knows our mail calendar."

"The growth slider on the right lets me adjust for year-over-year growth. If we think 2026 is tracking 15% above 2025, I slide it to +15 and the whole forecast scales up."

## [1:00–1:20] Season Phases

"Below the forecast you can see all four season phases. The model knows that weather impacts leads differently depending on where we are in the season:"

- "**Early season**, February into March — weather sensitivity is very high. A nice day can produce 50% more leads than average. This is when people first notice their lawn."
- "**Peak**, mid-March through mid-April — demand is coming regardless. Weather only swings things 10% either way."
- "**Tail**, late April into May — nice weather barely helps, but bad weather kills the stragglers, down 18%."

"The active phase is highlighted so you always know where we are."

## [1:20–1:45] The Table and Chart

"In the Leads by Date table, every row now has a weather impact badge — Ideal, Warm, Cold, Snow — with the expected percentage impact. Weekends are shaded so you can tell at a glance that Saturday's 50 leads isn't a bad day, it's a normal Saturday."

"On the trend chart, the gray dashed line is the model's baseline projection. When actual leads are above that line, we're outperforming. Below it, we're underperforming. You can toggle DM on or off and the baseline adjusts."

## [1:45–2:00] Closing

"The bottom line — this gives us a number to plan against every day. Instead of looking at yesterday's leads and guessing if it was good or bad, we can say: the model expected 180, we got 210, that's a strong day. Or we got 120 on a snow day and the model expected 115, so we're actually right on track."

"All of this is built on real data. R-squared of 0.98, meaning the model explains 98% of the variance in daily leads. It's in the dashboard now, ready to use."
