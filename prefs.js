import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = ['left', 'center', 'right'];

export default class NextEventPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const positionLabels = [_('Left'), _('Center'), _('Right')];

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Top Bar'),
            description: _('Configure appearance and placement in the GNOME panel'),
        });
        page.add(group);

        const positionRow = new Adw.ComboRow({
            title: _('Panel position'),
            model: Gtk.StringList.new(positionLabels),
        });
        const currentPos = settings.get_string('panel-position');
        const selected = Math.max(0, POSITIONS.indexOf(currentPos));
        positionRow.set_selected(selected);
        positionRow.connect('notify::selected', row => {
            settings.set_string('panel-position', POSITIONS[row.get_selected()]);
        });
        group.add(positionRow);

        const fontSizeRow = new Adw.SpinRow({
            title: _('Font size'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 40,
                step_increment: 1,
                page_increment: 1,
            }),
        });
        settings.bind('font-size', fontSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(fontSizeRow);

        const maxTitleRow = new Adw.SpinRow({
            title: _('Max title length'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 120,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        settings.bind('max-title-length', maxTitleRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(maxTitleRow);

        const refreshRow = new Adw.SpinRow({
            title: _('Refresh interval (seconds)'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 900,
                step_increment: 5,
                page_increment: 30,
            }),
        });
        settings.bind('refresh-interval-seconds', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(refreshRow);

        const nowIndicatorRow = new Adw.SwitchRow({
            title: _('Show "Now" indicator'),
            subtitle: _('Use "Now" for events currently in progress'),
        });
        settings.bind('show-ongoing-indicator', nowIndicatorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(nowIndicatorRow);
    }
}
