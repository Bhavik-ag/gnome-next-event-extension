/**
 * Next Event - GNOME Shell Extension
 * Shows the next upcoming calendar event for today in the top bar.
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import EDataServer from 'gi://EDataServer';
import ECal from 'gi://ECal';
import ICalGLib from 'gi://ICalGLib';

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

        const timeStrings = upcoming.map(ev => {
            const isNow = ev.date <= now && ev.end >= now;
            return isNow && this._shouldShowOngoingIndicator() ? 'Now' : this._formatTime(ev.date);
        });

        const timeCounts = new Map();
        for (const t of timeStrings) {
            timeCounts.set(t, (timeCounts.get(t) || 0) + 1);
        }

        const formattedTimes = Array.from(timeCounts.entries()).map(([t, count]) => {
            return count > 1 ? `${t} (${count})` : t;
        });

        this._label.set_text(`Next events: ${formattedTimes.join(' · ')}`);
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

            const item = new PopupMenu.PopupBaseMenuItem();

            let eventColor = ev.color;
            let extraText = "";
            if (ev.id) {
                const parts = ev.id.split('\n');
                const sourceUid = parts[0];
                if (!eventColor) {
                    eventColor = this._getCalendarColor(sourceUid);
                }
                if (parts.length > 1 && parts[1]) {
                    extraText = this._getEventText(sourceUid, parts[1]);
                }
            }

            if (eventColor) {
                const colorDot = new St.Widget({
                    width: 12,
                    height: 12,
                    style: `background-color: ${eventColor}; border-radius: 6px; margin-right: 8px;`,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                item.add_child(colorDot);
            }

            const label = new St.Label({
                text: `${timeText} · ${title}`,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            item.add_child(label);

            const textToSearch = `${ev.summary || ''} ${ev.location || ''} ${ev.description || ''} ${extraText}`;
            const links = [];

            const zoomMatch = textToSearch.match(/https?:\/\/([a-zA-Z0-9-]+\.)?zoom\.(?:us|com)\/[^\s<>"']+/);
            if (zoomMatch) links.push({ url: zoomMatch[0], icon: 'camera-web-symbolic', name: 'Zoom' });

            const teamsMatch = textToSearch.match(/https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+/);
            if (teamsMatch) links.push({ url: teamsMatch[0], icon: 'camera-web-symbolic', name: 'Teams' });

            const indicoMatch = textToSearch.match(/https?:\/\/indico\.cern\.ch\/event\/[^\s<>"']+/);
            if (indicoMatch) {
                links.push({ url: indicoMatch[0], icon: 'x-office-calendar-symbolic', name: 'Indico' });
            } else if (ev.id && ev.id.includes('@indico.cern.ch')) {
                const idMatch = ev.id.match(/indico-event-(\d+)@indico\.cern\.ch/);
                if (idMatch) {
                    links.push({ url: `https://indico.cern.ch/event/${idMatch[1]}/`, icon: 'x-office-calendar-symbolic', name: 'Indico' });
                }
            }

            for (const link of links) {
                const btn = new St.Button({
                    style_class: 'button',
                    style: 'padding: 4px; margin-left: 6px; border-radius: 4px;',
                    child: new St.Icon({ icon_name: link.icon, icon_size: 16 }),
                    y_align: Clutter.ActorAlign.CENTER,
                });
                btn.connect('clicked', () => {
                    Util.spawn(['xdg-open', link.url]);
                    this._indicator.menu.close();
                });
                item.add_child(btn);
            }

            item.connect('activate', () => {
                Util.spawn(['sh', '-c', 'gtk-launch org.gnome.Calendar.desktop || flatpak run org.gnome.Calendar || gnome-calendar']);
            });
            this._indicator.menu.addMenuItem(item);
        }
    }

    _getEventText(sourceUid, eventUid) {
        if (!this._sourceRegistry) {
            try {
                this._sourceRegistry = EDataServer.SourceRegistry.new_sync(null);
            } catch (e) {
                console.warn("ECAL SourceRegistry Error: " + e);
                return "";
            }
        }
        if (!this._ecalClients) this._ecalClients = {};
        
        try {
            let client = this._ecalClients[sourceUid];
            if (!client) {
                const source = this._sourceRegistry.ref_source(sourceUid);
                if (!source) {
                    console.warn("ECAL Error: Source not found for " + sourceUid);
                    return "";
                }
                client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 1, null);
                if (!client) {
                    console.warn("ECAL Error: Failed to connect client for " + sourceUid);
                    return "";
                }
                this._ecalClients[sourceUid] = client;
            }
            
            const [success, comp] = client.get_object_sync(eventUid, null, null);
            if (!success || !comp) {
                console.warn("ECAL Error: Failed to get object " + eventUid);
                return "";
            }
            
            let text = "";
            const descProp = comp.get_first_property(ICalGLib.PropertyKind.DESCRIPTION_PROPERTY);
            if (descProp) text += " " + descProp.get_description();
            
            const locProp = comp.get_first_property(ICalGLib.PropertyKind.LOCATION_PROPERTY);
            if (locProp) text += " " + locProp.get_location();
            
            return text;
        } catch (e) {
            console.warn("ECAL Error: " + e);
            return "";
        }
    }

    _getCalendarColor(sourceUid) {
        if (!this._calendarColors) this._calendarColors = {};
        if (this._calendarColors[sourceUid]) return this._calendarColors[sourceUid];

        try {
            if (!this._sourceRegistry) {
                this._sourceRegistry = EDataServer.SourceRegistry.new_sync(null);
            }
            if (this._sourceRegistry) {
                const source = this._sourceRegistry.ref_source(sourceUid);
                if (source && source.has_extension(EDataServer.SOURCE_EXTENSION_CALENDAR)) {
                    const calendar = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR);
                    const color = calendar.get_color();
                    if (color) {
                        this._calendarColors[sourceUid] = color;
                        return color;
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load calendar color from EDataServer:', e);
        }

        try {
            const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'evolution', 'sources', `${sourceUid}.source`]);
            const file = Gio.File.new_for_path(path);
            const [success, contents] = file.load_contents(null);
            if (success) {
                const text = new TextDecoder('utf-8').decode(contents);
                const match = text.match(/^Color=(.+)$/m);
                if (match && match[1]) {
                    this._calendarColors[sourceUid] = match[1].trim();
                    return this._calendarColors[sourceUid];
                }
            }
        } catch (e) {}

        const palette = ['#3584e4', '#26a269', '#c01c28', '#e66100', '#f6d32d', '#9141ac', '#986a44'];
        let colorIndex = 0;
        if (/^[0-9a-f]{40}$/i.test(sourceUid)) {
            colorIndex = parseInt(sourceUid.substring(0, 8), 16) % palette.length;
        } else {
            let hash = 0;
            for (let i = 0; i < sourceUid.length; i++) {
                hash = (hash << 5) - hash + sourceUid.charCodeAt(i);
                hash |= 0;
            }
            colorIndex = Math.abs(hash) % palette.length;
        }
        this._calendarColors[sourceUid] = palette[colorIndex];
        return this._calendarColors[sourceUid];
    }

    /**
     * Format a Date object to a human-readable time string (e.g. "3:30 PM").
     */
    _formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}
