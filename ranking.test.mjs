import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import {createAssistant} from './app.mjs';
import {rankedRows,memoryText,processRows} from './ranking.mjs';

function sample() {
 const children=[{pid:1,parent:null,name:'<img src=x>',cpu:1,memory:1000,privateMemory:400,role:'Windows 服务：Everything'},{pid:2,parent:null,name:'Everything.exe',cpu:2,memory:2000,privateMemory:600,role:'客户端'}];
 const group={id:'service:1',name:'Everything.exe',rootPid:1,processCount:2,cpu:3,memory:3000,privateMemory:1000,knownPrivateMemory:1000,privateMemoryKnown:2,association:'verified-service-executable',processes:children};
 return {version:1,processDetailsVersion:2,sampledAt:Date.now(),warming:false,machine:{cpu:10,cores:8,cpuName:'CPU',totalMemory:10000,usedMemory:3000,totalSwap:0,usedSwap:0,uptime:200,os:'Windows'},networks:[],disks:[],topMemory:children,topCpu:children,applications:[group]};
}

test('ranks complete groups before top 20 and never turns missing private memory into zero',()=>{
 const value=sample();
 value.applications.push({...value.applications[0],id:'partial',name:'Partial',privateMemory:null,privateMemoryKnown:1,knownPrivateMemory:1500,processes:[{pid:3,name:'Partial',privateMemory:1500,memory:2000,cpu:1},{pid:4,name:'Partial',privateMemory:null,memory:2000,cpu:1}]});
 assert.equal(rankedRows(value)[0].id,'partial');
 assert.match(memoryText(value.applications[1],'private'),/部分 1\/2/);
 assert.equal(memoryText({privateMemory:null},'private'),'不可用');
 assert.equal(memoryText({privateMemory:0},'private'),'0 B');
 assert.equal(processRows(value).length,4);
 assert.equal(rankedRows(value,{query:'2'}).length,1);
 assert.equal(rankedRows(value,{mode:'processes',metric:'working'})[0].memory,2000);
});

test('default application view expands safe PID details, retains expansion and switches memory metric',async t=>{
 const win=new Window({url:'http://localhost/'}),doc=win.document;
 doc.write(readFileSync(new URL('./index.html',import.meta.url),'utf8').replace(/<script[\s\S]*?<\/script>/g,''));
 let ready,sequence=0;
 const app=createAssistant(doc,{onPluginReady(fn){ready=fn;},async call(id){return id==='storage.get'?null:{...sample(),sampledAt:Date.now()+sequence++*1000};}});
 t.after(()=>{app.dispose();win.close();});
 await ready();await new Promise(r=>setTimeout(r,0));
 const $=id=>doc.getElementById(id);
 assert.equal($('process-mode').value,'apps');
 assert.equal($('memory-metric').value,'private');
 assert.equal($('processes').querySelectorAll('tr').length,1);
 $('tab-process').click();
 $('processes').querySelector('button').click();
 assert.equal($('processes').querySelector('button').getAttribute('aria-expanded'),'true');
 assert.match($('processes').textContent,/Windows 服务：Everything/);
 assert.match($('processes').textContent,/客户端/);
 assert.equal($('processes').querySelector('img'),null);
 await app.poll();
 assert.equal($('processes').querySelector('button').getAttribute('aria-expanded'),'true');
 $('memory-metric').value='working';$('memory-metric').dispatchEvent(new win.Event('change'));
 assert.equal($('process-memory-heading').textContent,'工作集（含共享）');
 assert.match($('processes').textContent,/2.9 KiB/);
 $('process-mode').value='processes';$('process-mode').dispatchEvent(new win.Event('change'));
 assert.equal($('processes').querySelectorAll('tr').length,2);
 $('process-query').value='不存在';$('process-query').dispatchEvent(new win.Event('input'));
 assert.equal($('process-empty').hidden,false);
});
