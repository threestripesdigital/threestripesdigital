# Isolated Rank Boost hero review

This Worker previews the real public funnel pages with the approved main-site branding, shared typography and updated mobile header. It has no databases, secrets, API forwarding, custom-domain routes, or production analytics. Form disclosure works, but submitting details displays a preview message. Wistia uses its documented do-not-track setting in the generated preview only.

Build from the Rank Boost application directory:

```sh
node design/hero-brand-preview/build.mjs
npx wrangler deploy --config design/hero-brand-preview/wrangler.json
```

Do not use the Pages deploy command for a preview: its production branch is named `preview`. This Worker configuration is separate from the production application and router configurations. The generated `dist` files must never replace `public`.

Bilal approved production publication of this design on September 22, 2026. Page content, form fields, script bodies, API functions, and live tracking configuration are preserved in the release source. Shared styles extend across the lower page and follow-up pages; the optimized poster and deferred lower testimonial downloads improve loading. This isolated review does not verify live event delivery or real submissions.

Wistia privacy option: https://docs.wistia.com/docs/player-attributes-and-properties#do-not-track
