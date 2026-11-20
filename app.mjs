import {defaults,preferences,bytes,pct,violations,appendSample,duration} from './model.mjs';
import {detailed,rankedRows,memoryText} from './ranking.mjs';
export function createAssistant(doc,api){
 const $=id=>doc.getElementById(id),win=doc.defaultView;
 let prefs={...defaults},sample=null,history=[],timer,busy=false,disposed=false,paused=false,blocked=false,consecutive=0,lastAlert=0,notificationBlocked=false,active=false,initialized=false,networkChosen=false;
 const status=(message,error=false)=>{if(!disposed){$('status').textContent=message;$('status').dataset.error=String(error);}};
 const call=async(id,args={})=>{if(!api)throw Error('请从 MyTools 打开电脑助手');return api.call(id,args);};
 const expanded=new Set();
 function element(tag,text){const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
 function line(parent,cells){const tr=element('tr');for(const cell of cells)tr.append(element('td',cell));parent.append(tr);}
 function chart(id,values){const svg=$(id);svg.replaceChildren();if(!values.length)return;const poly=doc.createElementNS('http://www.w3.org/2000/svg','polyline');poly.setAttribute('fill','none');poly.setAttribute('stroke','currentColor');poly.setAttribute('stroke-width','2');poly.setAttribute('points',values.map((v,i)=>(i*600/Math.max(1,values.length-1)).toFixed(2)+','+(100-Math.min(100,Math.max(0,v))).toFixed(2)).join(' '));svg.append(poly);}
 function render(){if(!sample)return;const m=sample.machine;
  $('cpu').textContent=sample.warming?'采样中…':pct(m.cpu);$('memory').textContent=pct(m.totalMemory?100*m.usedMemory/m.totalMemory:0);$('memory-detail').textContent=bytes(m.usedMemory)+' / '+bytes(m.totalMemory);$('swap').textContent=bytes(m.usedSwap)+' / '+bytes(m.totalSwap);$('uptime').textContent=duration(m.uptime);
  const current=$('network').value,names=sample.networks.map(n=>n.name);if(!names.includes(current)||$('network').options.length!==names.length){$('network').replaceChildren(...names.map(name=>{const o=element('option',name);o.value=name;return o;}));$('network').value=names.includes(current)?current:[...sample.networks].sort((a,b)=>(b.receivedPerSecond+b.transmittedPerSecond)-(a.receivedPerSecond+a.transmittedPerSecond))[0]?.name||'';}
  if(!networkChosen&&!sample.warming){const suggested=[...sample.networks].sort((a,b)=>(b.receivedPerSecond+b.transmittedPerSecond)-(a.receivedPerSecond+a.transmittedPerSecond))[0];if(suggested&&suggested.receivedPerSecond+suggested.transmittedPerSecond>0){$('network').value=suggested.name;networkChosen=true;}}
  const network=sample.networks.find(n=>n.name===$('network').value);$('download').textContent=network?bytes(network.receivedPerSecond)+'/s':'不可用';$('upload').textContent=network?bytes(network.transmittedPerSecond)+'/s':'不可用';
  chart('cpu-chart',history.map(s=>s.machine.cpu));chart('memory-chart',history.map(s=>s.machine.totalMemory?100*s.machine.usedMemory/s.machine.totalMemory:0));
  $('disks').replaceChildren();for(const disk of sample.disks)line($('disks'),[disk.mount,bytes(disk.total-disk.available),bytes(disk.available),bytes(disk.total)]);
  renderProcesses();
  $('hardware').replaceChildren();for(const [name,value] of [['处理器',m.cpuName],['逻辑处理器',String(m.cores)],['物理内存',bytes(m.totalMemory)],['系统',m.os||'不可用'],['运行时长',duration(m.uptime)],['GPU 使用率','首版不支持'],['温度','首版不支持']])line($('hardware'),[name,value]);
  $('updated').textContent='更新于 '+new Date(sample.sampledAt).toLocaleTimeString();
 }
 function renderProcesses(){
  if(!sample)return;
  const supported=detailed(sample);
  $('process-mode').disabled=!supported;
  $('memory-metric').disabled=!supported;
  if(!supported){$('process-mode').value='processes';$('memory-metric').value='working';}
  $('process-warning').hidden=supported;
  const mode=$('process-mode').value,metric=$('memory-metric').value;
  $('process-memory-heading').textContent=metric==='private'?'私有工作集':'工作集（含共享）';
  $('process-identity-heading').textContent=mode==='apps'?'主 PID / 分组依据':'PID / 身份';
  $('process-note').textContent=metric==='private'
   ?'私有工作集用于接近任务管理器常用内存列；不包含可共享页，不是私有提交量。无法读取时标为不可用；部分应用按已读取的下限排序。应用分组依据同路径进程树或已核实的服务配置，不保证与 Windows 应用分组完全一致。'
   :'工作集包含共享页，应用合计可能重复计算共享内存，不能直接对比任务管理器默认内存列。同名但不同路径或独立实例保持分开。';
  const rows=rankedRows(sample,{mode,metric,sort:$('process-sort').value,query:$('process-query').value});
  const focus=doc.activeElement?.dataset?.group;
  $('processes').replaceChildren();
  for(const row of rows){
   const tr=element('tr'),name=element('td');
   if(mode==='apps'&&supported){
    const toggle=element('button',row.name+'（'+row.processCount+' 个进程）');
    toggle.className='group-toggle';toggle.dataset.group=row.id;toggle.setAttribute('aria-expanded',String(expanded.has(row.id)));
    toggle.onclick=()=>{if(expanded.has(row.id))expanded.delete(row.id);else expanded.add(row.id);renderProcesses();};
    name.append(toggle);
   }else name.textContent=row.name;
   tr.append(name,element('td',String(row.pid??row.rootPid)+' · '+(mode==='apps'?(row.association==='verified-service-executable'?'服务与客户端':row.processCount>1?'同路径进程树':'独立进程'):(row.role||'进程'))),element('td',sample.warming?'采样中':pct(row.cpu)),element('td',memoryText(row,metric)));
   $('processes').append(tr);
   if(mode==='apps'&&expanded.has(row.id)){
    const detail=element('tr'),cell=element('td'),table=element('table'),head=element('thead'),body=element('tbody');
    cell.colSpan=4;cell.className='group-details';line(head,['进程 / 身份','PID','CPU',metric==='private'?'私有工作集':'工作集（含共享）']);
    for(const p of row.processes)line(body,[p.name+' · '+p.role,String(p.pid),sample.warming?'采样中':pct(p.cpu),memoryText(p,metric)]);
    table.append(head,body);cell.append(table);detail.append(cell);$('processes').append(detail);
   }
  }
  $('process-empty').hidden=rows.length>0;
  if(focus)for(const button of $('processes').querySelectorAll('button[data-group]'))if(button.dataset.group===focus)button.focus({preventScroll:true});
  if(expanded.size>2000){const live=new Set((sample.applications||[]).map(g=>g.id));for(const id of expanded)if(!live.has(id))expanded.delete(id);}
 }
 function stop(){active=false;if(timer)win.clearTimeout(timer);timer=undefined;}
 async function poll(){if(disposed||paused||blocked||doc.hidden||busy||!active)return;if(timer)win.clearTimeout(timer);timer=undefined;busy=true;
  try{const value=await call('system.resources');if(disposed||!active)return;if(!value||value.version!==1||!value.machine||!Array.isArray(value.disks)||!Array.isArray(value.networks)||!Array.isArray(value.topMemory)||!Array.isArray(value.topCpu))throw Error('主程序暂不支持资源统计，请更新 MyTools');const fresh=sample?.sampledAt!==value.sampledAt;sample=value;history=appendSample(history,value);render();status(value.warming?'正在建立 CPU / 网速采样基线，下一次刷新后显示实时数据':'实时监控中 · 关闭或隐藏插件后暂停采样');
   if(fresh&&prefs.alerts){const reasons=violations(sample,prefs);consecutive=reasons.length?consecutive+1:0;if(consecutive>=3){$('alert').hidden=false;$('alert').textContent=reasons.join('；');if(Date.now()-lastAlert>=300000){lastAlert=Date.now();if(!notificationBlocked)try{await call('system.notify',{title:'电脑助手资源提醒',body:reasons.join('；')});}catch{notificationBlocked=true;status('系统通知不可用，仍在当前页面显示提醒',true);}}}else $('alert').hidden=true;}
  }catch(e){blocked=true;status(e.message||String(e),true);$('retry').hidden=false;}
  finally{busy=false;if(active&&!disposed&&!paused&&!blocked&&!doc.hidden)timer=win.setTimeout(()=>void poll(),prefs.interval);}
 }
 function start(){if(disposed||paused||blocked||doc.hidden)return;active=true;void poll();}
 $('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'继续监控':'暂停监控';if(paused){stop();status('监控已暂停');}else start();};
 $('retry').onclick=()=>{blocked=false;$('retry').hidden=true;start();};$('network').onchange=()=>{networkChosen=true;render();};
 for(const id of ['process-sort','process-mode','memory-metric'])$(id).onchange=renderProcesses;
 $('process-query').oninput=renderProcesses;
 for(const name of ['overview','process','hardware','settings'])$('tab-'+name).onclick=()=>{for(const tab of ['overview','process','hardware','settings']){$('page-'+tab).hidden=tab!==name;$('tab-'+tab).classList.toggle('active',tab===name);}};
 function fillSettings(){$('interval').value=String(prefs.interval);$('alerts').checked=prefs.alerts;$('cpu-threshold').value=String(prefs.cpu);$('memory-threshold').value=String(prefs.memory);$('disk-threshold').value=String(prefs.diskGb);}
 $('settings-form').onsubmit=async e=>{e.preventDefault();$('save').disabled=true;try{const next=preferences({interval:Number($('interval').value),alerts:$('alerts').checked,cpu:Number($('cpu-threshold').value),memory:Number($('memory-threshold').value),diskGb:Number($('disk-threshold').value)});await call('storage.set',{key:'computer-assistant.settings.v1',value:next});prefs=next;consecutive=0;notificationBlocked=false;if(!prefs.alerts)$('alert').hidden=true;status('监控设置已保存');stop();start();}catch(error){status(error.message||String(error),true);}finally{$('save').disabled=false;}};
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)stop();else start();});
 function dispose(){disposed=true;stop();}win.addEventListener('pagehide',dispose);win.addEventListener('beforeunload',dispose);
 $('theme').onclick=()=>{const theme=doc.documentElement.dataset.theme==='dark'?'light':'dark';doc.documentElement.dataset.theme=theme;try{win.localStorage.setItem('computer-assistant.theme',theme);}catch{}};
 try{doc.documentElement.dataset.theme=win.localStorage.getItem('computer-assistant.theme')||(win.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{}
 async function init(){if(initialized||disposed)return;initialized=true;try{prefs=preferences(await call('storage.get',{key:'computer-assistant.settings.v1'}));}catch(e){status(e.message||String(e),true);}fillSettings();start();}
 fillSettings();if(api)api.onPluginReady(init);else status('预览模式：请从 MyTools 打开电脑助手');
 return {poll,start,stop,dispose,get busy(){return busy;}};
}
if(typeof document!=='undefined')createAssistant(document,window.mytools);
