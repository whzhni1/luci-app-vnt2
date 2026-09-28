'use strict';
'require view';
'require poll';
'require rpc';
'require uci';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callCheckBinaries  = rpcDeclare('check_binaries',  []);
var callListInstances  = rpcDeclare('list_instances',  []);
var callInstanceAction = rpcDeclare('instance_action', ['name','action','type']);
var callGetCtrlInfo    = rpcDeclare('get_ctrl_info',   ['name','cmd','network_code','type']);
var callGetCpuTicks    = rpcDeclare('get_cpu_ticks',   ['name','type']);
var callListWebInstances  = rpcDeclare('list_web_instances',  []);
var callWebInstanceAction = rpcDeclare('web_instance_action', ['file_name','action']);

var BIN_KEYS = [
    ['vnt2_web','vnt2_web'],['vnt2_cli','vnt2_cli'],['vnt2_ctrl','vnt2_ctrl'],['vnts2','vnts2'],
];

var LINKS = [
    ['http://rustvnt.com',                          _('Official Website')],
    ['https://github.com/vnt-dev/vnt',              'GitHub'],
    ['https://github.com/vnt-dev/VntApp/releases',  'GUIApp'],
    ['https://github.com/whzhni1/luci-app-vnt2',    'Luci'],
];

var ACTIONS = [
    { id:'start',   label:_('Start'),   needRunning:false },
    { id:'restart', label:_('Restart'), needRunning:true  },
    { id:'stop',    label:_('Stop'),    needRunning:true  },
];

var _lastTicks = {};

function rpcActionName(inst) {
    if (!inst) return '';
    if (inst.name === 'vnt2_web') return 'vnt2_web';
    var n = String(inst.name || '').replace(/^.*\//, '');
    if (inst.type === 'vnt')  n = n.replace(/\.vnt$/, '');
    if (inst.type === 'vnts') n = n.replace(/\.vnts$/, '');
    return n;
}

function typeLabel(type) { return type === 'vnts' ? _('Server') : (type === 'web' ? 'vnt2_web' : _('Client')); }


function filterCtrlInsts(instances) {
    return instances.filter(function(i) {
        if (!i.running) return false;
        if (i.type==='vnt')  return true;
        if (i.type==='vnts') return !!(i.web_addr && i.web_addr!=='');
        return false;
    });
}

function instKey(inst) {
    return (inst.type || 'x') + '-' + inst.name;
}

function findInstByKey(list, key) {
    for (var i=0; i<list.length; i++) if (instKey(list[i])===key) return list[i];
    return null;
}

function getInstEls(name) {
    var els = {};
    ['uptime','pid','res','actions','web'].forEach(function(k) {
        els[k] = document.getElementById('vnt2-'+k+'-'+name);
    });
    return els;
}

function getCtrlTabs(type) {
    return type==='vnts'
        ? [{id:'info',label:_('Networks')},{id:'servers',label:_('Servers')}]
        : [{id:'info',label:_('Basic Info')},{id:'ips',label:_('IP List')},
           {id:'clients',label:_('Client')},{id:'route',label:_('Route')}];
}

function switchTabs(tabPfx, bodyPfx, activeId, onSwitch) {
    document.querySelectorAll('[id^="'+tabPfx+'"]').forEach(function(el) {
        el.classList.toggle('active', el.id === tabPfx+activeId);
    });
    document.querySelectorAll('[id^="'+bodyPfx+'"]').forEach(function(el) {
        el.style.display = el.id===bodyPfx+activeId ? 'block' : 'none';
    });
    if (onSwitch) onSwitch(activeId);
}

function msgP(text, isError) {
    return E('p', {'class':'vnt2-msg' + (isError ? ' vnt2-msg-error' : '')}, text);
}

function wrapContent(tag, content) {
    return E('div', {'class':'vnt2-content-scroll'}, [
        E(tag, {'class':'vnt2-content-inner' + (tag === 'pre' ? ' vnt2-console' : '')}, content)
    ]);
}

function buildTable(rows) {
    return E('table', {'class':'vnt2-kv-table'},
        E('tbody', {}, rows.map(function(row) {
            return E('tr', {}, [
                E('td', {}, row[0]),
                E('td', {}, (row[1] instanceof Node) ? row[1] : String(row[1]!=null?row[1]:'-'))
            ]);
        }))
    );
}

function makeStatusBadge(status) {
    var map = {
        Online:  { label:_('Online'),  cls:'vnt2-pill-ok'   },
        Offline: { label:_('Offline'), cls:'vnt2-pill-err'  },
        Remote:  { label:_('Remote'),  cls:'vnt2-pill-info' },
        running: { label:_('Running'), cls:'vnt2-pill-ok'   }
    };
    var s = map[status] || { label: status || '-' };
    return E('span', {'class':'vnt2-pill ' + (s.cls || '')}, s.label);
}

function makeTable(heads, rows) {
    return E('div', {'class':'vnt2-data-table-wrap'},
        E('table', {'class':'vnt2-data-table'}, [
            E('thead', {}, E('tr', {}, heads.map(function(h) { return E('th', {}, h); }))),
            E('tbody', {}, rows.length
                ? rows.map(function(row) {
                    return E('tr', {}, row.map(function(cell) {
                        return E('td', {}, (cell instanceof Node) ? cell : String(cell!=null?cell:'-'));
                    }));
                })
                : [E('tr', {}, [E('td', {'colspan':String(heads.length),'class':'vnt2-no-data'}, _('No data'))])]
            )
        ])
    );
}

function getRenderer(self, instType, cmd) {
    var map = {
        vnt:  {info:self._renderInfo,  ips:self._renderIps,
               clients:self._renderClients, route:self._renderRoute},
        vnts: {info:self._renderVntsInfo, servers:self._renderVntsServers},
    };
    return map[instType] && map[instType][cmd]
        ? map[instType][cmd].bind(self) : null;
}

function refreshList(self) {
    return callListInstances().then(function(r) {
        var list = (r&&Array.isArray(r.instances))?r.instances:[];
        self._instances = list;
        self._refreshRows(list);
        return list;
    });
}

function fetchCpuAsync(inst, onResult) {
    if (!inst.running) return;
    callGetCpuTicks(inst.name, inst.type).then(function(r) {
        if (!r||!r.alive) return;
        var last=_lastTicks[instKey(inst)];
        _lastTicks[instKey(inst)]={proc:r.proc,total:r.total};
        if (!last) return;
        var dp=r.proc-last.proc, dt=r.total-last.total;
        onResult(dt>0?(dp/dt*100).toFixed(1):'0.0');
    }).catch(function(){});
}

function buildBatchBtns(self) {
    return [E('span', {'class':'vnt2-batch-label'}, _('All'))]
        .concat(ACTIONS.map(function(act) {
            return self._ui.iconButton(act.id, act.label, function() { self._doBatchAction(act.id); }, false);
        }));
}

return view.extend({
    handleSave: null,
    handleSaveApply: null,
    handleReset: null,

    load: function() {
        return Promise.all([L.require('vnt2.common'),callCheckBinaries(),callListInstances()]);
    },

    render: function(data) {
        var self=this;
        self._destroyed=false;
        _lastTicks={};
        self._ui  =data[0].VNT2UI;
        self._fmt =data[0].VNT2Format;
        self._web =data[0].VNT2Web;
        var binaries=data[1]||{};
        var instances=(data[2]&&Array.isArray(data[2].instances))?data[2].instances:[];
        self._instances=instances;

        instances.forEach(function(inst){
            if (!inst.running) return;
            callGetCpuTicks(inst.name, inst.type).then(function(r){
                if (r&&r.alive) _lastTicks[instKey(inst)]={proc:r.proc,total:r.total};
            }).catch(function(){});
        });

        var firstVnt=instances.filter(function(i){return i.type==='vnt';})[0];
        self._selectedInstance=firstVnt?instKey(firstVnt):null;
        self._activeCtrlTab='info';
        self._activeNetworkCode=null;

        var linkNodes=[
            E('div', {'class':'vnt2-links-title'}, [
                E('span', {'class':'vnt2-links-icon'}, '💡'),
                E('span', {}, 'VNT'),
                E('small', {}, _('Simple and efficient networking tool'))
            ]),
            E('div', {'class':'vnt2-links-list'}, LINKS.map(function(lk) {
                return E('a', {'class':'vnt2-link-pill', 'href':lk[0], 'target':'_blank', 'rel':'noopener'}, lk[1]);
            }))
        ];

        var runCount=instances.filter(function(i){return i.running;}).length;
        var node=E('div',{'class':'cbi-map'},[
            E('h2',{},_('VNT2 Status')),
            self._renderBinaryAlert(binaries),
            E('div',{'class':'cbi-section vnt2-card'},[
                E('div',{'class':'vnt2-row-between'},[
                    E('h3',{'style':'margin:0;'},[
                        E('span',{'data-role':'run-status','class':'vnt2-run-count'},
                            _('%d running').format(runCount)),
                        E('span',{'data-role':'run-total','class':'vnt2-total-count'},
                            _('/ %d total').format(instances.length))
                    ]),
                    E('div',{'class':'vnt2-btn-group'},buildBatchBtns(self))
                ]),
                E('div', {'id':'vnt2-instance-table-wrap'}, self._renderInstanceTable(instances))
            ]),
            E('div',{'class':'cbi-section vnt2-card'},[
                E('h3',{},_('Node Information')),
                self._renderCtrlPanel(instances)
            ]),
            E('div', {'class':'cbi-section vnt2-card vnt2-links-card'}, linkNodes)
        ]);

        if (self._selectedInstance&&instances.some(function(i){
            return instKey(i)===self._selectedInstance&&i.running;
        })) window.setTimeout(function(){self._loadCtrlTab(self._selectedInstance,'info');},300);

        self._pollFn=function(){
            return callListInstances().then(function(r){
                self._refreshRows((r&&Array.isArray(r.instances))?r.instances:[]);
                if (document.getElementById('vnt2-web-expand-row'))
                    return callListWebInstances().then(function(wr){
                        self._refreshWebPanel(wr);
                    }).catch(function(){});
            });
        };
        poll.add(self._pollFn,3);

        return node;
    },

    _renderBinaryAlert: function(binaries) {
        var missing=[];
        BIN_KEYS.forEach(function(p){if (!binaries[p[0]]) missing.push(p[1]);});
        if (!missing.length) return E('span',{});
        return E('div',{'class':'alert-message warning','style':'margin-bottom:16px;'},[
            E('strong',{},'\u26a0 ' + _('Missing binary files:')),
            E('span',{},' '+missing.join(', ')),E('br'),
            E('span',{},_('Please go to')),E('span',{},' '),
            E('a',{'class':'vnt2-breadcrumb-link','href':L.url('admin/vpn/vnt2/settings')},
                _('Settings and Update')),
            E('span',{},' '+_('page to download and install.'))
        ]);
    },

    _renderInstanceTable: function(instances) {
        var self=this;
        if (!instances.length)
            return E('p',{'class':'vnt2-empty'},
                _('No instances, please create one on the Client or Server configuration page first.'));
        var heads=[_('Instance Name'),_('Type'),_('Uptime'),'PID','CPU／RAM',_('Actions'),'Web UI'];
        return E('div',{'class':'vnt2-table-wrap vnt2-table-card'},
            E('table',{'class':'vnt2-table'},[
                E('thead',{},E('tr',{},heads.map(function(h){return E('th',{},h);}))),
                E('tbody',{'id':'vnt2-instance-tbody'},
                    instances.map(function(inst){return self._buildRow(inst);}))
            ])
        );
    },

    _buildRow: function(inst) {
        var self=this, running=!!inst.running, hasWeb=(inst.name==='vnt2_web') || (inst.type==='vnts' && !!(inst.web_addr&&inst.web_addr!==''));
        var rowAttrs={'id':'vnt2-row-'+instKey(inst), 'data-running': running ? '1' : '0', 'data-web': hasWeb ? '1' : '0'};
        if (inst.name === 'vnt2_web') {
            rowAttrs['class']='vnt2-row-clickable';
            rowAttrs['click']=function(ev){
                var t=ev.target;
                if (t && t.closest && t.closest('button,label,input,select,a')) return;
                self._toggleWebPanel();
            };
        }
        return E('tr',rowAttrs,[
            E('td',{'class':'vnt2-col-name'}, inst.name === 'vnt2_web'
                ? E('span',{'class':'vnt2-web-expand-link'},[
                    E('span',{'class':'vnt2-web-arrow','id':'vnt2-web-arrow'}),
                    inst.name
                  ])
                : inst.name),
            E('td',{},typeLabel(inst.type)),
            E('td',{'id':'vnt2-uptime-'+instKey(inst)},running?self._fmt.uptime(inst.uptime):'-'),
            E('td',{'id':'vnt2-pid-'+instKey(inst)},inst.pid||'-'),
            E('td',{'id':'vnt2-res-'+instKey(inst)},running?self._ui.resourceBars(0, inst.mem):'-'),
            E('td',{'id':'vnt2-actions-'+instKey(inst)},self._buildActionBtns(inst)),
            E('td',{'id':'vnt2-web-'+instKey(inst)},self._buildWebBtn(inst,hasWeb))
        ]);
    },

    _buildActionBtns: function(inst) {
        var self=this, running=!!inst.running;
        var wrap=E('div',{'class':'vnt2-btn-group'});
        ACTIONS.forEach(function(act){
            var dis=running!==act.needRunning;
            wrap.appendChild(self._ui.iconButton(act.id, act.label, function(){
                self._doAction(act,inst);
            }, dis));
        });
        return wrap;
    },

    _collapseWebPanel: function() {
        var exp   = document.getElementById('vnt2-web-expand-row');
        var arrow = document.getElementById('vnt2-web-arrow');
        if (exp && exp.parentNode) exp.parentNode.removeChild(exp);
        if (arrow) arrow.classList.remove('open');
    },

    _toggleWebPanel: function() {
        var self  = this;
        var row   = document.getElementById('vnt2-row-web-vnt2_web');
        var exp   = document.getElementById('vnt2-web-expand-row');
        var arrow = document.getElementById('vnt2-web-arrow');
        if (exp) {
            exp.parentNode.removeChild(exp);
            if (arrow) arrow.classList.remove('open');
            return;
        }
        if (!row) return;
        self._restoreWebPanel();
    },

    _restoreWebPanel: function() {
        var self = this;
        var row  = document.getElementById('vnt2-row-web-vnt2_web');
        if (!row || document.getElementById('vnt2-web-expand-row')) return;
        var tr = E('tr', {'id':'vnt2-web-expand-row'},
            E('td', {'colspan':'7','class':'vnt2-web-expand-cell'},
                E('div', {'id':'vnt2-web-expand-body','class':'vnt2-web-expand-body'},
                    E('p', {'class':'vnt2-loading'}, _('Loading...')))));
        if (row.nextSibling) row.parentNode.insertBefore(tr, row.nextSibling);
        else row.parentNode.appendChild(tr);
        var arrow = document.getElementById('vnt2-web-arrow');
        if (arrow) arrow.classList.add('open');
        self._loadWebPanel();
    },

    _loadWebPanel: function() {
        var self = this;
        callListWebInstances().then(function(r) {
            var body = document.getElementById('vnt2-web-expand-body');
            if (!body) return;
            body.innerHTML = '';
            body.appendChild(self._renderWebInstPanel(r));
        }).catch(function(err) {
            var body = document.getElementById('vnt2-web-expand-body');
            if (!body) return;
            body.innerHTML = '';
            body.appendChild(E('p', {'class':'vnt2-empty'}, _('Load failed: %s').format(String(err))));
        });
    },

    _renderWebInstPanel: function(r) {
        var self      = this;
        var available = !!(r && r.web_available === '1');
        var items     = (r && Array.isArray(r.items)) ? r.items : [];
        if (!available)
            return E('p', {'class':'vnt2-empty'}, _('vnt2_web is not running'));
        if (!items.length)
            return E('p', {'class':'vnt2-empty'}, _('No vnt2_web instances'));
        return E('div', {'class':'vnt2-web-inst-grid'},
            items.map(function(it) { return self._webInstCard(it); }));
    },

    _webInstRunning: function(it) {
        return it.running === '1' ? true : (it.running === '0' ? false : null);
    },

    _webInstBtns: function(it) {
        var self    = this;
        var running = it.running === '1';
        var btns = E('div', {'class':'vnt2-web-inst-btns'});
        ACTIONS.forEach(function(act) {
            var dis = (act.id === 'start') ? running : !running;
            btns.appendChild(self._ui.iconButton(act.id, act.label, function() {
                callWebInstanceAction(it.name, act.id).then(function(res) {
                    var ok = res && res.result === 'ok';
                    self._ui.notify(ok
                        ? _('Instance "%s" %s succeeded').format(it.name, act.label)
                        : _('Instance "%s" %s failed: %s').format(it.name, act.label, (res && (res.msg || res.code)) || ''),
                        ok ? 'success' : 'error');
                    if (ok) self._loadWebPanel();
                }).catch(function(err) {
                    self._ui.notify(_('Action failed: %s').format(String(err)), 'error');
                });
            }, dis));
        });
        return btns;
    },

    _webInstCard: function(it) {
        var self = this;
        var name = it.config_name || it.name;
        return E('div', {'class':'vnt2-web-inst-card', 'data-web-file':it.name}, [
            E('div', {'class':'vnt2-web-inst-head'}, [
                E('span', {'class':'vnt2-web-inst-name','title':name}, name),
                self._ui.statusBadge(self._webInstRunning(it))
            ]),
            self._webInstBtns(it)
        ]);
    },

    _refreshWebPanel: function(r) {
        var self      = this;
        var body      = document.getElementById('vnt2-web-expand-body');
        if (!body) return;
        var available = !!(r && r.web_available === '1');
        var items     = (r && Array.isArray(r.items)) ? r.items : [];
        if (!available) {
            var webMain = null;
            (self._instances || []).forEach(function(i) { if (i.name === 'vnt2_web') webMain = i; });
            if (webMain && webMain.running) return;
            body.innerHTML = '';
            body.appendChild(self._renderWebInstPanel(r));
            return;
        }
        if (!items.length) {
            body.innerHTML = '';
            body.appendChild(self._renderWebInstPanel(r));
            return;
        }
        var cards = body.querySelectorAll('.vnt2-web-inst-card');
        var map   = {};
        items.forEach(function(it) { if (it && it.name) map[it.name] = it; });
        var aligned = cards.length === items.length;
        if (aligned) cards.forEach(function(card) {
            if (!map[card.getAttribute('data-web-file')]) aligned = false;
        });
        if (!aligned) {
            body.innerHTML = '';
            body.appendChild(self._renderWebInstPanel(r));
            return;
        }
        items.forEach(function(it) {
            var card = null;
            cards.forEach(function(c) { if (c.getAttribute('data-web-file') === it.name) card = c; });
            if (!card) return;
            var head  = card.querySelector('.vnt2-web-inst-head');
            var badge = head ? head.querySelector('.vnt2-status-badge') : null;
            if (head) {
                var fresh = self._ui.statusBadge(self._webInstRunning(it));
                if (badge) head.replaceChild(fresh, badge);
                else head.appendChild(fresh);
            }
            var btns = card.querySelector('.vnt2-web-inst-btns');
            if (btns) card.replaceChild(self._webInstBtns(it), btns);
        });
    },

    _buildWebBtn: function(inst, hasWeb) {
        var self=this;
        if (inst.name === 'vnt2_web' && inst.running) {
            return self._ui.iconButton('web', _('Enter Web UI'), function() {
                self._web.open();
            }, false);
        }
        if (inst.type === 'vnts' && hasWeb && inst.running) {
            return self._ui.iconButton('web', _('Enter Web UI'), function() {
                var addr = inst.web_addr || '';
                var port = addr.indexOf(':') >= 0 ? addr.split(':').pop() : addr;
                window.open(window.location.protocol + '//' + window.location.hostname + ':' + (port || '80'), '_blank', 'noopener');
            }, false);
        }
        return E('span',{'class':'vnt2-muted-text'},'-');
    },

    _doAction: function(act, inst) {
        var self=this;
        var name=rpcActionName(inst);
        if (name==='vnt2_web'&&(act.id==='restart'||act.id==='stop')) self._collapseWebPanel();
        callInstanceAction(name,act.id,inst.type).then(function(result){
            var ok=act.id==='stop'
                ?result&&(result.result==='ok'||result.result==='not_running')
                :result&&result.result==='ok';
            self._ui.notify(
                ok?_('Instance "%s" %s succeeded').format(name,act.label)
                  :_('Instance "%s" %s failed: %s').format(name,act.label,(result&&result.msg)||_('Unknown error')),
                ok?'success':'error'
            );
            refreshList(self);
        }).catch(function(err){self._ui.notify(_('Action failed: %s').format(String(err)), 'error');});
    },

    _doBatchAction: function(actId) {
        var self=this;
        var act=ACTIONS.filter(function(a){return a.id===actId;})[0];
        if (!act) return;
        if (actId==='restart'||actId==='stop') self._collapseWebPanel();
        callInstanceAction(null,actId).then(function(r){
            var results=(r&&Array.isArray(r.results))?r.results:[];
            if (!results.length&&r&&r.result==='ok'){
                self._ui.notify(_('All %s commands sent').format(act.label),'success');
                refreshList(self); return;
            }
            if (!results.length){
                self._ui.notify(
                    _('No %s instances available for %s').format(
                        act.needRunning?_('running'):_('stopped'),act.label),'error');
                return;
            }
            var failed=results.filter(function(item){return item.result!=='ok';});
            self._ui.notify(
                failed.length
                    ?_('%s partially failed: %s').format(act.label,failed.map(function(item){
                        return '"'+item.name+'"'+(item.msg?': '+item.msg:'');
                    }).join(', '))
                    :_('All %s succeeded (%d total)').format(act.label,results.length),
                failed.length?'error':'success'
            );
            refreshList(self);
        }).catch(function(err){
            self._ui.notify(_('Batch %s failed: %s').format(act.label,String(err)),'error');
        });
    },

    _renderCtrlPanel: function(instances) {
        var self=this;
        var wrap=E('div',{'id':'vnt2-ctrl-panel-wrap'});
        self._syncCtrlPanelDom(wrap,filterCtrlInsts(instances));
        return wrap;
    },

    _syncCtrlPanelDom: function(wrap, ctrlInsts) {
        var self=this;
        if (!ctrlInsts.length) {
            if (!wrap.querySelector('#vnt2-no-inst-tip')) {
                wrap.innerHTML='';
                wrap.appendChild(E('p',{'id':'vnt2-no-inst-tip','class':'vnt2-empty'},
                    _('No running client instances.')));
                self._selectedInstance=null;
            }
            return;
        }
        if (!wrap.querySelector('#vnt2-inst-select')) {
            wrap.innerHTML='';
            if (!ctrlInsts.some(function(i){return instKey(i)===self._selectedInstance;}))
                self._selectedInstance=instKey(ctrlInsts[0]);
            wrap.appendChild(self._buildCtrlPanelContent(ctrlInsts));
            window.setTimeout(function(){
                self._loadCtrlTab(self._selectedInstance,self._activeCtrlTab);
            },100);
            return;
        }
        self._syncInstSelect(ctrlInsts);
    },

    _syncInstSelect: function(ctrlInsts) {
        var self=this, sel=document.getElementById('vnt2-inst-select');
        if (!sel) return;
        var oldNames=[], i;
        for (i=0;i<sel.options.length;i++) oldNames.push(sel.options[i].value);
        var newNames=ctrlInsts.map(function(i){return instKey(i);});
        var changed=oldNames.length!==newNames.length||
            newNames.some(function(n,idx){return n!==oldNames[idx];});
        if (!changed) return;
        if (!ctrlInsts.some(function(i){return instKey(i)===self._selectedInstance;}))
            self._selectedInstance=instKey(ctrlInsts[0]);
        sel.innerHTML='';
        ctrlInsts.forEach(function(inst){
            var opt=document.createElement('option');
            opt.value=instKey(inst);
            opt.textContent=inst.name+' ('+typeLabel(inst.type)+')';
            if (instKey(inst)===self._selectedInstance) opt.selected=true;
            sel.appendChild(opt);
        });
    },

    _buildCtrlPanelContent: function(ctrlInsts) {
        var self=this;
        var selInst=findInstByKey(ctrlInsts,self._selectedInstance);
        var tabs=getCtrlTabs(selInst?selInst.type:'vnt');
        if (!tabs.some(function(t){return t.id===self._activeCtrlTab;}))
            self._activeCtrlTab=tabs[0].id;

        var instSelect=E('select',{
            'id':'vnt2-inst-select','class':'cbi-input-select','style':'width:auto;',
            'change':function(ev){
                self._selectedInstance=ev.target.value;
                self._activeNetworkCode=null;
                var wrap=document.getElementById('vnt2-ctrl-panel-wrap');
                if (wrap){wrap.innerHTML='';wrap.appendChild(self._buildCtrlPanelContent(ctrlInsts));}
                self._loadCtrlTab(self._selectedInstance,self._activeCtrlTab);
            }
        },ctrlInsts.map(function(inst){
            var a={'value':instKey(inst)};
            if (instKey(inst)===self._selectedInstance) a['selected']='selected';
            return E('option',a,inst.name+' ('+typeLabel(inst.type)+')');
        }));

        var tabHeader=E('div',{'class':'vnt2-ctrl-tabs'},
            tabs.map(function(t){
                var on=t.id===self._activeCtrlTab;
                return E('button',{
                    'type':'button',
                    'id':'vnt2-ctrl-tabl-'+t.id,
                    'class':'vnt2-ctrl-tab' + (on ? ' active' : ''),
                    'click':function(){self._switchCtrlTab(t.id);}
                },t.label);
            })
        );

        var tabBody=E('div',{},tabs.map(function(t){
            return E('div',{
                'id':'vnt2-ctrl-tab-'+t.id,
                'style':'display:'+(t.id===self._activeCtrlTab?'block':'none')+';padding:12px 0;'
            },msgP(_('Loading...')));
        }));

        return E('div',{},[
            E('div',{'class':'vnt2-row-flex'},[
                E('label',{},_('Select Instance:')),
                instSelect,
                E('button',{'class':'btn cbi-button-action','click':function(){
                    if (self._selectedInstance)
                        self._loadCtrlTab(self._selectedInstance,self._activeCtrlTab);
                }},_('Refresh'))
            ]),
            tabHeader,tabBody
        ]);
    },

    _switchCtrlTab: function(tid) {
        var self=this;
        self._activeCtrlTab=tid;
        switchTabs('vnt2-ctrl-tabl-','vnt2-ctrl-tab-',tid,function(){
            if (self._selectedInstance) self._loadCtrlTab(self._selectedInstance,tid);
        });
    },

    _renderInfo: function(d) {
        var rows=[
            [_('Name'),d.name],
            [_('Virtual IP'),d.ip?d.ip+(d.prefix_len?'/'+d.prefix_len:''):'-'],
            [_('Gateway'),d.gateway],[_('Status'),d.status],[_('NAT Type'),d.nat_type],
            [_('MTU'),d.mtu],[_('Network Code'),d.network_code],
            [_('Public IPv4'),(d.public_ipv4s&&d.public_ipv4s.length)?d.public_ipv4s.join(', '):null],
            [_('Public IPv6'),d.public_ipv6],[_('Version'),d.version],
            [_('Online'),d.online_client_num||'0'],[_('Offline'),d.offline_client_num||'0'],
        ];
        var feats=[];
        if (d.encrypt)  feats.push(_('Encrypt'));
        if (d.compress) feats.push(_('Compress'));
        if (d.fec)      feats.push('FEC');
        if (d.rtx)      feats.push('RTX');
        rows.push([_('Features'),feats.length?feats.join(' '):'-']);
        var table=buildTable(rows), tbody=table.querySelector('tbody');
        if (d.server_info&&d.server_info.length) {
            tbody.appendChild(E('tr',{},[E('td',{'colspan':'2','class':'vnt2-kv-divider'},_('Servers'))]));
            d.server_info.forEach(function(s){
                tbody.appendChild(E('tr',{},[
                    E('td',{},s.server||'-'),
                    E('td',{},[
                        E('span',{},_('RTT: ')+(s.server_rtt!=null?s.server_rtt+'ms':'-')+'  '),
                        E('span',{'class':s.connected?'vnt2-ok-text':'vnt2-err-text'},
                            s.connected?_('Connected'):_('Disconnected'))
                    ])
                ]));
            });
        }
        return table;
    },

    _renderIps: function(d) {
        return buildTable([
            [_('Virtual IP'),d.ip?d.ip+(d.prefix_len?'/'+d.prefix_len:''):'-'],
            [_('Gateway'),d.gateway||'-'],[_('Device ID'),d.device_id||'-'],
        ]);
    },

    _renderClients: function(peers) {
        if (!peers||!peers.length) return msgP(_('No peer data available'));
        var fmt=this._fmt;
        var rows=peers.map(function(p){
            var loss='-';
            if (p.packet_loss&&p.packet_loss.loss_rate!=null)
                loss=(p.packet_loss.loss_rate*100).toFixed(2)+'%';
            return [p.name||'-',p.ip||'-',makeStatusBadge(p.online?'Online':'Offline'),
                p.version||'-',(p.nat_info&&p.nat_info.nat_type)||'-',
                p.traffic?fmt.bytes(p.traffic.tx_bytes):'-',
                p.traffic?fmt.bytes(p.traffic.rx_bytes):'-',loss];
        });
        return makeTable([_('Name'),_('IP'),_('Status'),_('Version'),
            _('NAT'),_('Upload'),_('Download'),_('Loss Rate')],rows);
    },

    _renderRoute: function(data) {
        if (!data || !data.length) return msgP(_('No route data available'));
        var rows=[];
        data.forEach(function(item) {

            if (Array.isArray(item.routes)) {
                item.routes.forEach(function(r) {
                    rows.push([item.ip||'-',item.ip||'-',r.addr||'-',r.protocol||'-',
                        r.metric!=null?r.metric:'-',r.rtt!=null?r.rtt+'ms':'-']);
                });
                return;
            }

            if (item.route) {
                var r=item.route;
                rows.push([item.name||item.ip||'-',item.ip||'-',r.addr||'-',r.protocol||'-',
                    r.metric!=null?r.metric:'-',r.rtt!=null?r.rtt+'ms':'-']);
            }
        });
        if (!rows.length) return msgP(_('No route info available'));
        return makeTable([_('Node'),_('IP'),_('Address'),_('Protocol'),_('Metric'),_('RTT')],rows);
    },

    _renderVntsInfo: function(networks) {
        if (!networks||!networks.length) return msgP(_('No network data'));
        var self=this;
        var codes=networks.map(function(n){return n.network_code;});
        var activeCode=self._activeNetworkCode;
        if (!activeCode||codes.indexOf(activeCode)<0)
            activeCode=self._activeNetworkCode=codes[0];

        var switchNetTab=function(code){
            self._activeNetworkCode=code;
            switchTabs('vnt2-net-tabl-','vnt2-net-body-',code,function(){
                self._loadNetworkClients(code);
            });
        };

        var subTabBar=E('div',{'class':'vnt2-ctrl-tabs'},
            networks.map(function(net){
                var on=net.network_code===activeCode;
                return E('button',{
                    'type':'button',
                    'id':'vnt2-net-tabl-'+net.network_code,
                    'class':'vnt2-ctrl-tab' + (on ? ' active' : ''),
                    'click':function(){switchNetTab(net.network_code);}
                },net.network_code);
            })
        );

        var srcMap={Config:_('Config'),Manual:_('Manual'),DeviceRegister:_('Device Register')};
        var bodies=E('div',{},networks.map(function(net){
            return E('div',{
                'id':'vnt2-net-body-'+net.network_code,
                'style':'display:'+(net.network_code===activeCode?'block':'none')+';'
            },[
                makeTable(
                    [_('Network'),_('Gateway'),_('Netmask'),_('Lease'),_('Source'),_('Online/Total')],
                    [[net.net,net.gateway,net.netmask,
                      net.lease_duration?net.lease_duration+'s':'-',
                      srcMap[net.source]||net.source||'-',
                      net.online_count+' / '+net.all_count]]
                ),
                E('div',{'id':'vnt2-net-clients-'+net.network_code,'style':'margin-top:12px;'},
                    msgP(_('Loading...')))
            ]);
        }));

        window.setTimeout(function(){self._loadNetworkClients(activeCode);},0);
        return E('div',{},[subTabBar,bodies]);
    },

    _loadNetworkClients: function(networkCode) {
        var self=this, el=document.getElementById('vnt2-net-clients-'+networkCode);
        if (!el) return;
        var fmt=self._fmt;
        el.innerHTML='';
        el.appendChild(msgP(_('Loading...')));
        var nInst=findInstByKey(self._instances||[],self._selectedInstance);
        callGetCtrlInfo(nInst?nInst.name:self._selectedInstance,'clients',networkCode,nInst?nInst.type:null).then(function(r){
            el.innerHTML='';
            if (!r||r.error||!r.data){el.appendChild(msgP(_('No data available')));return;}
            if (!r.data.length){el.appendChild(msgP(_('No devices in this network')));return;}
            var rows=r.data.map(function(dev){
                return [dev.device_name||'-',dev.ip||'-',makeStatusBadge(dev.status),
                    dev.device_version||'-',dev.latency_ms!=null?dev.latency_ms+'ms':'-',
                    fmt.bytes(dev.tx_bytes),fmt.bytes(dev.rx_bytes),dev.last_connect_time||'-'];
            });
            el.appendChild(makeTable([_('Name'),_('IP'),_('Status'),_('Version'),
                _('Latency'),_('Upload'),_('Download'),_('Last Connect')],rows));
        }).catch(function(){
            el.innerHTML='';
            el.appendChild(msgP(_('Load failed'),true));
        });
    },

    _renderVntsServers: function(data) {
        var wrap=E('div',{});
        var makeGroup=function(title,servers){
            wrap.appendChild(E('div',{'style':'margin-bottom:16px;'},[
                E('div',{'class':'vnt2-bold','style':'font-size:13px;margin-bottom:6px;'},title),
                makeTable([_('Address'),_('Status'),_('Latency')],
                    servers.map(function(s){
                        return [s.addr||'-',makeStatusBadge(s.connected?'Online':'Offline'),
                            s.latency_ms!=null?s.latency_ms+'ms':'-'];
                    })
                )
            ]));
        };
        makeGroup(_('Outbound Servers')+' '+((data&&data.outbound)?data.outbound.length:0), (data&&data.outbound)||[]);
        makeGroup(_('Inbound Servers') +' '+((data&&data.inbound) ?data.inbound.length :0), (data&&data.inbound) ||[]);
        return wrap;
    },

    _loadCtrlTab: function(key, cmd) {
        var self=this, el=document.getElementById('vnt2-ctrl-tab-'+cmd);
        if (!el) return;
        var setMsg=function(msg,isError){
            el.innerHTML='';
            el.appendChild(msgP(msg,isError));
        };
        var inst=findInstByKey(self._instances||[],key);
        var instName=inst?inst.name:key;
        var instType=inst?inst.type:'vnt';

        var doLoad=function(retryLeft){
            setMsg(_('Loading...'));
            callGetCtrlInfo(instName,cmd,null,inst?inst.type:null).then(function(r){
                el.innerHTML='';
                if (!r||r.error){
                    if (retryLeft>0){setMsg(_('Retrying...'));window.setTimeout(function(){doLoad(retryLeft-1);},600);return;}
                    setMsg(r&&r.error?_(r.error):_('No data available'));
                    return;
                }
                if (r.text!==undefined){
                    var cleanText = self._fmt.stripAnsi(r.text);
                    el.appendChild(cleanText?wrapContent('pre',cleanText):msgP(_('No data available')));
                    return;
                }
                var d=r.data;
                if (d==null){setMsg(_('No data available'));return;}
                var fn=getRenderer(self,instType,cmd);
                if (fn) el.appendChild(wrapContent('div',fn(d)));
            }).catch(function(){
                if (retryLeft>0){setMsg(_('Retrying...'));window.setTimeout(function(){doLoad(retryLeft-1);},600);return;}
                setMsg(_('Load failed'),true);
            });
        };
        doLoad(instType==='vnts'?1:0);
    },

    _refreshRows: function(instances) {
        var self=this;
        self._instances=instances;
        var tableWrap=document.getElementById('vnt2-instance-table-wrap');
        var rows=document.querySelectorAll('#vnt2-instance-tbody tr:not(#vnt2-web-expand-row)');
        var needsRebuild=!document.getElementById('vnt2-instance-tbody') || rows.length!==instances.length;
        if (!needsRebuild) {
            for (var ri=0; ri<instances.length; ri++) {
                if (!document.getElementById('vnt2-row-'+instKey(instances[ri]))) { needsRebuild=true; break; }
            }
        }
        if (needsRebuild && tableWrap) {
            var wasExpanded=!!document.getElementById('vnt2-web-expand-row');
            tableWrap.innerHTML='';
            tableWrap.appendChild(self._renderInstanceTable(instances));
            if (wasExpanded) self._restoreWebPanel();
        }
        instances.forEach(function(inst){
            var running=!!inst.running;
            var hasWeb=(inst.name==='vnt2_web') || (inst.type==='vnts' && !!(inst.web_addr&&inst.web_addr!==''));
            var row=document.getElementById('vnt2-row-'+instKey(inst));
            if (!row) return;
            var stateChanged = row.getAttribute('data-running') !== (running ? '1' : '0') ||
                row.getAttribute('data-web') !== (hasWeb ? '1' : '0');

            row.setAttribute('data-running', running ? '1' : '0');
            row.setAttribute('data-web', hasWeb ? '1' : '0');
            var els=getInstEls(instKey(inst));
            if (els.uptime) els.uptime.textContent=running?self._fmt.uptime(inst.uptime):'-';
            if (els.pid)    els.pid.textContent=inst.pid||'-';
            if (els.res){
                if (!running){els.res.textContent='-';delete _lastTicks[instKey(inst)];}
                else {
                    var mem=inst.mem, el=els.res;
                    self._ui.updateResourceBars(el, null, mem);
                    fetchCpuAsync(inst,function(cpu){
                        if (!self._destroyed) self._ui.updateResourceBars(el, cpu, mem);
                    });
                }
            }
            if (stateChanged && els.actions){els.actions.innerHTML='';els.actions.appendChild(self._buildActionBtns(inst));}
            if (stateChanged && els.web){els.web.innerHTML='';els.web.appendChild(self._buildWebBtn(inst,hasWeb));}
        });
        var runCount=instances.filter(function(i){return i.running;}).length;
        var statusEl=document.querySelector('[data-role="run-status"]');
        var totalEl=document.querySelector('[data-role="run-total"]');
        if (statusEl) statusEl.textContent=_('%d running').format(runCount);
        if (totalEl)  totalEl.textContent=_('/ %d total').format(instances.length);
        var wrap=document.getElementById('vnt2-ctrl-panel-wrap');
        if (wrap) self._syncCtrlPanelDom(wrap,filterCtrlInsts(instances));
    },

    destroy: function() {
        this._destroyed=true;
        _lastTicks={};
        if (this._pollFn) poll.remove(this._pollFn);
    }
});


