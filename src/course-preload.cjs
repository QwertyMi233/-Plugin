'use strict';
const {ipcRenderer}=require('electron');
if(process.isMainFrame && location.origin==='https://tongxuetang.tongji.edu.cn'){
let handler;
globalThis.TongxuetangDesktopJoinClick=payload=>ipcRenderer.invoke('course:join-click',payload);
globalThis.chrome={runtime:{id:'desktop',onMessage:{addListener(fn){handler=fn;}},sendMessage(message){return ipcRenderer.invoke('course:message',message);}}};
ipcRenderer.on('course:request',(_event,request)=>{if(!handler)return;try{const pending=handler(request.message,{},result=>ipcRenderer.send('course:reply',{id:request.id,result}));}catch(e){ipcRenderer.send('course:reply',{id:request.id,result:{error:e.message}});}});
(function (root) {
  'use strict';
  const SITE = 'https://tongxuetang.tongji.edu.cn';
  const DEFAULTS = { autoSubmit: true, autoJoin: true, localToken: '', notes: '', maxCalls: 20, maxCourses: 3 };
  function courseId(url) {
    try { const u = new URL(url, SITE); return u.origin === SITE ? (u.pathname.match(/^\/(?:my\/)?course\/(\d+)(?:\/|$)/) || [])[1] || null : null; } catch { return null; }
  }
  function safeURL(url) { try { const u = new URL(url, SITE); return u.origin === SITE && !u.username && !u.password ? u.href : null; } catch { return null; } }
  function courseURL(id) { if (!/^\d+$/.test(String(id))) throw Error('无效课程编号'); return SITE + '/my/course/' + id; }
  function parseProgress(text) {
    const m = String(text).match(/(?:已完成|完成任务)[：:\s]*(\d+)\s*\/\s*(\d+)(?:\s*任务)?/);
    return m ? { done: +m[1], total: +m[2] } : null;
  }
  function examResultMarker(text) {
    const s = String(text || '').replace(/\s+/g, '');
    const status = s.match(/(?:批阅|阅卷)(?:已)?完成|已批阅|已阅卷|交卷成功|提交成功|已交卷|考试(?:已)?结束|等待批阅|批阅中|(?:您|你)已通过本次考试|恭喜(?:您|你)?通过本次考试/);
    if (status) return status[0];
    if (/答对/.test(s) && /答错/.test(s) && /未答/.test(s) && /得分/.test(s) && /\d+(?:\.\d+)?分/.test(s)) return '成绩汇总表';
    return null;
  }
  function fingerprint(questions) {
    return JSON.stringify(questions.map(q => [q.id, q.type, q.stem, q.options.map(o => [o.label, o.text, o.value])]));
  }
  function hint(q) {
    if (q.type === 'judge') return null;
    const m = q.stem.match(/[（(]\s*([a-z](?:[\s,，、;；]*[a-z])*)\s*[）)]\s*[。.!！?？]?\s*$/i);
    if (!m) return null;
    const labels = [...new Set(m[1].toUpperCase().match(/[A-Z]/g))];
    if (!labels.length || (q.type === 'single' && labels.length !== 1) || labels.some(x => !q.options.some(o => o.label === x))) return null;
    return { id: q.id, selected: labels, reason: '题干末尾的答案提示', source: 'hint' };
  }
  function validateAnswer(q, a) {
    if (!q || !a || String(a.id) !== String(q.id) || !Array.isArray(a.selected)) return false;
    const labels = a.selected;
    return labels.length > 0 && (q.type === 'multi' || labels.length === 1) && new Set(labels).size === labels.length && labels.every(x => typeof x === 'string' && q.options.some(o => o.label === x));
  }
  function matches(q, a) { return validateAnswer(q, a) && [...q.selected].sort().join('|') === [...a.selected].sort().join('|'); }
  function decide(run, s, settings, now = Date.now()) {
    const cmd = (type, args = {}) => ({ command: { type, ...args } });
    const pause = reason => ({ pause: reason });
    const wait = phase => ({ patch: { phase } });
    const current = run.courses[run.index];
    if (!current) return { finished: true };
    const home = courseURL(current.id);
    if (s.blocked) return pause('页面出现验证或访问异常，请在课程页处理后继续。');
    if (s.login) return pause('请在同学堂页面完成登录，再点击“继续”。');
    if (s.courseId !== current.id) return cmd('navigate', { url: home });
    if (s.kind === 'public') {
      if (s.joinBlocked) return pause(s.joinBlocked);
      if (s.goLearn) return cmd('navigate', { url: s.goLearn });
      if (s.joinReady === false) return wait('等待课程页面加载完成后加入学习');
      if (!settings.autoJoin) return pause('这门课尚未加入学习。请手动加入，或在设置中开启自动加入学习。');
      const previous = run.joinAttempt?.courseId === current.id ? run.joinAttempt : null;
      const stage = s.joinConfirm ? 'confirm' : 'initial';
      if (previous && (previous.stage === stage || previous.stage === 'confirm')) {
        if (now - previous.at > 30000) return pause('加入学习后未进入学习目录，请检查课程窗口，处理后点击继续。未重复点击加入。');
        return wait('等待平台确认加入学习');
      }
      if (s.canJoin) return { patch: { joinAttempt: { courseId: current.id, stage, at: now }, phase: stage === 'confirm' ? '确认免费加入学习' : '自动加入学习' }, command: { type: 'joinCourse', courseId: current.id, stage } };
      if (previous && now - previous.at > 30000) return pause('加入学习后页面发生变化，请检查课程窗口后继续。');
      if (now - (run.pageSince || run.startedAt) < 15000 || previous) return wait('等待加入学习入口或学习目录');
      return pause('未找到可自动操作的加入学习入口，请检查课程窗口。');
    }
    if (s.kind === 'course') {
      if (!s.progress && !s.tasks.length && now - (run.pageSince || run.startedAt) < 15000) return wait('等待课程目录加载');
      if (s.progress && s.progress.total > 0 && s.progress.done === s.progress.total) return { advance: true };
      const pending = run.pending;
      if (pending) {
        const task = s.tasks.find(t => t.id === pending.id);
        if (task?.done || (s.progress && s.progress.done > pending.before)) {
          return { patch: { confirmed: [...new Set([...(run.confirmed || []), pending.id])], pending: null, paper: null, phase: '核对到任务已完成' } };
        }
        if (now - pending.since > 90000) return pause('平台尚未确认任务完成，请核对课程进度后继续。未重复提交。');
        return now - (run.lastCommandAt || 0) > 8000 ? cmd('reload') : wait('等待平台更新任务状态');
      }
      const tasks = s.tasks.filter(t => !t.done && !(run.confirmed || []).includes(t.id));
      const next = tasks.find(t => t.type === 'video') || tasks.find(t => t.type === 'quiz');
      if (!next) return pause('目录任务状态与课程完成数量不一致，请在课程页面核对后继续。');
      return { patch: { baseline: s.progress?.done ?? 0, taskId: next.id, paper: null, phase: next.type === 'video' ? '打开视频' : '打开试题' }, command: { type: 'navigate', url: next.url } };
    }
    if (s.kind === 'video') {
      const v = s.video;
      if (v.error) return pause('视频加载失败，请在播放器中处理后继续。');
      if (v.ended && v.duration > 0) {
        return { patch: { pending: { id: s.taskId, before: run.baseline || 0, since: now }, phase: '核对视频任务' }, command: { type: 'navigate', url: home } };
      }
      if (v.paused) return cmd('play');
      if (run.stalledSince && now - run.stalledSince > 180000) return pause('视频三分钟没有前进，请检查网络或播放器后继续。');
      return wait('正常播放 · ' + Math.floor(v.time) + ' / ' + Math.floor(v.duration || 0) + ' 秒');
    }
    if (s.kind === 'quizStart') return cmd('startQuiz');
    if (s.kind === 'quiz') {
      if (!s.questions.length) return wait('等待试题载入');
      const paper = run.paper;
      if (!paper || paper.fingerprint !== fingerprint(s.questions)) return { needAnswers: true };
      if (run.submittedAt) {
        if (now - run.submittedAt > 45000) return pause('交卷结果尚未确认，为避免重复交卷已暂停。请检查网站结果。');
        return wait('等待交卷结果');
      }
      if (!paper.answers || s.questions.some(q => !validateAnswer(q, paper.answers.find(a => a.id === q.id)))) return pause('答案不完整或与当前试卷不匹配，已暂停。');
      if (s.questions.some(q => !matches(q, paper.answers.find(a => a.id === q.id)))) return cmd('fill', { answers: paper.answers, fingerprint: paper.fingerprint });
      if (!settings.autoSubmit) return pause('所有答案已填入，请检查后手动交卷，或开启自动交卷再继续。');
      if (s.confirmOpen) {
        if (!s.confirmButton) return pause('交卷弹窗结构与已验证版本不同，请手动处理。');
        return { patch: { submittedAt: now, phase: '等待交卷结果' }, command: { type: 'confirmSubmit', fingerprint: paper.fingerprint, answers: paper.answers } };
      }
      return cmd('openSubmit', { fingerprint: paper.fingerprint, answers: paper.answers });
    }
    if (s.kind === 'result') {
      return { patch: { pending: { id: s.taskId || run.taskId, before: run.baseline || 0, since: now }, submittedAt: null, phase: '核对考试任务' }, command: { type: 'navigate', url: home } };
    }
    if (s.kind === 'unknown' && run.submittedAt && now - run.submittedAt > 20000) {
      return { patch: { pending: { id: s.taskId || run.taskId, before: run.baseline || 0, since: now }, submittedAt: null, phase: '提交后页面变化，返回目录核对任务状态' }, command: { type: 'navigate', url: home } };
    }
    if (now - (run.pageSince || run.startedAt) > 90000) return pause('当前页面未识别到已支持的课程控件，请查看运行记录和页面诊断。');
    return wait('等待页面载入');
  }
  const api = { SITE, DEFAULTS, courseId, safeURL, courseURL, parseProgress, examResultMarker, fingerprint, hint, validateAnswer, matches, decide };
  root.TongxuetangCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

(() => {
 'use strict';
 let settings={playbackRate:1,timerHookerEnabled:false}, last=null;
 const watched=new WeakSet(), nativeRate=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'playbackRate');
 const active=()=>globalThis.location?.origin==='https://tongxuetang.tongji.edu.cn'&&/^\/course\/\d+\/task\/\d+(?:\/|$)/.test(location.pathname);
 function read(v){try{return nativeRate.get.call(v);}catch{return null;}}
 function apply(v){
  if(!active())return;
  let error='';try{if(Math.abs(read(v)-settings.playbackRate)>0.001)nativeRate.set.call(v,settings.playbackRate);v.preservesPitch=true;}catch(e){error='播放器未接受预设倍速：'+e.message;}
  const actual=read(v);last={target:settings.playbackRate,actual,error:error||(Math.abs(actual-settings.playbackRate)>0.01?'播放器限制了倍速':''),timerHookerEnabled:settings.timerHookerEnabled};
 }
 function scan(doc=document,seen=new Set()){
  if(doc===document)last=null;
  if(!active()||seen.has(doc))return;seen.add(doc);
  for(const v of doc.querySelectorAll('video')){
   if(!watched.has(v)){watched.add(v);for(const name of ['play','loadedmetadata','ratechange'])v.addEventListener(name,()=>apply(v));}
   apply(v);
  }
  for(const f of doc.querySelectorAll('iframe'))try{if(f.contentDocument)scan(f.contentDocument,seen);}catch{}
 }
 function set(input){settings={playbackRate:input.playbackRate,timerHookerEnabled:input.timerHookerEnabled===true};scan();return last;}
 globalThis.TongxuetangPlayback={set,scan,read,state:()=>last};
 const observer=new MutationObserver(()=>scan());observer.observe(document,{childList:true,subtree:true});
 const ticker=setInterval(()=>scan(),1500);
 addEventListener('pagehide',()=>{observer.disconnect();clearInterval(ticker);},{once:true});
})();

(() => {
  'use strict';
  const C = globalThis.TongxuetangCore;
  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    const view = el.ownerDocument.defaultView, style = view.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    try { return !view.frameElement || visible(view.frameElement); } catch { return false; }
  }
  function resultText(d) {
    if (!d.body) return '';
    const walker = d.createTreeWalker(d.body, 4), parts = []; let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (node.textContent.trim() && parent && !parent.closest('.js-testpaper-question,script,style,template') && visible(parent)) parts.push(node.textContent.trim());
    }
    return parts.join('\n');
  }
  function docs(root = document, seen = new Set()) {
    if (seen.has(root)) return []; seen.add(root); const result = [root];
    for (const f of root.querySelectorAll('iframe')) { try { if (f.contentDocument) result.push(...docs(f.contentDocument, seen)); } catch {} }
    return result;
  }
  function controls(q) { return [...q.querySelectorAll('input[type="radio"],input[type="checkbox"]')]; }
  function questions(d) {
    return [...d.querySelectorAll('.js-testpaper-question')].map(el => {
      const inputs = controls(el); if (!inputs.length) return null;
      const optionText = {};
      for (const li of el.querySelectorAll('ul li,ol li')) { const m = li.innerText.trim().match(/^([A-Z])\s*[.．、]\s*([\s\S]*)$/); if (m) optionText[m[1]] = m[2].trim(); }
      const options = inputs.map(input => {
        const label = input.closest('label')?.innerText.trim() || input.parentElement.innerText.trim();
        return { label, text: optionText[label] || label, value: input.value };
      });
      const judge = options.length === 2 && options.some(o => o.label === '正确') && options.some(o => o.label === '错误');
      return { id: el.id || 'question' + inputs[0].name, type: judge ? 'judge' : inputs.some(i => i.type === 'checkbox') ? 'multi' : 'single', stem: el.querySelector('.testpaper-question-stem')?.innerText.trim() || '', options, selected: inputs.filter(i => i.checked).map(i => (i.closest('label') || i.parentElement).innerText.trim()) };
    }).filter(Boolean);
  }
  function find(documents, selector, predicate = visible) {
    for (const d of documents) for (const el of d.querySelectorAll(selector)) if (predicate(el)) return el;
    return null;
  }
  function joinInfo(documents) {
    const modal = find(documents, '.modal.in,.modal.show,[role="dialog"]');
    const scope = modal || document;
    const control = [...scope.querySelectorAll('a,button,input[type="button"],input[type="submit"]')].find(el => visible(el) && /^(加入学习|免费加入|确认加入|确认加入学习)$/.test((el.innerText || el.value || '').trim()));
    let blocked = null;
    if (modal && /协议|条款|承诺书|支付|付款|订单|购买|价格|[¥￥]/.test(modal.innerText)) blocked = '加入学习出现协议或付款信息，请在课程窗口手动处理后继续。';
    if (modal?.querySelector('input[type="password"],input[type="checkbox"]')) blocked = '加入学习需要额外确认或认证，请手动处理后继续。';
    if (control && (control.disabled || control.getAttribute('aria-disabled') === 'true' || control.classList.contains('disabled'))) blocked = '加入学习按钮暂不可用，请检查课程窗口。';
    if (control?.closest('form')) {
      const form = control.closest('form');
      if (/协议|条款|支付|付款|订单|[¥￥]/.test(form.innerText)) blocked = '加入学习表单包含协议或付款信息，请手动处理。';
    }
    if (control) {
      for (const attr of ['href','data-url']) {
        const value = control.getAttribute(attr);
        if (value && !/^javascript:|^#/.test(value)) {
          const url = C.safeURL(value);
          if (!url || C.courseId(url) !== C.courseId(location.href)) blocked = '加入学习入口指向其他课程或站点，已停止。';
        }
      }
    }
    return { control, canJoin: !!control && !blocked, confirm: !!modal, blocked };
  }
  function snapshot() {
    const documents = docs(); const path = location.pathname; const cid = C.courseId(location.href);
    const texts = documents.map(d => d.body?.innerText || '');
    const body = texts.join('\n');
    const v = find(documents, 'video');
    const qdoc = documents.find(d => d.querySelector('.js-testpaper-question'));
    const qs = qdoc ? questions(qdoc) : [];
    const finish = find(documents, '#finishPaper');
    const modal = find(documents, '#testpaper-finished-dialog');
    const start = find(documents, 'a', el => visible(el) && /^(开始考试|继续考试)$/.test(el.innerText.trim()));
    const tasks = [...document.querySelectorAll('.task-item')].map(row => {
      const a = row.querySelector('a[href*="/task/"]'); if (!a) return null;
      const url = C.safeURL(a.getAttribute('href')); const id = url?.match(/\/task\/(\d+)\//)?.[1];
      const left = row.querySelector('.left-menu')?.className || '';
      const type = row.querySelector('.es-icon-videoclass') ? 'video' : /试题|考试|测验/.test(a.innerText) ? 'quiz' : 'other';
      return id && url ? { id, url, title: a.innerText.trim(), type, done: /es-icon-iccheckcircleblack24px|es-icon-checkcircle|es-icon-finish/.test(left) } : null;
    }).filter(Boolean);
    const resultEvidence = documents.map(d => C.examResultMarker(resultText(d))).find(Boolean) || null;
    const go = [...document.querySelectorAll('a')].find(el => visible(el) && el.innerText.trim() === '去学习');
    const enrollment = joinInfo(documents);
    let kind = 'unknown';
    if (resultEvidence && /\/task\//.test(path)) kind = 'result'; else if (cid && !/\/task\//.test(path) && (enrollment.control || enrollment.blocked || go)) kind = 'public'; else if (v) kind = 'video'; else if (qs.length && finish) kind = 'quiz'; else if (start) kind = 'quizStart'; else if (/^\/my\/course\/\d+\/?$/.test(path)) kind = 'course'; else if (/^\/course\/\d+(?:\/(?:tasks|material_summary|summary))?\/?$/.test(path)) kind = 'public';
    const captions = [];
    if (v) for (const track of v.textTracks || []) { try { for (const cue of track.activeCues || []) captions.push(cue.text); } catch {} }
    return { url: location.href, courseId: cid, taskId: path.match(/\/task\/(\d+)\//)?.[1] || null, kind, title: (qdoc?.querySelector('h1')?.innerText || document.title).trim(), progress: C.parseProgress(document.body?.innerText || ''), tasks, goLearn: go ? C.safeURL(go.getAttribute('href')) : null,
      login: location.hostname === 'iam.tongji.edu.cn' || /^\/login/.test(path), blocked: /Verify you are human|Checking your browser|自动化访问已被|异常访问请验证/.test(body),
      video: v ? { time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0, paused: v.paused, ended: v.ended, readyState: v.readyState, error: v.error?.code || null, playbackRate: globalThis.TongxuetangPlayback?.read(v) ?? v.playbackRate } : null,
      questions: qs, canJoin: enrollment.canJoin, joinReady: document.readyState === 'complete', joinConfirm: enrollment.confirm, joinBlocked: enrollment.blocked, resultEvidence, confirmOpen: !!modal, confirmButton: !!modal?.querySelector('#testpaper-finish-btn'), captions: captions.join('\n'), questionCount: qs.length };
  }
  function currentPaper(expected) {
    const s = snapshot(); if (C.fingerprint(s.questions) !== expected) throw Error('试卷发生变化，已停止操作。'); return s;
  }
  async function perform(command) {
    const documents = docs();
    if (command.type === 'navigate') { const url = C.safeURL(command.url); if (!url) throw Error('拒绝非同学堂页面跳转'); location.assign(url); return; }
    if (command.type === 'joinCourse') {
      if (document.readyState !== 'complete') throw Error('课程页面尚未加载完成，请稍候再继续');
      if (C.courseId(location.href) !== command.courseId) throw Error('课程已变化，停止加入学习');
      const info = joinInfo(documents);
      if (info.blocked) throw Error(info.blocked);
      if (!info.canJoin || (info.confirm ? 'confirm' : 'initial') !== command.stage) throw Error('加入学习入口已变化，请检查课程窗口后继续');
      if (globalThis.TongxuetangDesktopJoinClick) {
        if (info.control.ownerDocument !== document) throw Error('加入入口位于嵌入页面，请手动处理');
        info.control.scrollIntoView({block:'center',inline:'nearest'});
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const latest = joinInfo(docs());
        if (latest.blocked || latest.control !== info.control || !latest.canJoin || (latest.confirm ? 'confirm' : 'initial') !== command.stage) throw Error(latest.blocked || '加入学习按钮已变化，请检查页面后继续');
        const rect = latest.control.getBoundingClientRect(), point = {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
        const cover = document.elementFromPoint(point.x,point.y);
        if (cover !== latest.control && !latest.control.contains(cover)) throw Error('加入学习按钮被遮挡，请检查课程窗口后继续');
        const result = await globalThis.TongxuetangDesktopJoinClick({courseId:command.courseId,stage:command.stage,point});
        if (!result?.ok) throw Error(result?.error || '课程窗口未接受加入学习点击');
      } else info.control.click();
      return;
    }
    if (command.type === 'reload') { location.reload(); return; }
    if (command.type === 'pauseVideo') { const v = find(documents, 'video'); v?.pause(); return; }
    if (command.type === 'play') { const v = find(documents, 'video'); if (!v) throw Error('未找到视频'); globalThis.TongxuetangPlayback?.scan(); await v.play(); return; }
    if (command.type === 'startQuiz') { const el = find(documents, 'a', e => visible(e) && /^(开始考试|继续考试)$/.test(e.innerText.trim())); if (!el) throw Error('未找到考试入口'); el.click(); return; }
    if (command.type === 'fill') {
      const s = currentPaper(command.fingerprint);
      for (const answer of command.answers) {
        const q = s.questions.find(q => q.id === answer.id); if (!C.validateAnswer(q, answer)) throw Error('答案与题目不匹配');
        const el = find(documents, '.js-testpaper-question', e => e.id === q.id || ('question' + controls(e)[0]?.name) === q.id);
        for (const input of controls(el)) {
          const label = (input.closest('label') || input.parentElement).innerText.trim(); const wanted = answer.selected.includes(label);
          if (input.disabled) throw Error('题目不可编辑');
          if ((input.type === 'checkbox' && input.checked !== wanted) || (input.type === 'radio' && wanted && !input.checked)) input.click();
        }
      }
      return;
    }
    if (command.type === 'openSubmit' || command.type === 'confirmSubmit') {
      const s = currentPaper(command.fingerprint);
      if (!s.questions.length || s.questions.some(q => !q.selected.length || (q.type !== 'multi' && q.selected.length !== 1))) throw Error('存在漏答题，停止交卷');
      if (!Array.isArray(command.answers) || s.questions.some(q => !C.matches(q, command.answers.find(a => a.id === q.id)))) throw Error('页面选项与已校验答案不同，停止交卷');
      const selector = command.type === 'openSubmit' ? '#finishPaper' : '#testpaper-finished-dialog #testpaper-finish-btn';
      const button = find(documents, selector); if (!button || button.disabled) throw Error('交卷控件尚未准备好'); button.click(); return;
    }
    throw Error('未支持的操作');
  }
  async function scan(allPages = false) {
    if (!/^\/course\/explore/.test(location.pathname)) throw Error('请先在网站打开“高等讲堂”的课程列表。');
    const courses = new Map();
    const collect = d => { for (const a of d.querySelectorAll('a[href]')) { const url = C.safeURL(a.getAttribute('href')); const id = url && new URL(url).pathname.match(/^\/course\/(\d+)\/?$/)?.[1]; const title = a.textContent.trim() || a.querySelector('img')?.alt?.trim(); if (id && title) courses.set(id, { id, title }); } };
    collect(document);
    if (allPages) {
      let maxPage = 1;
      for (const a of document.querySelectorAll('a[href]')) { try { const u = new URL(a.href); if (u.pathname === location.pathname) maxPage = Math.max(maxPage, Number(u.searchParams.get('page')) || 1); } catch {} }
      if (maxPage > 50) throw Error('超过50页，请按年份筛选后再读取。');
      const here = Number(new URL(location.href).searchParams.get('page')) || 1;
      for (let page = 1; page <= maxPage; page++) { if (page === here) continue; const url = new URL(location.href); url.searchParams.set('page', page); const response = await fetch(url, {credentials:'same-origin'}); if (!response.ok) throw Error('读取第' + page + '页失败'); const text = await response.text(); if (/登录统一身份认证/.test(text)) throw Error('登录已失效'); collect(new DOMParser().parseFromString(text, 'text/html')); await new Promise(r => setTimeout(r, 350)); }
    }
    return [...courses.values()];
  }
  globalThis.TongxuetangPage = { snapshot, questions, docs, perform, scan };
  if (!globalThis.chrome?.runtime?.id) return;
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'SCAN') { scan(!!message.allPages).then(courses => reply({courses})).catch(e => reply({error:e.message})); return true; }
    if (message.type === 'INSPECT') { reply(snapshot()); return; }
    if (message.type === 'PAUSE_VIDEO') { perform({type:'pauseVideo'}).then(() => reply({ok:true})); return true; }
  });
  let busy = false;
  async function tick() {
    if (busy || document.readyState === 'loading') return; busy = true;
    try { globalThis.TongxuetangPlayback?.scan(); const s = snapshot(); s.playback=globalThis.TongxuetangPlayback?.state(); const response = await chrome.runtime.sendMessage({type:'PULSE', snapshot:s}); if (response?.command) {
      try { await perform(response.command); } catch (e) { await chrome.runtime.sendMessage({type:'ACTION_ERROR', error:e.name === 'NotAllowedError' ? '浏览器阻止自动播放，请手动点一次播放，再继续。' : e.message}); }
    } } catch {} finally { busy = false; }
  }
  tick(); setInterval(tick, 3000);
})();

ipcRenderer.on('course:playback',(_event,settings)=>globalThis.TongxuetangPlayback.set(settings));
ipcRenderer.invoke('course:playback-get').then(settings=>globalThis.TongxuetangPlayback.set(settings)).catch(()=>{});
}
