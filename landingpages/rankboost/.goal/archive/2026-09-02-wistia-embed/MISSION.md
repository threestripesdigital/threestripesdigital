# Mission: Rank Boost VSL — replace placeholder with Wistia embed

Requested 2026-09-02 by the user, verbatim:

> please add the following to my vsl for the rank boost page (just replace that placeholder with this wistia embed)
> `<script src="https://fast.wistia.com/player.js" async></script><script src="https://fast.wistia.com/embed/8uioqg3047.js" async type="module"></script><style>wistia-player[media-id='8uioqg3047']:not(:defined) { background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/8uioqg3047/swatch'); display: block; filter: blur(5px); padding-top:56.25%; }</style> <wistia-player media-id="8uioqg3047" aspect="1.7777777777777777"></wistia-player>`
> ENSURE NOTHING WITH TRACKING ETC GETS FUCKED UP

## Headline outcome

The hero VSL placeholder on `public/index.html` renders Wistia player `8uioqg3047`, with the
Content-Security-Policy extended so the player actually loads, and every tracking path
(`meta.js` pixel, `fbq()` events, `/api/track` relay, Calendly, Cloudflare Insights) unchanged.

## Target

- Repo worktree: `/Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration`
  (branch `feature/rankboost-integration`; large uncommitted WIP that must be preserved).
- App root: `landingpages/rankboost`
- Live URL the placeholder currently shows on: https://threestripesdigital.com/rank-boost/law-firms/

## Safety rails (mission-specific, in addition to /goal defaults)

- Do not touch `public/meta.js`, any `fbq()` call, `functions/api/track.js`, or any `/api/*` code.
- Do not remove or reorder any existing CSP source; only append Wistia sources.
- `public/_headers` and `functions/_middleware.js` CSP strings must stay identical to each other.
- Do not commit, stash, checkout, or reset: the working tree holds the user's uncommitted work.
- Do not deploy.
