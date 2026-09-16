# Placement eligibility evidence

Verified September 16, 2026 using Meta Graph API v25.0. These checks do not activate or change campaign targeting.

## Static media

Meta-generated previews for the current SINGLE_IMAGE creative return:

- INSTREAM_VIDEO_DESKTOP: "The in-stream reels placement you selected does not support this ad format."
- AUDIENCE_NETWORK_REWARDED_VIDEO: "To deliver to Audience Network Rewarded Video, change the media for this placement to a video"

These two format/media combinations are reported as not applicable for creatives explicitly marked SINGLE_IMAGE with no video assets. Video creatives retain both requirements. INSTREAM_VIDEO_MOBILE renders the static artwork and remains required.

## Rank Boost v2 desktop Reels

For campaign 120249151255100545, validation-only updates against ad set 120249151260660545 used identical targeting except the device platform:

- Instagram Reels only, desktop: Meta error 100, subcode 1815336, Invalid Placement Combinations.
- Instagram Reels only, mobile: success.
- Facebook feed only, desktop (control): success.

The checker therefore reports INSTAGRAM_REELS_WEB as not applicable for this campaign only. Mobile Reels remains required. A configuration with no eligible preview formats fails closed. Revalidate this evidence before extending it to another campaign or API version.

## Cases not waived

Facebook profile-feed desktop remains required. Profile-feed-only targeting needs Facebook feed; validation with both feed and profile feed on desktop succeeds, so the unsupported preview alone does not prove ineligibility.

Audience Network video playback errors remain unresolved visual checks. Neither a successful API response containing an iframe nor a login/error screen counts as a visual pass.

## Review rules

All eligible formats require visual inspection of the current assets and placement rules. Targeting or creative changes invalidate reviews. Unsupported or unknown placements fail closed. A passed gate does not authorize activation or spend.
