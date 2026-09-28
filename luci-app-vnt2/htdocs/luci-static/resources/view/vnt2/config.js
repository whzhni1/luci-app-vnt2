'use strict';
'require view';
'require ui';
'require uci';
'require rpc';
'require vnt2.common';
'require vnt2.reference_editor';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callGetTemplateFields = rpcDeclare('get_template_fields', ['type','template']);
var callListConfigs       = rpcDeclare('list_configs',        ['filter']);
var callReadConfig        = rpcDeclare('read_config',         ['name','type']);
var callSaveConfig        = rpcDeclare('save_config',         ['name','type','content','old_name']);
var callDeleteConfig      = rpcDeclare('delete_config',       ['name','type']);
var callReadTemplate      = rpcDeclare('read_template',       ['type','template']);
var callListTemplates     = rpcDeclare('list_config_templates', ['type']);
var callListInstances     = rpcDeclare('list_instances',      []);
var callSetEnabled        = rpcDeclare('set_enabled',         ['type','configs']);
var callGetEnabled        = rpcDeclare('get_enabled',         ['type']);
var callInstanceAction    = rpcDeclare('instance_action',     ['name','action','type']);
var callSetWebAddr       = rpcDeclare('set_web_addr',       ['addr']);
var callRefreshWebToken  = rpcDeclare('refresh_web_token',  []);
var callSetWebToken       = rpcDeclare('set_web_token',       ['token']);
var callListWebInstances  = rpcDeclare('list_web_instances',  []);
var callWebInstanceAction = rpcDeclare('web_instance_action', ['file_name','action']);
var callGetConfExample    = rpcDeclare('get_conf_example',     ['type']);

var TABS          = { vnt:_('Client'), vnts:_('Server') };
var START_METHODS = { vnt:['vnt2_cli'], vnts:['vnts2'] };

function tabLabel(tab) { return tab === 'web' ? 'vnt2_web' : (TABS[tab] || tab); }

var _tab             = 'vnt';
var _dirty           = false;
var _listState       = { vnt:{}, vnts:{} };
var _listStateLoaded = { vnt:false, vnts:false };
var _statusTimer     = null;
var _webRowTouched   = {};

function defaultMethod(tab) { return START_METHODS[tab][0]; }

function parseConfigs(r) {
    return (r && Array.isArray(r.configs)) ? r.configs : [];
}

function parseWebInstances(r) {
    return {
        available: !!(r && r.web_available === '1'),
        items: (r && Array.isArray(r.items)) ? r.items : []
    };
}

function resetListState() {
    _listState       = { vnt:{}, vnts:{} };
    _listStateLoaded = { vnt:false, vnts:false };
}

function parseInstanceList(instances) {
    var status = {}, webAddr = {};
    (instances || []).forEach(function(inst) {
        if (!inst.name) return;
        var key = inst.type === 'web' ? inst.name : inst.type + '/' + inst.name;
        status[key]  = !!inst.running;
        webAddr[key] = inst.web_addr || '';
    });
    return { status:status, webAddr:webAddr };
}

function loadListState(tab) {
    if (_listStateLoaded[tab]) return Promise.resolve();
    return callGetEnabled(tab).then(function(r) {
        applyListStateResult(tab, r);
    });
}

function applyListStateResult(tab, r) {
    var state = {};
    ((r && r.configs) || []).forEach(function(item) {
        if (!item.name) return;
        var webReady    = !!(item.web_addr && item.web_addr.trim());
        var startMethod = item.name === 'vnt2_web' ? 'vnt2_web' : (tab === 'vnt' ? 'vnt2_cli' : (item.method_set ? item.start_method : defaultMethod(tab)));
        state[item.name] = {
            enabled:      !!item.enabled,
            start_method: startMethod,
            _methodSet:   true,
            _cfgWebAddr:  webReady ? '1' : ''
        };
    });
    _listState[tab] = state;
    _listStateLoaded[tab] = true;
}

function syncEnabledState(tab, r) {
    var backup = _listState[tab];
    applyListStateResult(tab, r);
    Object.keys(backup || {}).forEach(function(name) {
        if (backup[name]._dirty && _listState[tab][name]) {
            _listState[tab][name].enabled = backup[name].enabled;
            _listState[tab][name]._dirty  = true;
        }
    });
}

function clearDirtyToggles() {
    Object.keys(_listState).forEach(function(tab) {
        Object.keys(_listState[tab]).forEach(function(name) {
            delete _listState[tab][name]._dirty;
        });
    });
}

function refreshToggleCells(self) {
    document.querySelectorAll('tr[data-cfg-name]').forEach(function(row) {
        var name  = row.getAttribute('data-cfg-name');
        var state = _listState[_tab] ? _listState[_tab][name] : null;
        var box   = row.querySelector('input[type=checkbox]');
        if (!box || !state || state._dirty) return;
        if (box.checked !== !!state.enabled) box.checked = !!state.enabled;
    });
}

function saveListState(self, silent) {
    var promises = Object.keys(TABS).map(function(tab) {
        if (!_listStateLoaded[tab]) return Promise.resolve({ result: 'ok' });
        var configs = Object.keys(_listState[tab]).map(function(name) {
            return {
                name:         name,
                enabled:      _listState[tab][name].enabled,
                start_method: name === 'vnt2_web' ? 'vnt2_web' : (tab === 'vnt' ? 'vnt2_cli' : _listState[tab][name].start_method)
            };
        });
        return callSetEnabled(tab, configs);
    });
    return Promise.all(promises).then(function(results) {
        if (results.some(function(r) { return r && r.result !== 'ok'; })) {
            self._ui.notify(_('Partial save failed'), 'error');
            return;
        }
        clearDirtyToggles();
        if (!silent) self._ui.notify(_('Configuration saved'), 'success');
        return refreshStatus(self);
    }).catch(function(err) {
        self._ui.notify(_('Save error: %s').format(String(err)), 'error');
    });
}

function setTabActive(el, active) {
    if (!el) return;
    el.classList.toggle('active', !!active);
}

function updateToolbarForTab(tab) {
    var localBtn = document.getElementById('vnt2-btn-new-local');
    var webBtn   = document.getElementById('vnt2-btn-new-web');
    if (localBtn) localBtn.textContent = (tab === 'vnt') ? _('New vnt2_cli Instance') : _('New Config');
    if (webBtn) webBtn.style.display = (tab === 'vnt') ? '' : 'none';
}

function toggleView(showListView) {
    var lw = document.getElementById('vnt2-list-wrap');
    var ew = document.getElementById('vnt2-edit-wrap');
    if (!lw || !ew) return;
    lw.style.display = showListView ? '' : 'none';
    ew.style.display = showListView ? 'none' : '';
    if (showListView) { ew.innerHTML = ''; location.hash = _tab; }
}

function switchTab(self, tab) {
    if (_tab === tab) return;
    var ew      = document.getElementById('vnt2-edit-wrap');
    var editing = ew && ew.style.display !== 'none';
    function doSwitch() {
        _tab          = tab;
        _dirty        = false;
        location.hash = tab;
        Object.keys(TABS).forEach(function(t) {
            setTabActive(document.getElementById('vnt2-tab-' + t), t === tab);
        });
        toggleView(true);
        updateToolbarForTab(tab);
        if (!self._configs[tab]) {
            Promise.all([callListConfigs(tab), loadListState(tab)]).then(function(res) {
                self._configs[tab] = parseConfigs(res[0]);
                rebuildTable(self);
            });
        } else {
            loadListState(tab).then(function() { rebuildTable(self); });
        }
    }
    if (editing && _dirty) {
        self._ui.confirm(_('Discard Changes'),
            _('Unsaved changes will be lost when switching tabs. Are you sure?'))
            .then(function(ok) { if (ok) doSwitch(); });
    } else {
        doSwitch();
    }
}

function startStatusTimer(self) {
    stopStatusTimer();
    _statusTimer = window.setInterval(function() { refreshStatus(self); }, 3000);
}

function stopStatusTimer() {
    if (_statusTimer) { window.clearInterval(_statusTimer); _statusTimer = null; }
}

function refreshStatus(self) {
    var enabledSync = callGetEnabled(_tab).then(function(r) {
        syncEnabledState(_tab, r);
    }).catch(function() {});
    return Promise.all([
        enabledSync,
        callListInstances().then(function(r) {
            var parsed   = parseInstanceList(r && r.instances);
            self._status  = parsed.status;
            self._webAddr = parsed.webAddr;
            return enabledSync.then(function() {
                if (_tab === 'vnt') {
                    refreshStatusCells(self);
                    refreshToggleCells(self);
                } else
                    rebuildTable(self);
            });
        })
    ]).then(function() {
        if (_tab !== 'vnt') return null;
        return callListWebInstances().then(function(r) {
            self._webInsts = parseWebInstances(r);
            refreshWebInstCells(self);
        });
    }).catch(function() {});
}

function refreshWebInstCells(self) {
    var web   = self._webInsts || { available:false, items:[] };
    var items = web.available ? web.items : [];
    var rows  = [];
    document.querySelectorAll('tr[data-web-name]').forEach(function(row) {
        if (row.getAttribute('data-web-name') !== 'vnt2_web') rows.push(row);
    });
    if (rows.length !== items.length) { rebuildTable(self); return; }
    var map = {};
    items.forEach(function(it) { if (it && it.name) map[it.name] = it; });
    var stale = false;
    rows.forEach(function(row) {
        var it   = map[row.getAttribute('data-web-name')];
        var cell = row.querySelector('.vnt2-status-cell');
        if (!it || !cell) { stale = true; return; }
        cell.innerHTML = '';
        cell.appendChild(buildWebInstBadge(self, it));
        var box = row.querySelector('input[type=checkbox]');
        if (box && Date.now() - (_webRowTouched[it.name] || 0) >= 5000) {
            var want = it.running === '1';
            if (box.checked !== want) box.checked = want;
        }
    });
    if (stale) rebuildTable(self);
}

function rebuildTable(self) {
    var toolbar = document.getElementById('vnt2-config-toolbar');
    if (toolbar) toolbar.style.display = 'flex';
    var wrap = document.getElementById('vnt2-table-wrap');
    if (!wrap) return;
    var tableWrap  = wrap.querySelector('.vnt2-table-wrap');
    var scrollLeft = tableWrap ? tableWrap.scrollLeft : 0;
    wrap.innerHTML = '';
    wrap.appendChild(buildTable(self));
    var newTableWrap = wrap.querySelector('.vnt2-table-wrap');
    if (newTableWrap && scrollLeft > 0) newTableWrap.scrollLeft = scrollLeft;
}

function statusKey(tab, name) {
    return name === 'vnt2_web' ? name : tab + '/' + name;
}

function refreshStatusCells(self) {
    document.querySelectorAll('tr[data-cfg-name]').forEach(function(row) {
        var name = row.getAttribute('data-cfg-name');
        var cell = row.querySelector('.vnt2-status-cell');
        if (!name || !cell) return;
        var state = ensureState(_tab, name);
        cell.innerHTML = '';
        cell.appendChild(self._ui.statusBadge(state.enabled ? (self._status && self._status[statusKey(_tab, name)]) : null));
    });
}

function editVntWebAddr(self) {
    self._web.getAccess().then(function(r) {
        var oldAddr = (r && r.addr) || '0.0.0.0:19099';
        var input = E('input', {'type':'text','class':'cbi-input-text','style':'width:100%;','value':oldAddr});
        var closeM = self._ui.modal(_('Edit vnt2_web Listen Address'), [
            E('div', {'class':'vnt2-modal-body'}, [
                self._ui.buildFormRow(_('Listen Address'), input, _('Example: 0.0.0.0:19099'))
            ]),
            E('div', {'class':'vnt2-modal-btns'}, [
                E('button', {'class':'btn','click':function(){ closeM(); }}, _('Cancel')),
                E('button', {'class':'btn cbi-button-save','click':function() {
                    var addr = (input.value || '').trim();
                    if (!addr) { self._ui.notify(_('Listen address cannot be empty'), 'error'); input.focus(); return; }
                    input.classList.remove('vnt2-input-error');
                    callSetWebAddr(addr).then(function(res) {
                        if (!res || res.result !== 'ok') {
                            input.classList.add('vnt2-input-error');
                            self._ui.notify(res && res.code === 'port_conflict' ? portErrorMessage(res) : _('Save failed: %s').format((res && (res.msg || res.error)) || ''), 'error');
                            return;
                        }
                        closeM();
                        self._ui.notify(_('vnt2_web listen address saved'), 'success');
                        _listStateLoaded.vnt = false; loadListState('vnt').then(function(){ rebuildTable(self); refreshStatus(self); });
                    });
                }}, _('Save'))
            ])
        ]);
        window.setTimeout(function(){ input.focus(); input.select(); }, 50);
    });
}

function showVntWebToken(self) {
    self._web.getAccess().then(function(r) {
        var token = (r && r.token) || '';
        var input = E('input', {'type':'text','class':'cbi-input-text vnt2-token-input','value':token,'spellcheck':'false'});
        var closeT = self._ui.modal(_('vnt2_web Access Token'), [
            E('div', {'class':'vnt2-modal-body'}, [
                self._ui.buildFormRow(_('Access Token'), input, _('Token must be exactly 64 hexadecimal characters'))
            ]),
            E('div', {'class':'vnt2-modal-btns'}, [
                E('button', {'class':'btn','click':function(){ closeT(); }}, _('Close')),
                E('button', {'class':'btn cbi-button-save','click':function() {
                    var val = (input.value || '').trim();
                    if (!/^[0-9a-fA-F]{64}$/.test(val)) {
                        input.classList.add('vnt2-input-error');
                        self._ui.notify(_('Token must be exactly 64 hexadecimal characters'), 'error');
                        input.focus();
                        return;
                    }
                    input.classList.remove('vnt2-input-error');
                    if (val === token) { closeT(); return; }
                    callSetWebToken(val).then(function(res) {
                        if (!res || res.result !== 'ok') {
                            self._ui.notify(_('Save failed: %s').format((res && (res.msg || res.code)) || ''), 'error');
                            return;
                        }
                        closeT();
                        self._ui.notify(res.restarted === '1'
                            ? _('Token saved, vnt2_web restarted')
                            : _('Token saved'), 'success');
                    }).catch(function(err) {
                        self._ui.notify(_('Save failed: %s').format(String(err)), 'error');
                    });
                }}, _('Save'))
            ])
        ], 'vnt2-modal-wide');
        window.setTimeout(function(){ input.focus(); input.select(); }, 50);
    });
}

function refreshVntWebToken(self) {
    self._ui.confirm(_('Refresh vnt2_web Token'), _('Refresh vnt2_web access token? Existing tokenized links and logged-in browsers will become invalid.')).then(function(ok) {
        if (!ok) return;
        callRefreshWebToken().then(function(res) {
            self._ui.notify(res && res.result === 'ok' ? _('vnt2_web token refreshed') : _('Refresh failed: %s').format((res && res.msg) || ''), res && res.result === 'ok' ? 'success' : 'error');
            _listStateLoaded.vnt = false; loadListState('vnt').then(function(){ rebuildTable(self); refreshStatus(self); });
        }).catch(function(err) { self._ui.notify(_('Refresh failed: %s').format(String(err)), 'error'); });
    });
}

function buildHeadRow() {
    var heads = [_('Enabled'),_('Name'),_('Status'),_('Actions')];
    return E('thead', {}, E('tr', {},
        heads.map(function(h) { return E('th', {}, h); })
    ));
}

function buildCliTable(self, configs) {
    if (!configs.length)
        return E('p', {'class':'vnt2-empty'},
            _('No %s configurations yet. Click "New Config" to add one.').format(TABS[_tab]));
    return E('div', {'class':'vnt2-table-wrap vnt2-table-card'},
        E('table', {'class':'vnt2-table'}, [
            buildHeadRow(),
            E('tbody', {}, configs.map(function(cfg) { return buildRow(self, cfg); }))
        ])
    );
}

function buildWebInstBadge(self, it) {
    return self._ui.statusBadge(it.running === '1' ? true : (it.running === '0' ? false : null));
}

function updateWebInstCell(self, it) {
    var row = document.querySelector('tr[data-web-name="' + it.name + '"]');
    if (!row) return;
    var cell = row.querySelector('.vnt2-status-cell');
    if (!cell) return;
    cell.innerHTML = '';
    cell.appendChild(buildWebInstBadge(self, it));
}

function buildWebInstRow(self, it) {
    var name   = it.name;
    var orphan = it.exists === '0';
    var toggle = self._ui.toggleSwitch('vnt2-web-enabled-' + name, it.running === '1', function(ev, input) {
        var want = input.checked;
        _webRowTouched[name] = Date.now();
        callWebInstanceAction(name, want ? 'start' : 'stop').then(function(res) {
            if (res && res.result === 'ok') {
                it.enabled = want ? '1' : '0';
                it.running = want ? '1' : '0';
                updateWebInstCell(self, it);
                self._ui.notify(_('Instance "%s" %s succeeded').format(name, want ? _('Start') : _('Stop')), 'success');
            } else {
                input.checked = !want;
                self._ui.notify(_('Action failed: %s').format((res && (res.msg || res.code)) || ''), 'error');
            }
        }).catch(function(err) {
            input.checked = !want;
            self._ui.notify(_('Action failed: %s').format(String(err)), 'error');
        });
    }, null, orphan);
    var actions = orphan ? [
        self._ui.iconButton('edit', _('Edit'), null, true),
        self._ui.iconButton('code', _('Edit Raw Config'), null, true),
        self._ui.iconButton('delete', _('Delete stale record'), function() { deleteWebInst(self, it); }, false)
    ] : [
        self._ui.iconButton('edit', _('Edit'), function() { openEditor(self, name, false, null, 'web'); }, false),
        self._ui.iconButton('code', _('Edit Raw Config'), function() { openRawEditor(self, name, 'web'); }, false),
        self._ui.iconButton('delete', _('Delete'), function() { deleteWebInst(self, it); }, false)
    ];
    var nameAttrs = {'class':'vnt2-col-name'};
    if (orphan) {
        nameAttrs['class'] += ' vnt2-muted-text';
        nameAttrs['title'] = _('This instance no longer exists in vnt2_web');
    }
    return E('tr', {'data-web-name':name}, [
        E('td', {}, toggle),
        E('td', nameAttrs, it.config_name || name),
        E('td', {'class':'vnt2-status-cell'}, buildWebInstBadge(self, it)),
        E('td', {}, E('div', {'class':'vnt2-btn-group'}, actions))
    ]);
}

function buildWebCard(self) {
    var web  = self._webInsts || { available:false, items:[] };
    var rows = [buildRow(self, { name:'vnt2_web', type:'web', locked:true })];
    web.items.forEach(function(it) { rows.push(buildWebInstRow(self, it)); });
    var body = [
        E('div', {'class':'vnt2-table-wrap'},
            E('table', {'class':'vnt2-table'}, [
                buildHeadRow(),
                E('tbody', {}, rows)
            ]))
    ];
    return self._ui.card('vnt2_web', body, 'vnt2-inst-card');
}

function buildCliCard(self) {
    return self._ui.card('vnt2_cli', [buildCliTable(self, (self._configs.vnt || []).slice())], 'vnt2-inst-card');
}

function buildTable(self) {
    if (_tab === 'vnts')
        return E('div', {}, [buildCliTable(self, (self._configs[_tab] || []).slice())]);
    return E('div', {'class':'vnt2-inst-cards'}, [
        buildWebCard(self),
        buildCliCard(self)
    ]);
}

function refreshWebInstances(self) {
    return callListWebInstances().then(function(r) {
        self._webInsts = parseWebInstances(r);
        rebuildTable(self);
    }).catch(function() {});
}

function deleteWebInst(self, it) {
    var name    = it.name;
    var running = it.running === '1';
    self._ui.confirm(_('Confirm Delete'),
        running
            ? _('Instance "%s" is running and will be stopped on delete. Are you sure?').format(name)
            : _('Are you sure to delete config "%s"?').format(name)
    ).then(function(ok) {
        if (!ok) return;
        callDeleteConfig(name, 'web').then(function(r) {
            if (r && r.result === 'ok') {
                self._ui.notify(_('Config "%s" has been deleted').format(name), 'success');
                return refreshWebInstances(self);
            }
            self._ui.notify(_('Delete failed: %s').format((r && r.msg)||''), 'error');
        });
    });
}

function buildRow(self, cfg) {
    var tab     = _tab;
    var name    = cfg.name;
    var state   = ensureState(tab, name);

    var cb;
    var toggle = self._ui.toggleSwitch('vnt2-enabled-' + name, !!state.enabled, function(ev, input) {
        cb = input;
        _listState[tab][name].enabled = input.checked;
        _listState[tab][name]._dirty  = true;
        var cell = input.closest('tr').querySelector('.vnt2-status-cell');
        if (cell) {
            cell.innerHTML = '';
            cell.appendChild(self._ui.statusBadge(
                input.checked ? (self._status && self._status[statusKey(tab, name)]) : null
            ));
        }
    });
    cb = toggle.querySelector('input');

    var statusCell = E('td', {'class':'vnt2-status-cell'},
        self._ui.statusBadge(state.enabled ? (self._status && self._status[statusKey(tab, name)]) : null));

    var locked = name === 'vnt2_web' || cfg.locked;
    var actions = locked ? [
        self._ui.iconButton('edit', _('Edit Listen Address'), function() { editVntWebAddr(self); }, false),
        self._ui.iconButton('key', _('View Access Token'), function() { showVntWebToken(self); }, false),
        self._ui.iconButton('restart', _('Refresh Access Token'), function() { refreshVntWebToken(self); }, false)
    ] : [
        self._ui.iconButton('edit', _('Edit'), function() { openEditor(self, name, false); }, false),
        self._ui.iconButton('code', _('Edit Raw Config'), function() { openRawEditor(self, name); }, false),
        self._ui.iconButton('delete', _('Delete'), function() { deleteConfig(self, name); }, false)
    ];
    return E('tr', {'data-cfg-name':name}, [
        E('td', {}, toggle),
        E('td', {'class':'vnt2-col-name'}, name),
        statusCell,
        E('td', {}, E('div', {'class':'vnt2-btn-group'}, actions))
    ]);
}

function ensureState(tab, name) {
    if (!_listState[tab][name])
        _listState[tab][name] = {
            enabled:false, start_method:defaultMethod(tab),
            _methodSet:false, _cfgWebAddr:''
        };
    return _listState[tab][name];
}

function filterValuesByTemplateFields(fields, values) {
    var out = {};
    fields = fields || [];
    values = values || {};
    fields.forEach(function(f) {
        if (!f || !f.name) return;
        if (f.type === 'section') {
            var src = values[f.name] || {};
            var obj = {};
            var defKeys = Object.keys(f.keys || {});
            if (defKeys.length) {
                defKeys.forEach(function(k) {
                    if (Object.prototype.hasOwnProperty.call(src, k)) obj[k] = src[k];
                });
            } else {
                Object.keys(src).forEach(function(k) { obj[k] = src[k]; });
            }
            out[f.name] = obj;
        } else if (Object.prototype.hasOwnProperty.call(values, f.name)) {
            out[f.name] = values[f.name];
        }
    });
    return out;
}

function openEditor(self, name, isNew, templateName, typeOverride) {
    var ew = document.getElementById('vnt2-edit-wrap');
    if (!ew) return;
    ew.innerHTML = '';
    ew.appendChild(E('div', {'class':'vnt2-loading'}, _('Loading configuration...')));
    var tab = typeOverride || _tab;
    location.hash = (tab === 'web')
        ? 'vnt&web=' + (isNew ? 'new' : name)
        : _tab + (isNew ? '&new' : '&edit=' + name);
    toggleView(false);
    var tplTab = (tab === 'web') ? 'vnt' : tab;
    var p   = (isNew || !name)
        ? Promise.all([callReadTemplate(tplTab, templateName || ''), callGetTemplateFields(tplTab, templateName || ''), callListTemplates(tplTab)]).then(function(res) {
            return {
                content:(res[0] && res[0].content)||'',
                template:(res[0] && res[0].template) || templateName || 'default',
                fields:(res[1] && Array.isArray(res[1].fields)) ? res[1].fields : [],
                templates:(res[2] && Array.isArray(res[2].templates)) ? res[2].templates : [],
                values:{}
            };
          })
        : Promise.all([callReadConfig(name, tab), callReadTemplate(tplTab), callGetTemplateFields(tplTab)]).then(function(res) {
            var c = (res[0] && res[0].content) || '';
            return {
                content:(res[1] && res[1].content) || '',
                template:(res[1] && res[1].template) || 'default',
                values:filterValuesByTemplateFields((res[2] && Array.isArray(res[2].fields)) ? res[2].fields : (self._fields[tplTab] || []), self._parser.parseValues(c)),
                fields:(res[2] && Array.isArray(res[2].fields)) ? res[2].fields : (self._fields[tplTab] || [])
            };
          });
    p.then(function(res) {
        _dirty = false;
        ew.innerHTML = '';
        ew.appendChild(buildEditor(self, name, isNew, tab, res));
    }).catch(function(err) {
        self._ui.notify(_('Load failed: %s').format(String(err)), 'error');
        toggleView(true);
    });
}

function openRawEditor(self, name, typeOverride) {
    var ew = document.getElementById('vnt2-edit-wrap');
    if (!ew) return;
    ew.innerHTML = '';
    ew.appendChild(E('div', {'class':'vnt2-loading'}, _('Loading configuration...')));
    var tab = typeOverride || _tab;
    location.hash = (tab === 'web') ? 'vnt&webraw=' + name : _tab + '&raw=' + name;
    toggleView(false);
    Promise.all([
        callReadConfig(name, tab),
        callGetConfExample(tab === 'web' ? 'vnt' : tab).catch(function() { return { content:'' }; })
    ]).then(function(res) {
        _dirty = false;
        ew.innerHTML = '';
        ew.appendChild(buildRawEditor(self, name, tab, (res[0] && res[0].content) || '', (res[1] && res[1].content) || ''));
    }).catch(function(err) {
        self._ui.notify(_('Load failed: %s').format(String(err)), 'error');
        toggleView(true);
    });
}

function buildRawEditor(self, name, tab, content, example) {
    var editor = self._ref.build({
        referenceTitle: _('Official --conf-example'),
        editorTitle: _('Raw Config'),
        referenceText: example || '',
        value: content || '',
        insertChips: false,
        guide: false,
        highlightUnknownParams: true,
        includeCommentedParams: false,
        unknownParamsTitle: '',
        onInput: function() { _dirty = true; }
    });

    function backToList() {
        if (_dirty) {
            self._ui.confirm(_('Discard Changes'), _('Unsaved changes exist. Are you sure to discard and return?'))
                .then(function(ok) { if (ok) { _dirty = false; toggleView(true); } });
        } else toggleView(true);
    }

    return E('div', {'class':'vnt2-edit-view vnt2-raw-edit-view'}, [
        E('div', {'class':'vnt2-edit-header'}, [
            E('div', {'class':'vnt2-breadcrumb'}, [
                E('span', {'class':'vnt2-breadcrumb-link','click':backToList}, _('%s Config List').format(tabLabel(tab))),
                E('span', {'class':'vnt2-breadcrumb-sep'}, ' › '),
                E('span', {}, _('Edit Raw Config')),
                E('span', {'class':'vnt2-breadcrumb-sep'}, ' › '),
                E('span', {'class':'vnt2-bold'}, name)
            ])
        ]),
        editor.node,
        E('div', {'class':'vnt2-edit-footer vnt2-raw-footer'}, [
            E('button', {'class':'btn','click':backToList}, _('Back to List')),
            E('button', {'class':'btn cbi-button-save','click':function() {
                var raw = editor.getValue();
                var dupErrors = self._validator.validateDuplicateParameters(raw, false);
                if (dupErrors.length) {
                    if (editor.showValidationErrors) editor.showValidationErrors(dupErrors);
                    self._ui.notify(dupErrors.join('\n'), 'error');
                    return;
                }
                function doSave() {
                    callSaveConfig(name, tab, raw, name).then(function(r) {
                        if (!r || r.result !== 'ok') {
                            self._ui.notify(r && r.code === 'port_conflict' ? portErrorMessage(r) : _('Save failed: %s').format((r && (r.msg || r.error)) || ''), 'error');
                            return;
                        }
                        _dirty = false;
                        if (tab === 'web') {
                            if (r.restarted === '1')
                                self._ui.notify(_('Instance "%s" restarted successfully').format(name), 'success');
                            refreshWebInstances(self).then(function(){ toggleView(true); });
                            return;
                        }
                        refreshStatus(self).then(function(){ toggleView(true); });
                    }).catch(function(err) {
                        self._ui.notify(_('Save error: %s').format(String(err)), 'error');
                    });
                }
                var unknown = self._validator.unknownAgainstReference(raw, example || '', false);
                if (unknown.length) {
                    if (editor.showValidationErrors) editor.showValidationErrors([]);
                    self._ui.confirm(_('Unknown Parameters'), self._validator.unknownParamsMessage(unknown)).then(function(ok) {
                        if (!ok) return;
                        if (editor.clearValidation) editor.clearValidation();
                        doSave();
                    });
                    return;
                }
                doSave();
            }}, _('Save Raw Config'))
        ])
    ]);
}

function buildEditor(self, name, isNew, tab, res) {
    var fields = res.fields || self._fields[tab === 'web' ? 'vnt' : tab] || [];
    var formEl = buildForm(fields, res.values, self._parser);
    formEl.addEventListener('input',  function() { _dirty = true; });
    formEl.addEventListener('change', function() { _dirty = true; });

    if (isNew && (tab === 'vnt' || tab === 'web')) {
        var tunInput = formEl.querySelector('[data-field-name="tun_name"]');
        if (tunInput) {
            tunInput._userEdited = false;
            tunInput.addEventListener('input', function() { tunInput._userEdited = true; });
        }
    }

    var nameErr   = E('span', {'class':'vnt2-name-error'});
    var nameInput = E('input', {
        'type':'text','class':'cbi-input-text','style':'width:auto;',
        'value':name||'','placeholder':_('Letters, numbers, underscores, hyphens')
    });
    nameInput.addEventListener('input', function() {
        _dirty = true;
        nameErr.style.display = 'none';
        if (isNew) {
            var ti = formEl.querySelector('[data-field-name="tun_name"]');
            if (ti && !ti._userEdited) ti.value = 'vnt_' + nameInput.value.trim().replace(/\.toml$/, '');
        }
    });

    function backToList() {
        if (_dirty) {
            self._ui.confirm(_('Discard Changes'),
                _('Unsaved changes exist. Are you sure to discard and return?'))
                .then(function(ok) { if (ok) { _dirty = false; toggleView(true); } });
        } else {
            toggleView(true);
        }
    }

    return E('div', {'class':'vnt2-edit-view'}, [
        E('div', {'class':'vnt2-edit-header'}, [
            E('div', {'class':'vnt2-breadcrumb'}, [
                E('span', {'class':'vnt2-breadcrumb-link','click':backToList},
                    _('%s Config List').format(tabLabel(tab))),
                E('span', {'class':'vnt2-breadcrumb-sep'}, ' › '),
                E('span', {}, isNew ? _('New Configuration') : _('Edit Configuration'))
            ]),
            isNew ? E('div', {'class':'vnt2-row-nowrap','style':'margin-top:8px;'}, [
                E('label', {'style':'flex-shrink:0;'}, _('Template:')),
                E('select', {'class':'cbi-input-select vnt2-select-auto','change':function(ev) {
                    var next = ev.target.value;
                    var reload = function() { openEditor(self, nameInput.value.trim(), true, next, tab); };
                    if (_dirty) self._ui.confirm(_('Switch Template'), _('Switching template will rebuild the form. Continue?')).then(function(ok){ if (ok) reload(); else ev.target.value = res.template || 'default'; });
                    else reload();
                }}, (res.templates || []).map(function(t) {
                    return E('option', {'value':t.name, 'selected':t.name === (res.template || 'default') ? 'selected' : null}, t.label || t.name);
                }))
            ]) : E('span', {}),
            E('div', {'class':'vnt2-row-nowrap','style':'margin-top:8px;'}, [
                E('label', {'style':'margin-right:6px;flex-shrink:0;'},
                    _('Configuration Name:')),
                nameInput, nameErr
            ])
        ]),
        E('div', {'class':'vnt2-edit-body'}, formEl),
        E('div', {'class':'vnt2-edit-footer'}, [
            E('button', {'class':'btn','click':backToList}, _('Back to List')),
            E('button', {
                'class':'btn cbi-button-save',
                'click': function() {
                    var newName = nameInput.value.trim();
                    if (!newName || !/^[\w.-]+$/.test(newName) || (tab !== 'web' && /[.]/.test(newName))) {
                        nameErr.textContent   = (tab === 'web')
                            ? _('Name can only contain letters, numbers, underscores, hyphens, dots')
                            : _('Name can only contain letters, numbers, underscores, hyphens');
                        nameErr.style.display = 'inline';
                        nameInput.focus(); return;
                    }
                    if (tab === 'web') {
                        var dot = newName.lastIndexOf('.');
                        if (dot > 0 && newName.slice(dot) !== '.toml') {
                            nameErr.textContent   = _('File name extension must be .toml');
                            nameErr.style.display = 'inline';
                            nameInput.focus(); return;
                        }
                        var finalName = /\.toml$/.test(newName) ? newName : newName + '.toml';
                        if (isNew && ((self._webInsts && self._webInsts.items) || []).some(function(it) { return it.name === finalName; })) {
                            nameErr.textContent   = _('Configuration name already exists');
                            nameErr.style.display = 'inline';
                            nameInput.focus(); return;
                        }
                        saveWebConfig(self, name, newName, formEl, fields, res.content);
                        return;
                    }
                    if (isNew && self._configs[tab] &&
                        self._configs[tab].some(function(c) { return c.name === newName; })) {
                        nameErr.textContent   = _('Configuration name already exists');
                        nameErr.style.display = 'inline';
                        nameInput.focus(); return;
                    }
                    saveConfig(self, name, newName, tab, formEl, fields, res.content);
                }
            }, _('Save Configuration'))
        ])
    ]);
}

function buildForm(fields, values, parser) {
    var form = E('div', {'class':'vnt2-dyn-form'});
    if (!fields.length) {
        form.appendChild(E('p', {'class':'vnt2-hint'},
            _('Template fields are empty, please check the template file.')));
        return form;
    }
    fields.forEach(function(f) { form.appendChild(buildFormRow(f, values, parser)); });
    return form;
}

function getPlaceholder(f) {
    if (f.example) return f.example;
    if (f.comment) {
        var m = f.comment.match(/示例[：:]\s*(\S+)/);
        if (m) return m[1];
    }
    return '';
}

function cssEscapeName(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s || '').replace(/(["\\\]\[])/g, '\\$1');
}

function requiredComment(comment) {
    return /必填|required/i.test(String(comment || ''));
}

function closestFieldRow(el) {
    while (el && el !== document) {
        if (el.classList && el.classList.contains('vnt2-field-row')) return el;
        el = el.parentNode;
    }
    return null;
}

function clearFieldErrors(formEl) {
    if (!formEl) return;
    formEl.querySelectorAll('.vnt2-input-error').forEach(function(el) {
        el.classList.remove('vnt2-input-error');
    });
    formEl.querySelectorAll('.vnt2-field-row-error').forEach(function(el) {
        el.classList.remove('vnt2-field-row-error');
    });
    formEl.querySelectorAll('.vnt2-field-error').forEach(function(el) {
        if (el.parentNode) el.parentNode.removeChild(el);
    });
}

function setFieldError(target, message) {
    if (!target) return false;
    if (target.classList) target.classList.add('vnt2-input-error');
    var row = closestFieldRow(target);
    if (row) {
        row.classList.add('vnt2-field-row-error');
        var box = row.querySelector('.vnt2-field-input');
        if (box && message) {
            var old = box.querySelector('.vnt2-field-error');
            if (!old) box.appendChild(E('div', {'class':'vnt2-field-error'}, message));
            else old.textContent = message;
        }
    }
    return true;
}

function firstVisibleInput(root, selector) {
    var found = null;
    if (!root) return null;
    root.querySelectorAll(selector).forEach(function(el) {
        if (found) return;
        var row = closestFieldRow(el);
        if (row && row.style.display === 'none') return;
        found = el;
    });
    return found;
}

function markPortErrors(formEl, errors) {
    if (!formEl || !Array.isArray(errors)) return false;
    var marked = false;
    errors.forEach(function(err) {
        var param = String((err && err.param) || '');
        if (!param) return;
        var target = null;
        var dot = param.indexOf('.');
        if (dot > 0) {
            var sec = param.substring(0, dot);
            var key = param.substring(dot + 1);
            var cont = formEl.querySelector('[data-field-name="' + cssEscapeName(sec) + '"][data-field-type="section"]');
            if (cont) {
                target = cont.querySelector('[data-section-key="' + cssEscapeName(key) + '"]');
                if (target && target.classList && target.classList.contains('vnt2-array-field'))
                    target = target.querySelector('.vnt2-array-item');
            }
        } else {
            target = formEl.querySelector('[data-field-name="' + cssEscapeName(param) + '"]');
            if (target && target.classList && (target.classList.contains('vnt2-array-field') || target.classList.contains('vnt2-section-field')))
                target = target.querySelector('.vnt2-array-item, .vnt2-section-item');
        }
        if (setFieldError(target, (err && err.message) || _('Port conflict detected'))) marked = true;
    });
    return marked;
}

function portErrorMessage(res) {
    var list = (res && Array.isArray(res.errors)) ? res.errors : [];
    if (list.length)
        return list.map(function(e) { return e.message || e.msg || ''; }).filter(Boolean).join('\n');
    return (res && res.msg) || _('Port conflict detected');
}

function stripKeyPrefix(ph) {
    if (!ph) return ph || '';
    var i = ph.indexOf('=');
    return i > 0 ? ph.substring(i + 1).trim() : ph;
}

function sectionPlaceholder(def, key) {
    var ph = stripKeyPrefix(def.example || '');
    if (!ph && def.comment) {
        var m = def.comment.match(/示例[：:]\s*(\S+)/);
        if (m) ph = stripKeyPrefix(m[1]);
    }
    return ph || key;
}

function formatComment(parser, rawComment) {
    var text = (parser && rawComment)
        ? parser._extractI18nComment(rawComment)
        : (rawComment || '');
    return String(text)
        .replace(/选项[：:]\s*[^\n]*/gi, '')
        .replace(/示例[：:]\s*[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function toArrayItems(val, parser) {
    var items;
    if (Array.isArray(val)) {
        items = val.filter(function(v) { return String(v).trim() !== ''; });
    } else if (typeof val === 'string' && val.trim()) {
        var s = val.trim();
        if (s.charAt(0) === '[') {
            items = (parser && parser._parseArray)
                ? parser._parseArray(s)
                : s.replace(/^\[\s*|\s*\]$/g, '').split(',')
                    .map(function(x) { return x.replace(/^["']|["']$/g, '').trim(); })
                    .filter(Boolean);
        } else {
            items = [s];
        }
    } else {
        items = [];
    }
    if (!items.length) items = [''];
    return items;
}

function buildFormRow(f, values, parser) {
    var val = Object.prototype.hasOwnProperty.call(values, f.name)
        ? values[f.name]
        : (f.type === 'section' ? {} : f['default']);
    var isRequired  = requiredComment(f.comment);
    var nameEl      = E('div', {'class':'vnt2-field-name'});
    nameEl.appendChild(document.createTextNode(f.name));
    if (isRequired) nameEl.appendChild(E('span', {'class':'vnt2-required-star'}, ' *'));
    var commentText = formatComment(parser, f.comment);
    return E('div', {'class':'vnt2-field-row'}, [
        E('div', {'class':'vnt2-field-label'}, [
            nameEl,
            commentText
                ? E('div', {'class':'vnt2-field-desc'}, commentText)
                : E('span', {})
        ]),
        E('div', {'class':'vnt2-field-input'}, buildInput(f, val, isRequired, parser))
    ]);
}

var INPUT_BUILDERS = {
    bool:    buildBool,
    select:  buildSelect,
    array:   buildArray,
    int:     buildInt,
    section: buildSection,
};

function buildInput(f, val, isRequired, parser) {
    return (INPUT_BUILDERS[f.type] || buildText)(f, val, isRequired, parser);
}

function buildBool(f, val) {
    var checked = (val === 'true' || val === true);
    var cb = E('input', {
        'type':'checkbox','class':'vnt2-toggle-input',
        'data-field-name':f.name,'data-field-type':'bool'
    });
    if (checked) cb.setAttribute('checked','checked');
    return E('label', {'class':'vnt2-toggle-wrap'}, [
        cb,
        E('span', {'class':'vnt2-toggle-slider'}),
        E('span', {'class':'vnt2-toggle-text'}, _('Enabled'))
    ]);
}

function selectExtend(f) {
    if (!f || !f.extend || f.extend.type !== 'text') return null;
    return {
        trigger: f.extend.trigger || f.extend.value || '',
        prefix: f.extend.prefix || '',
        placeholder: f.extend.placeholder || ''
    };
}

function buildExtendedSelect(f, val, opts) {
    var ext = selectExtend(f);
    var raw = val != null ? String(val) : '';
    var mode = raw;
    if (ext && ext.prefix && raw.indexOf(ext.prefix) === 0) mode = ext.trigger;
    var cleanedOpts = opts.map(function(o) {
        o = String(o || '').trim();
        var meta = o.search(/(?:extend|扩展)[：:]/i);
        if (meta >= 0) o = o.substring(0, meta).trim();
        if (/^(?:prefix|placeholder)\s*=|^text\(/i.test(o)) return '';
        return o;
    }).filter(Boolean);
    var parsed = cleanedOpts.map(function(o) {
        var i = o.indexOf('=');
        return i !== -1
            ? {value:o.substring(0,i).trim(), label:o.substring(0,i).trim()+' — '+o.substring(i+1).trim()}
            : {value:o, label:o};
    });
    var hasMode = parsed.some(function(p) { return p.value === mode; });
    var options = [];
    if (!hasMode || mode === '' || mode == null)
        options.push(E('option', {'value':''}, _('Please select')));
    parsed.forEach(function(p) {
        var a = {'value':p.value};
        if (p.value === mode) a['selected'] = 'selected';
        options.push(E('option', a, p.label));
    });
    var sel = E('select', {'class':'vnt2-input vnt2-select cbi-input-select vnt2-extend-select'}, options);
    if (!ext) {
        sel.setAttribute('data-field-name', f.name);
        sel.setAttribute('data-field-type', 'select');
        return sel;
    }
    var initialExtra = (mode === ext.trigger)
        ? ((ext.prefix && raw.indexOf(ext.prefix) === 0) ? raw : (raw && raw !== ext.trigger ? raw : ext.prefix))
        : '';
    var input = E('input', {
        'type':'text',
        'class':'vnt2-input vnt2-extend-input',
        'value': initialExtra,
        'placeholder': ext.placeholder || ext.prefix || '',
        'style': mode === ext.trigger ? '' : 'display:none;'
    });
    var wrap = E('div', {
        'class':'vnt2-select-extend',
        'data-field-name':f.name,
        'data-field-type':'select_extend',
        'data-extend-trigger':ext.trigger,
        'data-extend-prefix':ext.prefix
    }, [sel, input]);
    function sync() {
        input.style.display = sel.value === ext.trigger ? '' : 'none';
        if (sel.value === ext.trigger && !input.value.trim()) input.value = ext.prefix || '';
    }
    sel.addEventListener('change', function() { sync(); wrap.dispatchEvent(new Event('input', {bubbles:true})); });
    input.addEventListener('input', function() { wrap.dispatchEvent(new Event('input', {bubbles:true})); });
    return wrap;
}

function buildSelect(f, val) {
    var opts = [];
    if (Array.isArray(f.options) && f.options.length) {
        opts = f.options;
    } else if (typeof f.options === 'string' && f.options.trim()) {
        opts = f.options.split(',').map(function(o) { return o.trim(); }).filter(Boolean);
    }
    if (!opts.length && f.comment) {
        var m = f.comment.match(/选项[：:]\s*([^\n]+)/);
        if (m) opts = m[1].split(',').map(function(o) { return o.trim(); }).filter(Boolean);
    }
    return buildExtendedSelect(f, val, opts);
}

function buildText(f, val) {
    return E('input', {
        'type':'text','class':'vnt2-input',
        'data-field-name':f.name,'data-field-type':'string',
        'value':val != null ? String(val) : '',
        'placeholder':getPlaceholder(f)
    });
}

function buildInt(f, val) {
    return E('input', {
        'type':'number','class':'vnt2-input vnt2-input-number',
        'data-field-name':f.name,'data-field-type':'int',
        'value':val != null ? String(val) : '0',
        'placeholder':getPlaceholder(f)
    });
}

function buildListField(f, items, cls, opts) {
    opts = opts || {};
    var pfx       = 'vnt2-' + cls;
    var clsField  = pfx + '-field';
    var clsItem   = pfx + '-item';
    var clsRow    = pfx + '-row';
    var clsBtnAdd = 'btn ' + pfx + '-btn-add';
    var clsBtnDel = 'btn ' + pfx + '-btn-del';
    var containerAttrs = { 'class': clsField };
    if (opts.sectionKey != null) {
        containerAttrs['data-section-key']  = opts.sectionKey;
        containerAttrs['data-section-type'] = cls;
    } else {
        containerAttrs['data-field-name'] = f.name;
        containerAttrs['data-field-type'] = cls;
    }
    var container = E('div', containerAttrs);

    var ph = (opts.placeholder != null && opts.placeholder !== '')
        ? opts.placeholder : getPlaceholder(f);

    function addRow(v) {
        var input = E('input', {
            'type':'text','class':'vnt2-input ' + clsItem,
            'value':v||'','placeholder':ph
        });
        var btnAdd = E('button', {
            'type':'button','class':clsBtnAdd,'title':_('Add a row'),
            'click':function(ev) {
                ev.preventDefault();
                var nr = addRow('');
                row.nextSibling
                    ? container.insertBefore(nr, row.nextSibling)
                    : container.appendChild(nr);
                nr.querySelector('.' + clsItem).focus();
                container.dispatchEvent(new Event('input', {bubbles:true}));
            }
        }, '+');
        var btnDel = E('button', {
            'type':'button','class':clsBtnDel,'title':_('Delete this row'),
            'click':function(ev) {
                ev.preventDefault();
                if (container.querySelectorAll('.' + clsRow).length <= 1) {
                    input.value = ''; input.focus();
                } else {
                    container.removeChild(row);
                }
                container.dispatchEvent(new Event('input', {bubbles:true}));
            }
        }, '−');
        var row = E('div', {'class':clsRow}, [input, btnAdd, btnDel]);
        return row;
    }
    items.forEach(function(v) { container.appendChild(addRow(v)); });
    return container;
}

function buildArray(f, val, isRequired, parser) {
    return buildListField(f, toArrayItems(val, parser), 'array');
}

function buildSection(f, val, isRequired, parser) {
    var keyDefs = f.keys || {};
    var defKeys = Object.keys(keyDefs);
    if (defKeys.length) {
        var container = E('div', {
            'class':           'vnt2-section-fields',
            'data-field-name': f.name,
            'data-field-type': 'section'
        });
        var gateCb    = null;
        var gatedRows = [];
        defKeys.forEach(function(k) {
            var def  = keyDefs[k];
            var cur  = (val && Object.prototype.hasOwnProperty.call(val, k))
                       ? val[k] : def['default'];
            var input;
            var boolInput = null;
            if (def.type === 'bool') {
                var checked = (cur === true || cur === 'true');
                var cbSec = E('input', {
                    'type':'checkbox','class':'vnt2-toggle-input',
                    'data-section-key':k,'data-section-type':'bool'
                });
                boolInput = cbSec;
                if (checked) cbSec.setAttribute('checked','checked');
                input = E('label', {'class':'vnt2-toggle-wrap'}, [
                    cbSec,
                    E('span', {'class':'vnt2-toggle-slider'}),
                    E('span', {'class':'vnt2-toggle-text'}, _('Enabled'))
                ]);
            } else if (def.type === 'array') {
                input = buildListField(
                    { name: f.name + '.' + k, example: def.example, comment: def.comment },
                    toArrayItems(cur, parser),
                    'array',
                    { sectionKey: k, placeholder: sectionPlaceholder(def, k) }
                );
            } else {
                input = E('input', {
                    'type': def.type === 'int' ? 'number' : 'text',
                    'class':'vnt2-input' + (def.type === 'int' ? ' vnt2-input-number' : ''),
                    'data-section-key':k,
                    'data-section-type': def.type === 'int' ? 'int' : 'string',
                    'value': cur != null ? String(cur) : '',
                    'placeholder': sectionPlaceholder(def, k)
                });
            }
            var keyDesc = formatComment(parser, def.comment);
            var keyRequired = requiredComment(def.comment);
            var keyNameEl = E('div', {'class':'vnt2-field-name'});
            keyNameEl.appendChild(document.createTextNode(f.name + '.' + k));
            if (keyRequired) keyNameEl.appendChild(E('span', {'class':'vnt2-required-star'}, ' *'));
            var row = E('div', {
                'class':'vnt2-field-row'
            }, [
                E('div', {'class':'vnt2-field-label'}, [
                    keyNameEl,
                    keyDesc
                        ? E('div', {'class':'vnt2-field-desc'}, keyDesc)
                        : E('span', {})
                ]),
                E('div', {'class':'vnt2-field-input'}, input)
            ]);
            if (k === 'enabled' && def.type === 'bool' && boolInput && !gateCb)
                gateCb = boolInput;
            else
                gatedRows.push(row);
            container.appendChild(row);
        });

        if (gateCb && gatedRows.length) {
            var syncGate = function() {
                gatedRows.forEach(function(r) {
                    r.style.display = gateCb.checked ? '' : 'none';
                });
            };
            gateCb.addEventListener('change', syncGate);
            syncGate();
        }
        return container;
    }
    var items = (val && typeof val === 'object' && !Array.isArray(val))
        ? Object.keys(val).map(function(k) {
            var cv = val[k];
            if (cv == null || String(cv).trim() === '') return '';
            return typeof cv === 'boolean'
                ? k + ' = ' + (cv ? 'true' : 'false')
                : k + ' = "' + String(cv) + '"';
          }).filter(function(line) { return line !== ''; })
        : [];
    if (!items.length) items = [''];
    return buildListField(f, items, 'section');
}

function collectItems(el, selector) {
    var items = [];
    el.querySelectorAll(selector).forEach(function(inp) {
        var v = inp.value.trim();
        if (v) items.push(v);
    });
    return items;
}

function collectValues(formEl) {
    var vals = {};
    formEl.querySelectorAll('[data-field-name]').forEach(function(el) {
        var name = el.getAttribute('data-field-name');
        var type = el.getAttribute('data-field-type');
        if (!name) return;
        if (type === 'array') {
            vals[name] = collectItems(el, '.vnt2-array-item');
        } else if (type === 'select_extend') {
            var sel = el.querySelector('.vnt2-extend-select');
            var extra = el.querySelector('.vnt2-extend-input');
            var trigger = el.getAttribute('data-extend-trigger') || '';
            var prefix = el.getAttribute('data-extend-prefix') || '';
            var mode = sel ? sel.value : '';
            if (mode === trigger) {
                var v = extra ? extra.value.trim() : '';
                vals[name] = (prefix && v.indexOf(prefix) !== 0) ? prefix + v : v;
            } else {
                vals[name] = mode;
            }
        } else if (type === 'section') {
            var obj = {};
            var typed = el.querySelectorAll('[data-section-key]');
            if (typed.length) {
                typed.forEach(function(inp) {
                    var sk = inp.getAttribute('data-section-key');
                    var st = inp.getAttribute('data-section-type');
                    if (st === 'bool') {
                        obj[sk] = inp.checked;
                    } else if (st === 'array') {
                        obj[sk] = collectItems(inp, '.vnt2-array-item');
                    } else if (st === 'int') {
                        var iv = inp.value.trim();
                        if (iv) obj[sk] = parseInt(iv) || 0;
                    } else {
                        var sv = inp.value.trim();
                        if (sv) obj[sk] = sv;
                    }
                });
            }
            collectItems(el, '.vnt2-section-item').forEach(function(line) {
                var eqIdx = line.indexOf('=');
                if (eqIdx <= 0) return;
                var k = line.substring(0, eqIdx).trim();
                var v = line.substring(eqIdx + 1).trim();
                var qm = v.match(/^"([\s\S]*)"$|^'([\s\S]*)'$/);
                if (qm) v = qm[1] != null ? qm[1] : qm[2];
                if (k && v) obj[k] = v;
            });
            vals[name] = obj;
        } else if (el.type === 'checkbox') {
            vals[name] = el.checked;
        } else if (type === 'int') {
            vals[name] = parseInt(el.value) || 0;
        } else {
            if (el.value === undefined) return;
            vals[name] = el.value.trim();
        }
    });
    return vals;
}

function validate(fields, formEl) {
    clearFieldErrors(formEl);
    var errors = [];
    fields.forEach(function(f) {
        if (f.extend && f.extend.type === 'text') {
            var extEl = formEl.querySelector('[data-field-name="'+cssEscapeName(f.name)+'"][data-field-type="select_extend"]');
            if (extEl) {
                var selExt = extEl.querySelector('.vnt2-extend-select');
                var inputExt = extEl.querySelector('.vnt2-extend-input');
                var triggerExt = extEl.getAttribute('data-extend-trigger') || '';
                var prefixExt = extEl.getAttribute('data-extend-prefix') || '';
                var vExt = inputExt ? inputExt.value.trim() : '';
                if (selExt && selExt.value === triggerExt && (!vExt || vExt === prefixExt)) {
                    errors.push(f.name);
                    setFieldError(inputExt || extEl, _('Required field'));
                }
            }
        }
        if (f.type === 'section' && f.keys) {
            var cont = formEl.querySelector('[data-field-name="'+cssEscapeName(f.name)+'"][data-field-type="section"]');
            if (!cont) return;
            Object.keys(f.keys).forEach(function(k) {
                var def = f.keys[k] || {};
                if (!requiredComment(def.comment)) return;
                var target = cont.querySelector('[data-section-key="'+cssEscapeName(k)+'"]');
                if (!target) return;
                var row = closestFieldRow(target);
                if (row && row.style.display === 'none') return;
                var ok = true;
                if (target.classList && target.classList.contains('vnt2-array-field')) {
                    ok = false;
                    target.querySelectorAll('.vnt2-array-item').forEach(function(inp) {
                        if (inp.value.trim()) ok = true;
                    });
                    target = target.querySelector('.vnt2-array-item');
                } else if (target.type === 'checkbox') {
                    ok = true;
                } else {
                    ok = !!(target.value != null && target.value.trim());
                }
                if (!ok) {
                    errors.push(f.name + '.' + k);
                    setFieldError(target, _('Required field'));
                }
            });
            return;
        }
        if (!requiredComment(f.comment)) return;
        if (f.type === 'array') {
            var c = formEl.querySelector(
                '[data-field-name="'+cssEscapeName(f.name)+'"][data-field-type="array"]');
            if (!c) return;
            var ok = false;
            c.querySelectorAll('.vnt2-array-item').forEach(function(inp) {
                if (inp.value.trim()) ok = true;
            });
            if (!ok) {
                errors.push(f.name);
                setFieldError(c.querySelector('.vnt2-array-item'), _('Required field'));
            }
        } else {
            var el = formEl.querySelector('[data-field-name="'+cssEscapeName(f.name)+'"]');
            if (!el || el.type === 'checkbox') return;
            if (!el.value.trim()) {
                errors.push(f.name);
                setFieldError(el, _('Required field'));
            }
        }
    });
    return errors;
}
function saveWebConfig(self, oldName, newName, formEl, fields, templateContent) {
    var errors = validate(fields, formEl);
    if (errors.length) {
        self._ui.notify(
            _('The following required fields are not filled: %s').format(errors.join(', ')), 'error');
        var first = formEl.querySelector('.vnt2-input-error');
        if (first) first.scrollIntoView({behavior:'smooth', block:'center'});
        return;
    }
    var values = collectValues(formEl);
    callReadTemplate('vnt').then(function(templateRes) {
        var currentTemplate = (templateRes && templateRes.content) || templateContent;
        var content = self._parser.serializeToToml(fields, values, currentTemplate);
        return callSaveConfig(newName, 'web', content, oldName || '');
    }).then(function(r) {
        if (!r || r.result !== 'ok') {
            self._ui.notify(_('Save failed: %s').format((r && (r.msg || r.error)) || ''), 'error');
            return;
        }
        _dirty = false;
        if (r.restarted === '1')
            self._ui.notify(_('Instance "%s" restarted successfully').format(r.name || newName), 'success');
        return refreshWebInstances(self).then(function() { toggleView(true); });
    }).catch(function(err) {
        self._ui.notify(_('Save error: %s').format(String(err)), 'error');
    });
}

function saveConfig(self, oldName, newName, tab, formEl, fields, templateContent) {
    loadListState(tab).then(function() {
        var errors = validate(fields, formEl);
        if (errors.length) {
            self._ui.notify(
                _('The following required fields are not filled: %s').format(errors.join(', ')), 'error');
            var first = formEl.querySelector('.vnt2-input-error');
            if (first) first.scrollIntoView({behavior:'smooth', block:'center'});
            return;
        }
        var values = collectValues(formEl);
        var templatePromise = callReadTemplate(tab);
        templatePromise.then(function(templateRes) {
            var currentTemplate = (templateRes && templateRes.content) || templateContent;
            var content = self._parser.serializeToToml(fields, values, currentTemplate);
            var renamed = !!(oldName && oldName !== newName);
            callSaveConfig(newName, tab, content, oldName||'').then(function(r) {
            if (!r || r.result !== 'ok') {
                if (r && r.code === 'port_conflict') {
                    markPortErrors(formEl, r.errors);
                    self._ui.notify(portErrorMessage(r), 'error');
                    var firstPort = formEl.querySelector('.vnt2-input-error');
                    if (firstPort) firstPort.scrollIntoView({behavior:'smooth', block:'center'});
                } else {
                    self._ui.notify(_('Save failed: %s').format((r && (r.msg || r.error)) || ''), 'error');
                }
                return;
            }
            if (renamed) {
                _listState[tab][newName] = _listState[tab][oldName] || ensureState(tab, newName);
                delete _listState[tab][oldName];
            }
            _dirty = false;
            var state = _listState[tab][newName] || ensureState(tab, newName);
            if (state.enabled) {
                callInstanceAction(newName, 'restart', tab).then(function(res) {
                    var ok = res && res.result === 'ok';
                    self._ui.notify(
                        ok ? _('Instance "%s" restarted successfully').format(newName)
                           : _('Instance "%s" restart failed: %s').format(
                               newName, (res && res.msg) || _('Unknown error')),
                        ok ? 'success' : 'error'
                    );
                }).catch(function(err) {
                    self._ui.notify(_('Restart error: %s').format(String(err)), 'error');
                });
            }
            return Promise.all([callListConfigs(tab), refreshStatus(self)])
                .then(function(res) {
                    self._configs[tab] = parseConfigs(res[0]);
                    ensureState(tab, newName);
                    rebuildTable(self);
                    toggleView(true);
                    saveListState(self, true);
                });
            }).catch(function(err) {
                self._ui.notify(_('Save error: %s').format(String(err)), 'error');
            });
        }).catch(function(err) {
            self._ui.notify(_('Load failed: %s').format(String(err)), 'error');
        });
    });
}

function deleteConfig(self, name) {
    var tab     = _tab;
    var running = !!(self._status && self._status[statusKey(tab, name)]);
    self._ui.confirm(_('Confirm Delete'),
        running
            ? _('Instance "%s" is running and will be stopped on delete. Are you sure?').format(name)
            : _('Are you sure to delete config "%s"?').format(name)
    ).then(function(ok) {
        if (!ok) return;
        callDeleteConfig(name, tab).then(function(r) {
            if (r && r.result === 'ok') {
                self._ui.notify(_('Config "%s" has been deleted').format(name), 'success');
                delete _listState[tab][name];
                return callListConfigs(tab).then(function(res) {
                    self._configs[tab] = parseConfigs(res);
                    rebuildTable(self);
                });
            }
            self._ui.notify(_('Delete failed: %s').format((r && r.msg)||''), 'error');
        });
    });
}

return view.extend({
    load: function() {
        var hash = location.hash.replace('#','');
        var initTab = hash.indexOf('vnts') === 0 ? 'vnts' : 'vnt';
        return Promise.all([
            L.require('vnt2.common'),
            L.require('vnt2.reference_editor'),
            L.uci.load('vnt2'),
            callGetTemplateFields('vnt'),
            callGetTemplateFields('vnts'),
            callListConfigs(initTab),
            callListInstances(),
            callListWebInstances(),
        ]).then(function(data) {
            data._initTab = initTab;
            return data;
        });
    },

    render: function(data) {
        var self    = this;
        var initTab = data._initTab || 'vnt';
        self._ui        = data[0].VNT2UI;
        self._parser    = data[0].VNT2ConfigParser;
        self._validator = data[0].VNT2Validation;
        self._web       = data[0].VNT2Web;
        self._ref       = data[1].VNT2ReferenceEditor;
        self._fields = {
            vnt:  (data[3] && Array.isArray(data[3].fields)) ? data[3].fields : [],
            vnts: (data[4] && Array.isArray(data[4].fields)) ? data[4].fields : []
        };
        self._configs          = {vnt:null, vnts:null};
        self._configs[initTab] = parseConfigs(data[5]);
        var parsed    = parseInstanceList(data[6] && data[6].instances);
        self._status  = parsed.status;
        self._webAddr = parsed.webAddr;
        self._webInsts = parseWebInstances(data[7]);
        resetListState();
        _tab   = initTab;
        _dirty = false;
        startStatusTimer(self);

        var node = E('div', {'class':'cbi-map'}, [
            E('h2', {}, _('Instance Management')),
            E('div', {'class':'cbi-section vnt2-card'}, [
                E('div', {'class':'vnt2-page-tabs'}, Object.keys(TABS).map(function(t) {
                    return E('button', {
                        'id':'vnt2-tab-' + t,
                        'type':'button',
                        'class':'vnt2-page-tab' + (t === _tab ? ' active' : ''),
                        'click':function() { switchTab(self, t); }
                    }, TABS[t]);
                })),

                E('div', {'id':'vnt2-list-wrap'}, [
                    E('div', {
                        'id':'vnt2-config-toolbar',
                        'class':'vnt2-toolbar'
                    }, [
                        E('div', {'class':'vnt2-toolbar-group'}, [
                            E('button', {'id':'vnt2-btn-new-local','class':'btn cbi-button-add',
                                'click':function() { openEditor(self, '', true); }
                            }, _tab === 'vnt' ? _('New vnt2_cli Instance') : _('New Config')),
                            E('button', {'id':'vnt2-btn-new-web','class':'btn cbi-button-add',
                                'style':'display:' + (_tab === 'vnt' ? '' : 'none') + ';',
                                'click':function() { openEditor(self, '', true, null, 'web'); }
                            }, _('New vnt2_web Instance'))
                        ]),
                        E('button', {'class':'btn cbi-button-save',
                            'click':function() { saveListState(self); }
                        }, _('Save & Apply'))
                    ]),
                    E('div', {'id':'vnt2-table-wrap'},
                        E('p', {'class':'vnt2-loading'}, _('Loading...')))
                ]),
                E('div', {'id':'vnt2-edit-wrap','style':'display:none;'})
            ])
        ]);

        loadListState(initTab).then(function() {
            rebuildTable(self);
            var hash = location.hash.replace('#','');
            if (hash.indexOf('&webraw=') !== -1) {
                openRawEditor(self, hash.split('&webraw=')[1], 'web');
            } else if (hash.indexOf('&web=new') !== -1) {
                openEditor(self, '', true, null, 'web');
            } else if (hash.indexOf('&web=') !== -1) {
                openEditor(self, hash.split('&web=')[1], false, null, 'web');
            } else if (hash.indexOf('&raw=') !== -1) {
                openRawEditor(self, hash.split('&raw=')[1]);
            } else if (hash.indexOf('&edit=') !== -1) {
                openEditor(self, hash.split('&edit=')[1], false);
            } else if (hash.indexOf('&new') !== -1) {
                openEditor(self, '', true);
            }
        });

        window.requestAnimationFrame(function() {
            var footer = document.querySelector('.cbi-page-actions');
            if (footer) footer.style.display = 'none';
        });

        return node;
    },

    handleSaveApply: function() { return saveListState(this); },
    handleSave:      function() { return L.uci.save(); },
    handleReset:     function() {
        resetListState();
        loadListState(_tab);
        return L.uci.load('vnt2').then(L.bind(function() {
            rebuildTable(this);
        }, this));
    },
    destroy: function() { stopStatusTimer(); }
});


