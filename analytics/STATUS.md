# Delivery status, 8 September 2026

## Deployed

- Private dashboard: https://rank-boost-command-center.bilal-17f.workers.dev
- Worker version: ac92a1a6-a011-48d7-928c-ff615ec04344
- Hourly reporting schedule: minute 7 of every hour, UTC.
- Analytics database: rank-boost-analytics, ee4bf499-5656-49eb-a728-13f1eafd2cf1. All three migrations applied remotely.
- Read-only booking source connected successfully: rankboost-leads, 072ff1b9-a238-424d-9c03-6ae26ecf74a1.
- Funnel instrumentation preview: https://analytics-preview.tsd-law-firm-rank-boost.pages.dev
- Immutable preview deployment: https://23117aa2.tsd-law-firm-rank-boost.pages.dev
- The main funnel/router has not been redeployed or launched by this task.

## Before paid launch

1. Restore Meta reporting permission for ad account 358826439854169. Existing local reporting tokens returned Meta error 200 (permission) or 190 (expired). No invalid token was installed in the Worker. Set its META_ACCESS_TOKEN secret securely with a token that has ads_read and account access.
2. Confirm the account currency and timezone. Sync checks them before storing data.
3. Publish the prepared analytics endpoint, script, page hooks and ANALYTICS_DB binding with the funnel's launch release.
4. Use the campaign naming rule and URL parameters in README.md. Campaigns starting with Rank Boost will be discovered automatically.
5. Verify one complete approved test application and booking before spending. Existing booking workflows may send messages, so this task did not submit a real booking.

## Verification evidence

- Existing Node test suite: 91 passed, zero failed. Includes 13 analytics tests covering thresholds, seven-day boundaries, weighted sums, scope filters, idempotency, token/cookie auth, CSRF, Meta pagination/corrections, automatic campaign discovery, Wistia events and booking import.
- Browser: desktop rendered correctly, metric-detail dialog worked, mobile viewport had no horizontal document overflow, and no browser console errors were captured.
- Live Worker: health 200, unauthenticated reporting 401, unauthenticated dashboard redirects to login, login 200, authenticated report 200 and sync dispatch 202.
- Live preview endpoint: repeated session and VSL play requests returned 200, while D1 stored only one of each. Unsigned lead linking returned 400, and foreign-origin ingestion returned 403.
- All probe session/event rows were removed afterward. No sample ad spend, customers or revenue were inserted.

## Source and release

Implementation branch: `codex/rank-boost-analytics`, based on `origin/main` at `227e314e6e52ee952dab64d71e51d6c2bbce2c25`. The dashboard is deployed independently of the main funnel release. The funnel launch and Meta reporting access remain pending. Do not treat a source push as a funnel launch.

The linked worktree must remain available until source integration and the funnel release are resolved. Local development servers are stopped and regenerable caches have been removed.

## Wistia and call-metric update

- Manual qualification confirmed by user. No Google attendance authorization configured. Stripe deferred.
- Wistia watched-percentage test on actual preview embed: after jumping to 80% playback position, percentWatched was only 0.012158. Only session and play events were emitted, not 25/50/75 milestones. Analytics requests were intercepted in the browser, so this test did not add production dashboard events.
- Manual Showed and Qualified persisted through the real local form and API, including independent timestamps. Desktop and mobile verified with no document overflow. Test row was local only.
- Remote login and reporting returned 200, with the qualified-rate metric and missing-outcome counters present.
- During embed verification, Wistia fonts from fast.wistia.net were blocked by CSP. Added that exact font host to both funnel CSP definitions.
