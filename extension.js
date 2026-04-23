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
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

// How often (seconds) to refresh the event display
const REFRESH_INTERVAL_SECONDS = 60;

// Max characters to show for event title before truncating
const MAX_TITLE_LENGTH = 35;
const TOPBAR_FONT_SIZE = 15;

export default class NextEventExtension extends Extension {
    enable() {
        this._upcomingEvents = [];
        this._indicator = new PanelMenu.Button(0.0, 'Next Event', false);
        this._label = new St.Label({
            text: 'Loading…',
            y_align: Clutter.ActorAlign.CENTER,
            style: `font-size: ${TOPBAR_FONT_SIZE}px; padding: 0 8px;`,
        });
        this._indicator.add_child(this._label);
        Main.panel.addToStatusArea('next-event', this._indicator, 0, 'center');

        this._eventSource = new Calendar.DBusEventSource();
        this._changedId = this._eventSource.connect('changed', () => {
            this._refresh();
        });

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );

        this._requestAndRefresh();
    }

    disable() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        if (this._eventSource) {
            if (this._changedId) {
                this._eventSource.disconnect(this._changedId);
                this._changedId = null;
            }
            this._eventSource.destroy();
            this._eventSource = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._label = null;
        this._upcomingEvents = [];
    }

    /**
     * Ask the event source to load today's range, then refresh the display.
     * DBusEventSource is lazy — it only fetches data when a range is requested.
     */
    _requestAndRefresh() {
        const now = new Date();

        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        this._eventSource.requestRange(todayStart, todayEnd);

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
        if (!this._label || !this._eventSource || !this._indicator)
            return;

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        this._eventSource.requestRange(todayStart, todayEnd);
        const events = this._eventSource.getEvents(todayStart, todayEnd);
        const upcoming = (events || [])
            .filter(ev => ev.date >= now || ev.end >= now)
            .sort((a, b) => a.date - b.date);
        this._upcomingEvents = upcoming;
        this._populateMenu();

        if (!events || events.length === 0) {
            this._label.set_text('No events today');
            return;
        }

        if (upcoming.length === 0) {
            this._label.set_text('Done for today');
            return;
        }

        const next = upcoming[0];
        const timeStr = this._formatTime(next.date);

        let title = next.summary || 'Untitled Event';
        if (title.length > MAX_TITLE_LENGTH)
            title = title.substring(0, MAX_TITLE_LENGTH - 1) + '…';

        const isNow = next.date <= now && next.end >= now;
        const prefix = isNow ? 'Now' : timeStr;

        this._label.set_text(`${prefix} · ${title}`);
    }

    _populateMenu() {
        if (!this._indicator)
            return;

        this._indicator.menu.removeAll();

        if (!this._upcomingEvents || this._upcomingEvents.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No upcoming events today', {
                reactive: false,
                can_focus: false,
            });
            this._indicator.menu.addMenuItem(emptyItem);
            return;
        }

        for (const ev of this._upcomingEvents) {
            const now = new Date();
            const isNow = ev.date <= now && ev.end >= now;
            const timeText = isNow ? 'Now' : this._formatTime(ev.date);
            let title = ev.summary || 'Untitled Event';
            if (title.length > MAX_TITLE_LENGTH)
                title = title.substring(0, MAX_TITLE_LENGTH - 1) + '…';

            const item = new PopupMenu.PopupMenuItem(`${timeText} · ${title}`);
            item.connect('activate', () => {
                Util.spawn(['gnome-calendar']);
            });
            this._indicator.menu.addMenuItem(item);
        }
    }

    /**
     * Format a Date object to a human-readable time string (e.g. "3:30 PM").
     */
    _formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}
