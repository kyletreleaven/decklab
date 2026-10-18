# 003 — Agent API times out once the app has been in the background a while

**Status:** open · cause hypothesised, first fix applied
**Reproduced:** yes, 2026-10-17, by hand on macOS 15.7.3. Time to onset not
measured.

## Symptom

`curl` against the agent API answers instantly while DeckLab is in front.
After the app has sat in the background for a while, the same request hangs
and comes back `504` — "the app did not answer in time".

Expected: the API answers whether or not the window is visible. An agent
working while you do something else is the point of it.

## Repro

1. Launch, enable the API, run
   `curl -H "Authorization: Bearer <token>" http://127.0.0.1:47474/decks` —
   answers in milliseconds.
2. Minimise or hide the window and leave it.
3. Re-run the curl after some minutes.

**Observed:** 504 after the 10s `REPLY_TIMEOUT`.
**Expected:** 200, as in step 1.

## Proof

Not testable in vitest: it needs a real WKWebView and real macOS scheduling.
The manual repro, with `time` in front of curl, is the check — note how long
the app was hidden.

## Cause

Hypothesis, not confirmed. Rust holds the listener and stays responsive; the
answer comes from the webview (`src-tauri/src/api.rs` → `api-request` event →
`src/api/bridge.ts`). A 504 means Rust got the request and the webview never
replied. Two layers can stop a hidden webview running JavaScript, and either
fits:

1. **WebKit's inactive scheduling policy.** WKWebView suspends or throttles a
   web view that is not visible. Tauri exposes it as `backgroundThrottling`
   (macOS 14+); unset, WebKit's default applies.
2. **App Nap.** macOS throttles a whole hidden, idle app. Opting out takes an
   `NSProcessInfo` activity held for as long as the API is enabled.

This is the risk recorded in `TODO.md` under *Staying on (1)*.

## Fix

Step 1 applied: `"backgroundThrottling": "disabled"` on the main window in
`tauri.conf.json`. Not yet confirmed by the repro. If it still times out, (2)
is the next suspect: hold an App Nap activity while the API is enabled.

**Other platforms.** `backgroundThrottling` is macOS 14+ only; Tauri
documents it as unsupported on Linux and Windows, where it is ignored. Whether
WebKitGTK throttles a hidden window the same way is unknown — not reproduced.
If it does, Tauri's docs suggest a pending Web Lock as a workaround.
