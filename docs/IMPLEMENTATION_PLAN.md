# ActualForge implementation plan

The project is implemented in eight large blocks.

## Status

- ✅ Block 1 complete
- ✅ Block 2 complete
- ✅ Block 3 complete
- ✅ Block 4 complete
- ✅ Block 5 complete
- ✅ Block 6 complete
- 🧪 Block 7 implementation complete, verification pending
- ⏭️ After verification: Block 8, Tests, documentation, and release

1. **Repository + Actual analysis + baseline** ✅
   - Analyze current Actual structure.
   - Pin a stable upstream revision.
   - Prepare ActualForge repository, attribution, branch/upstream policy, and development baseline.
   - Ensure the Actual base can be built/run reproducibly.

2. **Docker + finance-engine skeleton** ✅
   - Add the finance-engine service.
   - Define persistence, API, health check, Compose layout, and image strategy.
   - Keep Actual transaction data authoritative and store ActualForge interpretation separately.

3. **UI integration** ✅
   - Integrate ActualForge navigation and UI shell into the Actual web/PWA experience.
   - Connect the UI to the finance-engine without creating a second end-user UI.
   - Use a fixed same-origin bridge instead of exposing the finance-engine directly.

4. **Contracts** ✅
   - Add contract/domain management and transaction associations.

5. **Payment chains, returns, and splits** ✅
   - Add payment-chain interpretation, failed/reversed payment handling, and reversible split/link logic.

6. **Transfers and credit cards** ✅
   - Add transfer matching and credit-card-specific interpretation.

7. **Forecasts and clarification cases** 🧪
   - Add prediction entries and workflows for uncertain/unmatched finance events.

8. **Tests, documentation, and release**
   - Complete regression/integration coverage, operating documentation, packaging, and the first ActualForge release.

After each large block, work stops for review before the next block begins.
