# Rank Boost placement repair

These compact vector layouts retain the existing angle hooks and offer. Use them for square and small placements instead of cropping the 4:5 feed artwork. The original feed and story proof screenshot stays unchanged.

Jeremy reviewed the compact copy on September 16, 2026 in the existing Rank Boost advisory conversation. He confirmed that the adaptations preserve the source angles.

## Export

After installing the analytics dependencies, run:

```sh
node marketing/rankboost-placement-fixes/export.cjs /absolute/output/directory
```

The output is seven 1080 by 1080 square layouts and seven 1080 by 1350 Instagram search layouts, each as SVG and PNG. The search layout adds vertical room so the grid crop and lower profile overlay clear the copy. The first wide-layout experiment was rejected after Audience Network preview validation and is not part of the final export set.

## Video correction

The existing muted 12-second B1 video retains its content and duration. The vertical export scales the original to 864 by 1536 inside a 1080 by 1920 canvas, positioned at x108, y80. This moves the original CTA above Reel overlays. The square export scales the feed video to 800 by 1000 inside a 1080 by 1080 canvas, positioned at x140, y40. Full-resolution first-frame posters are uploaded separately to avoid Meta's low-resolution generated poster.

## Release requirement

Keep all campaign objects paused. Uploaded creative drafts are not a launch approval. Review every enabled placement, save the current fingerprints, and run the existing launch gate. Unsupported or inaccessible previews remain blocked. No bypass or synthetic pass is permitted.

Private API manifests and rendered evidence are stored in the local agent workspace under `rankboost-launch-fixes` and are excluded from this repository.
