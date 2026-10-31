# TEST_INFRA — Szhimatar2 E2E Test Infrastructure

## 1. Overview & Architecture

Szhimatar2's End-to-End (E2E) testing framework provides an opaque-box, requirement-driven verification suite designed to validate macOS Apple Silicon CPU detection and VideoToolbox hardware acceleration while preserving Windows NVENC and DUO rendering without regressions.

The test suite implements the **4-Tier Testing Methodology**:
- **Tier 1: Feature Coverage** (>=5 tests per feature for all 13 inventoried features) — 65 tests.
- **Tier 2: Boundary & Corner Cases** (>=5 tests per feature for all 13 features) — 65 tests.
- **Tier 3: Cross-Feature Combinations** (Pairwise coverage across major features) — 18 tests.
- **Tier 4: Real-World Application Scenarios** (Realistic end-to-end rendering workflows) — 12 tests.

Total E2E test cases: **160 tests** (220 tests including existing unit/component tests).

---

## 2. Directory Layout

```
tests/e2e/
├── harness/
│   ├── contracts.ts              # Architectural interface contracts, types, quality formulas, sanitizers
│   ├── hardwareOracle.ts         # Live host reference program runners (sysctl, FFmpeg, platform parsers)
│   ├── argumentEvaluator.ts      # FFmpeg command-line evaluator (VideoToolbox vs NVENC rules)
│   ├── platformSimulator.ts      # Deterministic platform simulation (macOS, Windows, Linux)
│   └── testHarness.ts            # Settings factories, reference command builders, live probe helpers
├── tier1-features.test.ts        # 65 tests: 13 features × 5 primary behavior tests
├── tier2-boundaries.test.ts      # 65 tests: 13 features × 5 boundary & corner case tests
├── tier3-combinations.test.ts    # 18 tests: Pairwise feature interactions
└── tier4-scenarios.test.ts       # 12 tests: Full user rendering scenarios and lifecycles
```

---

## 3. Authoritative Oracles & Sources of Truth

Every test derives its expected outputs from explicit authoritative sources:

1. **Hardware Detection Oracle (`HardwareOracle`)**:
   - macOS CPU: Live execution of `sysctl -n machdep.cpu.brand_string` on host returning Apple Silicon brand string (`Apple M1`).
   - Hardware Acceleration: Live execution of `ffmpeg -hide_banner -encoders` verifying presence of `h264_videotoolbox`, `hevc_videotoolbox`, `prores_videotoolbox`.
   - Windows/Linux Parsers: Certified pattern matching against Windows Registry `ProcessorNameString`, WMIC `cpu get name`, and `/proc/cpuinfo`.

2. **FFmpeg Live Execution Oracle**:
   - `HardwareOracle.executeFfmpegWithArgs()` executes real FFmpeg encoding commands against synthetic video sources (`lavfi testsrc`) to verify that generated VideoToolbox arguments are genuinely accepted by FFmpeg and that forbidden NVENC flags are genuinely rejected.

3. **Mathematical Specification**:
   - Quality formula: `clamp(Math.round(((51 - crf) * 100) / 51), 1, 100)`.
   - Bound clamping: CRF in `[0, 51]`, bitrate in `[0.1, 200]`, preview duration in `[0.1, 5.0]`.

4. **Architecture Contracts (`PROJECT.md`)**:
   - Mode sanitization: On macOS, `duo` is sanitized to `gpu` (or `cpu` if GPU unavailable); on Windows, `duo` is preserved.
   - Flag exclusion: Omission of `-spatial-aq`, `-temporal-aq`, `-cq`, `-multipass`, `-preset p1..p7`, `-rc constqp/vbr`, `-tune hq/ll` for VideoToolbox.

---

## 4. Test Runner & Execution Commands

The test suite runs under Vitest (v1.6.1) in Node environment with native ESM and TypeScript support.

### Run All Tests (Full Suite)
```bash
npm test
```
*Executes all unit tests and all 4 tiers of E2E tests (220 tests total).*

### Run Only E2E Test Suite
```bash
npx vitest run tests/e2e/
```

### Run Specific Tiers
```bash
# Tier 1: Feature Coverage (65 tests)
npx vitest run tests/e2e/tier1-features.test.ts

# Tier 2: Boundary & Corner Cases (65 tests)
npx vitest run tests/e2e/tier2-boundaries.test.ts

# Tier 3: Cross-Feature Combinations (18 tests)
npx vitest run tests/e2e/tier3-combinations.test.ts

# Tier 4: Real-World Scenarios (12 tests)
npx vitest run tests/e2e/tier4-scenarios.test.ts
```

---

## 5. Progressive Testability & Milestone Coverage

The test suite is structured to support progressive verification across implementation milestones:

| Milestone | Target Scope | E2E Tier Coverage |
|-----------|--------------|-------------------|
| **M1: Backend Hardware Detection** | `src-tauri/src/main.rs`: sysctl CPU detection, VideoToolbox check | Features 1, 2, 3 in Tiers 1-3 |
| **M2: Platform Render Modes** | `src/utils/platform.ts`, `RenderModeSelector.tsx`, `RenderScheduler.ts` | Features 4, 5 in Tiers 1-4 |
| **M3: VideoToolbox Pipeline Adaptation** | `src/services/RenderService.ts`, preview VideoToolbox | Features 6, 7, 8, 9 in Tiers 1-4 |
| **M4: Platform UI Cleanup** | `GeneralSettings.tsx`, `VideoSettings.tsx` | Features 10, 11 in Tiers 1-4 |
| **Final: Full Hardening** | 100% test suite pass across all platforms | Features 12, 13 across all Tiers |

---

## 6. Verification & Quality Gates

Before declaring a milestone complete or merging PRs:
1. `npm test` must complete with exit code `0` and 0 failed tests.
2. No temporary artifacts (e.g. `temp.mp4`, `.swp`, test outputs) may be committed to `src/` or `src-tauri/`.
3. Commits must follow Conventional Commits formatting: `type(scope): description`.
