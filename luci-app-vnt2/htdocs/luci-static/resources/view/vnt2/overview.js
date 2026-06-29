'use strict';
'require view';
'require poll';
'require rpc';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callCheckBinaries  = rpcDeclare('check_binaries',  []);
var callListInstances  = rpcDeclare('list_instances',  []);
var callInstanceAction = rpcDeclare('instance_action', ['name','action']);
var callGetCtrlInfo    = rpcDeclare('get_ctrl_info',   ['name','cmd','network_code']);
var callGetCpuTicks    = rpcDeclare('get_cpu_ticks',   ['name']);

var COLORS = { ok:'#28a745', err:'#dc3545', blue:'#3498db', gray:'#666', light:'#888' };

var BIN_KEYS = [
    ['vnt2_cli','vnt2_cli'],['vnt2_web','vnt2_web'],
    ['vnt2_ctrl','vnt2_ctrl'],['vnts2','vnts2'],
];

var LINKS = [
    ['http://rustvnt.com',                         _('Official Website')],
    ['https://github.com/vnt-dev/vnt',             'GitHub'],
    ['https://github.com/luojiang419/VNTC2.0-APP', 'GUIApp'],
    ['https://github.com/whzhni1/luci-app-vnt2',   'Luci'],
];

var ACTIONS = [
    { id:'start',   label:_('Start'),   needRunning:false },
    { id:'restart', label:_('Restart'), needRunning:true  },
    { id:'stop',    label:_('Stop'),    needRunning:true, color:COLORS.err },
];

var _lastTicks = {};

function runningColor(r) { return r ? COLORS.ok : COLORS.err; }

function typeLabel(type) { return type === 'vnts' ? _('Server') : _('Client'); }

function findInst(list, name) {
    for (var i=0; i<list.length; i++) if (list[i].name===name) return list[i];
    return null;
}

function filterCtrlInsts(instances) {
    return instances.filter(function(i) {
        if (!i.running) return false;
        if (i.type==='vnt')  return true;
        if (i.type==='vnts') return !!(i.web_addr && i.web_addr!=='');
        return false;
    });
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
        var on = el.id === tabPfx+activeId;
        el.style.borderBottom = on ? '2px solid '+COLORS.blue : '2px solid transparent';
        el.style.color = on ? COLORS.blue : COLORS.gray;
    });
    document.querySelectorAll('[id^="'+bodyPfx+'"]').forEach(function(el) {
        el.style.display = el.id===bodyPfx+activeId ? 'block' : 'none';
    });
    if (onSwitch) onSwitch(activeId);
}

function msgP(text, color, italic) {
    return E('p', {'style':'color:'+(color||COLORS.light)+';'+(italic?'font-style:italic;':'')}, text);
}

function fmtBytes(b) {
    b = parseInt(b)||0;
    if (b<=0) return '0 B';
    var u=['B','KB','MB','GB'], i=0;
    while (b>=1024&&i<3){b/=1024;i++;}
    return b.toFixed(2)+' '+u[i];
}

function formatUptime(s) {
    s = parseInt(s)||0;
    if (s<=0) return '-';
    var d=Math.floor(s/86400), h=Math.floor(s%86400/3600),
        m=Math.floor(s%3600/60), parts=[];
    if (d>0) parts.push(d+_('d'));
    if (h>0) parts.push(h+_('h'));
    if (m>0) parts.push(m+_('m'));
    parts.push(s%60+_('s'));
    return parts.join('');
}

function wrapContent(tag, content) {
    return E('div', {
        'style': [
            'border:1px solid #ddd', 'border-radius:4px',
            'max-height:300px', 'overflow-y:auto', 'overflow-x:auto',
            '-webkit-overflow-scrolling:touch', 'box-sizing:border-box',
            'width:100%', 'max-width:100%'
        ].join(';')
    }, [E(tag, {
        'style': [
            'padding:12px', 'margin:0', 'font-size:12px', 'line-height:1.6',
            'display:inline-block', 'min-width:100%', 'box-sizing:border-box',
            tag === 'pre' ? 'white-space:pre;word-break:normal' : ''
        ].filter(Boolean).join(';')
    }, content)]);
}

function buildTable(rows, tdStyle) {
    tdStyle = tdStyle||'font-weight:bold;padding:3px 12px 3px 0;white-space:nowrap;';
    return E('table',{'style':'font-size:13px;border-collapse:collapse;'},
        E('tbody',{},rows.map(function(row){
            return E('tr',{},[
                E('td',{'style':tdStyle},row[0]),
                E('td',{},String(row[1]!=null?row[1]:'-'))
            ]);
        }))
    );
}

function makeStatusBadge(status) {
    var map = {
        Online:{label:_('Online'),color:COLORS.ok},
        Offline:{label:_('Offline'),color:COLORS.err},
        Remote:{label:_('Remote'),color:'#007bff'},
        running:{label:_('Running'),color:COLORS.ok},
    };
    var s = map[status]||{label:status||'-',color:COLORS.light};
    return E('span',{'style':
        'display:inline-block;padding:1px 8px;border-radius:10px;'+
        'font-size:11px;font-weight:bold;color:#fff;background:'+s.color+';'
    },s.label);
}

function makeTable(heads, rows) {
    var th='padding:6px 10px;text-align:center;font-size:12px;white-space:nowrap;font-weight:bold;';
    var td='padding:5px 10px;font-size:12px;white-space:nowrap;vertical-align:middle;text-align:center;';
    return E('div',{'style':'width:100%;overflow-x:auto;'},
        E('table',{'style':'width:100%;border-collapse:collapse;min-width:400px;'},[
            E('thead',{},E('tr',{},heads.map(function(h){return E('th',{'style':th},h);}))),
            E('tbody',{},rows.length
                ? rows.map(function(row){
                    return E('tr',{},row.map(function(cell){
                        return E('td',{'style':td},(cell instanceof Node)?cell:String(cell!=null?cell:'-'));
                    }));
                })
                : [E('tr',{},[E('td',{'colspan':String(heads.length),'style':td+'color:#aaa;'},_('No data'))])]
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
    callGetCpuTicks(inst.name).then(function(r) {
        if (!r||!r.alive) return;
        var last=_lastTicks[inst.name];
        _lastTicks[inst.name]={proc:r.proc,total:r.total};
        if (!last) return;
        var dp=r.proc-last.proc, dt=r.total-last.total;
        onResult(dt>0?(dp/dt*100).toFixed(1):'0.0');
    }).catch(function(){});
}

function buildBatchBtns(self) {
    return [E('span',{'style':'font-size:20px;font-weight:bold;line-height:1;display:inline-flex;align-items:center;'},_('All'))]
        .concat(ACTIONS.map(function(act){
            return E('button',{
                'class':'btn cbi-button-action',
                'style':'padding:3px 10px;font-size:12px;'+(act.color?'color:'+act.color+';border-color:'+act.color+';':''),
                'click':function(){self._doBatchAction(act.id);}
            },act.label);
        }));
}

return view.extend({
    load: function() {
        return Promise.all([L.require('vnt2.common'),callCheckBinaries(),callListInstances()]);
    },

    render: function(data) {
        var self=this;
        self._destroyed=false;
        _lastTicks={};
        self._ui=data[0].VNT2UI;
        var binaries=data[1]||{};
        var instances=(data[2]&&Array.isArray(data[2].instances))?data[2].instances:[];
        self._instances=instances;

        instances.forEach(function(inst){
            if (!inst.running) return;
            callGetCpuTicks(inst.name).then(function(r){
                if (r&&r.alive) _lastTicks[inst.name]={proc:r.proc,total:r.total};
            }).catch(function(){});
        });

        var firstVnt=instances.filter(function(i){return i.type==='vnt';})[0];
        self._selectedInstance=firstVnt?firstVnt.name:null;
        self._activeCtrlTab='info';
        self._activeNetworkCode=null;

        var linkNodes=[E('span',{},'💡 '),E('b',{},'VNT'),
            E('span',{},' - '+_('Simple and efficient networking tool')+' | ')];
        LINKS.forEach(function(lk,i){
            if (i>0) linkNodes.push(E('span',{},' | '));
            linkNodes.push(E('a',{'href':lk[0],'target':'_blank'},lk[1]));
        });

        var runCount=instances.filter(function(i){return i.running;}).length;
        var node=E('div',{'class':'cbi-map'},[
            E('h2',{},_('VNT2 Status')),
            self._renderBinaryAlert(binaries),
            E('div',{'class':'cbi-section'},[
                E('div',{'style':'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;'},[
                    E('h3',{'style':'margin:0;'},[
                        E('span',{'data-role':'run-status','style':'font-size:13px;font-weight:normal;color:'+COLORS.ok+';'},
                            _('%d running').format(runCount)),
                        E('span',{'data-role':'run-total','style':'font-size:13px;font-weight:normal;color:#aaa;'},
                            _('/ %d total').format(instances.length))
                    ]),
                    E('div',{'style':'display:flex;gap:6px;'},buildBatchBtns(self))
                ]),
                self._renderInstanceTable(instances)
            ]),
            E('div',{'class':'cbi-section'},[
                E('h3',{},_('Node Information')),
                self._renderCtrlPanel(instances)
            ]),
            E('div', {'style': 'text-align:center;padding:12px;margin-top:16px;border-radius:8px;' +
                 'outline:1px solid #ddd;font-size:13px;color:#666;margin-bottom:60px;' +
                 'box-sizing:border-box;width:100%;max-width:100%;' +
                 'overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;'
            }, linkNodes)
        ]);

        if (self._selectedInstance&&instances.some(function(i){
            return i.name===self._selectedInstance&&i.running;
        })) window.setTimeout(function(){self._loadCtrlTab(self._selectedInstance,'info');},300);

        self._pollFn=function(){
            return callListInstances().then(function(r){
                self._refreshRows((r&&Array.isArray(r.instances))?r.instances:[]);
            });
        };
        poll.add(self._pollFn,3);

        window.setTimeout(function(){
            var el=document.querySelector('.cbi-page-actions');
            if (el) el.style.display='none';
        },0);
        return node;
    },

    _renderBinaryAlert: function(binaries) {
        var missing=[];
        BIN_KEYS.forEach(function(p){if (!binaries[p[0]]) missing.push(p[1]);});
        if (!missing.length) return E('span',{});
        return E('div',{'class':'alert-message warning','style':'margin-bottom:16px;'},[
            E('strong',{},'⚠ '+_('Missing binary files:')),
            E('span',{},' '+missing.join(', ')),E('br'),
            E('span',{},_('Please go to')),E('span',{},' '),
            E('a',{'href':L.url('admin/vpn/vnt2/settings'),'style':'text-decoration:underline;color:#0069d9;'},
                _('Settings and Update')),
            E('span',{},' '+_('page to download and install.'))
        ]);
    },

    _renderInstanceTable: function(instances) {
        var self=this;
        if (!instances.length)
            return E('p',{'style':'color:#888;'},
                _('No instances, please create one on the Client or Server configuration page first.'));
        var th='padding:8px 12px;text-align:center;white-space:nowrap;';
        var heads=[_('Instance Name'),_('Type'),_('Uptime'),'PID','CPU／RAM',_('Actions'),'Web UI'];
        return E('div',{'class':'vnt2-table-wrap','style':
                'width:100%;max-width:100%;box-sizing:border-box;display:block;overflow-x:auto;'+
                '-webkit-overflow-scrolling:touch;border:1px solid #ddd;border-radius:8px;'},
            E('table',{'class':'vnt2-table','style':
                    'width:100%;min-width:480px;border-collapse:collapse;border-spacing:0;box-sizing:border-box;'},[
                E('thead',{},E('tr',{},heads.map(function(h){return E('th',{'style':th},h);}))),
                E('tbody',{'id':'vnt2-instance-tbody'},
                    instances.map(function(inst){return self._buildRow(inst);}))
            ])
        );
    },

    _buildRow: function(inst) {
        var self=this, running=!!inst.running, hasWeb=!!(inst.web_addr&&inst.web_addr!=='');
        var td='padding:8px 12px;text-align:center;vertical-align:middle;white-space:nowrap;color:'+runningColor(running)+';';
        return E('tr',{'id':'vnt2-row-'+inst.name},[
            E('td',{'class':'vnt2-col-name','style':td},inst.name),
            E('td',{'style':td},typeLabel(inst.type)),
            E('td',{'id':'vnt2-uptime-'+inst.name,'style':td},running?formatUptime(inst.uptime):'-'),
            E('td',{'id':'vnt2-pid-'+inst.name,'style':td},inst.pid||'-'),
            E('td',{'id':'vnt2-res-'+inst.name,'style':td},running?'-／'+inst.mem+'M':'-'),
            E('td',{'id':'vnt2-actions-'+inst.name,'style':td},self._buildActionBtns(inst)),
            E('td',{'id':'vnt2-web-'+inst.name,'style':td},self._buildWebBtn(inst,hasWeb))
        ]);
    },

    _buildActionBtns: function(inst) {
        var self=this, running=!!inst.running;
        var wrap=E('div',{'style':'display:flex;flex-wrap:nowrap;gap:4px;justify-content:center;align-items:center;'});
        ACTIONS.forEach(function(act){
            var dis=running!==act.needRunning;
            wrap.appendChild(E('button',{
                'class':'btn cbi-button'+(dis?'':'-action'),
                'disabled':dis?'disabled':null,
                'style':'padding:2px 6px;font-size:11px;white-space:nowrap;'+
                    (act.color&&!dis?'color:'+act.color+';border-color:'+act.color+';':''),
                'click':function(){if (!dis) self._doAction(act,inst.name);}
            },act.label));
        });
        return wrap;
    },

    _buildWebBtn: function(inst, hasWeb) {
        if (hasWeb&&inst.running) {
            var port=inst.web_addr.split(':')[1]||'80';
            return E('a',{
                'href':window.location.protocol+'//'+window.location.hostname+':'+port,
                'target':'_blank','style':'font-size:18px;text-decoration:none;',
                'title':_('Enter Web UI')
            },'🌐 ');
        }
        return E('span',{'style':'color:#ccc;'},'-');
    },

    _doAction: function(act, name) {
        var self=this;
        callInstanceAction(name,act.id).then(function(result){
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
                wrap.appendChild(E('p',{'id':'vnt2-no-inst-tip','style':'color:#888;'},
                    _('No running client instances.')));
                self._selectedInstance=null;
            }
            return;
        }
        if (!wrap.querySelector('#vnt2-inst-select')) {
            wrap.innerHTML='';
            if (!ctrlInsts.some(function(i){return i.name===self._selectedInstance;}))
                self._selectedInstance=ctrlInsts[0].name;
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
        var newNames=ctrlInsts.map(function(i){return i.name;});
        var changed=oldNames.length!==newNames.length||
            newNames.some(function(n,idx){return n!==oldNames[idx];});
        if (!changed) return;
        if (!ctrlInsts.some(function(i){return i.name===self._selectedInstance;}))
            self._selectedInstance=ctrlInsts[0].name;
        sel.innerHTML='';
        ctrlInsts.forEach(function(inst){
            var opt=document.createElement('option');
            opt.value=inst.name;
            opt.textContent=inst.name+' ('+typeLabel(inst.type)+')';
            if (inst.name===self._selectedInstance) opt.selected=true;
            sel.appendChild(opt);
        });
    },

    _buildCtrlPanelContent: function(ctrlInsts) {
        var self=this;
        var selInst=findInst(ctrlInsts,self._selectedInstance);
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
            var a={'value':inst.name};
            if (inst.name===self._selectedInstance) a['selected']='selected';
            return E('option',a,inst.name+' ('+typeLabel(inst.type)+')');
        }));

        var tabHeader=E('div',{'style':'display:flex;border-bottom:2px solid #ddd;margin-top:12px;'},
            tabs.map(function(t){
                var on=t.id===self._activeCtrlTab;
                return E('div',{
                    'id':'vnt2-ctrl-tabl-'+t.id,
                    'style':'padding:6px 18px;cursor:pointer;font-size:13px;margin-bottom:-2px;'+
                        'border-bottom:'+(on?'2px solid '+COLORS.blue:'2px solid transparent')+';'+
                        'color:'+(on?COLORS.blue:COLORS.gray)+';',
                    'click':function(){self._switchCtrlTab(t.id);}
                },t.label);
            })
        );

        var tabBody=E('div',{},tabs.map(function(t){
            return E('div',{
                'id':'vnt2-ctrl-tab-'+t.id,
                'style':'display:'+(t.id===self._activeCtrlTab?'block':'none')+';padding:12px 0;'
            },msgP(_('Loading...'),COLORS.light,true));
        }));

        return E('div',{},[
            E('div',{'style':'display:flex;align-items:center;gap:8px;'},[
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
            tbody.appendChild(E('tr',{},[E('td',{'colspan':'2','style':'padding-top:8px;font-weight:bold;'},_('── Servers ──'))]));
            d.server_info.forEach(function(s){
                tbody.appendChild(E('tr',{},[
                    E('td',{'style':'padding:2px 12px 2px 0;'},s.server||'-'),
                    E('td',{},[
                        E('span',{},_('RTT: ')+(s.server_rtt!=null?s.server_rtt+'ms':'-')+'  '),
                        E('span',{'style':'color:'+(s.connected?COLORS.ok:COLORS.err)+';'},
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
        var rows=peers.map(function(p){
            var loss='-';
            if (p.packet_loss&&p.packet_loss.loss_rate!=null)
                loss=(p.packet_loss.loss_rate*100).toFixed(2)+'%';
            return [p.name||'-',p.ip||'-',makeStatusBadge(p.online?'Online':'Offline'),
                p.version||'-',(p.nat_info&&p.nat_info.nat_type)||'-',
                p.traffic?fmtBytes(p.traffic.tx_bytes):'-',
                p.traffic?fmtBytes(p.traffic.rx_bytes):'-',loss];
        });
        return makeTable([_('Name'),_('IP'),_('Status'),_('Version'),
            _('NAT'),_('Upload'),_('Download'),_('Loss Rate')],rows);
    },

    _renderRoute: function(peers) {
        if (!peers||!peers.length) return msgP(_('No route data available'));
        if (!peers.some(function(p){return p.route;})) return msgP(_('No route info available'));
        var rows=[];
        peers.forEach(function(p){
            if (!p.route) return;
            var r=p.route;
            rows.push([p.name||p.ip||'-',p.ip||'-',r.addr||'-',r.protocol||'-',
                r.metric!=null?r.metric:'-',r.rtt!=null?r.rtt+'ms':'-']);
        });
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

        var subTabBar=E('div',{'style':'display:flex;border-bottom:2px solid #ddd;margin-bottom:12px;'},
            networks.map(function(net){
                var on=net.network_code===activeCode;
                return E('div',{
                    'id':'vnt2-net-tabl-'+net.network_code,
                    'style':'padding:6px 18px;cursor:pointer;font-size:13px;margin-bottom:-2px;'+
                        'border-bottom:'+(on?'2px solid '+COLORS.blue:'2px solid transparent')+';'+
                        'color:'+(on?COLORS.blue:COLORS.gray)+';',
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
                    msgP(_('Loading...'),COLORS.light,true))
            ]);
        }));

        window.setTimeout(function(){self._loadNetworkClients(activeCode);},0);
        return E('div',{},[subTabBar,bodies]);
    },

    _loadNetworkClients: function(networkCode) {
        var self=this, el=document.getElementById('vnt2-net-clients-'+networkCode);
        if (!el) return;
        el.innerHTML='';
        el.appendChild(msgP(_('Loading...'),COLORS.light,true));
        callGetCtrlInfo(self._selectedInstance,'clients',networkCode).then(function(r){
            el.innerHTML='';
            if (!r||r.error||!r.data){el.appendChild(msgP(_('No data available')));return;}
            if (!r.data.length){el.appendChild(msgP(_('No devices in this network')));return;}
            var rows=r.data.map(function(dev){
                return [dev.device_name||'-',dev.ip||'-',makeStatusBadge(dev.status),
                    dev.device_version||'-',dev.latency_ms!=null?dev.latency_ms+'ms':'-',
                    fmtBytes(dev.tx_bytes),fmtBytes(dev.rx_bytes),dev.last_connect_time||'-'];
            });
            el.appendChild(makeTable([_('Name'),_('IP'),_('Status'),_('Version'),
                _('Latency'),_('Upload'),_('Download'),_('Last Connect')],rows));
        }).catch(function(){
            el.innerHTML='';
            el.appendChild(msgP(_('Load failed'),'#e00'));
        });
    },

    _renderVntsServers: function(data) {
        var wrap=E('div',{});
        var makeGroup=function(title,servers){
            wrap.appendChild(E('div',{'style':'margin-bottom:16px;'},[
                E('div',{'style':'font-weight:bold;font-size:13px;margin-bottom:6px;color:#555;'},title),
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

    _loadCtrlTab: function(name, cmd) {
        var self=this, el=document.getElementById('vnt2-ctrl-tab-'+cmd);
        if (!el) return;
        var setMsg=function(msg,color){
            el.innerHTML='';
            el.appendChild(msgP(msg,color,!color));
        };
        var inst=findInst(self._instances||[],name);
        var instType=inst?inst.type:'vnt';

        var doLoad=function(retryLeft){
            setMsg(_('Loading...'));
            callGetCtrlInfo(name,cmd,null).then(function(r){
                el.innerHTML='';
                if (!r||r.error){
                    if (retryLeft>0){setMsg(_('Retrying...'));window.setTimeout(function(){doLoad(retryLeft-1);},600);return;}
                    setMsg(r&&r.error?_(r.error):_('No data available'));
                    return;
                }
                if (r.text!==undefined){
                    el.appendChild(r.text?wrapContent('pre',r.text):msgP(_('No data available')));
                    return;
                }
                var d=r.data;
                if (d==null){setMsg(_('No data available'));return;}
                var fn=getRenderer(self,instType,cmd);
                if (fn) el.appendChild(wrapContent('div',fn(d)));
            }).catch(function(){
                if (retryLeft>0){setMsg(_('Retrying...'));window.setTimeout(function(){doLoad(retryLeft-1);},600);return;}
                setMsg(_('Load failed'),'#e00');
            });
        };
        doLoad(instType==='vnts'?1:0);
    },

    _refreshRows: function(instances) {
        var self=this;
        instances.forEach(function(inst){
            var running=!!inst.running, color=runningColor(running);
            var hasWeb=!!(inst.web_addr&&inst.web_addr!=='');
            var row=document.getElementById('vnt2-row-'+inst.name);
            if (!row) return;
            row.querySelectorAll('td').forEach(function(td){td.style.color=color;});
            var els=getInstEls(inst.name);
            if (els.uptime) els.uptime.textContent=running?formatUptime(inst.uptime):'-';
            if (els.pid)    els.pid.textContent=inst.pid||'-';
            if (els.res){
                if (!running){els.res.textContent='-';delete _lastTicks[inst.name];}
                else {
                    var mem=inst.mem, el=els.res;
                    fetchCpuAsync(inst,function(cpu){
                        if (!self._destroyed) el.textContent=cpu+'%／'+mem+'M';
                    });
                }
            }
            if (els.actions){els.actions.innerHTML='';els.actions.appendChild(self._buildActionBtns(inst));}
            if (els.web){els.web.innerHTML='';els.web.appendChild(self._buildWebBtn(inst,hasWeb));}
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