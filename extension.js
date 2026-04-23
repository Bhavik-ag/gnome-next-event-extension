/**
 * Next Event - GNOME Shell Extension
 * Shows the next upcoming calendar event for today in the top bar.
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

const DEFAULT_PANEL_POSITION = 'center';
const DEFAULT_FONT_SIZE = 15;
const DEFAULT_MAX_TITLE_LENGTH = 35;
const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;
const MIN_REFRESH_INTERVAL_SECONDS = 10;
const PANEL_POSITIONS = new Set(['left', 'center', 'right']);

export default class NextEventExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsSignals = [];
        this._upcomingEvents = [];
        this._createIndicator();

        this._createEventSource();

        this._startTimer();
        this._connectSettingsSignals();

        this._requestAndRefresh();
    }

    disable() {
        if (this._initialRefreshId) {
            GLib.source_remove(this._initialRefreshId);
            this._initialRefreshId = null;
        }

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

        if (this._settings && this._settingsSignals) {
            for (const id of this._settingsSignals)
                this._settings.disconnect(id);
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._label) {
            this._label.destroy();
            this._label = null;
        }

        this._settingsSignals = [];
        this._settings = null;
        this._upcomingEvents = [];
    }

    _createIndicator() {
        const currentText = this._label?.get_text() || 'Loading...';
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }

        this._indicator = new PanelMenu.Button(0.5, 'Next Event', false);
        this._label = new St.Label({
            text: currentText,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._updateLabelStyle();

        this._indicator.add_child(this._label);
        Main.panel.addToStatusArea('next-event', this._indicator, 0, this._getPanelPosition());
        this._populateMenu();
    }

    _connectSettingsSignals() {
        this._settingsSignals.push(
            this._settings.connect('changed::panel-position', () => {
                this._createIndicator();
                this._refresh();
            })
        );

        this._settingsSignals.push(
            this._settings.connect('changed::font-size', () => {
                this._updateLabelStyle();
            })
        );

        this._settingsSignals.push(
            this._settings.connect('changed::max-title-length', () => {
                this._refresh();
            })
        );

        this._settingsSignals.push(
            this._settings.connect('changed::refresh-interval-seconds', () => {
                this._startTimer();
                this._requestAndRefresh(true);
            })
        );

        this._settingsSignals.push(
            this._settings.connect('changed::show-ongoing-indicator', () => {
                this._refresh();
            })
        );
    }

    _startTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        const interval = Math.max(
            MIN_REFRESH_INTERVAL_SECONDS,
            this._settings?.get_int('refresh-interval-seconds') ?? DEFAULT_REFRESH_INTERVAL_SECONDS
        );

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._requestAndRefresh(true);
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _createEventSource() {
        if (this._eventSource) {
            if (this._changedId) {
                this._eventSource.disconnect(this._changedId);
                this._changedId = null;
            }
            this._eventSource.destroy();
            this._eventSource = null;
        }

        this._eventSource = new Calendar.DBusEventSource();
        this._changedId = this._eventSource.connect('changed', () => {
            this._requestAndRefresh();
        });
    }

    _getPanelPosition() {
        const value = this._settings?.get_string('panel-position') || DEFAULT_PANEL_POSITION;
        return PANEL_POSITIONS.has(value) ? value : DEFAULT_PANEL_POSITION;
    }

    _getMaxTitleLength() {
        const value = this._settings?.get_int('max-title-length') ?? DEFAULT_MAX_TITLE_LENGTH;
        return Math.max(10, value);
    }

    _shouldShowOngoingIndicator() {
        return this._settings?.get_boolean('show-ongoing-indicator') ?? true;
    }

    _updateLabelStyle() {
        if (!this._label)
            return;

        const fontSize = Math.max(10, this._settings?.get_int('font-size') ?? DEFAULT_FONT_SIZE);
        this._label.set_style(`font-size: ${fontSize}px; padding: 0 8px;`);
    }

    /**
     * Ask the event source to load today's range, then refresh the display.
     * DBusEventSource is lazy — it only fetches data when a range is requested.
     */
    _requestAndRefresh(forceReload = false) {
        if (forceReload)
            this._createEventSource();

        const now = new Date();

        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        this._eventSource.requestRange(todayStart, todayEnd);

        if (this._initialRefreshId) {
            GLib.source_remove(this._initialRefreshId);
            this._initialRefreshId = null;
        }

        this._initialRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._initialRefreshId = null;
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
        const maxTitleLength = this._getMaxTitleLength();

        let title = next.summary || 'Untitled Event';
        if (title.length > maxTitleLength)
            title = title.substring(0, maxTitleLength - 1) + '...';

        const isNow = next.date <= now && next.end >= now;
        const prefix = isNow && this._shouldShowOngoingIndicator() ? 'Now' : timeStr;

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
            const timeText = isNow && this._shouldShowOngoingIndicator()
                ? 'Now'
                : this._formatTime(ev.date);
            const maxTitleLength = this._getMaxTitleLength();
            let title = ev.summary || 'Untitled Event';
            if (title.length > maxTitleLength)
                title = title.substring(0, maxTitleLength - 1) + '...';

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
