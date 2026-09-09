# Website downsell email operations

The live content and IDs are in `downsell-email-system.json` and `downsell-email-live.json`. Content follows Flow 2A and Flow 2B in the email handoff, with the owner's page-one correction and Vernsten Law example. Do not claim the rank scan diagnoses code or page speed, promise qualification after a rebuild, invent case-study results, or disclose pricing.

## Delivery

- Flow 2A: immediately after a successful no-fit scan, then every 24 hours for seven emails. The signed Calendly link preserves lead attribution across devices.
- Flow 2B: after verified website booking, four emails on each of the first two days, then three per day from the rotation pool. The published runway covers approximately 92 days. Appointment cutoff normally stops it much sooner.
- Separate immediate sequences deliver the 24-hour and two-hour reminders. The existing minute processor queues these only for the current appointment, in a 15-minute dispatch window, after booking fields are saved. Bookings made after a reminder's due time do not receive that reminder.
- At 30 minutes before the appointment, the processor applies `rb_website_precall_stop`. All website pre-call sequences exclude that tag. The cutoff provides a buffer for Kit's sending queue.
- After seven days without booking, new leads receive `rb_website_long_term` and enter the monthly nurture. The first value email follows 23 days later (approximately day 30 from opt-in), then every 30 days for a year. Booking or a terminal disposition excludes this sequence. Post-build re-engagement is a separate workflow.

Kit uses the account's verified Bilal Amin sending identity at bilal@threestripesdigital.com. Replies go to that sending address. Timing is subject to Kit processing latency.

## Routing and stopping

Enrollment is performed by the funnel's durable integration jobs through the public Kit API, not a separate Kit visual automation. Adding an entry tag manually does not enroll a subscriber. Calendly booking applies a permanent `rb_website_consultation_entered` exclusion before removing the no-fit tag, so nurture cannot resume after cancellation. Existing historical no-fit contacts are not bulk-enrolled.

Cancellation and no-show tags suppress pre-call sends. After a call, apply `rb_website_call_attended`, `rb_website_closed`, or `rb_website_not_closed` in Kit to stop the sequence immediately. Existing main-offer booked and boost-live tags also exclude subscribers from website email sequences. These sequences do not repeat for a subscriber, preventing webhook retries from restarting delivery. Reschedules update the date, time and reschedule link and retain the current sequence position. A reminder already delivered to a subscriber does not repeat after rescheduling.

The processor rechecks the current lead and invitee before sending reminders or stopping the sequence. Pending reminders for an old appointment are skipped. It never reactivates an unsubscribed subscriber.

## Deployment and verification

Run `node tools/install-downsell-emails.mjs` with `KIT_API_KEY` in the environment to stage and verify resources. `--activate` activates verified sequences. The installer records IDs after every mutation and refuses mismatched existing subjects instead of overwriting unrelated content.

Run `npm test`, then the standard funnel deployment. Verify all five Kit sequences are active, their exclusion lists contain the expected lifecycle tags, and their emails match the source manifest. No changes to the main-offer sequences are required.
