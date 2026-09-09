# Approved lifecycle fixes

- Repair main nurture and recovery booking attribution and add explicit page-one eligibility copy.
- Tie pre-call email and SMS delivery to the current appointment, preserving the existing cadence and rotation content.
- Replace stale reminders on reschedule, safely start a fresh journey on rebooking, and stop both offers 30 minutes before the call.
- Respect unsubscribe, SMS opt-out and recorded outcomes. Verify real owner test delivery where a test number is supplied.
- Keep website recovery and post-build requalification manual. Do not change Meta optimization or ad copy in this change.

Implementation uses appointment-keyed durable jobs and repeatable single-email Kit sequences. The live owner inbox test confirmed repeat delivery; API timestamps and inbox indexes initially appeared unchanged while delivery was processing. A permanent migration exclusion prevents legacy pre-call automations from also delivering to migrated contacts. Existing unbooked and monthly nurture remain in Kit.
