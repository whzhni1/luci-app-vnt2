'use strict';
'require view';
'require ui';
'require rpc';
'require vnt2.common';
'require vnt2.reference_editor';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}

var callReadRaw        = rpcDeclare('read_advanced_raw', []);
var callSaveRaw        = rpcDeclare('save_advanced_raw', ['content']);
var callReset          = rpcDeclare('reset_advanced', []);
var callHelp           = rpcDeclare('get_binary_help', ['path','mode']);
var callTplList        = rpcDeclare('list_config_templates', ['type']);
var callTplRead        = rpcDeclare('read_config_template', ['type','name']);
var callTplSave        = rpcDeclare('save_config_template', ['type','name','content']);
var callTplDelete      = rpcDeclare('delete_config_template', ['type','name']);
var callTplDefault     = rpcDeclare('set_default_template', ['type','name']);
var callTplHelp        = rpcDeclare('get_template_help', ['type']);
var callGetSettings    = rpcDeclare('get_settings', []);
var callGetLogKeys     = rpcDeclare('get_log_keys', []);
var callSaveLogKeys    = rpcDeclare('save_log_keys', [
    'web_sync_keys','web_start_keys','web_stop_keys','web_delete_keys',
    'fault_restart_keys','online_keys','online_exclude_keys'
]);

var TAB_DEFS = [
    ['binary', _('Binary Profiles')],
    ['port_detect', _('Port Detection')],
    ['keywords', _('Log Keywords')],
    ['templates', _('Config Templates')]
];

var DEFAULT_LOG_KEYS = {
    web_sync_keys:       'POST /api/config|POST /api/start|POST /api/stop|POST /api/restart',
    web_start_keys:      'Starting VNT service|启用|启动配置|enable|enabled',
    web_stop_keys:       '禁用|停用|停止配置|disable|disabled',
    web_delete_keys:     '删除配置|删除|delete config|deleted config|DELETE /api/config',
    fault_restart_keys:  'Registration failed',
    online_keys:         'public_addr',
    online_exclude_keys: '0.0.0.0:0'
};

var LOG_KEY_DEFS = [
    ['web_sync_keys', _('Web Config Change Keywords'), _('Request log lines matching these keywords trigger a full vnt2_web instance sync to UCI')],
    ['web_start_keys', _('Web Instance Start Keywords'), _('Log lines containing a file name matching these keywords mark the instance as enabled in UCI')],
    ['web_stop_keys', _('Web Instance Stop Keywords'), _('Log lines containing a file name matching these keywords mark the instance as disabled in UCI')],
    ['web_delete_keys', _('Web Instance Delete Keywords'), _('Log lines containing a file name matching these keywords remove the instance record from UCI')],
    ['fault_restart_keys', _('Fault Restart Keywords'), _('Matching lines trigger the network check and process restart logic')],
    ['online_keys', _('Online Detect Keywords'), _('Matching lines mark the instance as online')],
    ['online_exclude_keys', _('Online Exclude Keywords'), _('Lines also matching these keywords are ignored by online detection')]
];

var SECTION_TYPES = {
    binary:  { key:'binary',  fields:['role','label','path'] },
    command: { key:'command', fields:['role','label','binary','command'] },
    query:   { key:'query',   fields:['role','cmd','label','binary','command'] },
    template:{ key:'template',fields:['type','name'] },
    port_detect:{ key:'port_detect',fields:['enabled','check_config','check_system','extra_param','ignore_param'] }
};

var FIXED_BINARIES = [
    { name:'vnt_web',  label:'vnt2_web',  role:'client_web',  path:'/usr/bin/vnt2_web', readonly:true },
    { name:'vnt_cli',  label:'vnt2_cli',  role:'client_cli',  path:'/usr/bin/vnt2_cli',  readonly:true },
    { name:'vnt_ctrl', label:'vnt2_ctrl', role:'client_ctrl', path:'/usr/bin/vnt2_ctrl', readonly:true },
    { name:'vnts',     label:'vnts2',     role:'server',      path:'/usr/bin/vnts2',    readonly:true }
];

var FIXED_COMMANDS = [
    { type:'command', name:'start_vnt_cli', label:'Startup Parameters', role:'client_cli', binary:'vnt_cli', command:'{bin} --conf {conf}' },
    { type:'query',   name:'ctrl_info', label:'Query Command', role:'client_cli', cmd:'info', binary:'vnt_ctrl', command:'{bin} -p {ctrl_port} info' },
    { type:'query',   name:'ctrl_ips', label:'Query Command', role:'client_cli', cmd:'ips', binary:'vnt_ctrl', command:'{bin} -p {ctrl_port} ips' },
    { type:'query',   name:'ctrl_clients', label:'Query Command', role:'client_cli', cmd:'clients', binary:'vnt_ctrl', command:'{bin} -p {ctrl_port} clients' },
    { type:'query',   name:'ctrl_route', label:'Query Command', role:'client_cli', cmd:'route', binary:'vnt_ctrl', command:'{bin} -p {ctrl_port} route' },
    { type:'command', name:'start_vnt_web', label:'Startup Parameters', role:'client_web', binary:'vnt_web', command:'{bin} --addr {web_addr} --token {token}' },
    { type:'command', name:'start_vnts', label:'Startup Parameters', role:'server', binary:'vnts', command:'{bin} -c {conf}' }
];

function escUci(s) { return String(s == null ? '' : s).replace(/'/g, "'\\''"); }
function sectionName(type, idx) { return type + '_' + idx; }
function parseUci(raw) {
    var data = { binary:[], command:[], query:[], template:[], port_detect:[] };
    var cur = null;
    String(raw || '').split('\n').forEach(function(line) {
        var s = line.trim();
        if (!s) return;
        var m = s.match(/^config\s+(\S+)(?:\s+['"]([^'"]+)['"])?/);
        if (m) {
            cur = { '.type':m[1], '.name':m[2] || sectionName(m[1], (data[m[1]]||[]).length) };
            if (data[m[1]]) data[m[1]].push(cur);
            return;
        }
        if (!cur) return;
        m = s.match(/^option\s+(\S+)\s+['"]?([\s\S]*?)['"]?$/);
        if (m) { cur[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); return; }
        m = s.match(/^list\s+(\S+)\s+['"]?([\s\S]*?)['"]?$/);
        if (m) {
            var k = m[1];
            if (!Array.isArray(cur[k])) cur[k] = [];
            cur[k].push(m[2].replace(/^['"]|['"]$/g, ''));
        }
    });
    return data;
}

function serializeUci(data) {
    var lines = [];
    ['binary','command','query','template','port_detect'].forEach(function(key) {
        var def = SECTION_TYPES[key] || { key:key, fields:[] };
        if (key === 'command') def.fields = ['role','label','binary','command'];
        if (key === 'query') def.fields = ['role','cmd','label','binary','command'];
        if (key === 'port_detect') def.fields = ['enabled','check_config','check_system','extra_param','ignore_param'];
        (data[key] || []).forEach(function(item, idx) {
            var name = item['.name'] || sectionName(key, idx);
            lines.push("config " + key + " '" + escUci(name) + "'");
            def.fields.forEach(function(f) {
                var v = item[f];
                if (f === 'command' && (v == null || v === '') && item.template) v = item.template;
                if (Array.isArray(v)) {
                    if (v.length)
                        v.forEach(function(x) { lines.push("\tlist " + f + " '" + escUci(x) + "'"); });
                } else {
                    lines.push("\toption " + f + " '" + escUci(v) + "'");
                }
            });
            lines.push('');
        });
    });
    return lines.join('\n').replace(/\n+$/, '\n');
}

function validateAdvancedData(data) {
    var errors = [], sec = {}, unique = { binary:{}, query:{}, command:{} };
    ['binary','command','query','template','port_detect'].forEach(function(type) {
        (data[type] || []).forEach(function(item) {
            var name = item['.name'] || '';
            if (name) {
                var sk = type + '.' + name;
                if (sec[sk]) errors.push(_('Duplicate section: %s').format(sk));
                sec[sk] = true;
            }
            var val = type === 'query' ? item.cmd : (type === 'binary' ? item.path : '');
            if (val && unique[type]) {
                if (unique[type][val]) errors.push(_('Duplicate %s parameter: %s').format(type, val));
                unique[type][val] = true;
            }
        });
    });
    return errors;
}

function renderTemplatePreview(parser, ui, content) {
    var fields = parser.parseTemplate(content || '');
    if (!fields.length) return E('p', {'class':'vnt2-empty'}, _('No fields can be previewed. Check template comments and parameters.'));
    return E('div', {'class':'vnt2-template-preview'}, [
        E('div', {'class':'vnt2-template-preview-title'}, _('Preview Form')),
        E('div', {}, fields.slice(0, 60).map(function(f) {
            var ctrl;
            if (f.type === 'bool') ctrl = ui.toggleSwitch(null, !!f.default, null, _('Enabled'));
            else if (f.type === 'array') ctrl = E('textarea', {'class':'vnt2-input','readonly':'readonly'}, Array.isArray(f.default) ? f.default.join('\n') : '');
            else if (f.type === 'int') ctrl = E('input', {'class':'vnt2-input vnt2-input-number','type':'number','readonly':'readonly','value':f.default || 0});
            else if (f.type === 'select') ctrl = E('select', {'class':'cbi-input-select','disabled':'disabled'}, (f.options || []).map(function(o){ return E('option', {'value':o}, o); }));
            else if (f.type === 'section') ctrl = E('div', {'class':'vnt2-form-desc'}, _('Sub section: %s').format(f.name));
            else ctrl = E('input', {'class':'vnt2-input','type':'text','readonly':'readonly','value':f.default || ''});
            return ui.buildFormRow(f.name + ' [' + f.type + ']', ctrl, f.comment || '');
        }))
    ]);
}

function extractCliOptions(text) {
    var opts = {}, m, reLong = /--[A-Za-z0-9][A-Za-z0-9_-]*/g, reShort = /(^|\s)-[A-Za-z](?=\s|,|$)/g;
    while ((m = reLong.exec(String(text || ''))) !== null) opts[m[0]] = true;
    while ((m = reShort.exec(String(text || ''))) !== null) opts[m[0].trim()] = true;
    return opts;
}

function validateCommandAgainstHelp(template, helpText) {
    var used = extractCliOptions(template), allowed = extractCliOptions(helpText), missing = [];
    Object.keys(used).forEach(function(k) { if (!allowed[k]) missing.push(k); });
    return missing.length ? [_('Parameters not found in official --help: %s').format(missing.join(', '))] : [];
}

function renderCommandPreview(template, bin, configPath, type) {
    var base = String(configPath || '/etc/vnt2_config').replace(/\/+$/, '') || '/etc/vnt2_config';
    var suffix = type === 'vnts' ? 'vnts' : 'vnt';
    var fileName = 'example.' + suffix;
    var vars = { bin:bin || '/usr/bin/vnt2_cli', conf:base + '/' + fileName, name:'example', type:suffix, web_addr:'0.0.0.0:19099', token:'0123456789abcdef...', ctrl_port:'11233', cmd:'info', file_name:fileName };
    return String(template || '').replace(/\{([A-Za-z0-9_]+)\}/g, function(_, k) { return vars[k] != null ? vars[k] : '{' + k + '}'; });
}

function templateTypeLabel(t) { return t === 'vnt' ? _('Client') : _('Server'); }

function ensureArray(v) {
    if (Array.isArray(v)) return v;
    if (v == null || v === '') return [];
    return [v];
}

function boolValue(v, def) {
    if (v == null || v === '') return !!def;
    return v === true || v === '1' || v === 'true' || v === 'on';
}

function renderDetectList(field, values, placeholder) {
    var container = E('div', {'class':'vnt2-port-param-list', 'data-adv-type':'port_detect', 'data-adv-idx':'0', 'data-adv-list-field':field});
    function addRow(v) {
        var input = E('input', {'type':'text','class':'vnt2-input vnt2-port-param-item','value':v || '', 'placeholder':placeholder || ''});
        var row = E('div', {'class':'vnt2-port-param-row'}, [
            input,
            E('button', {'type':'button','class':'btn vnt2-array-btn-add','title':_('Add a row'),'click':function(ev) {
                ev.preventDefault();
                var nr = addRow('');
                row.nextSibling ? container.insertBefore(nr, row.nextSibling) : container.appendChild(nr);
                nr.querySelector('.vnt2-port-param-item').focus();
            }}, '+'),
            E('button', {'type':'button','class':'btn vnt2-array-btn-del','title':_('Delete this row'),'click':function(ev) {
                ev.preventDefault();
                if (container.querySelectorAll('.vnt2-port-param-row').length <= 1) {
                    input.value = '';
                    input.focus();
                } else {
                    container.removeChild(row);
                }
            }}, '−')
        ]);
        return row;
    }
    values = ensureArray(values).filter(function(v) { return String(v || '').trim() !== ''; });
    if (!values.length) values = [''];
    values.forEach(function(v) { container.appendChild(addRow(v)); });
    return container;
}

return view.extend({
    handleSave: null,
    handleSaveApply: null,
    handleReset: null,

    load: function() {
        return Promise.all([L.require('vnt2.common'), L.require('vnt2.reference_editor'), callReadRaw(), callTplList('all'), callGetSettings(), callGetLogKeys()]);
    },

    render: function(data) {
        this._ui = data[0].VNT2UI;
        this._parser = data[0].VNT2ConfigParser;
        this._validator = data[0].VNT2Validation;
        this._ref = data[1].VNT2ReferenceEditor;
        this._raw = (data[2] && data[2].content) || '';
        this._data = parseUci(this._raw);
        this._templates = (data[3] && data[3].templates) || [];
        this._settings = data[4] || {};
        this._logKeys = data[5] || {};
        this._tab = location.hash ? location.hash.replace('#','') : 'binary';
        if (!TAB_DEFS.some(function(t) { return t[0] === this._tab; }, this)) this._tab = 'binary';
        this._tplType = 'vnt';
        this._editor = null;
        return E('div', {'class':'cbi-map'}, [
            E('h2', {}, _('VNT2 Advanced Settings')),
            this._renderTabs(),
            E('div', {'id':'vnt2-advanced-body'}, this._renderBody())
        ]);
    },

    _renderTabs: function() {
        var self = this;
        return E('div', {'class':'vnt2-page-tabs'}, TAB_DEFS.map(function(t) {
            return E('button', {'type':'button','data-adv-tab':t[0],'class':'vnt2-page-tab' + (self._tab === t[0] ? ' active' : ''),'click':function(){ self._switch(t[0]); }}, t[1]);
        }));
    },

    _switch: function(tab) {
        if (this._tab !== 'templates') this._collectAdvanced();
        this._tab = tab;
        location.hash = tab;
        document.querySelectorAll('[data-adv-tab]').forEach(function(el) { el.classList.toggle('active', el.getAttribute('data-adv-tab') === tab); });
        var body = document.getElementById('vnt2-advanced-body');
        body.innerHTML = '';
        body.appendChild(this._renderBody());
    },

    _renderBody: function() {
        if (this._tab === 'binary') return this._renderBinaryProfiles();
        if (this._tab === 'templates') return this._renderConfigTemplates();
        if (this._tab === 'port_detect') return this._renderPortDetection();
        if (this._tab === 'keywords') return this._renderKeywords();
        return this._renderBinaryProfiles();
    },

    _ensureFixedBinaries: function() {
        this._data.binary = [];
    },

    _ensureFixedCommands: function() {
        var self = this;
        if (!self._data.command) self._data.command = [];
        if (!self._data.query) self._data.query = [];
        FIXED_COMMANDS.forEach(function(def) {
            var list = self._data[def.type];
            var found = null;
            list.forEach(function(item) { if (item['.name'] === def.name) found = item; });
            if (!found) {
                found = { '.type':def.type, '.name':def.name };
                list.push(found);
            }
            found.role = def.role;
            found.label = def.label;
            found.binary = def.binary;
            if (def.cmd) found.cmd = def.cmd;
            if (!found.command) found.command = found.template || def.command;
            delete found.enabled;
            delete found.template;
        });
        self._data.command = self._data.command.filter(function(item) {
            return FIXED_COMMANDS.some(function(def) { return def.type === 'command' && def.name === item['.name']; });
        });
        self._data.query = self._data.query.filter(function(item) {
            return FIXED_COMMANDS.some(function(def) { return def.type === 'query' && def.name === item['.name']; });
        });
    },

    _renderBinaryProfiles: function() {
        var self = this;
        self._ensureFixedBinaries();
        self._ensureFixedCommands();
        var cards = [];
        FIXED_BINARIES.forEach(function(def) {
            var item = (self._data.binary || []).filter(function(b) { return b['.name'] === def.name; })[0];
            var idx = self._data.binary.indexOf(item);
            var value = item && item.path ? item.path : self._displayBinaryPath(def.name);
            var commands = self._commandItemsForBinary(def.name);
            var commandNodes = commands.length ? commands.map(function(row) {
                return E('div', {'class':'vnt2-binary-command-row'}, [
                    E('div', {'class':'vnt2-binary-command-main'}, [
                        E('b', {}, row.kind === 'query' ? (_('Query') + ': ' + (row.item.cmd || '')) : _('Startup Parameters')),
                        E('pre', {'class':'vnt2-command-template-preview'}, row.item.command || row.item.template || '')
                    ]),
                    self._ui.iconButton('edit', _('Edit with --help'), function() { self._openCommandEditor(row.kind, row.idx); }, false)
                ]);
            }) : [E('div', {'class':'vnt2-form-desc'}, _('No command template is bound to this binary.'))];
            var pathAttrs = {'class':'cbi-input-text','value':value,'readonly':def.readonly ? 'readonly' : null,'style':'width:100%;max-width:560px;'};
            if (!def.readonly) {
                pathAttrs['data-adv-type'] = 'binary';
                pathAttrs['data-adv-idx'] = idx;
                pathAttrs['data-adv-field'] = 'path';
            }
            var nodes = [
                E('div', {'class':'vnt2-binary-title'}, def.label),
                self._ui.buildFormRow(_('Full Path'), E('input', pathAttrs), def.readonly ? _('Read-only, derived from Settings Binary Path') : _('Example: %s').format(def.path)),
                E('div', {'class':'vnt2-binary-command-list'}, commandNodes)
            ];
            if (!def.readonly) {
                nodes.splice(2, 0,
                    E('input', {'type':'hidden','data-adv-type':'binary','data-adv-idx':idx,'data-adv-field':'role','value':def.role}),
                    E('input', {'type':'hidden','data-adv-type':'binary','data-adv-idx':idx,'data-adv-field':'label','value':def.label})
                );
            }
            cards.push(E('div', {'class':'vnt2-advanced-item vnt2-binary-card'}, nodes));
        });
        return E('div', {}, [self._ui.card(_('Binary Profiles'), E('div', {'class':'vnt2-binary-grid'}, cards), 'vnt2-advanced-card'), self._renderFooter()]);
    },

    _collectAdvanced: function() {
        var self = this;
        document.querySelectorAll('[data-adv-type]').forEach(function(el) {
            var t = el.getAttribute('data-adv-type'), i = parseInt(el.getAttribute('data-adv-idx')), f = el.getAttribute('data-adv-field');
            if (!self._data[t] || !self._data[t][i]) return;
            var lf = el.getAttribute('data-adv-list-field');
            if (lf) {
                var arr = [];
                el.querySelectorAll('.vnt2-port-param-item').forEach(function(inp) {
                    var v = (inp.value || '').trim();
                    if (v) arr.push(v);
                });
                self._data[t][i][lf] = arr;
                return;
            }
            if (!f) return;
            self._data[t][i][f] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
        });
        self._raw = serializeUci(self._data);
    },

    _renderFooter: function() {
        var self = this;
        var buttons = [
            E('button', {'class':'btn cbi-button-save','click':function(){ self._saveAdvanced(); }}, _('Save')),
            E('button', {'class':'btn cbi-button-negative','click':function(){ self._reset(); }}, _('Reset Defaults'))
        ];
        return E('div', {'class':'vnt2-edit-footer'}, buttons);
    },

    _saveAdvanced: function() {
        this._collectAdvanced();
        var errors = validateAdvancedData(this._data);
        if (errors.length) { this._ui.notify(errors.join('\n'), 'error'); return; }
        return callSaveRaw(this._raw).then(L.bind(function(r) { this._ui.notify(r && r.result === 'ok' ? _('Advanced settings saved') : _('Save failed: %s').format((r && r.msg) || ''), r && r.result === 'ok' ? 'success' : 'error'); }, this));
    },

    _binaryPath: function(name) {
        var path = '';
        (this._data.binary || []).forEach(function(b) {
            if (b['.name'] === name) path = b.path || '';
        });
        return path;
    },

    _displayBinaryPath: function(name) {
        var dir = ((this._settings && this._settings.bin_path) || '/usr/bin').replace(/\/+$/, '') || '/usr/bin';
        if (name === 'vnt_web') return dir + '/vnt2_web';
        if (name === 'vnt_cli') return dir + '/vnt2_cli';
        if (name === 'vnt_ctrl') return dir + '/vnt2_ctrl';
        if (name === 'vnts') return dir + '/vnts2';
        return '';
    },

    _commandBinaryPath: function(item) {
        return this._displayBinaryPath(item.binary || '');
    },

    _commandItemsForBinary: function(binaryName) {
        var out = [];
        (this._data.command || []).forEach(function(item, idx) {
            if ((item.binary || '') === binaryName) out.push({ kind:'command', idx:idx, item:item });
        });
        (this._data.query || []).forEach(function(item, idx) {
            if ((item.binary || '') === binaryName) out.push({ kind:'query', idx:idx, item:item });
        });
        return out;
    },

    _openCommandEditor: function(kind, idx) {
        var self = this;
        self._collectAdvanced();
        var item = self._data[kind][idx];
        var wrap = document.getElementById('vnt2-advanced-body');
        var path = self._commandBinaryPath(item);
        wrap.innerHTML = '';
        wrap.appendChild(E('div', {'class':'vnt2-loading'}, _('Loading official --help...')));
        callHelp(path, 'help').catch(function() { return { content:_('No --help output') }; }).then(function(hr) {
            var helpText = (hr && hr.content) || '';
            var value = item.command || item.template || '';
            var preview = E('pre', {'class':'vnt2-command-template-preview'}, renderCommandPreview(value, path, self._settings.config_path, item.binary === 'vnts' ? 'vnts' : 'vnt'));
            var meta = E('div', {}, [
                self._ui.buildFormRow(kind === 'query' ? _('Query Command') : _('Startup Parameters'), preview, '')
            ]);
            var editor = self._ref.build({
                referenceTitle: _('Official --help') + ' - ' + (path || ''),
                editorTitle: kind === 'query' ? _('Edit Query Command') : _('Edit Startup Parameters'),
                referenceText: helpText,
                value: value,
                meta: meta,
                insertChips: false,
                guide: false,
                onInput: function(v) { preview.textContent = renderCommandPreview(v, path, self._settings.config_path, item.binary === 'vnts' ? 'vnts' : 'vnt'); }
            });
            function saveEditor() {
                var errors = validateCommandAgainstHelp(editor.getValue(), helpText);
                if (errors.length) { self._ui.notify(errors.join('\n'), 'error'); return; }
                item.command = editor.getValue();
                delete item.template;
                Promise.resolve(self._saveAdvanced()).then(function() { self._switch('binary'); });
            }
            wrap.innerHTML = '';
            wrap.appendChild(E('div', {}, [
                editor.node,
                E('div', {'class':'vnt2-edit-footer'}, [
                    E('button', {'class':'btn','click':function() { self._switch('binary'); }}, _('Back')),
                    E('button', {'class':'btn cbi-button-save','click':saveEditor}, _('Save'))
                ])
            ]));
        });
    },

    _ensurePortDetect: function() {
        if (!this._data.port_detect) this._data.port_detect = [];
        var item = this._data.port_detect[0];
        if (!item) {
            item = { '.type':'port_detect', '.name':'default' };
            this._data.port_detect.push(item);
        }
        item['.name'] = item['.name'] || 'default';
        if (item.enabled == null) item.enabled = '1';
        if (item.check_config == null) item.check_config = '1';
        if (item.check_system == null) item.check_system = '1';
        if (!item.ignore_param) item.ignore_param = ['endpoint', 'peer_servers', 'server_addr', 'server_address', 'remote_addr', 'remote'];
        if (!item.extra_param) item.extra_param = [];
        this._data.port_detect = [item];
        return item;
    },

    _detectSwitch: function(label, field, checked, desc) {
        var cb = E('input', {'type':'checkbox','class':'vnt2-toggle-input','data-adv-type':'port_detect','data-adv-idx':'0','data-adv-field':field});
        if (checked) cb.setAttribute('checked', 'checked');
        return this._ui.buildFormRow(label, E('label', {'class':'vnt2-toggle-wrap'}, [
            cb,
            E('span', {'class':'vnt2-toggle-slider'}),
            E('span', {'class':'vnt2-toggle-text'}, _('Enabled'))
        ]), desc || '');
    },

    _renderKeywords: function() {
        var self = this;
        var rows = LOG_KEY_DEFS.map(function(def) {
            var raw  = self._logKeys[def[0]];
            var keys = String(raw == null ? DEFAULT_LOG_KEYS[def[0]] : raw).split('|').filter(function(k) { return k !== ''; });
            var list = renderDetectList(def[0], keys, _('Keyword'));
            list.setAttribute('id', 'vnt2-keylist-' + def[0]);
            return self._ui.buildFormRow(def[1], list, def[2]);
        });
        return E('div', {}, [
            self._ui.card(_('Log Keywords'),
                [E('p', {'class':'vnt2-form-desc'}, _('Keywords are matched as substrings against each log line of the instance process. One keyword per row; clear all rows to disable a group.'))].concat(rows),
                'vnt2-advanced-card'),
            E('div', {'class':'vnt2-edit-footer'}, [
                E('button', {'class':'btn','click':function() {
                    self._logKeys = {};
                    var body = document.getElementById('vnt2-advanced-body');
                    body.innerHTML = '';
                    body.appendChild(self._renderBody());
                }}, _('Reset Defaults')),
                E('button', {'class':'btn cbi-button-save','click':function() { self._saveLogKeys(); }}, _('Save'))
            ])
        ]);
    },

    _saveLogKeys: function() {
        var self = this;
        var vals = LOG_KEY_DEFS.map(function(def) {
            var box = document.getElementById('vnt2-keylist-' + def[0]);
            var arr = [];
            if (box) box.querySelectorAll('.vnt2-port-param-item').forEach(function(inp) {
                var v = (inp.value || '').trim();
                if (v) arr.push(v);
            });
            return arr.join('|');
        });
        callSaveLogKeys.apply(null, vals).then(function(r) {
            if (r && r.result === 'ok') {
                LOG_KEY_DEFS.forEach(function(def, i) { self._logKeys[def[0]] = vals[i]; });
                self._ui.notify(_('Keywords saved'), 'success');
            } else {
                self._ui.notify(_('Save failed: %s').format((r && (r.msg || r.code)) || ''), 'error');
            }
        }).catch(function(err) {
            self._ui.notify(_('Save failed: %s').format(String(err)), 'error');
        });
    },

    _renderPortDetection: function() {
        var item = this._ensurePortDetect();
        return E('div', {}, [
            this._ui.card(_('Port Detection'), [
                E('p', {'class':'vnt2-form-desc'}, _('Automatically detects local listening port parameters such as *_port, *_bind, bind, web_addr, and excludes remote endpoint parameters.')),
                this._detectSwitch(_('Enable Port Detection'), 'enabled', boolValue(item.enabled, true), _('Run silent port checks before saving client, server, or vnt2_web listen address.')),
                this._detectSwitch(_('Check Duplicate Ports in Configs'), 'check_config', boolValue(item.check_config, true), _('Scan existing .vnt and .vnts configs, excluding the config currently being edited.')),
                this._detectSwitch(_('Check System Port Usage'), 'check_system', boolValue(item.check_system, true), _('Block saving when a newly selected port is already listening on this device. Unchanged running instance ports are ignored.')),
                E('div', {'class':'vnt2-port-rules'}, [
                    E('div', {'class':'vnt2-port-rule-box'}, [
                        E('b', {}, _('Auto-detected parameters')),
                        E('div', {'class':'vnt2-form-desc'}, '*_port, *_bind, bind, ctrl_port, web_addr')
                    ]),
                    E('div', {'class':'vnt2-port-rule-box'}, [
                        E('b', {}, _('Built-in ignored parameters')),
                        E('div', {'class':'vnt2-form-desc'}, 'endpoint, peer_servers, server_addr, server_address, remote_addr, remote')
                    ])
                ]),
                this._ui.buildFormRow(_('Extra Detection Parameters'), renderDetectList('extra_param', item.extra_param, 'api_listen 或 [section].port'), _('One parameter per row. Use section.key or [section].key for section fields.')),
                this._ui.buildFormRow(_('Ignored Parameters'), renderDetectList('ignore_param', item.ignore_param, 'endpoint'), _('One parameter per row. Matching key names or section.key names will be skipped.'))
            ], 'vnt2-advanced-card'),
            this._renderFooter()
        ]);
    },

    _renderConfigTemplates: function() {
        var self = this;
        var list = self._templates.filter(function(t){ return t.type === self._tplType; });
        return E('div', {}, [
            E('div', {'class':'vnt2-page-tabs vnt2-advanced-subtabs'}, ['vnt','vnts'].map(function(t) { return E('button', {'class':'vnt2-page-tab' + (self._tplType === t ? ' active' : ''),'click':function(){ self._tplType = t; self._reloadTemplates(); }}, templateTypeLabel(t)); })),
            self._ui.card(_('Config Templates') + ' - ' + templateTypeLabel(self._tplType), [
                E('p', {'class':'vnt2-form-desc'}, _('Default templates are readonly. Clone a default template, edit the raw template text, then use Preview to see the form that Instance Management will create.')),
                self._renderTemplateTable(list),
                E('div', {'style':'margin-top:10px;'}, E('button', {'class':'btn cbi-button-add','click':function(){ self._openTemplateEditor(self._tplType, '', false, ''); }}, _('New Custom Template')))
            ], 'vnt2-advanced-card')
        ]);
    },

    _renderTemplateTable: function(list) {
        var self = this;
        return E('div', {'class':'vnt2-table-wrap vnt2-table-card'}, E('table', {'class':'vnt2-table'}, [
            E('thead', {}, E('tr', {}, [_('Name'),_('Type'),_('Source'),_('Default'),_('Actions')].map(function(h){ return E('th', {}, h); }))),
            E('tbody', {}, list.map(function(t) {
                return E('tr', {}, [
                    E('td', {}, t.label || t.name), E('td', {}, templateTypeLabel(t.type)), E('td', {}, t.readonly ? _('Built-in readonly') : _('Custom')), E('td', {}, t.selected ? '✓' : '-'),
                    E('td', {}, E('div', {'class':'vnt2-btn-group'}, [
                        self._ui.iconButton(t.readonly ? 'view' : 'edit', t.readonly ? _('View') : _('Edit'), function(){ self._editTemplate(t); }, false),
                        self._ui.iconButton('copy', _('Clone'), function(){ self._cloneTemplate(t); }, false),
                        self._ui.iconButton('start', _('Use as default'), function(){ self._setDefaultTemplate(t); }, false),
                        t.readonly ? E('span', {}) : self._ui.iconButton('delete', _('Delete'), function(){ self._deleteTemplate(t); }, false)
                    ]))
                ]);
            }))
        ]));
    },

    _editTemplate: function(t) {
        callTplRead(t.type, t.name).then(L.bind(function(r) { this._openTemplateEditor(t.type, t.name, !!r.readonly, r.content || ''); }, this));
    },

    _cloneTemplate: function(t) {
        var name = window.prompt(_('New template name'), t.name === 'default' ? (t.type === 'vnt' ? 'my-client' : 'my-server') : t.name + '-copy');
        if (!name) return;
        if (!/^[A-Za-z0-9_-]+$/.test(name)) { this._ui.notify(_('Template name can only contain letters, numbers, underscores and hyphens'), 'error'); return; }
        callTplRead(t.type, t.name).then(L.bind(function(r) { return callTplSave(t.type, name, r.content || ''); }, this)).then(L.bind(function(r) { this._ui.notify(r && r.result === 'ok' ? _('Template cloned') : _('Clone failed: %s').format((r && r.msg) || ''), r && r.result === 'ok' ? 'success' : 'error'); return this._reloadTemplates(); }, this));
    },

    _setDefaultTemplate: function(t) {
        callTplDefault(t.type, t.name).then(L.bind(function(r) { this._ui.notify(r && r.result === 'ok' ? _('Default template saved') : _('Save failed'), r && r.result === 'ok' ? 'success' : 'error'); return this._reloadTemplates(); }, this));
    },

    _deleteTemplate: function(t) {
        this._ui.confirm(_('Delete Template'), _('Delete template "%s"?').format(t.name)).then(L.bind(function(ok) { if (!ok) return; callTplDelete(t.type, t.name).then(L.bind(function(){ this._reloadTemplates(); }, this)); }, this));
    },

    _reloadTemplates: function() {
        return Promise.all([callTplList('all'), callReadRaw()]).then(L.bind(function(rs) { this._templates = (rs[0] && rs[0].templates) || []; this._raw = (rs[1] && rs[1].content) || this._raw; this._data = parseUci(this._raw); var body = document.getElementById('vnt2-advanced-body'); if (body) { body.innerHTML = ''; body.appendChild(this._renderConfigTemplates()); } }, this));
    },

    _openTemplateEditor: function(type, name, readonly, content) {
        var self = this;
        var wrap = document.getElementById('vnt2-advanced-body');
        wrap.innerHTML = '';
        wrap.appendChild(E('div', {'class':'vnt2-loading'}, _('Loading official --conf-example...')));
        callTplHelp(type).catch(function(){ return { content:_('No --conf-example output') }; }).then(function(hr) {
            var preview = E('div', {'id':'vnt2-template-preview'});
            var nameInput = E('input', {'class':'cbi-input-text','value':name || '', 'readonly':readonly ? 'readonly' : null, 'placeholder':_('Custom template name')});
            var editor = self._ref.build({
                referenceTitle: _('Official --conf-example') + ' - ' + ((hr && hr.bin) || ''),
                editorTitle: (readonly ? _('View Template') : _('Edit Template')) + ' - ' + templateTypeLabel(type),
                referenceText: (hr && hr.content) || '',
                value: content || '',
                readonly: readonly,
                insertChips: !readonly,
                guide: true,
                highlightUnknownParams: true,
                includeCommentedParams: true,
                toolsInReferencePane: true,
                meta: E('div', {'class':'vnt2-template-name-inline'}, [
                    E('label', {}, _('Template Name')),
                    nameInput,
                    readonly ? E('span', {'class':'vnt2-form-desc'}, _('Built-in templates are readonly. Clone it before editing.')) : E('span', {})
                ]),
                previewNode: preview
            });
            function doPreview() {
                var curName = nameInput.value.trim() || name || 'default';
                var curContent = editor.getValue();
                var errors = self._validator.validateDuplicateParameters(curContent, true);
                wrap.innerHTML = '';
                wrap.appendChild(E('div', {'class':'vnt2-edit-view'}, [
                    E('div', {'class':'vnt2-edit-header'}, [
                        E('div', {'class':'vnt2-breadcrumb'}, [
                            E('span', {'class':'vnt2-breadcrumb-link','click':function(){ self._openTemplateEditor(type, curName, readonly, curContent); }}, _('Edit Template')),
                            E('span', {'class':'vnt2-breadcrumb-sep'}, ' › '),
                            E('span', {}, _('Preview New Config Form'))
                        ]),
                        E('div', {'class':'vnt2-bold','style':'margin-top:8px;'}, templateTypeLabel(type) + ' / ' + curName)
                    ]),
                    errors.length
                        ? E('div', {'class':'alert-message error'}, errors.join('\n'))
                        : renderTemplatePreview(self._parser, self._ui, curContent),
                    E('div', {'class':'vnt2-edit-footer'}, [
                        E('button', {'class':'btn','click':function(){ self._openTemplateEditor(type, curName, readonly, curContent); }}, _('Back to Editor'))
                    ])
                ]));
            }
            wrap.innerHTML = '';
            wrap.appendChild(E('div', {}, [editor.node, E('div', {'class':'vnt2-edit-footer'}, [
                E('button', {'class':'btn','click':function(){ self._reloadTemplates(); }}, _('Back')),
                E('button', {'class':'btn','click':doPreview}, _('Preview New Config Form')),
                readonly ? E('button', {'class':'btn cbi-button-add','click':function(){ self._cloneTemplate({type:type,name:name||'default'}); }}, _('Clone')) : E('button', {'class':'btn cbi-button-save','click':function(){
                    var nm = nameInput.value.trim();
                    if (!/^[A-Za-z0-9_-]+$/.test(nm)) { self._ui.notify(_('Template name can only contain letters, numbers, underscores and hyphens'), 'error'); return; }
                    var dupErrors = self._validator.validateDuplicateParameters(editor.getValue(), true);
                    if (dupErrors.length) { if (editor.showValidationErrors) editor.showValidationErrors(dupErrors); self._ui.notify(dupErrors.join('\n'), 'error'); return; }
                    function doTplSave() {
                        callTplSave(type, nm, editor.getValue()).then(function(r){ self._ui.notify(r && r.result === 'ok' ? _('Template saved') : _('Save failed: %s').format((r && r.msg) || ''), r && r.result === 'ok' ? 'success' : 'error'); if (r && r.result === 'ok') self._reloadTemplates(); });
                    }
                    var unknown = self._validator.unknownAgainstReference(editor.getValue(), (hr && hr.content) || '', true);
                    if (unknown.length) {
                        if (editor.showValidationErrors) editor.showValidationErrors([]);
                        self._ui.confirm(_('Unknown Parameters'), self._validator.unknownParamsMessage(unknown)).then(function(ok) {
                            if (!ok) return;
                            if (editor.clearValidation) editor.clearValidation();
                            doTplSave();
                        });
                        return;
                    }
                    doTplSave();
                }}, _('Save'))
            ])]));
        });
    },

    _reset: function() {
        this._ui.confirm(_('Reset Defaults'), _('Reset advanced settings to built-in defaults?')).then(L.bind(function(ok) { if (!ok) return; callReset().then(L.bind(function(r) { if (r && r.result === 'ok') { this._raw = r.content || ''; this._data = parseUci(this._raw); this._switch('binary'); this._ui.notify(_('Defaults restored'), 'success'); } }, this)); }, this));
    }
});

