'use strict';
const $=id=>document.getElementById(id);
let currentState=null,queueSignature='',logSignature='',toastTimer;
function toast(text,error=false){$('toast').textContent=text;$('toast').className=error?'error':'';$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
async function send(type,data={}){const result=await chrome.runtime.sendMessage({type,...data});if(result?.error)throw Error(result.error);return result;}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function refresh(initial=false){
  const st=await send('GET');currentState=st;
  if(initial){$('token').value=st.settings.localToken;$('notes').value=st.settings.notes;$('maxCourses').value=st.settings.maxCourses;$('maxCalls').value=st.settings.maxCalls;$('autoSubmit').checked=st.settings.autoSubmit;}
  const r=st.run,labels={running:'运行中',paused:'已暂停',finished:'已完成'};
  $('badge').textContent=labels[r?.status]||'未开始';$('phase').textContent=r?.phase||'准备你的学习队列';
  $('counts').textContent=r?`课程 ${Math.min(r.index+1,r.courses.length)} / ${r.courses.length} · AI 请求 ${r.aiCalls}`:'先添加课程';
  $('detail').textContent=r?.courses[r.index]?.title||(r?.status==='finished'?'平台已确认本次队列全部完成。':'先启动 AI 服务、保存连接口令，再选择课程。');
  $('progress').max=r?.courses.length||1;$('progress').value=r?.index||0;
  $('start').disabled=r?.status==='running';$('pause').disabled=r?.status!=='running';$('resume').disabled=!r||r.status!=='paused';$('focus').disabled=!r;
  const signature=JSON.stringify(st.queue);$('queueCount').textContent=`${st.queue.filter(q=>q.selected).length} / ${st.queue.length} 门已选`;
  if(signature!==queueSignature){queueSignature=signature;$('queue').replaceChildren();if(!st.queue.length){const p=document.createElement('p');p.className='empty';p.textContent='还没有课程';$('queue').append(p);}for(const q of st.queue){const row=document.createElement('label'),check=document.createElement('input'),text=document.createElement('div'),a=document.createElement('a'),small=document.createElement('small');check.type='checkbox';check.checked=q.selected;check.dataset.id=q.id;a.href='https://tongxuetang.tongji.edu.cn/my/course/'+q.id;a.target='_blank';a.rel='noopener';a.textContent=q.title;small.textContent='课程 '+q.id+(q.completedAt?' · 已确认完成':'');text.append(a,small);row.append(check,text);$('queue').append(row);check.addEventListener('change',async()=>{try{await send('SELECT',{ids:[...$('queue').querySelectorAll('input:checked')].map(i=>i.dataset.id)});await refresh();}catch(e){toast(e.message,true);}});}}
  const ls=JSON.stringify(st.logs);if(ls!==logSignature){logSignature=ls;$('logs').replaceChildren();for(const l of [...st.logs].reverse()){const row=document.createElement('div'),time=document.createElement('time'),text=document.createElement('span');row.className='log '+l.level;time.textContent=new Date(l.time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});text.textContent=l.message;row.append(time,text);$('logs').append(row);}if(!st.logs.length){const p=document.createElement('p');p.className='empty';p.textContent='开始后，记录会显示在这里。';$('logs').append(p);}}
}
async function save(){await send('SAVE_SETTINGS',{settings:{localToken:$('token').value,notes:$('notes').value,maxCourses:$('maxCourses').value,maxCalls:$('maxCalls').value,autoSubmit:$('autoSubmit').checked}});}
function bind(id,fn){$(id).addEventListener('click',async()=>{const button=$(id);button.disabled=true;try{await fn();await refresh();}catch(e){toast(e.message,true);}finally{button.disabled=false;}});}
bind('openCatalog',()=>chrome.tabs.create({url:'https://tongxuetang.tongji.edu.cn/course/explore/gaodengjiangtang?filter%5Btype%5D=all&filter%5Bprice%5D=all&filter%5BcurrentLevelId%5D=all&orderBy=latest'}));
for(const [id,type] of [['start','START'],['pause','PAUSE'],['resume','RESUME'],['focus','FOCUS']])bind(id,()=>send(type));
bind('save',async()=>{await save();toast('设置已保存');});
for(const [id,allPages] of [['scan',false],['scanAll',true]])bind(id,async()=>{toast(allPages?'正在读取分页，请稍候…':'正在读取课程…');const result=await send('SCAN',{allPages});toast(`已读取 ${result.count} 门课程，自动去重。`);});
bind('import',async()=>{const r=await send('IMPORT',{text:$('urls').value});$('urls').value='';toast(`已导入 ${r.count} 门课程`);});
bind('selectAll',()=>send('SELECT',{ids:currentState.queue.map(q=>q.id)}));bind('selectNone',()=>send('SELECT',{ids:[]}));bind('clearQueue',()=>send('CLEAR_QUEUE'));
bind('health',async()=>{await save();const r=await send('HEALTH');$('connection').textContent=r.configured?`本机服务已连接 · 模型 ${r.model} · 尚需云端测试验证密钥和网络。`:'服务已连接，但尚未配置 API 密钥。';toast('本机连接检查完成');});
let testTimer;
bind('aiTest',async()=>{await save();clearTimeout(testTimer);const job=await send('AI_TEST');$('connection').textContent='正在通过本机服务请求 OpenAI…';const start=Date.now();const poll=async()=>{try{const r=await send('POLL_TEST',{id:job.id});if(r.status==='pending'){if(Date.now()-start>180000)throw Error('云端测试超时，请检查网络和服务窗口');testTimer=setTimeout(poll,2000);return;}if(r.status!=='done')throw Error(r.error||'云端连接失败');$('connection').textContent='云端 AI 已响应 · '+r.answers.map(a=>a.selected.join('、')).join('；');toast('云端连接成功');}catch(e){$('connection').textContent=e.message;toast(e.message,true);}};await poll();});
bind('diagnose',async()=>{const snapshot=await send('INSPECT');download('tongxuetang-page-diagnostic.json',snapshot);toast('诊断包含页面题目，请自行决定是否分享。');});
bind('export',()=>{const st=currentState;const {localToken,...settings}=st.settings;download('tongxuetang-run-log.json',{version:'0.1.0',settings:{...settings,notes:'[未导出资料]'},queue:st.queue,run:st.run?{status:st.run.status,phase:st.run.phase,index:st.run.index,aiCalls:st.run.aiCalls,preview:st.run.preview}:null,logs:st.logs});});
bind('clearCache',async()=>{await send('CLEAR_CACHE');toast('答案缓存已清除');});
refresh(true).catch(e=>toast(e.message,true));setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},2000);
