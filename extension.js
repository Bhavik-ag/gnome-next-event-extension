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
        this._selectedDate = new Date();
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
        this._selectedDate = null;
        this._lastRequestStart = null;
        this._lastRequestEnd = null;
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
        
        const box = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const icon = new St.Icon({
            icon_name: 'x-office-calendar-symbolic',
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        
        this._label = new St.Label({
            text: currentText,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._updateLabelStyle();

        box.add_child(icon);
        box.add_child(this._label);
        this._indicator.add_child(box);

        Main.panel.addToStatusArea('next-event', this._indicator, 0, this._getPanelPosition());
        
        this._indicator.menu.connect('open-state-changed', (menu, isOpen) => {
            if (!isOpen) {
                this._selectedDate = new Date();
                this._refresh();
            }
        });

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
            this._settings.connect('changed::display-mode', () => {
                this._refresh();
            })
        );

        this._settingsSignals.push(
            this._settings.connect('changed::show-mini-timeline', () => {
                this._refresh();
            })
        );

        this._settingsSignals.push(
            this._settings.connect('changed::show-pill-background', () => {
                this._updateLabelStyle();
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
                this._requestAndRefresh(false);
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

    _getDisplayMode() {
        return this._settings?.get_string('display-mode') || 'upcoming-times';
    }

    _updateLabelStyle() {
        if (!this._label)
            return;

        const fontSize = Math.max(10, this._settings?.get_int('font-size') ?? DEFAULT_FONT_SIZE);
        const showPillBackground = this._settings?.get_boolean('show-pill-background') ?? true;
        
        if (this._currentEventColor && showPillBackground) {
            let textColor = '#ffffff';
            let hex = this._currentEventColor.replace('#', '');
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            if (hex.length === 6) {
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
                textColor = (yiq >= 128) ? '#000000' : '#ffffff';
            }
            this._label.set_style(`font-size: ${fontSize}px; padding: 2px 12px; background-color: ${this._currentEventColor}; color: ${textColor}; border-radius: 99px; margin-left: 4px;`);
        } else {
            this._label.set_style(`font-size: ${fontSize}px; padding: 0 8px;`);
        }
    }

    /**
     * Ask the event source to load today's range, then refresh the display.
     * DBusEventSource is lazy — it only fetches data when a range is requested.
     */
    _requestAndRefresh(forceReload = false) {
        if (forceReload) {
            this._createEventSource();
            this._lastRequestStart = null;
            this._lastRequestEnd = null;
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const selDate = this._selectedDate || now;
        const dayOfWeek = selDate.getDay();
        const distFromMonday = (dayOfWeek + 6) % 7;
        const startOfWeek = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate() - distFromMonday, 0, 0, 0);
        const endOfWeek = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate() - distFromMonday + 6, 23, 59, 59);

        const requestStart = new Date(Math.min(todayStart, startOfWeek));
        const requestEnd = new Date(Math.max(todayEnd, endOfWeek));

        const rangeChanged = !this._lastRequestStart || !this._lastRequestEnd || 
                             this._lastRequestStart.getTime() !== requestStart.getTime() || 
                             this._lastRequestEnd.getTime() !== requestEnd.getTime();

        if (!rangeChanged && !forceReload) {
            this._refresh();
            return;
        }

        this._lastRequestStart = requestStart;
        this._lastRequestEnd = requestEnd;

        this._isRequestingRange = true;
        this._eventSource.requestRange(requestStart, requestEnd);
        this._isRequestingRange = false;

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

        if (this._isRequestingRange || this._eventSource.isLoading || this._eventSource.hasLoaded === false)
            return;

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const events = this._eventSource.getEvents(todayStart, todayEnd) || [];
        const sortedTodayEvents = events.sort((a, b) => a.date - b.date);
        const upcoming = sortedTodayEvents.filter(ev => ev.date >= now || ev.end >= now);
        
        this._upcomingEvents = upcoming;
        this._populateMenu();

        const displayMode = this._getDisplayMode();

        if (displayMode === 'icon-only') {
            this._label.set_text('');
            this._label.hide();
            return;
        } else {
            this._label.show();
        }

        if (sortedTodayEvents.length === 0) {
            this._label.set_text('No events today');
            return;
        }

        const formatEvent = (ev, showNowIfOngoing) => {
            const isNow = ev.date <= now && ev.end >= now;
            let timeStr = isNow && showNowIfOngoing ? 'Now' : this._formatTime(ev.date);
            let titleStr = ev.summary || 'Untitled Event';
            const maxTitleLength = this._getMaxTitleLength();
            if (titleStr.length > maxTitleLength) {
                titleStr = titleStr.substring(0, maxTitleLength - 1) + '...';
            }
            return `${timeStr} ${titleStr}`;
        };

        if (displayMode === 'next-event') {
            const nextEv = sortedTodayEvents.find(ev => ev.date > now);
            if (nextEv) {
                this._label.set_text(formatEvent(nextEv, false));
                this._currentEventColor = this._getEventColor(nextEv);
                this._updateLabelStyle();
            } else {
                this._label.set_text('Done for today');
                this._currentEventColor = null;
                this._updateLabelStyle();
            }
        } else if (displayMode === 'now-next-event') {
            const currentOrNextEv = sortedTodayEvents.find(ev => ev.date > now || (ev.date <= now && ev.end > now));
            if (currentOrNextEv) {
                this._label.set_text(formatEvent(currentOrNextEv, true));
                this._currentEventColor = this._getEventColor(currentOrNextEv);
                this._updateLabelStyle();
            } else {
                this._label.set_text('Done for today');
                this._currentEventColor = null;
                this._updateLabelStyle();
            }
        } else {
            if (upcoming.length === 0) {
                this._label.set_text('Done for today');
                this._currentEventColor = null;
                this._updateLabelStyle();
                return;
            }

            this._currentEventColor = null;
            this._updateLabelStyle();

            const timeStrings = upcoming.map(ev => {
                const isNow = ev.date <= now && ev.end >= now;
                return isNow ? 'Now' : this._formatTime(ev.date);
            });

            const timeCounts = new Map();
            for (const t of timeStrings) {
                timeCounts.set(t, (timeCounts.get(t) || 0) + 1);
            }

            const formattedTimes = Array.from(timeCounts.entries()).map(([t, count]) => {
                return count > 1 ? `${t} (${count})` : t;
            });

            this._label.set_text(formattedTimes.join(' · '));
        }
    }

    _populateMenu() {
        if (!this._indicator)
            return;

        this._indicator.menu.removeAll();

        const selDate = this._selectedDate || new Date();
        const dayOfWeek = selDate.getDay();
        const distFromMonday = (dayOfWeek + 6) % 7;
        const startOfWeek = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate() - distFromMonday);

        const weekBox = new St.BoxLayout({
            vertical: false,
            style: 'padding: 8px; margin-bottom: 4px;',
            x_expand: true,
            reactive: true,
        });

        weekBox.connect('scroll-event', (actor, event) => {
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP) {
                this._selectedDate = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate() - 1);
                this._requestAndRefresh();
                return Clutter.EVENT_STOP;
            } else if (direction === Clutter.ScrollDirection.DOWN) {
                this._selectedDate = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate() + 1);
                this._requestAndRefresh();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        const prevBtn = new St.Button({
            child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 16 }),
            style_class: 'button',
            style: 'padding: 6px; border-radius: 4px; margin-right: 8px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        prevBtn.connect('clicked', () => {
            this._selectedDate = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate() - 7);
            this._requestAndRefresh();
        });
        weekBox.add_child(prevBtn);

        const daysBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });

        const daysOfWeek = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
        const todayStr = new Date().toDateString();

        const TIMELINE_HEIGHT = 60;
        const weekStart = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate(), 0, 0, 0);
        const weekEnd = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 6, 23, 59, 59);
        const weekEvents = this._eventSource ? (this._eventSource.getEvents(weekStart, weekEnd) || []) : [];

        for (let i = 0; i < 7; i++) {
            const dateObj = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + i);
            const isSelected = dateObj.toDateString() === selDate.toDateString();
            const isToday = dateObj.toDateString() === todayStr;

            const dayBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
            });

            const dayName = new St.Label({
                text: daysOfWeek[i],
                style: 'font-size: 0.8em; opacity: 0.7; margin-bottom: 2px;',
                x_align: Clutter.ActorAlign.CENTER,
            });

            const dayNum = new St.Label({
                text: dateObj.getDate().toString(),
                style: isToday ? 'font-weight: bold; color: #3584e4;' : '',
                x_align: Clutter.ActorAlign.CENTER,
            });

            dayBox.add_child(dayName);
            dayBox.add_child(dayNum);

            const showMiniTimeline = this._settings?.get_boolean('show-mini-timeline') ?? true;

            if (showMiniTimeline) {
                const dayCol = new St.Widget({
                    x_expand: true,
                    style: `height: ${TIMELINE_HEIGHT}px; margin-top: 6px; border-radius: 2px; background-color: rgba(128, 128, 128, 0.05);`,
                    clip_to_allocation: true,
                });
                dayCol.set_layout_manager(new Clutter.FixedLayout());

                const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0);
                const dayEnd = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 23, 59, 59);
                
                const dayEvents = weekEvents.filter(ev => ev.date <= dayEnd && ev.end >= dayStart);
                dayEvents.sort((a, b) => {
                    const durA = a.allDay ? 24 * 3600000 : (a.end.getTime() - a.date.getTime());
                    const durB = b.allDay ? 24 * 3600000 : (b.end.getTime() - b.date.getTime());
                    return durB - durA;
                });

                for (const ev of dayEvents) {
                    const evStart = Math.max(ev.date.getTime(), dayStart.getTime());
                    const evEnd = Math.min(ev.end.getTime(), dayEnd.getTime());

                    const startHour = new Date(evStart).getHours() + new Date(evStart).getMinutes() / 60;
                    const endHour = new Date(evEnd).getHours() + new Date(evEnd).getMinutes() / 60;

                    const y = (startHour / 24) * TIMELINE_HEIGHT;
                    let h = ((endHour - startHour) / 24) * TIMELINE_HEIGHT;
                    if (h < 2) h = 2;
                    if (ev.allDay) {
                        h = TIMELINE_HEIGHT;
                    }

                    let eventColor = this._getEventColor(ev);

                    const isAllDayOrMulti = ev.allDay || (ev.end.getTime() - ev.date.getTime() >= 24 * 3600000);

                    const block = new St.Widget({
                        style: `background-color: ${eventColor}; border-radius: 2px;`,
                    });
                    block.opacity = isAllDayOrMulti ? 77 : 204;
                    block.set_position(3, y);
                    block.set_size(-1, h);
                    block.add_constraint(new Clutter.BindConstraint({
                        source: dayCol,
                        coordinate: Clutter.BindCoordinate.WIDTH,
                        offset: -6,
                    }));
                    dayCol.add_child(block);
                }

                const now = new Date();
                if (isToday) {
                    const nowHour = now.getHours() + now.getMinutes() / 60;
                    const nowY = (nowHour / 24) * TIMELINE_HEIGHT;

                    const dot = new St.Widget({
                        style: 'background-color: #ed333b; border-radius: 3px;',
                    });
                    dot.set_position(0, nowY - 2);
                    dot.set_size(6, 6);
                    dayCol.add_child(dot);

                    const redLine = new St.Widget({
                        style: 'background-color: #ed333b; border-radius: 1px;',
                    });
                    redLine.set_position(6, nowY);
                    redLine.set_size(-1, 2);
                    redLine.add_constraint(new Clutter.BindConstraint({
                        source: dayCol,
                        coordinate: Clutter.BindCoordinate.WIDTH,
                        offset: -6,
                    }));
                    dayCol.add_child(redLine);
                }

                dayBox.add_child(dayCol);
            }

            const bgStyle = isSelected ? 'background-color: rgba(128, 128, 128, 0.2);' : 'background-color: transparent;';
            const dayBtn = new St.Button({
                child: dayBox,
                style_class: 'button',
                style: `padding: 4px 0; width: 36px; border-radius: 4px; margin: 0 2px; ${bgStyle}`,
            });
            dayBtn.connect('clicked', () => {
                this._selectedDate = dateObj;
                this._requestAndRefresh();
            });
            daysBox.add_child(dayBtn);
        }

        weekBox.add_child(daysBox);

        const nextBtn = new St.Button({
            child: new St.Icon({ icon_name: 'go-next-symbolic', icon_size: 16 }),
            style_class: 'button',
            style: 'padding: 6px; border-radius: 4px; margin-left: 8px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        nextBtn.connect('clicked', () => {
            this._selectedDate = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate() + 7);
            this._requestAndRefresh();
        });
        weekBox.add_child(nextBtn);

        const weekMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        weekMenuItem.add_child(weekBox);
        this._indicator.menu.addMenuItem(weekMenuItem);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const selStart = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate(), 0, 0, 0);
        const selEnd   = new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate(), 23, 59, 59);
        const selEvents = this._eventSource ? (this._eventSource.getEvents(selStart, selEnd) || []) : [];
        const sortedEvents = selEvents.sort((a, b) => a.date - b.date);

        if (sortedEvents.length === 0) {
            const isToday = selDate.toDateString() === todayStr;
            const emptyItem = new PopupMenu.PopupMenuItem(isToday ? 'No events today' : 'No events', {
                reactive: false,
                can_focus: false,
            });
            this._indicator.menu.addMenuItem(emptyItem);
            return;
        }

        for (const ev of sortedEvents) {
            const now = new Date();
            const isNow = ev.date <= now && ev.end >= now;
            
            const maxTitleLength = this._getMaxTitleLength();
            let title = ev.summary || 'Untitled Event';
            if (title.length > maxTitleLength)
                title = title.substring(0, maxTitleLength - 1) + '...';

            const item = new PopupMenu.PopupBaseMenuItem();
            const isPast = ev.end < now;
            if (isPast) {
                item.opacity = 127;
            }

            let eventColor = this._getEventColor(ev);
            let eventDescription = "";
            let eventLocation = "";
            let extraText = "";
            if (ev.id) {
                const parts = ev.id.split('\n');
                const sourceUid = parts[0];
                if (parts.length > 1 && parts[1]) {
                    const details = this._getEventDetails(sourceUid, parts[1]);
                    eventDescription = details.description || "";
                    eventLocation = details.location || "";
                    extraText = `${eventDescription} ${eventLocation}`;
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

            const labelBox = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            const titleLabel = new St.Label({
                text: title,
            });
            if (isNow) {
                titleLabel.set_style('font-weight: bold;');
            }
            labelBox.add_child(titleLabel);

            let effectiveEnd = new Date(ev.end.getTime() - 1);
            const isSameDay = ev.date.getFullYear() === effectiveEnd.getFullYear() &&
                              ev.date.getMonth() === effectiveEnd.getMonth() &&
                              ev.date.getDate() === effectiveEnd.getDate();

            let timeString;
            if (isSameDay) {
                timeString = ev.allDay ? 'All Day' : `${this._formatTime(ev.date)} - ${this._formatTime(ev.end)}`;
            } else {
                const endToFormat = ev.allDay ? effectiveEnd : ev.end;
                timeString = `${this._formatDateTime(ev.date, !ev.allDay)} - ${this._formatDateTime(endToFormat, !ev.allDay)}`;
            }

            const textToSearch = `${ev.summary || ''} ${ev.location || ''} ${ev.description || ''} ${extraText}`;
            const links = [];

            const zoomMatch = textToSearch.match(/https?:\/\/([a-zA-Z0-9-]+\.)?zoom\.(?:us|com)\/[^\s<>"']+/);
            if (zoomMatch) links.push({ url: zoomMatch[0], icon: 'camera-web-symbolic', name: 'Zoom' });

            const teamsMatch = textToSearch.match(/https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+/);
            if (teamsMatch) links.push({ url: teamsMatch[0], icon: 'camera-web-symbolic', name: 'Teams' });

            let indicoUrl = null;
            if (ev.id && ev.id.includes('@indico.cern.ch')) {
                const idMatch = ev.id.match(/indico-event-(\d+)@indico\.cern\.ch/);
                if (idMatch) {
                    indicoUrl = `https://indico.cern.ch/event/${idMatch[1]}/`;
                }
            }
            if (!indicoUrl) {
                const indicoMatch = textToSearch.match(/https?:\/\/indico\.cern\.ch\/event\/[^\s<>"']+/);
                if (indicoMatch) {
                    indicoUrl = indicoMatch[0];
                }
            }
            if (indicoUrl) {
                links.push({ url: indicoUrl, icon: 'x-office-calendar-symbolic', name: 'Indico' });
            }

            let displayLocation = eventLocation ? eventLocation.trim() : '';
            if (displayLocation) {
                const urlRegex = /https?:\/\/[^\s<>"']+/;
                const locationUrlMatch = displayLocation.match(urlRegex);
                
                if (locationUrlMatch) {
                    const matchedUrl = locationUrlMatch[0];
                    const alreadyInLinks = links.some(l => l.url === matchedUrl || matchedUrl.includes(l.url) || l.url.includes(matchedUrl));
                    
                    if (!alreadyInLinks) {
                        links.push({ url: matchedUrl, icon: 'web-browser-symbolic', name: 'Link' });
                    }
                    
                    displayLocation = displayLocation.replace(matchedUrl, '').trim();
                }
                
                displayLocation = displayLocation.replace(/^[,|-]\s*/, '').replace(/\s*[,|-]$/, '').trim();
            }

            if (displayLocation && displayLocation.length > 0) {
                timeString += `, ${displayLocation}`;
            }

            const timeLabel = new St.Label({
                text: timeString,
            });
            timeLabel.set_style('font-size: 0.85em; opacity: 0.8; max-width: 280px;');
            timeLabel.clutter_text.line_wrap = true;
            labelBox.add_child(timeLabel);

            item.add_child(labelBox);


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

    _getEventDetails(sourceUid, eventUid) {
        if (!this._sourceRegistry) {
            try {
                this._sourceRegistry = EDataServer.SourceRegistry.new_sync(null);
            } catch (e) {
                console.warn("ECAL SourceRegistry Error: " + e);
                return { description: "", location: "" };
            }
        }
        if (!this._ecalClients) this._ecalClients = {};
        
        try {
            let client = this._ecalClients[sourceUid];
            if (!client) {
                const source = this._sourceRegistry.ref_source(sourceUid);
                if (!source) {
                    console.warn("ECAL Error: Source not found for " + sourceUid);
                    return { description: "", location: "" };
                }
                client = ECal.Client.connect_sync(source, ECal.ClientSourceType.EVENTS, 1, null);
                if (!client) {
                    console.warn("ECAL Error: Failed to connect client for " + sourceUid);
                    return { description: "", location: "" };
                }
                this._ecalClients[sourceUid] = client;
            }
            
            const [success, comp] = client.get_object_sync(eventUid, null, null);
            if (!success || !comp) {
                console.warn("ECAL Error: Failed to get object " + eventUid);
                return { description: "", location: "" };
            }
            
            let description = "";
            let location = "";
            const descProp = comp.get_first_property(ICalGLib.PropertyKind.DESCRIPTION_PROPERTY);
            if (descProp) description = descProp.get_description();
            
            const locProp = comp.get_first_property(ICalGLib.PropertyKind.LOCATION_PROPERTY);
            if (locProp) location = locProp.get_location();
            
            return { description, location };
        } catch (e) {
            console.warn("ECAL Error: " + e);
            return { description: "", location: "" };
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

    _getEventColor(ev) {
        let eventColor = ev.color;
        if (!eventColor && ev.id) {
            const parts = ev.id.split('\n');
            eventColor = this._getCalendarColor(parts[0]);
        }
        return eventColor || '#3584e4';
    }

    /**
     * Format a Date object to a human-readable time string (e.g. "3:30 PM").
     */
    _formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /**
     * Format a Date object to a string with date and optionally time (e.g. "11 Jun, 14:00").
     */
    _formatDateTime(date, includeTime) {
        const options = { month: 'short', day: 'numeric' };
        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }
        return date.toLocaleString(undefined, options);
    }
}
