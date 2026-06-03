'use strict';
'require baseclass';

return baseclass.extend({
    _kwMap: null,
    _getMap: function() {
        if (!this._kwMap) this._kwMap = [
            // init.d
            ['VNT2: starting all enabled instances...',    _('VNT2: starting all enabled instances...')],
            ['Starting automatic download of vnt2/vnts2...', _('Starting automatic download of vnt2/vnts2...')],
            ['Start failed: config file does not exist:',  _('Start failed: config file does not exist:')],
            ['Start failed: unable to build startup command', _('Start failed: unable to build startup command')],
            ['Start failed: binary is not executable:',    _('Start failed: binary is not executable:')],
            ['Registered type=',                           _('Registered type=')],
            ['Fix route:',                                 _('Fix route:')],

            // vnt2-run.sh
            ['［INFO］',   _('［INFO］')],
            ['［WARN］',   _('［WARN］')],
            ['［ERROR］',  _('［ERROR］')],
            ['［DEBUG］',  _('［DEBUG］')],
            ['Starting:',                        _('Starting:')],
            ['Process exited',                   _('Process exited')],
            ['Log truncated (exceeded',    _('Log truncated (exceeded')],
            ['mkfifo failed',                    _('mkfifo failed')],

             // vnt2-update.sh
            ['Checking version:',                _('Checking version:')],
            ['API request failed or no version found',          _('API request failed or no version found')],
            ['API request failed, please switch mirror',        _('API request failed, please switch mirror')],
            ['Done, found',                      _('Done, found')],
            ['versions',                         _('versions')],
            ['No matching file found, please switch mirror',    _('No matching file found, please switch mirror')],
            ['No matching file found',           _('No matching file found')],
            ['SHA256 verification passed',       _('SHA256 verification passed')],
            ['SHA256 verification failed, please re-download',  _('SHA256 verification failed, please re-download')],
            ['sha256sum unavailable, skipping verification',    _('sha256sum unavailable, skipping verification')],
            ['Downloaded:',     _('Downloaded:')],
            ['Cache not found, please check version first',     _('Cache not found, please check version first')],
            ['Please check upstream version first',             _('Please check upstream version first')],
            ['Download URL not found:',          _('Download URL not found:')],
            ['Download URL not found, please re-check version', _('Download URL not found, please re-check version')],
            ['Downloading:',                     _('Downloading:')],
            ['Download failed rc=',              _('Download failed rc=')],
            ['Download failed(rc=',              _('Download failed(rc=')],
            ['), please switch mirror',          _('), please switch mirror')],
            ['Download complete:',               _('Download complete:')],
            ['Starting installation...',         _('Starting installation...')],
            ['Installation succeeded',           _('Installation succeeded')],
            ['Installation failed',              _('Installation failed')],
            ['Package installation failed',      _('Package installation failed')],
            ['File type:',                       _('File type:')],
            ['UPX compressing:',                 _('UPX compressing:')],
            ['UPX succeeded',                    _('UPX succeeded')],
            ['UPX failed, copying directly',     _('UPX failed, copying directly')],
            ['Installed:',                       _('Installed:')],
            ['Not found:',                       _('Not found:')],
            ['Not ELF, skipping:',               _('Not ELF, skipping:')],
            ['Installation complete:',           _('Installation complete:')],
            ['No installable file found',        _('No installable file found')],
            ['Unknown file format',              _('Unknown file format')],
            ['Service action:',                  _('Service action:')],
            ['=== Auto update:',                 _('=== Auto update:')],
            ['Local:',                           _('Local:')],
            ['Upstream:',                        _('Upstream:')],
            ['Already up to date, skipping',     _('Already up to date, skipping')],
            ['Already up to date(',              _('Already up to date(')],
            ['Updating:',                        _('Updating:')],
            ['Not installed',                    _('Not installed')],
            ['Unknown',                          _('Unknown')],
            ['Language pack detected:',          _('Language pack detected:')],

        ];
        return this._kwMap;
    },

    translate: function(body) {
        var map = this._getMap();
        for (var i = 0; i < map.length; i++) {
            var kw  = map[i][0];
            var tr  = map[i][1];
            if (kw !== tr && body.indexOf(kw) !== -1)
                body = body.split(kw).join(tr);
        }
        return body;
    }
});