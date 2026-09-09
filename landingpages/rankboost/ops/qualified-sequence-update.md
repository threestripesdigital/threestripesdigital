# Qualified booked email update

Qualified leads with keywords on pages 1 to 5 use 31 emails. Content is preserved in qualified-sequence-draft.json; final IDs are in qualified-routing.json. The legacy installer now refuses stage and activate operations to prevent restoring its superseded manifest.

Q01 to Q12 send at hours 0, 2, 4, 6, 8, 10, 24, 26, 28, 30, 32 and 34. A 14-hour delay starts the separate 17-email rotation at hour 48. Rotation sends every eight hours, including an eight-hour delay before the entry tag is reapplied. Initial confirmations do not repeat.

The 24-hour and two-hour reminders have separate booked-tag automations, eligibility conditions and custom-date delays. The dispatch worker computes dates in Kit account timezone America/New_York, including daylight saving. Eligibility is recomputed at dispatch, so stale jobs skip expired reminders. More than 15 minutes must remain until the reminder due time. Delivery times are approximate because of provider processing.

All four sequences exclude no-show, cancellation, boost-live and CRM stop tags. All four automations have matching stop events. Agency Tracker PR 306 adds explicit attended, no-show, closed, not closed and rescheduled outcomes. Save the deal contact email, choose Check Rank Boost emails, then Record outcome and stop emails. Moving a deal stage alone does not record an outcome.

Rebooking does not automatically clear suppression or restart nurture. After verifying a new booking, an operator must reset old automation enrollment and applicable lifecycle tags before a fresh booked-tag entry. Do not clear stop tags while an old enrollment may remain active.

The keyword model matches the scan and is explicitly illustrative. Booking supplies local call date/time and a validated Calendly reschedule URL before applying the booked tag. Missing fields use honest fallbacks. Broader local SEO evidence is accurately labeled. Verified 48-hour organic boost proof and dedicated video breakout pages remain unavailable.

Validation: 106 funnel tests pass, including booking payloads, dispatch-time recomputation, daylight saving, short-notice and missing dates. 62 local Liquid renders cover full and empty fixtures. Eight static links/assets returned HTTP 200 with a browser user agent. Provider previews and final activation readbacks are recorded in the launch audit. No real contact was sent a test email. Other audience flows retain their existing behavior.
