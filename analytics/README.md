# Rank Boost Command Center

Private Cloudflare Worker dashboard and D1 analytics backend for Three Stripes Digital's lawyer Rank Boost funnel. The dashboard never writes to Meta or changes campaigns.

## What runs automatically

- Hourly Cron Trigger at minute 7 imports daily Meta ad-level Insights, with pagination, a 90-day correction lookback, transactional replacement and a sync lease.
- Campaigns whose names start with `Rank Boost` are discovered automatically. `META_CAMPAIGN_IDS` can instead pin exact comma-separated IDs. Once discovered, renamed campaigns remain tracked.
- The existing `rankboost-leads` D1 database supplies verified Calendly bookings, cancellation/no-show updates and keyword eligibility. It is read only from this Worker.
- The funnel's same-origin `/api/analytics` endpoint writes deduplicated visits, hero VSL milestones, application starts and scheduler opens. Application completion and attribution require the existing signed lead token.
- A seven-day observation hold begins at first detected spend. Threshold flags remain visible, routine recommendations say to wait, and technical tracking failures remain actionable. No automatic pauses, budget changes, targeting changes or creative changes exist.
- Attendance, free-boost execution, sales outcomes and collected revenue are entered in the dashboard. They cannot be inferred reliably from Meta or a calendar reservation.

## Start before campaign launch

1. Publish the prepared funnel instrumentation as part of the funnel's launch. The source changes are in `landingpages/rankboost`. Its Wrangler config includes the separate `ANALYTICS_DB` binding. The existing lead database must not receive the analytics migrations.
2. Install a Meta system-user token with `ads_read` and access to ad account `358826439854169`: `npx wrangler secret put META_ACCESS_TOKEN`. Do not use the CAPI token as a reporting token. The credentials available during setup returned permission or expiry errors.
3. Verify `CURRENCY` and `REPORTING_TIMEZONE` against the ad account. Initial strategy targets assume USD and the config starts at America/New_York. Sync fails visibly on a mismatch, avoiding silently comparing another currency to USD targets. Keep the funnel `REPORTING_TIMEZONE` the same.
4. Name the campaign beginning with `Rank Boost`, for example `Rank Boost | Lawyers | VSL`. This is an example name, not a campaign created by this project.
5. Set every ad's URL parameters to:

```text
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}
```

6. Verify one visit, a VSL play, an application and a booking end to end before starting paid delivery. Real booking tests may trigger the existing messaging workflow, so use its approved test process.

Data collection begins on the first instrumented paid-ad visit. Meta figures arrive on the hourly sync and are subject to Meta reporting delay; the dashboard is not a second-by-second Meta feed.

## Local development and verification

Requires Node 24 and npm. From this folder:

```sh
npm ci
npm run db:local
npm run dev -- --var LOCAL_PREVIEW:true
npm run check
node --test ../landingpages/rankboost/test/analytics.test.js
```

Local preview bypass is limited to localhost and is not present in deployment configuration. Never deploy LOCAL_PREVIEW. No sample results are seeded into the production database.

## Deploy

```sh
npm run db:remote
npx wrangler secret put DASHBOARD_PASSWORD
npm run deploy
```

The dashboard password is held in the operator's protected credentials store and installed as a Worker secret. It is never committed to the repository.

Only `public/` is uploaded as dashboard assets. Authentication executes before all private assets. Login is rate limited; session cookies are HMAC signed, HttpOnly, Secure, SameSite Strict and expire after 12 hours. Reporting and bookkeeping endpoints require authentication, and writes require same-origin requests. The event endpoint only accepts the existing funnel origins, bounded JSON and a per-IP rate limit. Anonymous engagement is inherently client-reported, not proof of a genuine person. Client tracking honors GPC and Do Not Track and can be blocked by privacy tools.

## Metric definitions and caveats

- Good and bad boundaries come from the supplied strategy, not verified industry benchmarks. OK is the intervening band, with an arithmetic midpoint shown as a reference.
- CPM, link CTR and link CPC use sums of spend, impressions and link clicks. Daily/ad rates are never averaged directly.
- Zero denominators show No data. Zero calls after at least $700 and seven elapsed days generates a separate diagnostic.
- Show rate uses resolved calls scheduled in the selected period, excluding future, cancelled and unresolved calls. Missing outcomes are flagged.
- Visitor conversion uses unique booked sessions started in the selected period. Browser visits are sessions, not unique people. Late calls can update past cohorts.
- Sales/boost rates follow showed-call cohorts. CAC uses new paid call records in the period. Do not mark multiple calls for the same customer as new paid clients.
- ROAS uses collected payments minus refunds divided by spend. Use 90 days for comparison with the strategy's three-month target. It does not represent profit or LTV.
- Payback uses CAC divided by average new-client monthly retainer revenue, before margins and operating costs. The source's break-even examples contain inconsistent arithmetic and are not used to trigger scaling.
- There is no automated scaling rule. A 20% increase is not recommended merely because 14 days passed. Profitability and stable seven-day results require review.
- Bookings without a tracked campaign session are excluded from paid metrics, but appear in the call management list when no campaign is selected. Meta-attributed and first-party conversion counts are deliberately not added together.
- Existing signed lead tokens link anonymous sessions to verified bookings. Customer names, emails, phone numbers and keywords are not copied to analytics.
- Current booking import is capped at 2,000 records and fails visibly at that limit. Meta imports are capped at 5,000 daily ad rows, supporting 34 ads across the 90-day correction window. Add pagination/storage partitioning before expanding significantly.

## Source references

- [Cloudflare Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Meta Insights API](https://developers.facebook.com/docs/marketing-api/insights)
- [Wistia Aurora player events](https://docs.wistia.com/docs/player-events)

The Meta reporting endpoints are implemented against the documented Insights contract but could not be verified with the account until its reporting permission is fixed. Mocked pagination, correction and token-failure paths are covered by focused tests.

## Wistia and manual call operations

Wistia uses Aurora `percent-watched-change` and `player.percentWatched` (0 to 1), measuring watched media rather than seek position. Retention here means watching at least half the total video, not necessarily the first half continuously. Replays do not add another session milestone. The native video fallback uses unique played ranges. No Wistia account Stats API token is configured or required for these embedded-player events.

Fresh organic/direct visits are excluded from paid tracking. Attribution uses a paid session in the same tab for up to 30 minutes from creation; an untagged return inside that window remains paid. This is not multi-day or cross-device attribution. To exclude your testing browser, open the funnel with `rb_internal=1` in its query string. This persists per origin in localStorage until `rb_internal=0`; repeat for each browser and preview/production origin. It cannot remove earlier test visits. Privacy settings can prevent browser tracking.

The user chose manual sales qualification on 8 September 2026. In Calls & revenue, select Record outcome, mark Attendance and Sales qualified, then Save outcome. Qualification starts Unknown, independently of the automated keyword eligibility check. The sales-qualified rate is Yes divided by Yes plus No among noncancelled bookings created in the selected period. Unknown qualification is flagged and excluded from that denominator. Cost per qualified call uses the Yes count and is provisional while unknowns remain. There is no supplied qualified-rate benchmark, so it has no invented traffic-light target.

Show rate is Showed divided by Showed plus No-show among past, noncancelled calls scheduled in the selected period. Future attendance cannot be entered. Missing attendance makes show rate and cost per showed call provisional. Manual attendance and qualification have independent timestamps, so qualification edits do not freeze booking status imports. Manual attendance takes precedence over imported status; review it if a booking is later cancelled or changed. Call management displays up to 100 records in the selected period, prioritizing past unresolved calls. The summary calculations use all matching records, not just this display limit.

Google attendance is not connected. For future automation, enable the Meet and Calendar APIs in a Google Cloud project and configure an OAuth client. The meeting owner must sign in and grant `meetings.space.readonly` and `calendar.events.readonly`; securely retain the refresh token as a Worker secret. Match calendar meeting codes/times to Meet conference records and participant sessions. Host/bot attendance is not prospect attendance. Anonymous, phone and unmatched guests require manual review. Missing records must stay Unknown, never inferred No-show. No recording/Drive permission is needed just for attendance. Manual entry requires no Google authorization.

Stripe integration is explicitly deferred. Existing manual financial fields remain available, but no payment feed is connected and financial metrics are not verified automatic outcomes.

## Direct source reporting, September 2026

Meta Insights also imports landing_page_view and offsite_conversion.fb_pixel_lead actions, aggregated by campaign and day. Overlapping generic Lead totals are not added. These are Meta-attributed website actions, not unique visitors or verified bookings; they remain separate from GA4 and Calendly counts.

GA4 property 524936646 belongs to Three Stripes Digital Website and uses America/New_York. The worker reads it hourly using the GA4_SERVICE_ACCOUNT secret and the read-only Analytics scope. Only the main site's law firm funnel paths are included. The 1, 7, 30 and 90 day windows are queried independently so unique users are not added across days. All-traffic provider totals stay separate from paid campaign metrics. Failed imports preserve the last snapshot and expose an error and freshness status.

Initial live requests for all four windows succeeded with no rows. The landing page currently has no GA4 tag, so API access alone does not establish collection. No new landing page code was installed. Wistia reporting still requires an API token with Read detailed stats access; its native player continues to collect its own analytics. Available PostHog projects do not belong to Three Stripes, so no unrelated project was connected. PostHog is optional.

BROWSER_TRACKING_ENABLED=false disables presentation of historical custom events as current funnel performance. Attributed booking and visitor metrics remain unavailable. The existing booking database import and manual call outcome workflow remain available; a direct provider import does not automatically match individual visitors across providers.

## Paused September 2026 campaign

At the owner's request, the dashboard browser analytics script is no longer loaded by any of the four funnel pages. Meta and Wistia's existing scripts remain. Meta reporting and server-side booking import remain separate integrations, but new custom visitor, video milestone and session-to-booking attribution is unavailable. Native Wistia analytics are separate; a Wistia Stats API import has not been configured. Do not restore browser collection without the owner's instruction.

The campaign is pinned by ID to `120249029003230545`. All 22 ad sets and 34 ads must remain paused until the owner explicitly authorizes activation. The target daily budget is USD 154, implemented in the CAD ad account as CAD 9.69 per ad set. Reporting retains the strategy's USD thresholds and converts CAD spend using a fixed reference rate of 1 USD = CAD 1.3840 (Bank of Canada, 4 September 2026). The dashboard discloses this estimate. Review the rate before activation and when interpreting subsequent results; it is not live FX or card settlement data.

Prelaunch review and preview sessions are retained as raw diagnostic records but excluded from paid visitor, video, lead, booking and revenue totals. Before activating this campaign, set `LAUNCH_AT` to the actual activation timestamp in UTC and deploy the reporting configuration. If it is omitted, the first detected spend sets the fallback timestamp; that fallback may miss first-hour sessions. Never activate the campaign during preparation.
