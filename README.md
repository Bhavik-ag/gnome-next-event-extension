# Next Event (GNOME Shell Extension)

Shows today’s next calendar event in the GNOME top bar. Click the widget to see all upcoming events for today, then click any event to open GNOME Calendar.

## Quick install (Ubuntu, end user)

1. Download `next-event@bhavik.dev.shell-extension.zip` from this repo’s **Releases** page.
2. Open terminal in your Downloads folder and run:
   ```bash
   gnome-extensions install --force next-event@bhavik.dev.shell-extension.zip
   gnome-extensions enable next-event@bhavik.dev
   ```
3. (Optional) Open **Extension Manager** and configure preferences.

If the UI does not refresh immediately on Wayland, log out and back in once.

## Customize (Extension Manager / Preferences)

Open preferences:

```bash
gnome-extensions prefs next-event@bhavik.dev
```

Available settings:
- Panel position (left / center / right)
- Font size
- Max title length
- Refresh interval (seconds)
- Show/hide `Now` indicator

## Uninstall

```bash
gnome-extensions disable next-event@bhavik.dev
rm -rf ~/.local/share/gnome-shell/extensions/next-event@bhavik.dev
```

## Build package from source

```bash
./package.sh
```

Creates: `dist/next-event@bhavik.dev.shell-extension.zip`

## Maintainer docs

Publishing + review checklist: `docs/README.md`
