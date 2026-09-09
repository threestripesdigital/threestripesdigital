# Reporting connections, 10 September 2026

The private dashboard is deployed at https://rank-boost-command-center.bilal-17f.workers.dev. Imports run at minute 7 each hour. The worker never changes Meta delivery settings.

## Verified

- Direct Wistia main-VSL reporting is connected using a token limited to Read detailed stats. All four date-window requests returned real video metrics. Native tracking remains unchanged.

- Meta landing page view and website Lead actions are imported alongside spend and clicks, using the same ad attribution window. They are labeled separately from unique visitors and Calendly bookings.
- Meta reporting uses original CAD account 358826439854169 and campaign 120249029003230545 per the owner's September 10 instruction. All 22 ad sets and 34 ads remain PAUSED. Budget totals CAD 206.76, equivalent to USD 150 at the dated September 8 reference rate of 1.3784. The account is active and its funding source is Visa ending 5759. API readback reports no ad issues; payment processing and future ad approval are not guaranteed by that readback.
- The existing lead database supplies verified Calendly booking records. No real test booking or customer message was generated during this work.
- Direct GA4 reporting for Three Stripes Digital Website (property 524936646) is configured using a Worker secret and the Analytics read-only scope. Live 1, 7, 30 and 90 day requests succeeded. Reports are restricted to law firm funnel paths on the production host.
- All four GA4 windows returned no rows. The landing page has no GA4 tag. Successful reporting access is not evidence of visitor collection.
- Custom dashboard collection remains off. No landing page files were changed. Disabled custom metrics display as unavailable, not measured zero performance.

## Still needed

- Website visit collection requires an existing source that actually receives funnel events. GA4 currently has none. No additional landing page script was installed under the owner's constraint.
- The available PostHog account has no Three Stripes project. No unrelated project was connected. PostHog is optional.
- Individual ad, video and booking attribution requires matching identifiers from the source systems. Aggregate reports must not be represented as linked visitor journeys.
- Before paid activation, follow the launch timestamp instructions in README.md. Previous authorized booking and SMS tests passed, and browser/CAPI Lead deduplication was confirmed September 9. Physical iPhone Safari remains unverified. This task does not launch ads.

## Deployment

The original-account restoration changes reporting configuration only. No database migration or funnel deployment is required. The deployment receipt is retained in the launch audit evidence.
