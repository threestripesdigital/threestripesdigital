# Pre-booking SMS

New qualified and no-fit submissions enroll atomically with their saved lead. Existing submissions are not backfilled. Appointment follow-up must be enabled.

Each route sends at 10 minutes, 24 hours and 72 hours after submission, within provider daytime restrictions. The qualified route uses the signed Rank Boost booking link; the website route uses its dedicated Calendly event and attribution token. The qualified route uses the saved scan to calculate the same incremental monthly case-value gap as the emails. Missing scan data omits the value claim. The second text introduces the owner-confirmed Rensch result, with one booking link; proof images remain in email. Website texts focus on being found on Google and AI. Personal replies and STOP remain in every acquisition text.

At dispatch, the source must remain current. Any newer scan, booking either offer, reply, or phone suppression stops the acquisition sequence. Existing booked-call confirmation and reminders remain separate. Provider reply lookup failure prevents a send. Quiet hours defer delivery without exhausting retries. Delayed jobs expire before the next slot, and successful sends are spaced at least 20 hours apart. At most three sends per submission, without catch-up bursts.

Inbound pre-booking replies are polled for 14 days after submission, including after acquisition texts stop. Slack receives the lead identity and literal reply as plain text, with deduplication by Roezan message ID. This is a funnel integration, not account-wide Roezan monitoring. Existing appointment reply polling remains in place. Polling delays increase with inbox volume; the current bounded poll checks one eligible pre-booking contact per processor cycle. A fresh provider reply check also runs before each outbound message.

Validation covers both routes, timing, deduplication, newer scans, either-offer booking, changed email with same phone, expired jobs, quiet-hour spacing, all replies, STOP, Slack escaping, provider failure, successful send and suppression. No live handset receipt is implied by automated tests.
