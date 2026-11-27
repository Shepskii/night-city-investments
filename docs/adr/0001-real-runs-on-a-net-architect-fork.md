---
status: accepted
---

# Real runs use a fork of NET Architect, not NET Architecture

Real NET runs play out on NET Architect, or on our fork of it, NET Architect (NCI Edition) (`cpr-net-architect-nci-edition`), and not on NET Architecture (`cpr-net-architecture`), even though NET Architecture is the NET module the table now prefers for netrunning in general. NET Architecture has no API, no saved session and no items on its floors. NCI could neither start a run there nor read its result, and would have to guess both from its chat cards and the runner's token. NET Architect has all three, but its upstream has gone quiet with a known bug unanswered. Under MIT we can fork it to fix that bug, add NET scenes like NET Architecture's, add jack in at Scene Tools access points, and add the hooks NCI needs.

## Considered options

- **Support NET Architecture in NCI**: NCI would recognise runs from the runner's token appearing and leaving a linked NET scene. A successful Eye-Dee on a File floor would count as getting the data, and a failed check or an ICE hit as traced. This was rejected because the inference is fragile and tied to that module's card format, which changes often.
- **Stay on upstream NET Architect only**: this was rejected because of the unfixed jack-in bug and because NCI can't get the hooks it needs.

## Consequences

- **Which module NCI uses:** NCI keeps working with the original NET Architect, with shards attached by hand, and uses the fork when it's active, preferring the fork if both are.
- **Ownership:** the fork is ours to maintain, and it stays MIT with the original copyright.
- **Changing course:** a later move to NET Architecture would need it to grow an API first, or would mean the inference above.
