'use strict';
const C=require('./core.cjs');
const {randomUUID,createHash}=require('node:crypto');
const sha=text=>createHash('sha256').update(text).digest('hex');
const CATALOG=C.SITE+'/course/explore/gaodengjiangtang?filter%5Btype%5D=all&filter%5Bprice%5D=all&filter%5BcurrentLevelId%5D=all&orderBy=latest';
class Engine {
  constructor(store,ai,browser){this.store=store;this.ai=ai;this.browser=browser;this.chain=Promise.resolve();}
  serial(fn){const result=this.chain.then(fn,fn);this.chain=result.catch(()=>{});return result;}
  log(level,message){const data=this.store.data;data.logs.push({time:new Date().toISOString(),level,message});data.logs=data.logs.slice(-300);}
  pause(reason){const r=this.store.data.run;if(r){r.status='paused';r.phase=reason;}this.log('pause',reason);this.store.flush();}
  async start(){const data=this.store.data;if(data.run?.status==='running')throw Error('任务已在运行');if(!this.store.hasKey())throw Error('请先填写并保存 AI 密钥，再测试连接');const courses=data.queue.filter(q=>q.selected).slice(0,data.settings.maxCourses);if(!courses.length)throw Error('请先添加并勾选课程');const now=Date.now();data.run={id:randomUUID(),status:'running',phase:'打开课程',courses,index:0,confirmed:[],aiCalls:0,startedAt:now,pageSince:now,lastSeen:now};this.log('info','队列开始，共 '+courses.length+' 门');this.store.flush();await this.browser.open(C.courseURL(courses[0].id));}
  async resume(){const r=this.store.data.run;if(!r||r.status==='finished')throw Error('没有可继续的任务');r.status='running';r.phase='继续运行';r.pageSince=Date.now();r.lastSeen=Date.now();r.lastCommandKey='';r.actionAttempts=0;r.stalledSince=null;if(r.paper?.jobId&&!r.paper.answers){r.paper=null;r.aiNonce=randomUUID();}this.store.flush();await this.browser.focusOrOpen(C.courseURL(r.courses[r.index].id));}
  import(text){const data=this.store.data,map=new Map(data.queue.map(q=>[q.id,q]));let count=0;for(const line of String(text).split(/\s+/)){const id=C.courseId(line);if(id&&!map.has(id)){map.set(id,{id,title:'课程 '+id,selected:true});count++;}}if(!count)throw Error('未找到新的有效同学堂课程链接');data.queue=[...map.values()];this.store.flush();return {count};}
  async scan(allPages){const snapshot=await this.browser.inspect();if(!snapshot.url?.includes('/course/explore/gaodengjiangtang'))throw Error('请先打开高等讲堂列表并登录，再读取');const result=await this.browser.request({type:'SCAN',allPages:!!allPages});if(result.error)throw Error(result.error);const data=this.store.data,map=new Map(data.queue.map(q=>[q.id,q]));for(const q of result.courses||[])if(/^\d+$/.test(q.id)&&!map.has(q.id))map.set(q.id,{id:q.id,title:String(q.title).slice(0,1000),selected:true});data.queue=[...map.values()];this.store.flush();return {count:result.courses?.length||0};}
  cacheKey(q,s){const settings=this.store.data.settings;return sha(JSON.stringify([settings.provider,settings.model,settings.notes,s.title,q.type,q.stem,q.options.map(o=>[o.label,o.text])]));}
  async prepare(s){
    const data=this.store.data,r=data.run,fp=C.fingerprint(s.questions);
    if(r.paper?.fingerprint===fp&&r.paper.answers)return;
    if(r.paper?.fingerprint===fp&&r.paper.jobId){
      if(Date.now()-r.paper.startedAt>180000)throw Error('AI 作答超过三分钟，请核对网络后继续');
      const result=this.ai.poll(r.paper.jobId);if(result.status==='pending'){r.phase='云端 AI 正在作答';return;}if(result.status!=='done')throw Error(result.error||'AI 作答失败');
      const answers=[...r.paper.base,...result.answers.map(a=>({...a,source:'ai'}))];for(const q of s.questions){const a=answers.find(a=>a.id===q.id);if(!C.validateAnswer(q,a))throw Error('答案与当前试卷不匹配，已停止填写');if(a.source==='ai')data.cache[this.cacheKey(q,s)]={selected:a.selected,reason:a.reason,at:Date.now()};}
      data.cache=Object.fromEntries(Object.entries(data.cache).sort((a,b)=>b[1].at-a[1].at).slice(0,500));r.paper={fingerprint:fp,answers};this.log('info','AI 答案已通过题号及选项校验');return;
    }
    const base=[],missing=[];for(const q of s.questions){let a=C.hint(q);if(!a){const hit=data.cache[this.cacheKey(q,s)];if(hit&&Date.now()-hit.at<7*86400000){const candidate={id:q.id,selected:hit.selected,reason:hit.reason,source:'cache'};if(C.validateAnswer(q,candidate))a=candidate;}}if(a)base.push(a);else missing.push(q);}
    if(!missing.length){r.paper={fingerprint:fp,answers:base};return;}
    if(r.aiCalls>=data.settings.maxCalls)throw Error('已达到本次 AI 请求上限');
    const job=this.ai.submit({requestId:sha(r.id+':'+(r.aiNonce||'')+':'+fp),courseTitle:String(s.title).slice(0,1000),notes:[data.settings.notes,r.captions||''].filter(Boolean).join('\n').slice(0,120000),questions:missing.map(q=>({id:q.id,type:q.type,stem:q.stem,options:q.options.map(o=>({label:o.label,text:o.text}))}))});
    r.aiCalls++;r.paper={fingerprint:fp,base,jobId:job.id,startedAt:Date.now()};r.phase='联网处理 '+missing.length+' 道题';this.log('info','提示/缓存命中 '+base.length+' 题；请求 AI '+missing.length+' 题');
  }
  async pulse(s){
    const data=this.store.data,r=data.run;if(!r||r.status!=='running')return {};
    if(!s||!C.safeURL(s.url)||!Array.isArray(s.questions)||!Array.isArray(s.tasks)||s.questions.length>100)return {};
    const now=Date.now();r.lastSeen=now;if(r.lastURL!==s.url){r.lastURL=s.url;r.pageSince=now;r.lastCommandKey='';r.actionAttempts=0;r.stalledSince=null;}
    if(s.captions&&!r.captions?.endsWith(s.captions))r.captions=((r.captions||'')+'\n'+s.captions).slice(-100000);
    if(s.video){if(s.video.time>(r.lastVideoTime||0)+.1)r.stalledSince=null;else if(!s.video.paused)r.stalledSince ||=now;r.lastVideoTime=s.video.time;}
    r.preview={kind:s.kind,title:s.title,time:s.video?.time,duration:s.video?.duration,questionCount:s.questions.length,progress:s.progress};
    try{
      if(s.kind==='quiz'&&!s.blocked&&!s.login&&s.courseId===r.courses[r.index]?.id)await this.prepare(s);
      if(r.paper?.jobId&&!r.paper.answers){this.store.flush();return {};}
      const d=C.decide(r,s,data.settings,now);if(d.pause){this.pause(d.pause);return {};}
      if(d.advance){const course=r.courses[r.index];this.log('success','平台确认完成：'+course.title);data.queue=data.queue.map(q=>q.id===course.id?{...q,completedAt:new Date().toISOString()}:q);r.index++;Object.assign(r,{confirmed:[],paper:null,pending:null,submittedAt:null,captions:'',lastCommandKey:'',pageSince:now});if(r.index>=r.courses.length){const outside=data.queue.filter(q=>q.selected&&!r.courses.some(c=>c.id===q.id)).length;r.status='finished';r.phase=outside?'本次计划已完成；另有 '+outside+' 门已选课程未纳入，请调整课程上限后重新开始':'队列已完成';this.store.flush();return {};}r.phase='进入下一门课程';this.store.flush();await this.browser.switchCourse(C.courseURL(r.courses[r.index].id));return {};}
      if(d.finished){r.status='finished';r.phase='队列已完成';}
      if(d.command){const key=s.url+':'+d.command.type+':'+(d.command.url||d.command.fingerprint||'');if(key===r.lastCommandKey&&now-r.lastCommandAt<7000){this.store.flush();return {};}r.actionAttempts=key===r.lastCommandKey?(r.actionAttempts||0)+1:1;if(r.actionAttempts>6){this.pause('页面未按预期变化，已停止重复点击，请查看课程窗口');return {};}r.lastCommandKey=key;r.lastCommandAt=now;}
      Object.assign(r,d.patch||{});this.store.flush();return {command:d.command};
    }catch(e){this.pause(e.message);return {};}
  }
  async saveSettings(input){const data=this.store.data;const old=JSON.stringify(data.settings);const settings=this.store.saveSettings(input);if(data.run&&old!==JSON.stringify(settings)){if(data.run.status==='running'){this.pause('设置已更新，请确认后点击继续');await this.browser.pauseVideo().catch(()=>{});}data.run.paper=null;data.run.aiNonce=randomUUID();}if(input.apiKey?.trim()&&data.run?.status==='running'){this.pause('密钥已更新，请点击继续');data.run.paper=null;}this.store.flush();return {ok:true};}
  async dispatch(type,arg={}){
    const data=this.store.data;
    switch(type){
      case 'GET':return this.store.publicState();
      case 'SAVE':return this.saveSettings(arg);
      case 'FORGET_KEY':{if(data.run?.status==='running')this.pause('已删除密钥，请重新配置');this.store.forget(arg.provider);return {ok:true};}
      case 'AI_TEST':return this.ai.submit({requestId:randomUUID(),courseTitle:'连接测试',notes:'',questions:[{id:'connection-test',type:'judge',stem:'一加一等于二。',options:[{label:'正确',text:'正确'},{label:'错误',text:'错误'}]}]});
      case 'POLL_TEST':return this.ai.poll(arg.id);
      case 'OPEN_CATALOG':await this.browser.open(CATALOG);return {ok:true};
      case 'OPEN_COURSE':{const id=C.courseId(arg.url);if(!id)throw Error('课程链接无效');await this.browser.open(C.courseURL(id));return {ok:true};}
      case 'SCAN':return this.scan(arg.allPages);
      case 'IMPORT':return this.import(arg.text);
      case 'SELECT':{const selected=new Set(arg.ids||[]);data.queue=data.queue.map(q=>({...q,selected:selected.has(q.id)}));this.store.flush();return {ok:true};}
      case 'CLEAR_QUEUE':if(data.run?.status==='running')throw Error('请先暂停任务');this.store.update({queue:[]});return {ok:true};
      case 'START':await this.start();return {ok:true};
      case 'PAUSE':this.pause('你已暂停任务');await this.browser.pauseVideo().catch(()=>{});return {ok:true};
      case 'RESUME':await this.resume();return {ok:true};
      case 'FOCUS':await this.browser.focusOrOpen(C.SITE);return {ok:true};
      case 'INSPECT':return this.browser.inspect();
      case 'CLEAR_CACHE':this.store.update({cache:{}});return {ok:true};
      default:throw Error('未支持的操作');
    }
  }
}
module.exports={Engine,CATALOG};
