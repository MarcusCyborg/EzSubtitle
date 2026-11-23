# Transcript source, round 1: Codex result

The implementation makes transcript sources distinguishable and fixes reproduced retrieval and content-loss defects. **The player CC discrepancy on the sample remains unverified.** This build does not claim to fetch the player's own caption response.

## Revisions and environment

- Worktree: `F:\EzSubtitle-codex`; branch: `codex/transcript-source-codex`.
- Verified baseline: `d3aa0e395120a424dc2e057604a72c386864f8b2`. The worktree was clean.
- Tested implementation: `04d5763adbc055483aa296ee99e4443f732bb725`. The following commit adds this report only; `git log -1 --format=%H -- docs/TRANSCRIPT_SOURCE_ROUND1_RESULT.md` identifies its SHA.
- Windows, PowerShell, Node.js 22.17.0, npm 10.9.2, WXT 0.21.4; existing lockfile install. Checked on 2026-11-23.
- Browser observation: desktop Google Chrome through the browser connector, using the existing session. Browser version and loaded EzSubtitle build were not verified. No extension was changed or loaded; Edge was not tested.
- Production Chrome MV3 build: `F:\EzSubtitle-codex\.output\chrome-mv3`.

## Evidence and unresolved hypotheses

| Evidence | Observation | What it establishes |
| --- | --- | --- |
| Live player UI, sample video, about 1:05:00 | Chrome displayed rolling Vietnamese CC. The exact track ID, translation state and response body were unavailable through the browser tool. | The sample opened and displayed CC in this session. Does not identify the responding source or establish a CC match. |
| Supplied exports, checked locally | The phrase attributed to player CC in the handoff appears once in the Glasp export and is absent from the old EzSubtitle export. The other phrase appears once in the EzSubtitle export near 1:31 and is absent from Glasp. The timestamped block counts are 296 and 823 respectively. Glasp's matching phrase is within an export block that starts before 1:31. | The exported texts differ. Grouped block counts and start times do not measure completeness or phrase-level alignment. |
| Earlier observations from the handoff, not repeated here | Native transcript and EzSubtitle agreed on the discrepant phrase; the earlier native DOM comparison reported 1,318 matching segments after whitespace normalization. A standalone metadata timedtext request returned HTTP 200 with an empty body, and a minimal endpoint POST returned HTTP 400. | These observations are consistent with EzSubtitle using a native transcript source in that session. They do not identify whether the historical winner was cache, endpoint, or DOM. |
| Code inspection and synthetic regression tests | MV3 has no `DOMParser`, so the worker could issue XML requests it could never parse. Schema 2 cached fallback segments without recording their source. The endpoint parser dropped repeated text at different timestamps, and the format selector could decode parsed text a second time. | These defects are reproducible and are addressed by the implementation. None establishes why the sample player and native transcript differ. |

The browser connector exposes console logs and a page asset inventory, but no network response-body inspection API. On the sample tab, the asset inventory returned no timedtext resource and read-only page evaluation did not expose Resource Timing. With no successful, inspectable player response, no replay or parameter experiments were run. The roles of `variant=gemini`, PO tokens, context, encoding and source freshness remain open. No parameter or token was transplanted, and no source was identified as the one used by Glasp.

## Retrieval policy

**Before:** The schema 2 cache won first. On a miss the worker tried metadata timedtext JSON3, srv3, then classic XML. If that failed, the YouTube page tried those formats, then the native transcript endpoint, rendered single-track DOM, and finally the native panel fallback. Success from any step went into the same cache without attribution. The page also requested all three timedtext formats before parsing the response.

**After:** An eligible cache hit still wins unless the user selects reload. The worker makes one bounded JSON3 attempt. The YouTube page tries JSON3, srv3, and classic XML in order and stops at the first parseable response with timestamps. If those fail, the native endpoint and the two rendered fallbacks remain available for the identified original track. Visible single-track DOM requires confirmation from a current player snapshot. Duplicate native labels are not resolved by menu position. Translated requests can use timedtext; the native paths cannot prove a translation match and are skipped. The selected track and the initial track selection policy are unchanged.

Each result carries its actual source, video/track/language/translation, time fetched, cache hit flag, and preceding fallback error codes. The panel and popup show the source and whether the result came from cache. **Reload transcript** bypasses the extension cache for the same selected track. Schema 3 caches only the two metadata timedtext paths for 30 minutes, scoped to tab, video and track selection, including translation and variant. It excludes session query parameters and signed URLs from new records; schema 2 records cannot be read as current results. Storage failure does not block retrieval.

The worker has an 8 s deadline; page timedtext uses up to 4 s per format and 12 s total, and endpoint requests share a 12 s deadline. Each body is capped at 4 MiB by bytes read. Network reads and body streams can be aborted; the page and callers discard stale navigation results. These are budgets, not measured live retrieval times. There is no new player instrumentation, and neither playback nor CC settings are changed by the timedtext path.

## Changes by area

| Files | Purpose |
| --- | --- |
| `entrypoints/background.ts`, `entrypoints/content.ts`, `entrypoints/youtube-main-world.content.ts` | Bound retrieval, reject stale and incompatible requests, retain fallback order, attribute each path. |
| `src/lib/transcript/bounded-response.ts`, `fetch-transcript.ts`, `provenance.ts` and `src/types/messages.ts` | Stream and limit responses, keep XML in the page context, carry provenance without copying network secrets. |
| `src/lib/storage/transcript-cache.ts`, `src/lib/youtube/caption-tracks.ts` | Add source-dependent cache eligibility and expiry; separate stable track and translation identity from session URLs. |
| `src/lib/youtube/transcript-endpoints.ts`, `native-transcript.ts` | Reject conflicting track metadata and ambiguous fallback menu mappings. The selected endpoint response is also checked when it explicitly declares a track. |
| `src/lib/transcript/parse-json3.ts`, `parse-youtubei.ts`, `format.ts` | Preserve repeat speech after a JSON3 window reset or expiry, preserve independently timed endpoint text, and avoid double decoding exported text. |
| `entrypoints/popup/App.tsx`, `src/lib/youtube/youtube-panel.ts` | Show the result's source and add a reload action. |
| Modified unit and integration tests under `tests/` | Exercise source, identity, fallbacks, bounded reads, caching and both export modes using synthetic or existing public fixtures. |

No manifest permissions or dependencies changed.

## Verification

| Check | Baseline | Implementation |
| --- | --- | --- |
| `npm run compile` | Passed | Passed |
| `npm run lint` | Passed | Passed |
| `npm test` | 102 passed in 17 files | 116 passed in 17 files |
| `npm run build` | Chrome MV3 passed | Chrome MV3 passed |

**Simulated:** One worker request with no `DOMParser`; an empty JSON3 response followed by successful page srv3; HTTP 410 followed by native fallback and a fresh retry; same-tab cache hit, expiry, old schema rejection, and explicit bypass; incompatible video, language, ASR and translation; a stale endpoint and a streaming body canceled during navigation; literal entity text, repeated speech, zero and hour-plus timestamps; 2,400 cues across a synthetic long lesson exported in both modes. The panel copy and download tests check that the full text is returned while search is active. Detailed output uses each segment timestamp to the existing second resolution; readable output uses each block's original first timestamp.

**Live:** One sample opened, with CC observed around 1:05:00. No successful player response was captured. The 1:31 phrase and other lesson windows were not revalidated live. No new-build extension result, live full-transcript export, timing comparison, or additional video case was observed. This is a tooling limit, not evidence against either implementation. The temporary browser tab was closed and browser control was released.

## Reproduce the pending live check

1. In the same Chrome profile, confirm the exact unpacked path `F:\EzSubtitle-codex\.output\chrome-mv3`. Enable only this implementation among the implementations under comparison. Reload the extension and the sample video.
2. Open DevTools Network before loading CC. Record the selected CC track, ASR/manual, language, translation state and playback time. Filter for `timedtext`. Confirm a nonempty player response with timestamped text and record its size, encoding and whether it is segmented or contains continuations. Keep all signed URLs and bodies outside the repo.
3. Use the extension's **Reload transcript** action with the same track. Record the displayed source and compare the response, player CC, metadata timedtext, native endpoint and native DOM in the same session. Sample 1:20-1:45 and at least five other windows, for example 6:00, 27:00, 40:00, 1:05:00, 2:00:00 and near the end.
4. Compare detailed and readable exports against the accepted source's timestamped payload, including repeated speech and the first and last cues. Test a manual track, another language, a translation, CC off, and navigation to another video before making a live retrieval claim. After a successful reference request, test parameter hypotheses one at a time.

The build still uses metadata URLs and does not capture or prioritize player requests. Native continuation coverage and transcript completeness on the sample remain unknown. If a selected endpoint returns text without a track declaration, selection still relies on the uniquely matched endpoint from the preceding response. If initial endpoint data has no video identifier, the page URL and navigation guards are the remaining checks. Ambiguous fallback metadata can produce an unavailable result instead of guessing. Reload skips the extension cache; reloading the video can refresh an expired URL from player metadata. No live source or quality score is assigned.

## Adoption follow-up

After independent review, the user selected this implementation as the foundation for further work. The review found a JSON3 regression: rolling snapshots that grow without a space (for example Japanese text or trailing punctuation) repeated their prefix. Prefix extraction now works without a word separator while retaining the existing window reset and expiry checks. Five additional synthetic cases cover Japanese, Chinese, punctuation, expired/reset windows and separate windows. They do not establish the semantics of an unseen live response.

After this fix, compile and lint passed, all 121 tests in 17 files passed, and the Chrome MV3 production build passed. This adoption does not change the unresolved status of player CC retrieval or claim that the original sample discrepancy is fixed. The next milestone is a successful live player response, identity validation and a source-selection policy at the retrieval coordinator rather than only inside a fallback.
