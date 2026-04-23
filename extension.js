/**
 * Next Event - GNOME Shell Extension
 * Shows the next upcoming calendar event for today in the top bar.
 * Compatible with GNOME Shell 45, 46, 47 (Ubuntu 24.04+)
 *
 * How it works:
 *   - Taps into GNOME Shell's existing DBusEventSource (the same source
 *     used by the built-in calendar dropdown) via Main.panel.statusArea.dateMenu
 *   - Polls every 60 seconds for the next upcoming event today
 *   - Displays the event title + time in the top bar
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

// How often (seconds) to refresh the event display
const REFRESH_INTERVAL_SECONDS = 60;

// Max characters to show for event title before truncating
const MAX_TITLE_LENGTH = 35;

export default class NextEventExtension extends Extension {
    enable() {
        // ── UI: a simple label sitting in the centre of the top bar ──────────
        this._label = new St.Label({
            text: '📅 …',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 13px; padding: 0 6px;',
        });

        // Add the label to the centre box of the panel
        Main.panel._centerBox.add_child(this._label);

        // ── Event source: reuse GNOME Shell's own DBus calendar source ────────
        // This is the same source that populates the calendar dropdown, so it
        // already has all locally configured calendars (GNOME Calendar, GNOME
        // Online Accounts, Evolution, etc.).
        this._eventSource = new Calendar.DBusEventSource();

        // When the source signals that its data changed, refresh our display
        this._changedId = this._eventSource.connect('changed', () => {
            this._refresh();
        });

        // ── Periodic refresh timer ───────────────────────────────────────────
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE; // keep repeating
            }
        );

        // Do an initial fetch right now
        this._requestAndRefresh();
    }

    disable() {
        // Remove the label from the panel
        if (this._label) {
            Main.panel._centerBox.remove_child(this._label);
            this._label.destroy();
            this._label = null;
        }

        // Stop the timer
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        // Disconnect and destroy the event source
        if (this._eventSource) {
            if (this._changedId) {
                this._eventSource.disconnect(this._changedId);
                this._changedId = null;
            }
            this._eventSource.destroy();
            this._eventSource = null;
        }
    }

    /**
     * Ask the event source to load today's range, then refresh the display.
     * DBusEventSource is lazy — it only fetches data when a range is requested.
     */
    _requestAndRefresh() {
        const now = new Date();

        // Start of today (midnight)
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

        // End of today (23:59:59)
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Tell the source to ensure data for today is loaded
        this._eventSource.requestRange(todayStart, todayEnd);

        // Wait a moment for the DBus call to come back, then display
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Query the event source for today's events, find the next upcoming one,
     * and update the panel label.
     */
    _refresh() {
        if (!this._label || !this._eventSource)
            return;

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Make sure the range is requested (idempotent if already loaded)
        this._eventSource.requestRange(todayStart, todayEnd);

        // Pull all events for today
        const events = this._eventSource.getEvents(todayStart, todayEnd);

        if (!events || events.length === 0) {
            this._label.set_text('📅 No events today');
            return;
        }

        // Find the next event that hasn't ended yet
        const upcoming = events
            .filter(ev => ev.date >= now || ev.end >= now)  // not yet finished
            .sort((a, b) => a.date - b.date);               // earliest first

        if (upcoming.length === 0) {
            this._label.set_text('📅 Done for today!');
            return;
        }

        const next = upcoming[0];

        // Format the event time
        const timeStr = this._formatTime(next.date);

        // Truncate long titles
        let title = next.summary || 'Untitled Event';
        if (title.length > MAX_TITLE_LENGTH)
            title = title.substring(0, MAX_TITLE_LENGTH - 1) + '…';

        // Is the event happening right now?
        const isNow = next.date <= now && next.end >= now;
        const prefix = isNow ? '🔴 Now' : `📅 ${timeStr}`;

        this._label.set_text(`${prefix} · ${title}`);
    }

    /**
     * Format a Date object to a human-readable time string (e.g. "3:30 PM").
     */
    _formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}
