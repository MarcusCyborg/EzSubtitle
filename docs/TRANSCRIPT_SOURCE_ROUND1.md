# Transcript source comparison: round 1

This brief is identical for both implementations. Read `docs/TRANSCRIPT_IMPROVEMENT_PLAN.md` for background, but this document defines the narrower scope of this round.

## Objective

Explain and fix the discrepancy between the captions displayed by the YouTube player and the transcript returned by EzSubtitle, using evidence from actual responses. Deliver the smallest maintainable improvement that preserves the full available transcript and original timestamps.

The provided example has one phrase in player CC and a different phrase in YouTube's native transcript. Matching the native panel alone is not proof of meeting the objective. Neither Glasp nor a single correct phrase is a universal ground truth.

## Shared inputs and isolation

- Begin at the baseline commit supplied in the launch prompt. Do not pull newer implementation commits into your branch.
- Work only in your assigned worktree and branch. Do not inspect, edit, cherry-pick, or reuse the competing implementation before evaluation.
- Read the local, read-only context at `F:\EzSubtitle-evaluation\PRIVATE_CONTEXT.md` for the sample video and supplied transcripts. If unavailable, report that limitation instead of inventing evidence.
- This repository is public. Do not commit the private context, unlisted video link/title/identifier, full transcripts, screenshots, session tokens, signed URLs, browser traces, or raw response dumps. Keep private diagnostics outside the repository. Use synthetic or minimally sanitized fixtures for public tests.
- Do not read or change browser profiles or extension installations unrelated to the assigned work. The baseline checkout at `F:\EzSubtitle` is not your editing workspace.

## Required work

1. Inspect repository instructions and Git state. Run baseline checks and identify existing failures before making changes.
2. Establish which source currently wins, including cache, background timedtext, page timedtext, endpoint and native DOM fallback. Record sanitized diagnostics and failure causes where necessary.
3. When browser access is available, observe a successful player caption request/response and compare it with the other sources under the same video, language, translation and session context. Check the sample discrepancy plus several windows across the lesson.
4. Treat `variant=gemini`, PO-token requirements, format differences and source freshness as hypotheses. Do not remove a parameter or transplant a token without evidence that the change is valid and works.
5. Implement a focused retrieval fix justified by the evidence. Preserve selected-track identity, navigation cancellation, bounded requests, language/translation handling and existing fallbacks.
6. Add enough provenance and cache invalidation to prove which source produced the result and prevent an old fallback from masking the fix. Avoid a large cache or UI redesign; add a minimal reload/source indication only if required for verification.
7. Verify that existing detailed/readable copy paths still preserve available content and timestamps. Fix a parser issue only when evidence or a regression test demonstrates it matters to this task.
8. Add meaningful unit/integration tests, run final checks, and write `docs/TRANSCRIPT_SOURCE_ROUND1_RESULT.md` using the reporting contract below.

## Out of scope

- New AI providers, AI text correction, speech recognition, audio/video downloading, OCR, translation or slide processing.
- New chapter-generation features, prompt presets, bulk UI redesign or general refactoring.
- Hardcoded corrections for the sample sentence or video, silently merging different transcript sources, or replacing missing terms with guesses.
- Copying proprietary Glasp code or relying on Glasp's service/cache.
- Publishing a release, merging branches, force-pushing or automatically sending a transcript to an AI service.

## Browser coordination

Code and mocked tests can run in parallel in separate worktrees. Browser investigation and live extension testing must be sequential on the shared computer. The launch prompt specifies whether your session has the browser slot.

If you do not have the browser slot, continue independent code inspection, tests and instrumentation. State the exact live experiment you need when ready. Do not control Chrome/Edge, toggle extensions or reload another implementation's build. The user will hand over the browser slot explicitly.

Having a browser slot does not grant unavailable tools. Follow the actual tool permissions and instructions. If browser access is blocked, record the concrete limitation and continue independent work. Never claim live source verification from mocked tests, an empty HTTP 200, or a fixture copied from the desired export.

When switching builds, the evaluator must confirm which worktree's `.output/chrome-mv3` is loaded, enable only the implementation under test, reload the video, bypass transcript cache and record the selected track. Do not alter unrelated extensions. Use the same browser profile and comparable conditions for both implementations.

## Checks

Baseline preparation on 2026-11-23: compile, lint, all 102 tests in 17 files, and the Chrome MV3 production build passed on the shared source checkout before any implementation changes. Each agent must still verify its own worktree after installing from the lockfile.

Run relevant tests during development, then:

```powershell
npm run compile
npm run lint
npm test
npm run build
```

Install dependencies using the lockfile if needed. Keep each worktree's dependencies/build output separate. Do not upgrade dependencies merely to make this comparison easier.

Cover wrong video/track/translation, expired or empty responses, fallback source, stale navigation, cache reuse/invalidation and preservation of timestamps/content. Exercise XML parsing in a context without DOMParser if the implementation depends on it in a service worker. Preserve legitimate repeated speech when handling rolling captions.

## Reporting contract

In `docs/TRANSCRIPT_SOURCE_ROUND1_RESULT.md`, report:

1. Baseline SHA and final commit SHA when available; environment and browser/build used.
2. Verified observations, hypotheses still open and root-cause evidence. Keep private identifiers and raw responses out of the report.
3. The retrieval flow before/after, chosen source policy, fallback behavior and cache changes.
4. Files changed and why; any additional permissions/dependencies and why they are necessary.
5. Baseline/final check results with failures clearly separated from checks not run.
6. Live cases tested, selected tracks, source returned, full-transcript checks and observed discrepancies. Label simulated results and live results separately.
7. Remaining limitations, reproduction steps and the exact build path for local testing.

Commit only relevant source/tests/public documentation on the assigned branch when ready. Do not push until the user requests it. Do not commit private evidence or generated build/dependency output. If live verification is pending, say so in the report and final response; do not call the root-cause fix verified.

## Evaluation contract

Mandatory gates:

- No hardcoded answer, wrong-video/track leakage, silent meaning changes, or fabricated evidence.
- No regression in full available transcript copy or timestamps.
- Build and required checks pass, or pre-existing/environmental failures are explicitly demonstrated.
- A retrieval fix is called verified only with successful live response evidence and matching player CC across multiple sampled windows.

After mandatory gates, use these weights to structure the review, not to imply statistically precise quality:

| Criterion | Weight | Evidence |
| --- | ---: | --- |
| Source correctness and explanation | 35 | Successful observed responses, multiple comparison windows, clear residual uncertainty |
| Reliability | 25 | Track/video/translation identity, navigation races, fallbacks and cache behavior |
| Content and timestamp preservation | 20 | Whole-transcript export checks, no invented text or lost legitimate repetitions |
| Maintainability | 15 | Focused diff, useful tests, understandable code, justified permissions/dependencies |
| Latency and playback impact | 5 | Measured requests/time, no disruptive player changes |

Use the same cases and cache/build procedure for both candidates. Include a few additional video cases not used for tuning. Missing browser access is a tooling limitation and makes live conclusions incomplete; do not present it as proof that one model is intrinsically worse.

Select a candidate only after reviewing code and running comparable checks. Useful isolated tests/ideas may be ported after evaluation; do not merge both implementations wholesale. Continue the broader plan only after choosing the retrieval approach.
