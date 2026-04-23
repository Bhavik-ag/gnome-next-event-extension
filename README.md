# Next Event (GNOME Shell Extension)

Shows today’s next upcoming calendar event in the GNOME top bar.  
Clicking it opens a dropdown of upcoming events for today, and clicking any event opens GNOME Calendar.

## Install (end user)

### Option 1: Install from zip (recommended)

```bash
gnome-extensions install --force next-event@bhavik.dev.shell-extension.zip
gnome-extensions enable next-event@bhavik.dev
```

### Option 2: Install from source files

```bash
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/next-event@bhavik.dev"
mkdir -p "$EXT_DIR"
cp extension.js metadata.json "$EXT_DIR"/
gnome-extensions enable next-event@bhavik.dev
```

## Customize

Edit `extension.js`:

- `TOPBAR_FONT_SIZE`: top bar text size
- `REFRESH_INTERVAL_SECONDS`: refresh interval
- `MAX_TITLE_LENGTH`: max event title length
- `_populateMenu()`: dropdown item text and click action

Apply changes:

```bash
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/next-event@bhavik.dev"
cp extension.js metadata.json "$EXT_DIR"/
gnome-extensions disable next-event@bhavik.dev
gnome-extensions enable next-event@bhavik.dev
```

On Wayland, if it still looks stale, log out and back in once.

## Package

```bash
./package.sh
```

The zip is created in `dist/`.

## More docs

Publishing instructions: `docs/README.md`
