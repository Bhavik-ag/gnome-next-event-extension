# Publishing Guide (extensions.gnome.org)

This file is for maintainers publishing **Next Event** to the GNOME Extensions marketplace.

## UUID naming (what people generally use)

Use a stable reverse-domain style UUID:

- `extension-name@yourdomain.com` (best if you own the domain)
- `extension-name@yourname.dev`
- `extension-name@github-username.github.io`

Current UUID for this project: `next-event@bhavik.dev`

Rules:

1. Keep UUID stable after first public release.
2. Folder name must exactly match UUID.
3. `metadata.json` UUID must exactly match folder/zip UUID.

## Pre-publish checklist

1. Confirm `metadata.json` fields:
   - `uuid`
   - `name`
   - `description`
   - `shell-version`
   - `version` (increment for each release)
2. Confirm extension loads cleanly on target GNOME Shell version(s).
3. Remove debug-only code/log noise.
4. Build zip:
   ```bash
   ./package.sh
   ```

## Submit to extensions.gnome.org

1. Sign in at https://extensions.gnome.org
2. Create a new extension submission.
3. Upload the zip from `dist/`.
4. Fill required metadata/screenshots.
5. Submit for review.

## Updating an existing published extension

1. Increase `version` in `metadata.json`.
2. Rebuild with `./package.sh`.
3. Upload new zip as an update in EGO.
