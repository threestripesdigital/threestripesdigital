# Appointment follow-up

The minute processor owns pre-call scheduling when `APPOINTMENT_FOLLOWUP_ENABLED=true`. Kit resources and exact IDs are recorded in `appointment-email-live.json`. Each of the 49 sequences contains one immediate repeatable email. Original copy and cadence are preserved: qualified opening at hours 0, 2, 4, 6, 8, 10, 24, 26, 28, 30, 32, 34, then a 17-email rotation every eight hours from hour 48; website opening at hours 0, 3, 6, 9, 24, 30, 36, 42, then the existing eight-email rotation every eight hours from hour 50.

Booking applies `rb_appointment_managed` before clearing the old cancellation/no-show/cutoff tags. The seven legacy pre-call sequences exclude that permanent migration tag. Their automations cannot duplicate delivery for migrated contacts. Existing unbooked, no-show recovery, boost-live and monthly nurture retain their current routing.

Rescheduling keeps the original nurture start time. A fresh booking without a reschedule relationship starts a fresh journey. Reminders have keys for the new invitee, so they can send again after rescheduling. Completed nurture slots are not repeated just because the appointment changed. Stale jobs check the current invitee, lead state, deadline and outcome before dispatch. Both flows stop 30 minutes before the appointment, without requiring an operator to record attendance first. Kit processing is asynchronous, so exact inbox arrival is not instantaneous.

Main cancellation/no-show events set their lifecycle tags and refresh the signed recovery link. The main nurture and recovery emails use `rank_boost_booking_link`; existing eligible subscriber records are backfilled where a stored lead token is available. Expired links return the visitor to qualification instead of opening an unattributed calendar. Five older main nurture emails now use positions 1 through 50 and explicitly include page-one firms and position one.

SMS includes a confirmation requesting YES and separate 24-hour and two-hour reminders for both offers. Main cancellation/no-show texts retain signed rebooking links. Website recovery and post-build qualification remain manual, per the owner's instruction. Quiet-hour checks use the booked timezone or Roezan contact timezone and the narrower of provider settings and 9 AM to 8 PM. Unknown timezones use a conservative shared US daytime window. Overdue reminders are skipped instead of sent late. Quiet-hour deferrals do not exhaust failure retries.

The processor checks Roezan for replies to current appointments, with a bounded polling budget. YES records confirmation and queues an owner notification; other replies queue an attention notification. STOP persists local suppression, and sends also check Roezan's opt-out state. No automation opts a contact back in. There is no supplied selfie-video asset in this implementation.

Recorded CRM stop, boost-live and website attended/closed/not-closed tags stop the new pre-call flow too. Operators continue to use the existing recorded-outcome actions. This change does not add new sales campaigns, website recovery, or automatic rebuild-to-Rank-Boost qualification. Main no-show and boost-live continue through their existing sequences.

## Verification and rollout

- 119 automated tests pass, including cadence, idempotency, old-appointment suppression across repeated scans, rescheduling, recovery token validation, SMS replies and opt-outs.
- Wrangler Pages Functions build passes.
- Kit owner QA inbox received the native reminder twice, confirming repeat delivery despite initially stale API/inbox readbacks. Messages: `1a08593e8e7aa528`, `1a08595ad66a9d39`. A separate bounded owner-only broadcast experiment also delivered (`1a0859d45f21ffe3`); production uses native sequences.
- All 39 main email contents were updated and read back. Existing email IDs and timing were retained. Two existing Kit contacts had attribution fields backfilled without enrollment or sending.
- `tools/repair-main-booking-links.mjs` pauses each affected sequence, temporarily unpublishes the same email ID, edits its content, verifies it, restores publication and resumes the original sequence. Live content writes were ignored while the email remained published. Original contents and settings are backed up in `main-booking-link-backup.json`.
- Native SMS delivery to an owner test phone remains pending until a designated test number is supplied. No customer phone was used for testing.

Rollout: apply migration 0006, verify the Kit resources and migration exclusions, deploy the functions and page copy, then enable `APPOINTMENT_FOLLOWUP_ENABLED` on the production Pages environment. Existing production credentials are preserved. Meta ad configuration is unchanged.

Rollback: disable the feature flag, restore the preceding Pages deployment, and remove only the managed exclusion from the legacy pre-call sequences if reverting migrated contacts. Preserve the appointment ledger, original email backup and completed-job receipts. Do not clear consent or terminal outcome suppression. Do not rerun the superseded legacy installer.
