# Next Event — GNOME Shell Extension
### Full Build & Test Guide for Ubuntu 24.04 (GNOME 46)

---

## What This Extension Does

Displays the **next upcoming calendar event for today** right in your GNOME top bar (centre panel area). It reads from the same data source GNOME Shell's own calendar dropdown uses — so any calendar you've set up in **GNOME Calendar**, **GNOME Online Accounts** (Google, Nextcloud, etc.), or **Evolution** will automatically appear.

Example top bar display:
```
📅 3:30 PM · Team standup
```
Or, if the event is happening right now:
```
🔴 Now · Team standup
```

---

## Step 1 — Prerequisites

Open a terminal and make sure you have the needed tools:

```bash
# Check your GNOME Shell version (should be 46 on Ubuntu 24.04)
gnome-shell --version

# Install the gnome-extensions CLI tool if not present
sudo apt install gnome-shell-extension-prefs

# Optional but helpful: log viewer for debugging
# (already installed on Ubuntu)
journalctl --user -u gnome-shell -f
```

---

## Step 2 — Install the Extension Files

Copy the extension to the correct location:

```bash
# Create the extension directory (name MUST match the UUID in metadata.json)
mkdir -p ~/.local/share/gnome-shell/extensions/next-event@yourusername.local

# Copy both files into it
cp /path/to/extension.js  ~/.local/share/gnome-shell/extensions/next-event@yourusername.local/
cp /path/to/metadata.json ~/.local/share/gnome-shell/extensions/next-event@yourusername.local/
```

> **If you downloaded the files from Claude**, they'll be in your Downloads folder.
> Run: `cp ~/Downloads/extension.js ~/.local/share/gnome-shell/extensions/next-event@yourusername.local/`
> and the same for `metadata.json`.

Verify the directory looks correct:
```bash
ls ~/.local/share/gnome-shell/extensions/next-event@yourusername.local/
# Should show: extension.js  metadata.json
```

---

## Step 3 — Add a Test Calendar Event (if you don't have any)

If GNOME Calendar has no events, the extension will show "No events today". Add a test one first:

```bash
# Open GNOME Calendar
gnome-calendar
```

In GNOME Calendar: click the **+** button → add an event for today with a specific time (e.g., 30 minutes from now). It will be saved to your local calendar via GNOME's Evolution Data Server.

Alternatively, if you use Google Calendar, just make sure GNOME Online Accounts is configured:
**Settings → Online Accounts → Google** and toggle "Calendar" on.

---

## Step 4 — Reload GNOME Shell & Enable the Extension

### On Wayland (default on Ubuntu 24.04):

Wayland does **not** support the old `Alt+F2 → r` trick. You must **log out and log back in**:

```bash
# Save your work, then log out via:
gnome-session-quit --logout
```

After logging back in, enable the extension:

```bash
gnome-extensions enable next-event@yourusername.local
```

### On X11 (if you chose "Ubuntu on Xorg" at login):

You can restart the shell without logging out:

```bash
# Restart GNOME Shell (X11 only)
busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting…", global.context)'
# Then enable:
gnome-extensions enable next-event@yourusername.local
```

---

## Step 5 — Verify It's Working

Check the extension is enabled:
```bash
gnome-extensions list --enabled
# Should include: next-event@yourusername.local
```

Look at your top bar — you should see the event label in the centre.

---

## Step 6 — Debugging / Logs

If something isn't working, watch the GNOME Shell log in real time:

```bash
journalctl /usr/bin/gnome-shell -f --output=cat
```

Look for lines starting with `next-event` or any JavaScript errors mentioning `extension.js`.

Common issues and fixes:

| Problem | Cause | Fix |
|---|---|---|
| Extension won't enable | Syntax error in JS | Check journalctl for the error line |
| "No events today" | No calendar events in EDS | Add an event in GNOME Calendar |
| "No events today" | GOA not synced | Open Settings → Online Accounts → force sync |
| Label doesn't appear | Wrong shell version | Edit metadata.json to add your version |

---

## Step 7 — Making Code Changes

Every time you edit `extension.js` you need to reload. The workflow is:

```bash
# 1. Edit the file
nano ~/.local/share/gnome-shell/extensions/next-event@yourusername.local/extension.js

# 2. Disable the extension
gnome-extensions disable next-event@yourusername.local

# 3a. On Wayland: log out and back in, then re-enable
gnome-extensions enable next-event@yourusername.local

# 3b. On X11: restart shell then re-enable
busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting…", global.context)'
gnome-extensions enable next-event@yourusername.local
```

---

## Step 8 — Uninstall

```bash
gnome-extensions disable next-event@yourusername.local
rm -rf ~/.local/share/gnome-shell/extensions/next-event@yourusername.local
```

---

## How It Works Internally

The extension hooks into `Calendar.DBusEventSource` — GNOME Shell's built-in D-Bus client that talks to `gnome-shell-calendar-server` (part of GNOME Shell itself). That server, in turn, queries Evolution Data Server (EDS), which is the unified backend for all locally configured calendars.

```
GNOME Calendar ──┐
GOA (Google etc) ──┤──► Evolution Data Server (EDS)
Evolution ────────┘            │
                               ▼
                   gnome-shell-calendar-server  (D-Bus)
                               │
                               ▼
                    Calendar.DBusEventSource   (in Shell)
                               │
                    ┌──────────┴──────────┐
                    │                     │
              Built-in                Next Event
            Calendar menu           Extension (us)
```

The extension calls `requestRange(todayStart, todayEnd)` to trigger a D-Bus fetch, then `getEvents()` to retrieve the results. It polls every 60 seconds and also listens to the `changed` signal for instant updates.

---

## Customisation

Edit `extension.js` to tweak:

| Setting | Location | Default |
|---|---|---|
| Refresh interval | `REFRESH_INTERVAL_SECONDS` | 60 seconds |
| Max title length | `MAX_TITLE_LENGTH` | 35 characters |
| Label style | `style:` in `enable()` | 13px, 6px padding |
