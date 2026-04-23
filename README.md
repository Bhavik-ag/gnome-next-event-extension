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
mkdir -p "$EXT_DIR/schemas"
cp extension.js metadata.json prefs.js "$EXT_DIR"/
cp schemas/*.xml "$EXT_DIR/schemas"/
glib-compile-schemas "$EXT_DIR/schemas"
gnome-extensions enable next-event@bhavik.dev
```

## Customize

Open preferences in **Extension Manager** (or run `gnome-extensions prefs next-event@bhavik.dev`) and change:

- Panel position: left / center / right
- Font size
- Max title length
- Refresh interval
- Show/hide `Now` indicator for ongoing events

Most changes apply immediately.

If you are developing from source and changed code:

```bash
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/next-event@bhavik.dev"
mkdir -p "$EXT_DIR/schemas"
cp extension.js metadata.json prefs.js "$EXT_DIR"/
cp schemas/*.xml "$EXT_DIR/schemas"/
glib-compile-schemas "$EXT_DIR/schemas"
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
