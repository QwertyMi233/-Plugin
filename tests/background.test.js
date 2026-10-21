'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../extension/core.js');
function harness(){
  const saved={settings:{...C.DEFAULTS,localToken:'fake-connection-token'},queue:[{id:'3382',title:'模拟课程',selected:true}]};let listener;const requests=[];
  const event={addListener(){}};
  const chrome={storage:{local:{get:async()=>structuredClone(saved),set:async value=>Object.assign(saved,structuredClone(value))}},runtime:{getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn},onInstalled:event,onStartup:event},action:{onClicked:event},alarms:{onAlarm:event,create(){}},tabs:{onUpdated:event,onRemoved:event,create:async opts=>({id:42,url:opts.url}),query:async()=>[],sendMessage:async()=>({ok:true})}};
  const context=vm.createContext({chrome,crypto:globalThis.crypto,TextEncoder,AbortSignal,URL,console,importScripts(){},TongxuetangCore:C,fetch:async(url,options)=>{requests.push({url,options});if(url.endsWith('/jobs'))return {ok:true,json:async()=>({id:'1'.repeat(32),status:'pending'})};return {ok:true,json:async()=>({status:'done',answers:[{id:'j17',selected:['正确'],reason:'测试桩返回'}]})};}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
  const send=(message,sender={url:'chrome-extension://test/dashboard.html'})=>new Promise(resolve=>listener(message,sender,resolve));
  const pulse=s=>send({type:'PULSE',snapshot:s},{frameId:0,tab:{id:42,url:s.url}});
  const page=(kind,extra={})=>({url:C.SITE+'/my/course/3382',courseId:'3382',taskId:null,kind,title:'模拟课程',questions:[],tasks:[],...extra});
  return {saved,requests,send,pulse,page};
}
test('模拟课程到交卷再核对完成：提示题本地处理，无提示题交给云端桥接',async()=>{
  const h=harness();await h.send({type:'START'});
  const course=h.page('course',{progress:{done:1,total:2},tasks:[{id:'q',type:'quiz',done:false,url:C.SITE+'/course/3382/task/2/show'}]});
  assert.equal((await h.pulse(course)).command.type,'navigate');
  const questions=[{id:'s1',type:'single',stem:'选择题（D）',options:['A','B','C','D'].map(label=>({label,text:label,value:label})),selected:[]},{id:'j17',type:'judge',stem:'判断题',options:[{label:'正确',text:'正确',value:'1'},{label:'错误',text:'错误',value:'0'}],selected:[]}];
  const quiz=h.page('quiz',{url:C.SITE+'/course/3382/task/2/show',taskId:'q',questions});
  await h.pulse(quiz);assert.equal(h.saved.run.paper.jobId,'1'.repeat(32));assert.equal(h.requests.length,1);
  const sent=JSON.parse(h.requests[0].options.body);assert.equal(sent.questions.length,1);assert.equal(sent.questions[0].id,'j17');assert.equal(sent.questions[0].options[0].label,'正确');
  const fill=await h.pulse(quiz);assert.equal(fill.command.type,'fill');assert.equal(fill.command.answers.length,2);
  for(const q of questions)q.selected=fill.command.answers.find(a=>a.id===q.id).selected;
  assert.equal((await h.pulse(quiz)).command.type,'openSubmit');
  const confirmation={...quiz,confirmOpen:true,confirmButton:true};assert.equal((await h.pulse(confirmation)).command.type,'confirmSubmit');
  assert.equal((await h.pulse(confirmation)).command,undefined);
  const result=h.page('result',{url:quiz.url,taskId:'q'});assert.equal((await h.pulse(result)).command.url,C.courseURL('3382'));
  await h.pulse({...course,progress:{done:2,total:2}});assert.equal(h.saved.run.status,'finished');assert.ok(h.saved.queue[0].completedAt);
});
test('错误标签页不能触发任务；其他课程试卷不能触发 AI',async()=>{const h=harness();await h.send({type:'START'});await h.send({type:'PULSE',snapshot:h.page('quiz')},{frameId:0,tab:{id:99,url:C.SITE+'/my/course/3382'}});assert.equal(h.requests.length,0);await h.pulse(h.page('quiz',{courseId:'3383',url:C.SITE+'/course/3383/task/1/show'}));assert.equal(h.requests.length,0);});
test('暂停和无效来源请求',async()=>{const h=harness();await h.send({type:'START'});await h.send({type:'PAUSE'});assert.equal(h.saved.run.status,'paused');const result=await h.send({type:'CLEAR_QUEUE'},{url:'https://evil.example/'});assert.match(result.error,/无效请求来源/);assert.equal(h.saved.queue.length,1);});
