# Mission: Rank Boost VSL page simplification + booking confirmation page

Requested 2026-09-04 by the user. Brief, verbatim:

> You are restructuring a VSL call funnel landing page for a law firm SEO offer. The current page has too many sections below the VSL which cannibalize video play rate. The goal is a simplified page that works whether or not the prospect watches the video.
>
> The final page structure should be, in this exact order from top to bottom: header with logo and CTA button, headline, VSL video player, application button that opens an inline form with embedded scheduler, trust logos row, recent wins section with rank tracker screenshots, ONE testimonial section (pick the stronger of the two currently on the page), FAQ section limited to five or six questions, final CTA button. Remove the problem section, the process or how it works section, the comparison table, and the second testimonial section entirely. Those topics are already covered in the VSL and having them as text below the video steals attention from the video itself.
>
> For the confirmation page that loads after someone books their call, build it with these elements in order: a short urgency video at the top from the founder framing what the call covers and what to prepare, then breakout videos each under three minutes addressing specific objections a lawyer might have before the call (is this white hat, will this hurt my existing rankings, what happens if it doesn't work, do you work with my competitors), then testimonials, then a clear next steps section. Keep breakout videos between one and three minutes each. The confirmation page exists to raise interest level between booking and the call so show rate stays high.
>
> Do not add any sections back to the main landing page that duplicate what the VSL already covers. Every section below the VSL must either be visual proof the video cannot show or objection handling the video did not cover. If a section does neither, cut it.
>
> On the copy, the headline is good. "We move law-firm keywords from page 2 to 5 to page 1 in under 48 hours" is specific, outcome driven, and has a timeframe. I would not touch that. The "Get my free boost" button text works because it's low friction and matches the offer.
>
> The one copy thing I'd look at is the VSL thumbnail and the first line of subtitles visible before someone presses play. Right now the subtitle reads "how they decide" which is vague. That first visible line is doing the job of a hook for the video itself. If someone is on the fence about pressing play, that subtitle needs to be more specific to the outcome. Something like "why your competitors outrank you" or "the 48 hour ranking method" would give a clearer reason to press play. The thumbnail itself is fine, Bilal on camera in a real environment signals credibility.
>
> I would not rewrite the body copy on the sections you're keeping. The recent wins screenshots speak for themselves. The FAQ is doing its job. The testimonials are strongest when they're specific and verifiable, which yours appear to be. Don't overthink the copy on a page that's about to get stripped down. Get the structure right first, get ads running, then let the data tell you what copy needs to change.
>
> The deck sales letter angle is worth keeping in your back pocket too. If you run ads and your play rate comes back below 20 percent, instead of adding text sections back to the page, convert the VSL content into a scrollable slide deck embedded on the page. Same information, different consumption mechanism. I've seen that take a page from single digit play rates to 70 percent of people consuming through slide five. But that's a phase two move. Get the simplified page live first.
>
> use the follwoing to update the VSL for the rank boosts, use /goal endpoint with fable5.1 + gpt5.6-sol and then tell me when you're done. Ik there's no breakout videos yet so keep those as placeholders

## Headline outcome

`public/index.html` is stripped to header → headline → VSL → application button/form → trust logos → recent wins → video testimonials → 6-question FAQ → final CTA, with nothing else between the VSL and the footer; and `public/thank-you.html` reads founder urgency video (placeholder) → four objection breakout videos (placeholders) → testimonials → next steps, with every existing booking-verification, tracking, and funnel binding unchanged and `npm test` green.

## Target

- Repo worktree: `/Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration`
- Mission branch: `goal/rankboost-vsl-simplify` (base commit `da472ae` = snapshot of the previously uncommitted, currently deployed WIP)
- App root: `landingpages/rankboost` (static Cloudflare Pages site, no build step, `npm test` = `node --test`)
- Live URL: https://threestripesdigital.com/rank-boost/law-firms/ (Pages project `tsd-law-firm-rank-boost`, production branch `preview`; deploys are done from the working tree via `npm run deploy:pages`, not from git)

## Safety rails (mission-specific, in addition to /goal defaults)

- Do not touch `public/meta.js`, any `fbq()` call, `functions/**`, `router/**`, `public/results.js`, `public/book.js`, `public/book.html`, `public/results.html`, `public/partner.*`, `public/privacy.html`, `migrations/**`.
- Do not modify the Content-Security-Policy in `public/_headers` or `functions/_middleware.js`. Wistia is already allowed.
- Do not change the qualification form's markup, field order, validation, or submit/redirect flow (`results` → `book` → `thank-you`). The "embedded scheduler" already lives on the `book` step behind the signed lead token; it is not moved.
- Do not rewrite body copy in kept sections (headline, VSL caption, wins, video testimonials, FAQ answers). Button labels may be unified to "Get my free boost".
- Do not add any new section to the landing page.
- No deploy. No push. No force. Commits only on `goal/rankboost-vsl-simplify`.
