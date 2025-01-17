/* Ssh Search Provider for Gnome Shell
 *
 * Copyright (c) 2011 Bernd Schlapsi
 *
 * This programm is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 *
 * This programm is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const Main = imports.ui.main;
const Search = imports.ui.search;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const Util = imports.misc.util;

// Settings
const SSHSEARCH_TERMINAL_APP = 'sakura';
const HOST_SEARCHSTRING = 'host ';

// sshSearchProvider holds the instance of the search provider
// implementation. If null, the extension is either uninitialized
// or has been disabled via disable().
var sshSearchProvider = null;

function SshSearchProvider() {
    this._init();
}

SshSearchProvider.prototype = {
    __proto__: Search.SearchProvider.prototype,

    _init: function(name) {
        //global.log('init ssh-search');
        Search.SearchProvider.prototype._init.call(this, "SSH");
        
        let filename = '';
        this._configHosts = [];
        this._knownHosts = [];
        this._sshknownHosts1 = [];
        this._sshknownHosts2 = [];
        
        // init for ~/.ssh/config
        filename = GLib.build_filenamev([GLib.get_home_dir(), '/.ssh/', 'config']);
        let configFile = Gio.file_new_for_path(filename);
        this.configMonitor = configFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this.configMonitor.connect('changed', Lang.bind(this, this._onConfigChanged));
        this._onConfigChanged(null, configFile, null, Gio.FileMonitorEvent.CREATED);

        // init for ~/.ssh/known_hosts
        filename = GLib.build_filenamev([GLib.get_home_dir(), '/.ssh/', 'known_hosts']);
        let knownhostsFile = Gio.file_new_for_path(filename);
        this.knownhostsMonitor = knownhostsFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this.knownhostsMonitor.connect('changed', Lang.bind(this, this._onKnownhostsChanged));
        this._onKnownhostsChanged(null, knownhostsFile, null, Gio.FileMonitorEvent.CREATED);

        // init for /etc/ssh/ssh_known_hosts
        let sshknownhostsFile1 = Gio.file_new_for_path('/etc/ssh/ssh_known_hosts');
        this.sshknownhostsMonitor1 = sshknownhostsFile1.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this.sshknownhostsMonitor1.connect('changed', Lang.bind(this, this._onSshKnownhosts1Changed));
        this._onSshKnownhosts1Changed(null, sshknownhostsFile1, null, Gio.FileMonitorEvent.CREATED);

        // init for /etc/ssh_known_hosts
        let sshknownhostsFile2 = Gio.file_new_for_path('/etc/ssh_known_hosts');
        this.sshknownhostsMonitor2 = sshknownhostsFile2.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this.sshknownhostsMonitor2.connect('changed', Lang.bind(this, this._onSshKnownhosts2Changed));
        this._onSshKnownhosts2Changed(null, sshknownhostsFile2, null, Gio.FileMonitorEvent.CREATED);
    },

    _onConfigChanged: function(filemonitor, file, other_file, event_type) {
        if (!file.query_exists (null)) {
            this._configHosts = [];
            return;
        }

        if (event_type == Gio.FileMonitorEvent.CREATED ||
            event_type == Gio.FileMonitorEvent.CHANGED ||
            event_type == Gio.FileMonitorEvent.CHANGES_DONE_HINT)
        {
            this._configHosts = [];

            // read hostnames if ssh-config file is created or changed
            let content = file.load_contents(null);
            let filelines = String(content[1]).trim().split('\n');

            // search for all lines which begins with "host"
            for (var i=0; i<filelines.length; i++) {
                let line = filelines[i].toLowerCase();
                if (line.match(HOST_SEARCHSTRING)) {
                    // read all hostnames in the host definition line
                    let hostnames = line.slice(HOST_SEARCHSTRING.length).split(' ');
                    for (var j=0; j<hostnames.length; j++) {
                        this._configHosts.push(hostnames[j]);
                    }
                }
            }
        }
    },

    _onKnownhostsChanged: function(filemonitor, file, other_file, event_type) {
        if (!file.query_exists (null)) {
            this._knownHosts = [];
            return;
        }

        if (event_type == Gio.FileMonitorEvent.CREATED ||
            event_type == Gio.FileMonitorEvent.CHANGED ||
            event_type == Gio.FileMonitorEvent.CHANGES_DONE_HINT)
        {
            this._knownHosts = this._parseKnownHosts(file);
        }
    },

    _onSshKnownhosts1Changed: function(filemonitor, file, other_file, event_type) {
        if (!file.query_exists (null)) {
            this._sshknownHosts1 = [];
            return;
        }

        if (event_type == Gio.FileMonitorEvent.CREATED ||
            event_type == Gio.FileMonitorEvent.CHANGED ||
            event_type == Gio.FileMonitorEvent.CHANGES_DONE_HINT)
        {
            this._sshknownHosts1 = this._parseKnownHosts(file);
        }
    },

    _onSshKnownhosts2Changed: function(filemonitor, file, other_file, event_type) {
        if (!file.query_exists (null)) {
            this._sshknownHosts2 = [];
            return;
        }

        if (event_type == Gio.FileMonitorEvent.CREATED ||
            event_type == Gio.FileMonitorEvent.CHANGED ||
            event_type == Gio.FileMonitorEvent.CHANGES_DONE_HINT)
        {
            this._sshknownHosts2 = this._parseKnownHosts(file);
        }
    },

    _parseKnownHosts: function(file) {
        let knownHosts = [];

        // read hostnames if ssh-known_hosts file is created or changed
        let content = file.load_contents(null);
        let filelines = String(content[1]).trim().split('\n');

        for (var i=0; i<filelines.length; i++) {
            let hostnames = filelines[i].split(' ')[0];

            // if hostname had a 60 char length, it looks like
            // the hostname is hashed and we ignore it here
            if (hostnames.length != 60) {
                hostnames = hostnames.split(',');
                for (var j=0; j<hostnames.length; j++) {
                    knownHosts.push(hostnames[j]);
                }
            }
        }
        return knownHosts;
    },

    getResultMeta: function(resultId) {
        let appSys = Shell.AppSystem.get_default();
        let app = appSys.lookup_app(SSHSEARCH_TERMINAL_APP + '.desktop');

        let ssh_name = resultId.host;
        if (resultId.port != 22) {
            ssh_name = ssh_name + ':' + resultId.port;
        }
        if (resultId.user.length != 0) {
            ssh_name = resultId.user + '@' + ssh_name;
        }

        return { 'id': resultId,
                 'name': ssh_name,
                 'createIcon': function(size) {
                                   return app.create_icon_texture(size);
                               }
               };
    },

    activateResult: function(id) {
        let target = id.host;
        if (id.user.length != 0) {
            target = id.user + '@' + target;
        }
        if (id.port == 22) {
            // don't call with the port option, because the host definition
            // could be from the ~/.ssh/config file
            Util.spawn([SSHSEARCH_TERMINAL_APP, '-e', 'ssh ' + target]);
        }
        else {
            Util.spawn([SSHSEARCH_TERMINAL_APP, '-e', 'ssh -p ' + id.port + ' ' + target]);
        }
    },

    _checkHostnames: function(hostnames, terms) {
        let searchResults = [];
        for (var i=0; i<hostnames.length; i++) {
            for (var j=0; j<terms.length; j++) {
                try {
                    let term_parts = terms[j].split('@');
                    let host = term_parts[term_parts.length-1];
                    let user = '';
                    if (term_parts.length > 1) {
                        user = term_parts[0];
                    }
                    if (hostnames[i].match(host)) {
                        host = hostnames[i];
                        let port = 22;

                        // check if hostname is in the format "[ip-address]:port"
                        if (host[0] == '[') {
                            let host_port = host.slice(1).split(']:');
                            host = host_port[0];
                            port = host_port[1];
                        }

                        searchResults.push({
                            'user': user,
                            'host': host,
                            'port': port
                        });
                    }
                }
                catch(ex) {
                    continue;
                }
            }
        }
        return searchResults;
    },

    getInitialResultSet: function(terms) {
        // check if a found host-name begins like the search-term
        let results = [];
        results = results.concat(this._checkHostnames(this._configHosts, terms));
        results = results.concat(this._checkHostnames(this._knownHosts, terms));
        results = results.concat(this._checkHostnames(this._sshknownHosts1, terms));
        results = results.concat(this._checkHostnames(this._sshknownHosts2, terms));

        if (results.length > 0) {
            return(results);
        }

        return [];
    },

    getSubsearchResultSet: function(previousResults, terms) {
        return this.getInitialResultSet(terms);
    },
};

function init(meta) {
}

function enable() {
    if (sshSearchProvider==null) {
        sshSearchProvider = new SshSearchProvider();
        Main.overview.addSearchProvider(sshSearchProvider);
    }
}

function disable() {
    if  (sshSearchProvider!=null) {
        Main.overview.removeSearchProvider(sshSearchProvider);
        sshSearchProvider.configMonitor.cancel();
        sshSearchProvider.knownhostsMonitor.cancel();
        sshSearchProvider.sshknownhostsMonitor1.cancel();
        sshSearchProvider.sshknownhostsMonitor2.cancel();
        sshSearchProvider = null;
    }
}
