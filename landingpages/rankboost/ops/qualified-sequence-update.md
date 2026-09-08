# Qualified booked email update

Scope: qualified leads with eligible keywords on pages 1 to 5. The website downsell and other lifecycle sequences retain their current behavior.

`qualified-sequence-draft.json` preserves the 31 drafts saved in Kit, their IDs, timing plan and outstanding routing requirements. The original four published emails in sequence 2862371 are still active. Do not run the legacy full-system installer against its old booked manifest, because it would restore the superseded four-email content.

The scan now supplies complete opportunity inputs from the same model used in the results: current CTR and clicks, position-one CTR, inquiry rate, close rate and expected case count. Fractional leads and cases are preserved. These are illustrative assumptions, not guaranteed revenue or incremental results. Booking and recovered-reschedule jobs supply the invitee's local call date/time and a validated Calendly reschedule URL before applying the booked tag. Missing values clear stale booking fields and invoke email fallbacks. No firm name or city is invented.

The CRM implementation is in Agency Tracker PR 306. Recording an explicit call outcome applies stop tag 23211559. Kit sequence 2862371 currently excludes that tag plus no-show, cancellation and boost-live tags. Stage changes alone do not record a call outcome, and rebooking restart is not automated yet.

Before activation, finish visual automation routing, separate the two event-relative reminders, configure the day 3 onward rotation without repeating initial confirmations, and test short-notice bookings, rescheduling, outcome suppression and subscriber previews. Keep both reminders as drafts until their date-relative routing is verified.

Validation: 103 funnel tests pass, including actual check/booking queue payload assertions and pure field tests. All eight static email links/images returned HTTP 200 with a browser user agent. Default Python user-agent requests returned HTTP 403, so that initial probe was not evidence of broken assets or inbox compatibility. Actual email client image loading still needs verification.
