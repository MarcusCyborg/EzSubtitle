# Player CC retrieval follow-up

Baseline: `352b8dd8e619e5d2df0dfa20259d0e36cce4be94` on `main`. Work is in `codex/player-caption-source`. The round 1 findings are recorded in [TRANSCRIPT_SOURCE_ROUND1_RESULT.md](TRANSCRIPT_SOURCE_ROUND1_RESULT.md).

**Live acceptance is pending.** The Chrome and Edge sessions were available, but the browser connector exposes console logs and observed page assets, not Network initiators and response bodies. No enabled build, nonempty player response, or same-track player/metadata/native comparison was verified on the sample in this turn. No live claim is made for the disputed phrase or the rest of the transcript. A 200 with no cues is not evidence of a working source, and no cause is assigned to `variant`, PO tokens, or format.

| Before | This build |
| --- | --- |
| Eligible metadata cache, worker JSON3, page JSON3/srv3/classic, native API, native DOM. | The worker first asks the current tab for an eligible observed CC response for the selected track. On a miss the prior order applies. The result records `PLAYER_CC_UNAVAILABLE` before any downstream fallback errors. |
| No source tied to a request made by the player. | The main-world observer checks the direct caller of a fetch or XHR against the current origin's player bundle path and reads the original response. The extension sends its page requests through the saved transport. There is no Resource Timing lookup, timedtext replay, format retry for player CC, or token reuse. |
| Schema 3 cache stores successful metadata timedtext. | Schema 4 still stores only successful metadata timedtext. An eligible player response can supersede a cache hit. Reload skips the metadata cache and rechecks the current observation. Player data stays in memory in the tab for up to 30 minutes of eligibility and is discarded on navigation; reload does not ask YouTube to send new CC. |

The observer requires a unique track in the current player's metadata. The request and selected track must agree on video, source language, manual or ASR, `name`, translation, variant, and any track discriminators. It checks that metadata still contains the track before serving the captured cues. An unrecognized caller, URL shape, response format or body is ineligible. The code rejects known range, pagination and continuation signals. The accepted shape is not a proof that the captions contain all spoken words or that YouTube never splits responses by a mechanism the build does not recognize.

The observer allows one capture in progress per tab, with a 12 s deadline and a 4 MiB body cap. Navigation or a newer player request cancels the extension's read; the player's own traffic is left alone. The worker lookup takes at most 1.5 s and does not wait for new player requests. If CC was off, the request completed before it could be attributed, or a matching response is still loading, the caller can fall back immediately. If the user turns CC off after a capture, the existing capture remains eligible until it is superseded, expires, or navigation invalidates it. No permissions, dependencies, playback settings, or CC selection controls changed.

## Verification

- Windows, Node.js 22.17.0, npm 10.9.2, WXT 0.21.4. The baseline suite passed 121 tests in 17 files. After the parameter compatibility follow-up below, this branch passed `npm run compile`, `npm run lint`, and 159 tests in 18 files. Production builds passed for Chrome (`npm run build`) and Edge (`.\node_modules\.bin\wxt.cmd build --browser=edge`).
- Synthetic fixtures cover direct player stack attribution, exclusion of an extension page fetch, JSON3 and XHR XML, a supplementary Unicode character, duplicate/ambiguous and mismatched track identity, empty/ranged/continuation responses, the stream byte cap, navigation during a read and A -> B -> A. The worker tests cover precedence over successful metadata and its cache, stale lookup rejection, reload, and no player storage. The suite retains the baseline tests for exports and JSON3 rolling captions.
- Live comparison remains open in both Chrome and Edge. A fixture cannot establish which transport, caller or body shape YouTube uses on the sample.

## Parameter compatibility follow-up (2026-11-23)

The review identified five options rejected by the original fixed allowlist: `exp`, `xoaf`, `xowf`, `xowatf`, `xospf`. The local saved player metadata was inspected again without printing its video ID, signed URL or option values. All five are present once on its single caption track; `exp` and `xoaf` are included in `sparams`. This is metadata evidence, not a captured successful CC response. Neither signing nor a boolean-like value proves that an option is content-neutral.

The build now admits these five specific options only with exact agreement between the observed request and the current track metadata. Missing, additional, changed or duplicate values are rejected. They participate in track and cache identity, so rotating one cannot silently reuse a previous capture or metadata cache entry. No claim is made that they are merely session or experiment parameters. Unknown keys are still rejected even when present in metadata, as are range requests and recognized continuation bodies. Existing manual/ASR, translation, variant, origin and navigation checks still apply.

The five synthetic reproductions supplied by the reviewer were incorporated into the permanent observer tests. Additional tests cover changed metadata after capture, missing/different/duplicate/request-only options, separation of metadata cache entries and range/continuation rejection with the five options present. These resolve the reproduced compatibility rejection; their live semantics and whole-video coverage still need acceptance.

The connected Chrome tool was checked again: it exposes read-only page evaluation, console logs and page assets, with no Network response-body API. It cannot dispatch the diagnostic event through its read-only evaluator. No sample page or new build was loaded through that connector in this follow-up. The next concrete step is the local diagnostic below; it is a request for observation, not a completed acceptance check.

### Immediate local diagnostic

In Chrome, reload the unpacked extension from `F:\EzSubtitle\.output\chrome-mv3`, then reload the sample video. Enable the intended CC track manually and wait until subtitles appear. In the page's DevTools Console (context `top`, not the extension service worker), execute:

```js
window.dispatchEvent(new Event('ezsubtitle:diagnose-player-cc'))
```

Return only the resulting table (`transport`, `result`, `format`, `status`, `cues`), the selected CC language/manual-ASR/translation state, and the source label shown after pressing **Tải lại transcript**. If only `true` appears and there is no table, report that explicitly; the event's return value alone does not confirm that the observer is installed or has captured anything. The diagnostic does not expose URL values or transcript text. A `CAPTURED` row is the first observation to investigate, not proof of complete or correct transcript content. Successful body inspection, multi-window comparison and copy/export coverage remain the subsequent acceptance gates.

## Run the live acceptance check

1. Load `F:\EzSubtitle\.output\chrome-mv3` in Chrome or `F:\EzSubtitle\.output\edge-mv3` in Edge as the unpacked extension. Confirm the path in the extension details and enable one EzSubtitle build. Open the private sample from the local handoff. Open DevTools **Network** before reloading the page, filter for `timedtext`, and leave an existing player CC selection unchanged where possible. If needed, the tester can enable CC manually to produce a new request. Do not change extensions unrelated to the test.
2. Inspect **Initiator** and **Response**. Require an actual player call, status 200, a nonempty response with timed cues, and the same video, named track, ASR/manual, language and translation as the selected EzSubtitle track. Check for range or continuation before treating the response as a transcript candidate. Record the format and timing locally. Do not share the signed URL, the response body, or an unredacted HAR.
3. For a sanitized diagnosis, run `window.dispatchEvent(new Event('ezsubtitle:diagnose-player-cc'))` in the page's DevTools console. The last 12 observations in the current navigation contain only transport, disposition and, when available, status, format and cue count. `CAPTURED` is a successful local capture; `INITIATOR_UNCONFIRMED`, `TRACK_UNCONFIRMED` and `UNSUPPORTED_REQUEST_SCOPE` are not. `Tải lại transcript` in EzSubtitle should show `Nguồn: CC player` for the matching track after a successful capture.
4. Compare the timed cues with displayed player CC, metadata timedtext when available, and the native transcript with the same selection. Check 1:20-1:45, 6:00, 27:00, 40:00, 1:05:00, 2:00:00 and near the end. Compare both export modes and the first and last cues. If metadata is empty or the native track cannot be confirmed, record it as unavailable instead of comparing a different track. Useful follow-ups are CC off on a fresh page, another language, manual/ASR and translation, then A -> B -> A. Repeat on the second browser with the same build.
