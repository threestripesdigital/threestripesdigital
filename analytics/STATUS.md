# Reporting connections, 9 September 2026

The private dashboard is deployed at https://rank-boost-command-center.bilal-17f.workers.dev. Imports run at minute 7 each hour. The worker never changes Meta delivery settings.

## Verified

- Meta reporting token, account and selected campaign are connected. Campaign 120249029003230545, all 22 ad sets and all 34 ads remain PAUSED.
- The existing lead database supplies verified Calendly booking records. No real test booking or customer message was generated during this work.
- Direct GA4 reporting for Three Stripes Digital Website (property 524936646) is configured using a Worker secret and the Analytics read-only scope. Live 1, 7, 30 and 90 day requests succeeded. Reports are restricted to law firm funnel paths on the production host.
- All four GA4 windows returned no rows. The landing page has no GA4 tag. Successful reporting access is not evidence of visitor collection.
- Custom dashboard collection remains off. No landing page files were changed. Disabled custom metrics display as unavailable, not measured zero performance.

## Still needed

- A Wistia API token with Read detailed stats access is needed for the direct video reporting integration. No token was found in the available saved credentials; the owner was asked for its saved location. Native Wistia player tracking remains present.
- Website visit collection requires an existing source that actually receives funnel events. GA4 currently has none. No additional landing page script was installed under the owner's constraint.
- The available PostHog account has no Three Stripes project. No unrelated project was connected. PostHog is optional.
- Individual ad, video and booking attribution requires matching identifiers from the source systems. Aggregate reports must not be represented as linked visitor journeys.
- Before any future paid activation, follow the launch timestamp and budget instructions in README.md and complete an explicitly authorized booking test. This task does not launch ads.

## Deployment

Worker version e38bfc0c-de88-4e34-9cda-27697f4a4a1a. No database migration or funnel deployment was required.
