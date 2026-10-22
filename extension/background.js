'use strict';
importScripts('core.js');
const C = TongxuetangCore;
const LOCAL = 'http://127.0.0.1:18765';
let transaction = Promise.resolve();
function serialized(fn) { const result = transaction.then(fn, fn); transaction = result.catch(() => {}); return result; }
async function state() { const s = await chrome.storage.local.get(['settings','queue','run','logs','cache']); return {settings:{...C.DEFAULTS,...s.settings},queue:s.queue||[],run:s.run||null,logs:s.logs||[],cache:s.cache||{}}; }
async function log(level, message) {
  const {logs} = await state(); logs.push({time:new Date().toISOString(),level,message}); await chrome.storage.local.set({logs:logs.slice(-300)});
}
async function pause(reason) { const {run}=await state(); if(run){run.status='paused';run.phase=reason;await chrome.storage.local.set({run});} await log('pause',reason); }
async function local(path, settings, body) {
  if(!settings.localToken) throw Error('请先启动 AI 服务，并在设置中粘贴连接口令。');
  let response; try { response=await fetch(LOCAL+path,{method:body?'POST':'GET',headers:{'Authorization':'Bearer '+settings.localToken,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(7000),credentials:'omit'}); } catch { throw Error('无法连接本机 AI 服务。请保持“启动AI服务”窗口打开，并检查连接口令。'); }
  let data;try{data=await response.json();}catch{throw Error('AI 服务返回了无法解析的结果');}
  if(!response.ok)throw Error(data.error||'AI 服务请求失败'); return data;
}
async function digest(text) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
async function answerKey(q,settings,title) {return digest(JSON.stringify([title,settings.notes,q.stem,q.options.map(o=>[o.label,o.text])]));}
async function prepareAnswers(st,snapshot) {
  const {run,settings,cache}=st, fp=C.fingerprint(snapshot.questions);
  if(run.paper?.fingerprint===fp && run.paper.answers)return;
  if(run.paper?.fingerprint===fp && run.paper.jobId){
    if(Date.now()-run.paper.startedAt>180000)throw Error('AI 请求超过三分钟，请检查服务窗口，确认后再继续。');
    const result=await local('/jobs/'+run.paper.jobId,settings);
    if(result.status==='pending'){run.phase='云端 AI 正在作答';return;}
    if(result.status!=='done')throw Error(result.error||'AI 请求失败');
    const answers=[...run.paper.base,...result.answers.map(a=>({...a,source:'ai'}))];
    for(const q of snapshot.questions){const a=answers.find(a=>a.id===q.id);if(!C.validateAnswer(q,a))throw Error('AI 对部分题目未给出有效答案，请补充资料或手动处理。');if(a.source==='ai')cache[await answerKey(q,settings,snapshot.title)]={selected:a.selected,reason:a.reason,at:Date.now()};}
    const limited=Object.fromEntries(Object.entries(cache).sort((a,b)=>b[1].at-a[1].at).slice(0,500));st.cache=limited;
    run.paper={fingerprint:fp,answers};await log('info','AI 答案已校验；准备填写 '+answers.length+' 道题。');return;
  }
  const base=[],missing=[];
  for(const q of snapshot.questions){let a=C.hint(q);if(!a){const hit=cache[await answerKey(q,settings,snapshot.title)];if(hit && Date.now()-hit.at<7*86400000){const candidate={id:q.id,selected:hit.selected,reason:hit.reason,source:'cache'};if(C.validateAnswer(q,candidate))a=candidate;}}if(a)base.push(a);else missing.push(q);}
  if(!missing.length){run.paper={fingerprint:fp,answers:base};return;}
  if(run.aiCalls>=settings.maxCalls)throw Error('已达到本次 AI 请求上限，请检查设置后继续。');
  const requestId=await digest(run.id+':'+(run.aiNonce||'')+':'+fp);
  const response=await local('/jobs',settings,{requestId,courseTitle:snapshot.title,notes:[settings.notes,run.captions||''].filter(Boolean).join('\n').slice(0,120000),questions:missing.map(q=>({id:q.id,type:q.type,stem:q.stem,options:q.options.map(o=>({label:o.label,text:o.text}))}))});
  run.aiCalls++;run.paper={fingerprint:fp,base,jobId:response.id,startedAt:Date.now()};run.phase='云端 AI 正在处理 '+missing.length+' 道题';await log('info','选择题提示/缓存命中 '+base.length+' 题；联网请求 '+missing.length+' 题。');
}
async function pulse(message,sender){
  const st=await state(),run=st.run,s=message.snapshot;
  if(!run || run.status!=='running' || sender.tab?.id!==run.tabId || sender.frameId!==0)return {};
  if(!C.safeURL(s.url) || !C.safeURL(sender.tab.url))return {};
  const now=Date.now();run.lastSeen=now;
  if(run.lastURL!==s.url){run.lastURL=s.url;run.pageSince=now;run.lastCommandKey='';run.actionAttempts=0;run.stalledSince=null;}
  if(s.captions && !run.captions?.endsWith(s.captions))run.captions=((run.captions||'')+'\n'+s.captions).slice(-100000);
  if(s.video){if(s.video.time>(run.lastVideoTime||0)+0.1){run.stalledSince=null;}else if(!s.video.paused){run.stalledSince ||=now;}run.lastVideoTime=s.video.time;}
  run.preview={kind:s.kind,title:s.title,time:s.video?.time,duration:s.video?.duration,questionCount:s.questions.length,progress:s.progress};
  try{
    if(s.kind==='quiz' && !s.blocked && !s.login && s.courseId===run.courses[run.index]?.id)await prepareAnswers(st,s);
    if(run.paper?.jobId && !run.paper.answers){await chrome.storage.local.set({run});return {};}
    const decision=C.decide(run,s,st.settings,now);
    if(decision.pause){await chrome.storage.local.set({run,cache:st.cache});await pause(decision.pause);return {};}
    if(decision.advance){
      await log('success','平台确认完成：'+run.courses[run.index].title);
      const id=run.courses[run.index].id;st.queue=st.queue.map(q=>q.id===id?{...q,completedAt:new Date().toISOString()}:q);
      run.index++;run.confirmed=[];run.paper=null;run.pending=null;run.submittedAt=null;run.captions='';run.lastCommandKey='';run.pageSince=now;
      if(run.index>=run.courses.length){const outside=st.queue.filter(q=>q.selected&&!run.courses.some(c=>c.id===q.id)).length;run.status='finished';run.phase=outside?'本次计划已完成；另有 '+outside+' 门已选课程未纳入，请调整课程上限后重新开始':'队列已完成';await chrome.storage.local.set({run,queue:st.queue});return {};}
      run.phase='进入下一门课程';await chrome.storage.local.set({run,queue:st.queue});
      const oldId=run.tabId,mayClose=run.ownedTab===true;
      const next=await chrome.tabs.create({url:C.courseURL(run.courses[run.index].id),active:true});
      run.tabId=next.id;run.ownedTab=true;run.lastSeen=now;await chrome.storage.local.set({run});
      if(mayClose&&oldId!==next.id)try{await chrome.tabs.remove(oldId);}catch{await log('info','下一课已打开；旧课程标签页未能关闭，可手动关闭。');}
      return {};
    }
    if(decision.finished){run.status='finished';run.phase='队列已完成';}
    if(decision.command){
      const key=s.url+':'+decision.command.type+':'+(decision.command.url||decision.command.fingerprint||'');
      if(key===run.lastCommandKey && now-run.lastCommandAt<7000){await chrome.storage.local.set({run,cache:st.cache});return {};}
      run.actionAttempts=key===run.lastCommandKey?(run.actionAttempts||0)+1:1;
      if(run.actionAttempts>6){await chrome.storage.local.set({run});await pause('页面没有按预期变化，已停止重复点击。请检查课程页面。');return {};}
      run.lastCommandKey=key;run.lastCommandAt=now;
    }
    Object.assign(run,decision.patch||{});await chrome.storage.local.set({run,cache:st.cache});return {command:decision.command};
  }catch(e){await chrome.storage.local.set({run,cache:st.cache});await pause(e.message);return {};}
}
async function findCourseTab(catalog=false){const tabs=await chrome.tabs.query({url:C.SITE+'/*'});if(catalog){const lists=tabs.filter(t=>t.url?.includes('/course/explore/gaodengjiangtang'));return lists.find(t=>t.active)||lists[0];}const {run}=await state();return tabs.find(t=>t.id===run?.tabId)||tabs.find(t=>t.active)||tabs[0];}
async function handle(message,sender){
  if(message.type==='PULSE')return pulse(message,sender);
  if(message.type==='ACTION_ERROR'){const {run}=await state();if(sender.tab?.id===run?.tabId)await pause(message.error||'网页操作失败');return {};}
  if(!sender.url?.startsWith(chrome.runtime.getURL('')))throw Error('无效请求来源');
  const st=await state();
  if(message.type==='GET')return st;
  if(message.type==='SAVE_SETTINGS'){
    const settings={...st.settings,autoSubmit:!!message.settings.autoSubmit,localToken:String(message.settings.localToken||'').trim(),notes:String(message.settings.notes||'').slice(0,100000),maxCalls:Math.max(1,Math.min(100,Number(message.settings.maxCalls)||20)),maxCourses:Math.max(1,Math.min(100,Number(message.settings.maxCourses)||3))};
    if(st.run && settings.notes!==st.settings.notes)st.run.paper=null;
    await chrome.storage.local.set({settings,run:st.run});return {ok:true};
  }
  if(message.type==='HEALTH')return local('/health',st.settings);
  if(message.type==='AI_TEST')return local('/jobs',st.settings,{requestId:crypto.randomUUID(),courseTitle:'连接测试',notes:'',questions:[{id:'connection-test',type:'judge',stem:'一加一等于二。',options:[{label:'正确',text:'正确'},{label:'错误',text:'错误'}]}]});
  if(message.type==='POLL_TEST')return local('/jobs/'+encodeURIComponent(message.id),st.settings);
  if(message.type==='SCAN'){
    const tab=await findCourseTab(true);if(!tab)throw Error('请先在浏览器打开高等讲堂课程列表。');
    const result=await chrome.tabs.sendMessage(tab.id,{type:'SCAN',allPages:!!message.allPages});if(result.error)throw Error(result.error);
    const queue=new Map(st.queue.map(q=>[q.id,q]));for(const q of result.courses)if(!queue.has(q.id))queue.set(q.id,{...q,selected:true});
    await chrome.storage.local.set({queue:[...queue.values()]});return {count:result.courses.length};
  }
  if(message.type==='IMPORT'){
    const queue=new Map(st.queue.map(q=>[q.id,q]));let count=0;
    for(const line of String(message.text).split(/\s+/)){const id=C.courseId(line);if(id && !queue.has(id)){queue.set(id,{id,title:'课程 '+id,selected:true});count++;}}
    if(!count)throw Error('没有找到新的有效同学堂课程链接');await chrome.storage.local.set({queue:[...queue.values()]});return {count};
  }
  if(message.type==='SELECT'){const selected=new Set(message.ids);await chrome.storage.local.set({queue:st.queue.map(q=>({...q,selected:selected.has(q.id)}))});return {ok:true};}
  if(message.type==='CLEAR_QUEUE'){if(st.run?.status==='running')throw Error('请先暂停任务');await chrome.storage.local.set({queue:[]});return {ok:true};}
  if(message.type==='START'){
    if(st.run?.status==='running')throw Error('已有任务正在运行');const courses=st.queue.filter(q=>q.selected).slice(0,st.settings.maxCourses);if(!courses.length)throw Error('请先读取或导入课程，并勾选至少一门。');
    const tab=await chrome.tabs.create({url:C.courseURL(courses[0].id),active:true});const now=Date.now();
    const run={id:crypto.randomUUID(),status:'running',phase:'打开课程',courses,index:0,tabId:tab.id,ownedTab:true,confirmed:[],aiCalls:0,startedAt:now,pageSince:now,lastSeen:now};
    await chrome.storage.local.set({run});await log('info','队列开始，共 '+courses.length+' 门；自动交卷：'+(st.settings.autoSubmit?'开启':'关闭'));return {ok:true};
  }
  if(message.type==='PAUSE'){
    await pause('你已暂停任务');if(st.run?.tabId)try{await chrome.tabs.sendMessage(st.run.tabId,{type:'PAUSE_VIDEO'});}catch{}return {ok:true};
  }
  if(message.type==='RESUME'){
    const run=st.run;if(!run || run.status==='finished')throw Error('没有可继续的任务，请开始新队列。');
    let tab;try{tab=await chrome.tabs.get(run.tabId);}catch{}
    if(!tab || (!C.safeURL(tab.url) && !tab.url?.startsWith('https://iam.tongji.edu.cn/'))){tab=await chrome.tabs.create({url:C.courseURL(run.courses[run.index].id),active:true});run.ownedTab=true;}
    run.tabId=tab.id;run.status='running';run.phase='继续运行';run.pageSince=Date.now();run.lastSeen=Date.now();run.actionAttempts=0;run.lastCommandKey='';run.stalledSince=null;
    if(run.paper?.jobId && !run.paper.answers){run.paper=null;run.aiNonce=crypto.randomUUID();}
    await chrome.storage.local.set({run});return {ok:true};
  }
  if(message.type==='FOCUS'){if(st.run?.tabId)await chrome.tabs.update(st.run.tabId,{active:true});return {ok:true};}
  if(message.type==='INSPECT'){const tab=await findCourseTab();if(!tab)throw Error('没有打开的同学堂页面');return chrome.tabs.sendMessage(tab.id,{type:'INSPECT'});}
  if(message.type==='CLEAR_CACHE'){await chrome.storage.local.set({cache:{}});return {ok:true};}
  throw Error('未知请求');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{serialized(()=>handle(message,sender)).then(data=>reply(data)).catch(e=>reply({error:e.message}));return true;});
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
chrome.runtime.onInstalled.addListener(async()=>{const st=await state();await chrome.storage.local.set({settings:st.settings});chrome.alarms.create('watchdog',{periodInMinutes:1});});
chrome.runtime.onStartup.addListener(()=>serialized(async()=>{const {run}=await state();if(run){run.tabId=null;run.ownedTab=false;await chrome.storage.local.set({run});await pause('浏览器已重新启动，请确认课程页并点击继续。');}}));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='watchdog')serialized(async()=>{const {run}=await state();if(run?.status==='running' && Date.now()-run.lastSeen>180000)await pause('课程页三分钟没有响应，请检查浏览器和登录状态。');});});
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.url)serialized(async()=>{const {run}=await state();if(run?.tabId!==tabId||run.status!=='running')return;if(change.url.startsWith('https://iam.tongji.edu.cn/')||change.url.startsWith(C.SITE+'/login'))await pause('需要登录。请在课程浏览器页完成认证，再点击继续。');});});
chrome.tabs.onRemoved.addListener(tabId=>serialized(async()=>{const {run}=await state();if(run?.tabId===tabId&&run.status==='running')await pause('课程标签页已关闭。点击继续将重新打开课程。');}));
