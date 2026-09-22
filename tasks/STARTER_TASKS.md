# Starter tasks

These earlier task descriptions are retained for continuity. They are not assigned, funded, or completed. The [40-task backlog](BACKLOG.md) is the current planning index; these older IDs map to it below. Do not open duplicate issues for both identifiers.

| Earlier ID | Current task |
| --- | --- |
| AAI-001 | [AAI-T-013: report examples and pilot acceptance](BACKLOG.md#aai-t-013) |
| AAI-002 | [AAI-T-013: pilot acceptance](BACKLOG.md#aai-t-013) |
| AAI-003 | [AAI-T-023: biological sources](BACKLOG.md#aai-t-023) |
| AAI-004 | [AAI-T-024: offline XAUUSD specification](BACKLOG.md#aai-t-024) |
| AAI-005 | [AAI-T-012: Telegram workflow](BACKLOG.md#aai-t-012) |
| AAI-006 | [AAI-T-020: service utility design](BACKLOG.md#aai-t-020) |
| AAI-007 | [AAI-T-022: launch research](BACKLOG.md#aai-t-022) |
| AAI-008 | [AAI-T-014: durable alerts](BACKLOG.md#aai-t-014) |
| AAI-009 | [AAI-T-006: licensing decision](BACKLOG.md#aai-t-006) |

| ID | Task | Useful skills | Starting point |
| --- | --- | --- | --- |
| AAI-001 | Make a scan report understandable | Writing, UX | [AAI Scan](../projects/AAI_SCAN.md) |
| AAI-002 | Write the private-pilot acceptance record | QA, operations | [AAI Scan](../projects/AAI_SCAN.md) |
| AAI-003 | Evaluate biological model sources | Research, ML | [Solana Trading Lab](../projects/SOLANA_TRADING_LAB.md) |
| AAI-004 | Specify one XAUUSD experiment | Trading research, MQL5 | [XAUUSD EA Lab](../projects/XAUUSD_EA_LAB.md) |
| AAI-005 | Propose one useful Telegram workflow | Product, bot development | [Telegram Tools](../projects/TELEGRAM_TOOLS.md) |
| AAI-006 | Design an AAI service-credit flow | Product, payments | [AAI Utility](../projects/AAI_UTILITY.md) |
| AAI-007 | Define the launch-study cohort | Data engineering, statistics | [Launch Research](../research/LAUNCH_STUDY.md) |
| AAI-008 | Design reliable alert delivery | Backend engineering | [AAI Scan](../projects/AAI_SCAN.md) |
| AAI-009 | Propose the licensing approach | Maintainer research | [Contributing](../CONTRIBUTING.md) |

## AAI-001: Scan-report examples

**Output:** three clearly labeled synthetic reports: an ordinary observation, missing provider data, and a changed pool.

**Complete when:** a reader can identify the observation time, source, change, and unknowns; the report never labels token accounts as distinct holders or missing values as zero. No access to the private code is needed for the first draft.

## AAI-002: Pilot acceptance record

**Output:** a results template for Telegram delivery, permitted-user access, watch/compare behavior, persistence across restart, backup restoration, and provider failure.

**Complete when:** each check has a reproducible procedure and a place for date, version, result, and evidence. Leave checks pending until someone actually performs them. Running live checks depends on deployment approval and access.

## AAI-003: Biological source inventory

**Output:** primary papers, dataset links, species, model scope, licenses, and availability for the expanded multi-brain and jellyfish-inspired source inventory. Cat, monkey, crow, and other species remain explicit verification targets rather than assumed available complete brains.

**Complete when:** every candidate has traceable evidence or an explicit unavailable/unknown status, and one candidate is accepted or rejected for a small reproducible experiment. A public animal-themed coin alone is not supporting model evidence.

## AAI-004: Gold strategy specification

**Output:** one entry/exit/risk specification plus broker, data, cost, and evaluation assumptions.

**Complete when:** two implementers could follow the rules consistently; a later evaluation period is reserved; no real-account execution is needed to review the proposal.

## AAI-005: Telegram utility proposal

**Output:** one problem statement, example conversation, commands, permissions, data-retention needs, and rough operating-cost estimate.

**Complete when:** a newcomer can explain who benefits and what a minimal demo would prove. Use synthetic examples and avoid private group data.

## AAI-006: Service-credit design

**Output:** a test-asset payment flow covering quote, approval, confirmation, access, expiry, failure, and refund.

**Complete when:** each state has a clear outcome, duplicate payments are handled, and the design does not require a user to share wallet secrets. Product, token, and pricing choices remain identified as proposals.

## AAI-007: Launch cohort and data plan

**Output:** launch eligibility rules, observation windows, outcome definitions, exclusions, and a source inventory.

**Complete when:** failed and missing-data cases remain visible, later outcomes cannot leak into earlier inputs, and coverage/cost limitations are stated. No data subscription is required to submit the plan.

## AAI-008: Durable alert design

**Output:** a proposed queue/outbox design covering retries, deduplication, expiry, restart recovery, and delivery status.

**Complete when:** success, timeout, ambiguous delivery, and restart cases have explicit expected behavior. Describe tradeoffs; do not claim exactly-once delivery without evidence. Implementation requires access to the scanner code.

## AAI-009: License decision proposal

**Output:** options for documentation and code licensing, with official license text links and a note on dependencies and data terms.

**Complete when:** the founder can make a concrete choice. Do not add a license or claim permission on the founder's behalf as part of this research task.
