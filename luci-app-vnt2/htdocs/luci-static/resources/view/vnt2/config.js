'use strict';
'require view';
'require ui';
'require uci';
'require rpc';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callGetTemplateFields = rpcDeclare('get_template_fields', ['type']);
var callListConfigs       = rpcDeclare('list_configs',        ['filter']);
var callReadConfig        = rpcDeclare('read_config',         ['name','type']);
var callSaveConfig        = rpcDeclare('save_config',         ['name','type','content','old_name']);
var callDeleteConfig      = rpcDeclare('delete_config',       ['name','type']);
var callReadTemplate      = rpcDeclare('read_template',       ['type']);
var callListInstances     = rpcDeclare('list_instances',      []);
var callSetEnabled        = rpcDeclare('set_enabled',         ['type','configs']);
var callGetEnabled        = rpcDeclare('get_enabled',         ['type']);
var callInstanceAction    = rpcDeclare('instance_action',     ['name','action']);

var TABS          = { vnt:_('Client'), vnts:_('Server') };
var START_METHODS = { vnt:['vnt2_cli','vnt2_web'], vnts:['vnts2'] };

var _tab             = (location.hash === '#vnts') ? 'vnts' : 'vnt';
var _dirty           = false;
var _listState       = { vnt:{}, vnts:{} };
var _listStateLoaded = { vnt:false, vnts:false };
var _statusTimer     = null;

function defaultMethod(tab) { return START_METHODS[tab][0]; }

function parseConfigs(r) {
    return (r && Array.isArray(r.configs)) ? r.configs : [];
}

function resetListState() {
    _listState       = { vnt:{}, vnts:{} };
    _listStateLoaded = { vnt:false, vnts:false };
}

function parseInstanceList(instances) {
    var status = {}, webAddr = {};
    (instances || []).forEach(function(inst) {
        status[inst.name]  = inst.running;
        webAddr[inst.name] = inst.web_addr || '';
    });
    return { status:status, webAddr:webAddr };
}

function loadListState(tab) {
    if (_listStateLoaded[tab]) return Promise.resolve();
    return callGetEnabled(tab).then(function(r) {
        var state = {};
        ((r && r.configs) || []).forEach(function(item) {
            if (!item.name) return;
            var webReady    = !!(item.web_addr && item.web_addr.trim());
            var startMethod = item.method_set
                ? item.start_method
                : (tab === 'vnt' && webReady ? 'vnt2_web' : defaultMethod(tab));
            state[item.name] = {
                enabled:      !!item.enabled,
                start_method: startMethod,
                _methodSet:   true,
                _cfgWebAddr:  webReady ? '1' : ''
            };
        });
        _listState[tab]       = state;
        _listStateLoaded[tab] = true;
    });
}

function saveListState(self, silent) {
    var promises = Object.keys(TABS).map(function(tab) {
        if (!_listStateLoaded[tab]) return Promise.resolve();
        var configs = Object.keys(_listState[tab]).map(function(name) {
            return {
                name:         name,
                enabled:      _listState[tab][name].enabled,
                start_method: _listState[tab][name].start_method
            };
        });
        return callSetEnabled(tab, configs);
    });
    return Promise.all(promises).then(function(results) {
        if (results.some(function(r) { return r && r.result !== 'ok'; })) {
            self._ui.notify(_('Partial save failed'), 'error');
            return;
        }
        if (!silent) self._ui.notify(_('Configuration saved'), 'success');
        return refreshStatus(self);
    }).catch(function(err) {
        self._ui.notify(_('Save error: %s').format(String(err)), 'error');
    });
}

function setTabActive(el, active) {
    if (!el) return;
    el.style.borderBottom = active ? '2px solid #3498db' : '2px solid transparent';
    el.style.color        = active ? '#3498db' : '#666';
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
    return callListInstances().then(function(r) {
        var parsed   = parseInstanceList(r && r.instances);
        self._status  = parsed.status;
        self._webAddr = parsed.webAddr;
        rebuildTable(self);
    }).catch(function() {});
}

function rebuildTable(self) {
    var wrap = document.getElementById('vnt2-table-wrap');
    if (!wrap) return;
    var tableWrap  = wrap.querySelector('.vnt2-table-wrap');
    var scrollLeft = tableWrap ? tableWrap.scrollLeft : 0;
    wrap.innerHTML = '';
    wrap.appendChild(buildTable(self));
    var newTableWrap = wrap.querySelector('.vnt2-table-wrap');
    if (newTableWrap && scrollLeft > 0) newTableWrap.scrollLeft = scrollLeft;
}

function buildTable(self) {
    var configs = self._configs[_tab] || [];
    if (!configs.length)
        return E('p', {'class':'vnt2-empty'},
            _('No %s configurations yet. Click "New Config" to add one.').format(TABS[_tab]));
    var thStyle = 'padding:8px 12px;text-align:center;white-space:nowrap;';
    var heads   = [_('Enabled'),_('Name'),_('Start Method'),_('Status'),_('Actions')];
    return E('div', {'class':'vnt2-table-wrap','style':
            'width:100%;max-width:100%;box-sizing:border-box;display:block;overflow-x:auto;'+
            '-webkit-overflow-scrolling:touch;border:1px solid #ddd;border-radius:8px;'},
        E('table', {'class':'vnt2-table','style':
                'width:100%;min-width:480px;border-collapse:collapse;border-spacing:0;box-sizing:border-box;'}, [
            E('thead', {}, E('tr', {},
                heads.map(function(h) { return E('th', {'style':thStyle}, h); })
            )),
            E('tbody', {}, configs.map(function(cfg) { return buildRow(self, cfg); }))
        ])
    );
}

function buildRow(self, cfg) {
    var tab     = _tab;
    var name    = cfg.name;
    var tdStyle = 'padding:8px 12px;text-align:center;vertical-align:middle;white-space:nowrap;';
    var state   = ensureState(tab, name);

    var cb = E('input', {'type':'checkbox','style':'width:16px;height:16px;cursor:pointer;'});
    if (state.enabled) cb.setAttribute('checked','checked');
    cb.addEventListener('change', function() {
        _listState[tab][name].enabled = cb.checked;
        var cell = cb.closest('tr').querySelector('.vnt2-status-cell');
        if (cell) {
            cell.innerHTML = '';
            cell.appendChild(self._ui.statusBadge(
                cb.checked ? (self._status && self._status[name]) : null
            ));
        }
    });

    var statusCell = E('td', {'class':'vnt2-status-cell','style':tdStyle},
        self._ui.statusBadge(state.enabled ? (self._status && self._status[name]) : null));

    return E('tr', {'data-cfg-name':name}, [
        E('td', {'style':tdStyle+'cursor:pointer;',
            'click':function(ev) { if (ev.target !== cb) cb.click(); }}, cb),
        E('td', {'class':'vnt2-col-name','style':tdStyle}, name),
        E('td', {'style':tdStyle}, buildMethodSelect(self, tab, name)),
        statusCell,
        E('td', {'style':tdStyle}, [
            E('button', {'class':'btn cbi-button-edit','style':'margin-right:6px;',
                'click':function() { openEditor(self, name, false); }}, _('Edit')),
            E('button', {'class':'btn cbi-button-negative',
                'click':function() { deleteConfig(self, name); }}, _('Delete'))
        ])
    ]);
}

function buildMethodSelect(self, tab, name) {
    var state    = _listState[tab][name];
    var webReady = !!(state._cfgWebAddr && state._cfgWebAddr.trim());
    if (!state._methodSet) {
        state.start_method = (tab === 'vnt' && webReady) ? 'vnt2_web' : defaultMethod(tab);
        state._methodSet   = true;
    }
    var sel = E('select', {'class':'cbi-input-select','style':'width:auto;'},
        START_METHODS[tab].map(function(m) {
            var attrs = {'value':m};
            if (m === state.start_method)      attrs['selected'] = 'selected';
            if (m === 'vnt2_web' && !webReady) attrs['disabled'] = 'disabled';
            return E('option', attrs, m);
        })
    );
    sel.addEventListener('change', function() { _listState[tab][name].start_method = sel.value; });
    sel.addEventListener('focus',  function() { stopStatusTimer(); });
    sel.addEventListener('blur',   function() { startStatusTimer(self); });
    return sel;
}

function ensureState(tab, name) {
    if (!_listState[tab][name])
        _listState[tab][name] = {
            enabled:false, start_method:defaultMethod(tab),
            _methodSet:false, _cfgWebAddr:''
        };
    return _listState[tab][name];
}

function openEditor(self, name, isNew) {
    var ew = document.getElementById('vnt2-edit-wrap');
    if (!ew) return;
    ew.innerHTML = '';
    ew.appendChild(E('div', {'class':'vnt2-loading'}, _('Loading configuration...')));
    location.hash = _tab + (isNew ? '&new' : '&edit=' + name);
    toggleView(false);
    var tab = _tab;
    var p   = (isNew || !name)
        ? callReadTemplate(tab).then(function(r) {
            return { content:(r && r.content)||'', values:{} };
          })
        : callReadConfig(name, tab).then(function(r) {
            var c = (r && r.content)||'';
            return { content:c, values:self._parser.parseValues(c) };
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

function buildEditor(self, name, isNew, tab, res) {
    var fields = self._fields[tab] || [];
    var formEl = buildForm(fields, res.values, self._parser);
    formEl.addEventListener('input',  function() { _dirty = true; });
    formEl.addEventListener('change', function() { _dirty = true; });

    if (isNew && tab === 'vnt') {
        var tunInput = formEl.querySelector('[data-field-name="tun_name"]');
        if (tunInput) {
            tunInput._userEdited = false;
            tunInput.addEventListener('input', function() { tunInput._userEdited = true; });
        }
    }

    var nameErr   = E('span', {
        'style':'color:#dc3545;font-size:12px;margin-left:8px;display:none;'
    });
    var nameInput = E('input', {
        'type':'text','class':'cbi-input-text','style':'width:auto;',
        'value':name||'','placeholder':_('Letters, numbers, underscores, hyphens')
    });
    nameInput.addEventListener('input', function() {
        _dirty = true;
        nameErr.style.display = 'none';
        if (isNew) {
            var ti = formEl.querySelector('[data-field-name="tun_name"]');
            if (ti && !ti._userEdited) ti.value = 'vnt_' + nameInput.value.trim();
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
                    _('%s Config List').format(TABS[tab])),
                E('span', {'class':'vnt2-breadcrumb-sep'}, ' › '),
                E('span', {}, (isNew ? _('New') : _('Edit')) + _('Configuration'))
            ]),
            E('div', {'style':'display:flex;align-items:center;margin-top:8px;'}, [
                E('label', {'style':'font-weight:bold;margin-right:6px;flex-shrink:0;'},
                    _('Configuration Name:')),
                nameInput, nameErr
            ])
        ]),
        E('div', {'class':'vnt2-edit-body'}, formEl),
        E('div', {'class':'vnt2-edit-footer','style':'padding-top:60px;display:flex;gap:8px;'}, [
            E('button', {'class':'btn','click':backToList}, _('← Back to List')),
            E('button', {
                'class':'btn cbi-button-save',
                'click': function() {
                    var newName = nameInput.value.trim();
                    if (!newName || !/^[\w-]+$/.test(newName)) {
                        nameErr.textContent   = _('Name can only contain letters, numbers, underscores, hyphens');
                        nameErr.style.display = 'inline';
                        nameInput.focus(); return;
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

function buildFormRow(f, values, parser) {
    var val = Object.prototype.hasOwnProperty.call(values, f.name)
        ? values[f.name]
        : (f.type === 'section' ? {} : f['default']);
    var isRequired  = !!(f.comment && f.comment.indexOf('必填') !== -1);
    var nameEl      = E('div', {'class':'vnt2-field-name'});
    nameEl.appendChild(document.createTextNode(f.name));
    if (isRequired) nameEl.appendChild(E('span', {'class':'vnt2-required-star'}, ' *'));
    var rawComment  = f.comment || '';
    var commentText = parser ? parser._extractI18nComment(rawComment) : rawComment;
    commentText = commentText
        .replace(/选项[：:]\s*[^\n]*/gi, '')
        .replace(/示例[：:]\s*\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return E('div', {'class':'vnt2-field-row'}, [
        E('div', {'class':'vnt2-field-label'}, [
            nameEl,
            commentText
                ? E('div', {'class':'vnt2-field-desc'}, commentText)
                : E('span', {})
        ]),
        E('div', {'class':'vnt2-field-input'}, buildInput(f, val, isRequired))
    ]);
}

var INPUT_BUILDERS = {
    bool:    buildBool,
    select:  buildSelect,
    array:   buildArray,
    int:     buildInt,
    section: buildSection,
};

function buildInput(f, val, isRequired) {
    return (INPUT_BUILDERS[f.type] || buildText)(f, val, isRequired);
}

function buildBool(f, val) {
    var checked = (val === 'true' || val === true);
    var span    = E('span', {'class':'vnt2-bool-label'}, checked ? _('Enabled') : _('Disabled'));
    var cb      = E('input', {
        'type':'checkbox','class':'vnt2-checkbox',
        'data-field-name':f.name,'data-field-type':'bool'
    });
    if (checked) cb.setAttribute('checked','checked');
    cb.addEventListener('change', function() {
        span.textContent = cb.checked ? _('Enabled') : _('Disabled');
    });
    return E('label', {'class':'vnt2-bool-wrap'}, [cb, span]);
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
    var parsed = opts.map(function(o) {
        var i = o.indexOf('=');
        return i !== -1
            ? {value:o.substring(0,i).trim(),
               label:o.substring(0,i).trim()+' — '+o.substring(i+1).trim()}
            : {value:o, label:o};
    });
    var options = [];
    if (!parsed.some(function(p) { return p.value === val; }) || val === '' || val == null)
        options.push(E('option', {'value':''}, _('— Please select —')));
    parsed.forEach(function(p) {
        var a = {'value':p.value};
        if (p.value === val) a['selected'] = 'selected';
        options.push(E('option', a, p.label));
    });
    return E('select', {
        'class':'vnt2-input vnt2-select cbi-input-select',
        'data-field-name':f.name,'data-field-type':'select'
    }, options);
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

function buildListField(f, items, cls) {
    var pfx       = 'vnt2-' + cls;
    var clsField  = pfx + '-field';
    var clsItem   = pfx + '-item';
    var clsRow    = pfx + '-row';
    var clsBtnAdd = 'btn ' + pfx + '-btn-add';
    var clsBtnDel = 'btn ' + pfx + '-btn-del';

    var container = E('div', {
        'class':           clsField,
        'data-field-name': f.name,
        'data-field-type': cls
    });

    function addRow(v) {
        var input = E('input', {
            'type':'text','class':'vnt2-input ' + clsItem,
            'value':v||'','placeholder':getPlaceholder(f)
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

function buildArray(f, val) {
    var items = Array.isArray(val)
        ? val.filter(function(v) { return String(v).trim() !== ''; })
        : (typeof val === 'string' && val.trim()
            ? (val.trim().charAt(0) === '['
                ? VNT2ConfigParser._parseArray(val.trim())
                : [val.trim()])
            : []);
    if (!items.length) items = [''];
    return buildListField(f, items, 'array');
}

function buildSection(f, val) {
    var items = (val && typeof val === 'object' && !Array.isArray(val))
        ? Object.keys(val).map(function(k) { return (val[k]||'').trim(); }).filter(Boolean)
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
        } else if (type === 'section') {
            var obj = {}, autoIdx = 1;
            collectItems(el, '.vnt2-section-item').forEach(function(line) {
                var eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                    var k = line.substring(0, eqIdx).trim();
                    var v = line.substring(eqIdx + 1).trim();
                    if (k && v) { obj[k] = v; autoIdx++; }
                } else {
                    obj['net' + autoIdx++] = line;
                }
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
    formEl.querySelectorAll('.vnt2-input-error').forEach(function(el) {
        el.classList.remove('vnt2-input-error');
    });
    var errors = [];
    fields.forEach(function(f) {
        if (!f.comment || f.comment.indexOf('必填') === -1) return;
        if (f.type === 'array') {
            var c = formEl.querySelector(
                '[data-field-name="'+f.name+'"][data-field-type="array"]');
            if (!c) return;
            var ok = false;
            c.querySelectorAll('.vnt2-array-item').forEach(function(inp) {
                if (inp.value.trim()) ok = true;
            });
            if (!ok) {
                errors.push(f.name);
                var fi = c.querySelector('.vnt2-array-item');
                if (fi) fi.classList.add('vnt2-input-error');
            }
        } else {
            var el = formEl.querySelector('[data-field-name="'+f.name+'"]');
            if (!el || el.type === 'checkbox') return;
            if (!el.value.trim()) {
                errors.push(f.name);
                el.classList.add('vnt2-input-error');
            }
        }
    });
    return errors;
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
        var content = self._parser.serializeToToml(fields, collectValues(formEl), templateContent);
        var renamed = !!(oldName && oldName !== newName);
        callSaveConfig(newName, tab, content, oldName||'').then(function(r) {
            if (!r || r.result !== 'ok') {
                self._ui.notify(_('Save failed: %s').format((r && r.msg)||''), 'error');
                return;
            }
            if (renamed) {
                _listState[tab][newName] = _listState[tab][oldName] || ensureState(tab, newName);
                delete _listState[tab][oldName];
            }
            _dirty = false;
            if (tab === 'vnt') {
                var webReady = self._parser.hasWebAddr(content);
                var st       = ensureState(tab, newName);
                st._cfgWebAddr  = webReady ? '1' : '';
                st.start_method = webReady ? 'vnt2_web' : 'vnt2_cli';
                st._methodSet   = true;
            }
            var state = _listState[tab][newName] || ensureState(tab, newName);
            if (state.enabled) {
                callInstanceAction(newName, 'restart').then(function(res) {
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
            self._ui.notify(_('Save error: ') + String(err), 'error');
        });
    });
}

function deleteConfig(self, name) {
    var tab     = _tab;
    var running = !!(self._status && self._status[name]);
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
        var initTab = (location.hash === '#vnts') ? 'vnts' : 'vnt';
        return Promise.all([
            L.require('vnt2.common'),
            L.uci.load('vnt2'),
            callGetTemplateFields('vnt'),
            callGetTemplateFields('vnts'),
            callListConfigs(initTab),
            callListInstances(),
        ]).then(function(data) {
            data._initTab = initTab;
            return data;
        });
    },

    render: function(data) {
        var self    = this;
        var initTab = data._initTab || 'vnt';
        self._ui     = data[0].VNT2UI;
        self._parser = data[0].VNT2ConfigParser;
        self._fields = {
            vnt:  (data[2] && Array.isArray(data[2].fields)) ? data[2].fields : [],
            vnts: (data[3] && Array.isArray(data[3].fields)) ? data[3].fields : []
        };
        self._configs          = {vnt:null, vnts:null};
        self._configs[initTab] = parseConfigs(data[4]);
        var parsed    = parseInstanceList(data[5] && data[5].instances);
        self._status  = parsed.status;
        self._webAddr = parsed.webAddr;
        resetListState();
        _tab   = initTab;
        _dirty = false;
        startStatusTimer(self);

        var node = E('div', {'class':'cbi-map'}, [
            E('h2', {}, _('VNT2 Configuration')),
            E('div', {'class':'cbi-section'}, [
                E('div', {'style':'display:flex;border-bottom:2px solid #ddd;margin-bottom:16px;'},
                    Object.keys(TABS).map(function(t) {
                        var active = t === initTab;
                        return E('div', {
                            'id':    'vnt2-tab-' + t,
                            'style': [
                                'padding:8px 24px','cursor:pointer','font-weight:bold',
                                'margin-bottom:-2px',
                                'border-bottom:'+(active?'2px solid #3498db':'2px solid transparent'),
                                'color:'+(active?'#3498db':'#666')
                            ].join(';'),
                            'click': function() { switchTab(self, t); }
                        }, TABS[t]+_('Configuration'));
                    })
                ),
                E('div', {'id':'vnt2-list-wrap'}, [
                    E('div', {
                        'class':'vnt2-toolbar',
                        'style':'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;'
                    }, [
                        E('button', {'class':'btn cbi-button-add',
                            'click':function() { openEditor(self, '', true); }
                        }, _('+ New Config')),
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
            if (hash.indexOf('&edit=') !== -1) {
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