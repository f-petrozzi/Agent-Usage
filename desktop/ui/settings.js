'use strict';
const api=window.agentUsage, $=id=>document.getElementById(id);
let flags={},slots=[],accounts=[],glyphs={};
function error(e){$('strip').hidden=false;$('strip').textContent=String(e.message||e);}
async function call(cmd,args){try{return await api.invoke(cmd,args);}catch(e){error(e);throw e;}}
function action(fn){return ()=>Promise.resolve().then(fn).catch(()=>{});}
function selected(id,value){for(const b of $(id).querySelectorAll('button')){b.classList.toggle('on',b.dataset.v===String(value));b.setAttribute('aria-pressed',b.dataset.v===String(value));}}
function toggle(id,on){$(id).classList.toggle('on',on);$(id).setAttribute('aria-checked',String(on));}
function renderFlags(v){flags=v;selected('seg-show',!v.notch_visible?'hide':v.notch_on_hover?'hover':'show');selected('seg-tray',v.tray_visible?'tray':'none');$('cap-show').textContent='Pinning lasts until you hide or quit. Every launch starts invisible.';$('cap-tray').textContent='With no tray icon, reopen Agent Usage from Start to reveal it.';}
function renderAccounts(){
  const parent=$('acc-on');parent.replaceChildren();
  const enabled=slots.length?slots.map(s=>s.provider):accounts.map(a=>a.id);
  for(const a of accounts){
    const row=document.createElement('div');row.className='acct';
    const label=document.createElement('div');label.className='acct-line';label.textContent=a.name;
    const button=document.createElement('button');button.className='switch'+(enabled.includes(a.id)?' on':'');button.setAttribute('role','switch');button.setAttribute('aria-label',a.name);button.setAttribute('aria-checked',enabled.includes(a.id));
    button.onclick=action(async()=>{const next=enabled.includes(a.id)?enabled.filter(id=>id!==a.id):[...enabled,a.id];if(!next.length)return;slots=await call('set_notch_slots',{slots:next.length===accounts.length?[]:next.map(provider=>({provider}))});renderAccounts();});
    label.append(button);row.append(label);
    const detail=document.createElement('div');detail.className='acct-detail';detail.textContent=[a.snap.status,a.snap.note].filter(Boolean).join(' · ');row.append(detail);parent.append(row);
  }
}
for(const tab of ['accounts','appearance','general']) $('tab-'+tab).onclick=()=>{
  for(const name of ['accounts','appearance','general']){$('pane-'+name).hidden=name!==tab;$('tab-'+name).setAttribute('aria-selected',name===tab);$('tab-'+name).classList.toggle('sel',name===tab);$('tab-'+name).tabIndex=name===tab?0:-1;}
  $('title').textContent=tab[0].toUpperCase()+tab.slice(1);
};
const initialTab=new URLSearchParams(location.search).get('tab');
$('tab-'+(['accounts','appearance','general'].includes(initialTab)?initialTab:'accounts')).click();
api.on('settings_tab',tab=>{if(['accounts','appearance','general'].includes(tab))$('tab-'+tab).click();});
$('close').onclick=action(()=>call('close_settings'));
$('quit').onclick=action(()=>call('quit_app'));
$('btn-data').onclick=action(()=>call('open_data_dir'));
$('author').onclick=action(()=>call('open_author_page'));
$('btn-recentre').onclick=action(()=>call('reset_notch_position'));
$('save-collector').onclick=action(async()=>{await call('set_collector',{source:$('source').value,sshTarget:$('ssh').value.trim()});$('strip').hidden=false;$('strip').textContent='Collector saved; refreshing…';});
$('shortcut').onchange=action(async()=>{try{await call('set_shortcut',{shortcut:$('shortcut').value});}finally{const c=await call('get_collector');$('shortcut').value=c.shortcut;}});
$('seg-show').onclick=event=>{const b=event.target.closest('button');if(!b)return;action(async()=>renderFlags(await call('set_ui_flags',{notchVisible:b.dataset.v!=='hide',notchOnHover:b.dataset.v!=='show'})))();};
$('seg-tray').onclick=event=>{const b=event.target.closest('button');if(b)action(async()=>renderFlags(await call('set_ui_flags',{trayVisible:b.dataset.v==='tray'})))();};
for(const [id,get,set,key] of [['seg-size','get_scale','set_scale','scale'],['seg-theme','get_theme','set_theme','theme'],['seg-weekly','get_weekly_ring','set_weekly_ring','placement'],['seg-transition','get_color_transition','set_color_transition','style'],['seg-edge','get_notch_edge','set_notch_edge','edge']]){
  action(async()=>selected(id,await call(get)))();
  $(id).onclick=e=>{const b=e.target.closest('button');if(b)action(async()=>{selected(id,await call(set,{[key]:key==='scale'?Number(b.dataset.v):b.dataset.v}));})()};
}
for(const [id,get,set] of [['sw-autostart','get_autostart','set_autostart'],['sw-move','get_move_handle','set_move_handle']]){
  action(async()=>toggle(id,await call(get)))();
  $(id).onclick=action(async()=>toggle(id,await call(set,{on:!$(id).classList.contains('on')})));
}
$('screen').onchange=action(()=>call('set_notch_monitor',{id:$('screen').value}));
api.on('ui_flags',renderFlags);
api.on('agent_accounts',v=>{accounts=v;renderAccounts();});
api.on('theme_resolved',v=>document.documentElement.dataset.theme=v);
action(async()=>{
  const c=await call('get_collector');$('source').value=c.source;$('ssh').value=c.sshTarget;$('shortcut').value=c.shortcut;if(c.error)error(c.error);
  slots=await call('get_notch_slots');accounts=await call('get_agent_accounts');renderAccounts();renderFlags(await call('get_ui_flags'));
  document.documentElement.dataset.theme=await call('get_theme_resolved');$('about-version').textContent=await call('get_version');
  const monitors=await call('get_monitors');$('row-screen').hidden=false;
  for(const m of monitors){const o=document.createElement('option');o.value=m.id;o.textContent=m.label;o.selected=m.current;$('screen').append(o);}
})();

let updateState={status:'idle'};
function renderUpdate(state){
  updateState=state;
  const labels={idle:['Updates','Check'],checking:['Checking…','Check'],current:['Up to date','Check'],available:[`Version ${state.version}`,'Update'],downloading:[`Downloading ${state.percent}%`,'Update'],ready:['Ready to update','Restart'],installing:['Restarting…','Restart'],error:['Update failed','Retry'],unavailable:['Updates unavailable','Check']};
  const [label,button]=labels[state.status]||labels.idle;
  $('update-status').textContent=label;$('update-action').textContent=button;
  $('update-action').disabled=['checking','downloading','installing','unavailable'].includes(state.status);
}
$('update-action').onclick=action(()=>call(updateState.status==='ready'?'install_update':updateState.status==='available'?'download_update':'check_for_update'));
api.on('update_state',renderUpdate);
action(async()=>renderUpdate(await call('get_update_state')))();
