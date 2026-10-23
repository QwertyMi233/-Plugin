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
