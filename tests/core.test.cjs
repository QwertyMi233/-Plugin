'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core.cjs');
const question=(id='q1',type='single',stem='题目（D）')=>({id,type,stem,options:['A','B','C','D'].map((label,i)=>({label,text:'选项'+label,value:String(i)})),selected:[]});
const run=()=>({courses:[{id:'3382',title:'测试课程'}],index:0,startedAt:1000,pageSince:1000,confirmed:[]});
const snap=kind=>({courseId:'3382',kind,tasks:[],questions:[],taskId:'44621'});
test('限定同学堂域名和课程编号',()=>{assert.equal(C.courseId(C.SITE+'/my/course/3382'),'3382');assert.equal(C.courseId('https://other.example/course/3382'),null);assert.equal(C.safeURL('https://tongxuetang.tongji.edu.cn.evil.example/'),null);assert.equal(C.safeURL('https://a:b@tongxuetang.tongji.edu.cn/'),null);assert.equal(C.safeURL('javascript:alert(1)'),null);assert.throws(()=>C.courseURL('../x'));});
test('严格识别末尾提示，单选不能有多个答案',()=>{assert.deepEqual(C.hint(question()).selected,['D']);assert.deepEqual(C.hint(question('q','multi','题目 (A、B D)')).selected,['A','B','D']);assert.equal(C.hint(question('q','single','题目（AB）')),null);assert.equal(C.hint(question('q','multi','题目（Z）')),null);assert.equal(C.hint(question('q','single','题目（A）补充文本')),null);assert.equal(C.hint(question('q','judge','题目（A）')),null);});
test('答案按题号对应，拒绝漏题、重复和不存在的选项',()=>{const q=question();assert.equal(C.validateAnswer(undefined,{id:'q1',selected:['A']}),false);assert.equal(C.validateAnswer(q,{id:'q2',selected:['A']}),false);assert.equal(C.validateAnswer(q,{id:'q1',selected:[]}),false);assert.equal(C.validateAnswer(q,{id:'q1',selected:['Z']}),false);assert.equal(C.validateAnswer(q,{id:'q1',selected:['A','A']}),false);assert.equal(C.validateAnswer(q,{id:'q1',selected:['D']}),true);});
test('学习完成提示文字不会被当作课程计数',()=>{assert.equal(C.parseProgress('任务完成 满足以下条件: 学习到最后。'),null);assert.deepEqual(C.parseProgress('已完成 0 / 2 任务'),{done:0,total:2});});
test('只跳过平台标记完成的任务',()=>{const r=run(),s=snap('course');s.progress={done:1,total:2};s.tasks=[{id:'v',done:true,type:'video',url:C.SITE+'/course/3382/task/1/show'},{id:'q',done:false,type:'quiz',url:C.SITE+'/course/3382/task/2/show'}];assert.equal(C.decide(r,s,C.DEFAULTS,2000).command.url,s.tasks[1].url);s.progress={done:2,total:2};assert.equal(C.decide(r,s,C.DEFAULTS,2000).advance,true);});
test('视频结束先回目录核对，不能直接标记完成',()=>{const r=run(),s=snap('video');s.taskId='v';s.video={ended:true,duration:20};const decision=C.decide(r,s,C.DEFAULTS,3000);assert.equal(decision.patch.pending.id,'v');assert.equal(decision.advance,undefined);assert.equal(decision.command.url,C.courseURL('3382'));});
test('平台未更新进度时等待，超时暂停',()=>{const r=run();r.pending={id:'q',before:1,since:1000};const s=snap('course');s.progress={done:1,total:2};s.tasks=[{id:'q',done:false}];assert.equal(C.decide(r,s,C.DEFAULTS,200000).advance,undefined);assert.match(C.decide(r,s,C.DEFAULTS,200000).pause,/尚未确认/);s.tasks[0].done=true;assert.deepEqual(C.decide(r,s,C.DEFAULTS,200000).patch.confirmed,['q']);});
test('自动填写、手动交卷模式、两阶段交卷及防重复提交',()=>{const r=run(),s=snap('quiz'),q=question();s.questions=[q];r.paper={fingerprint:C.fingerprint(s.questions),answers:[{id:q.id,selected:['D']}]};assert.equal(C.decide(r,s,C.DEFAULTS,3000).command.type,'fill');q.selected=['D'];assert.match(C.decide(r,s,{...C.DEFAULTS,autoSubmit:false},3000).pause,/手动交卷/);assert.equal(C.decide(r,s,C.DEFAULTS,3000).command.type,'openSubmit');s.confirmOpen=true;s.confirmButton=true;let d=C.decide(r,s,C.DEFAULTS,3000);assert.equal(d.command.type,'confirmSubmit');assert.ok(d.command.answers);Object.assign(r,d.patch);assert.equal(C.decide(r,s,C.DEFAULTS,15000).command,undefined);assert.match(C.decide(r,s,C.DEFAULTS,60000).pause,/重复交卷/);});
test('手动交卷后同样回目录核对',()=>{const r=run();r.paper={answers:[{id:'q',selected:['A']}]};const s=snap('result');assert.equal(C.decide(r,s,C.DEFAULTS,3000).command.url,C.courseURL('3382'));});
test('登录、验证和页面异常会暂停',()=>{assert.match(C.decide(run(),{...snap('unknown'),login:true},C.DEFAULTS,2000).pause,/登录/);assert.match(C.decide(run(),{...snap('unknown'),blocked:true},C.DEFAULTS,2000).pause,/验证/);assert.ok(C.decide(run(),snap('unknown'),C.DEFAULTS,100000).pause);});

test('成绩页标记覆盖批阅完成、通过考试和成绩汇总，不把普通说明当结果',()=>{
 for(const text of ['批阅完成','恭喜您已通过本次考试。','阅卷已完成','答对 1 题 答错 0 题 未答 0 题 得分 100.0 分'])assert.ok(C.examResultMarker(text),text);
 for(const text of ['本次考试共10题，总分100.0分，及格为0分','答题中','完成后查看得分'])assert.equal(C.examResultMarker(text),null);
});
test('恢复时已在成绩页也返回目录核对；未知交卷结果不直接完成课程',()=>{
 const run={courses:[{id:'3382'}],index:0,confirmed:[],startedAt:1,pageSince:1};
 const snapshot={url:C.SITE+'/course/3382/task/44621/show',courseId:'3382',taskId:'44621',kind:'result',tasks:[],questions:[]};
 const result=C.decide(run,snapshot,C.DEFAULTS,100000);assert.equal(result.command.url,C.courseURL('3382'));assert.equal(result.advance,undefined);assert.equal(result.patch.pending.id,'44621');
 const fallback=C.decide({...run,submittedAt:70000},{...snapshot,kind:'unknown'},C.DEFAULTS,100000);assert.equal(fallback.command.url,C.courseURL('3382'));assert.equal(fallback.advance,undefined);
});

test('目录控件尚未加载时先等待，不立即暂停',()=>{const r=run(),s=snap('course');assert.equal(C.decide(r,s,C.DEFAULTS,2000).patch.phase,'等待课程目录加载');assert.ok(C.decide(r,s,C.DEFAULTS,20000).pause);});
