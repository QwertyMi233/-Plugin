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
