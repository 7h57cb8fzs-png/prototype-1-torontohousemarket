# Toronto House Market — Version 7

Base: Phase 6 release from 2026-09-15 (`a0204d2dc70d4e2f855c42f2099bfa5faaa7b0cc`).

Version 7 goals:
- Preserve all Phase 6 UI, sharing, address autocomplete, buyer tools, seller tools, admin, and MLS/VOW behavior.
- Add OpenAI as a fallback when the existing AI provider fails.
- Add OpenAI Expert Comp recovery for weak/no comparable cases using real sold evidence and professional-Realtor reasoning rather than fixed attribute priorities.
- Permit external sold evidence only when the transaction is identifiable and source-labelled; never fabricate a sale.
- Add seller renovation-condition slider (0–100) plus optional seller minimum/maximum expectations.
- Keep seller expectations separate from the independent valuation.
- Add seller-specific value, likely sale range, listing strategy and preparation/timing reasoning.

Phase 6 remains the rollback baseline.
