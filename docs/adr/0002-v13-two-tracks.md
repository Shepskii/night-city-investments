---
status: accepted
---

# Moving to Foundry v13 on two tracks

Night City Investments and the four bridges (Scene Tools access point, and the three Night City Map bridges for Forien's Quest Log, NCI and Messenger) will support Foundry v12 and v13 from one codebase. Where the two differ, a small guarded helper decides. NET Architect (NCI Edition) and CPR Combat HUD (CT) will instead get v13-only major versions (2.0), while their 1.x versions stay on v12 for fixes only. The Cyberpunk RED system's first v13 version (0.93) is v13 only and changes its sheets, rolls and chat. NCI and the bridges barely touch the system, so supporting both costs a few guards. The two forks import the system's internal roll and chat files, so supporting both would mean two copies of their most fragile code.

## Considered options

- **Every module supports both versions:** rejected for the two forks, because they would carry code for both CPR 0.92 and CPR 0.93.
- **Every module moves to v13 only:** rejected, because the campaign world can't move until the system and the other authors' modules (Pneuma's tools, Night City Messenger, Night City Map) are ready. Until then the user's modules must keep working on v12.

## Consequences

- **No v13 build before the system:** none starts until the system's 0.93 is released, because no world can run these modules on v13 before then. Only changes that also work on v12 are made ahead of time.
- **Testing:** v13 testing uses a separate Foundry instance with a copy of the test world. A world migrated to v13 can't go back.
- **Dropping v12:** support for v12 in NCI and the bridges ends once the campaign world has moved.
