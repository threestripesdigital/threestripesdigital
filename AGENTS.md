# Meta campaign launch requirement

Before launching or publishing a Meta campaign or replacement creative, consult the Jeremy marketing skill and pass the placement evaluation. This is Bilal's explicit requirement.

Every enabled placement must have correctly sized artwork, readable copy at mobile display size, no cropped text, clear profile/CTA safe areas, all exposed Meta enhancement fields explicitly OPT_OUT, and multi-advertiser ads explicitly OPT_OUT. Verify Meta's saved settings and previews. Unknown or unsupported placements fail closed.

Register every campaign in the command center before launch. Review all desktop and mobile placement previews in Campaigns & creatives and save the visual evaluation for every ad. Run `scripts/meta-launch-gate.py --campaign CAMPAIGN_ID` with the dashboard credential in the environment immediately before activation. Any missing, failed or stale review blocks launch. Changes to creative content, image assets or targeting require a fresh review. The dashboard does not activate ads and does not replace explicit authorization to launch or spend.

Use `scripts/meta-launch-gate.py --campaign CAMPAIGN_ID --activate` for authorized activation, adding `--entity-id` for a specific ad or ad set. Do not bypass this guard with direct activation calls. The guard reads a fresh evaluation and refuses activation on any error or non-passing ad.
