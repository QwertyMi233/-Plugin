'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const button='<a class="btn btn-primary js-buy-btn btn-lg" href="javascript:" data-url="/course/3381/buy">加入学习</a>';
function page(html,url='https://tongxuetang.tongji.edu.cn/course/3381'){
 const dom=new JSDOM('<html><body>'+html+'</body></html>',{url,runScripts:'outside-only'}),w=dom.window;
 Object.defineProperty(w.document,'readyState',{get:()=> 'complete',configurable:true});
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 // jsdom has no layout; model visibility for DOM behavior checks only.
 w.Element.prototype.getClientRects=function(){for(let el=this;el;el=el.parentElement)if(el.hidden||el.style?.display==='none')return [];return [{}];};
 for(const file of ['core.cjs','page-agent.js'])w.eval(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'));
 return {dom,w,api:w.TongxuetangPage,C:w.TongxuetangCore};
}
test('真实按钮结构：加入学习点击后显示去学习；课程介绍各子页可识别',async()=>{
 for(const suffix of ['', '/tasks','/material_summary']){const {dom,w,api}=page(button,'https://tongxuetang.tongji.edu.cn/course/3381'+suffix);let clicks=0;w.document.querySelector('a').onclick=()=>{clicks++;w.document.body.innerHTML='<a href="/my/course/3381">去学习</a>';};const s=api.snapshot();assert.equal(s.kind,'public');assert.equal(s.canJoin,true);await api.perform({type:'joinCourse',courseId:'3381',stage:'initial'});assert.equal(clicks,1);assert.equal(api.snapshot().goLearn,'https://tongxuetang.tongji.edu.cn/my/course/3381');dom.window.close();}
});
test('加入学习→普通免费确认→等待目录，原按钮不被重复点击',async()=>{
 const {dom,w,api,C}=page(button);let initial=0,confirmed=0;w.document.querySelector('a').onclick=()=>{initial++;const modal=w.document.createElement('div');modal.className='modal in';modal.innerHTML='<button>确认加入学习</button>';modal.querySelector('button').onclick=()=>{confirmed++;w.document.body.innerHTML='<a href="/my/course/3381">去学习</a>';};w.document.body.append(modal);};
 const r={courses:[{id:'3381'}],index:0,startedAt:1,pageSince:1};for(const at of [1000,2000]){const d=C.decide(r,api.snapshot(),C.DEFAULTS,at);Object.assign(r,d.patch);await api.perform(d.command);}assert.equal(initial,1);assert.equal(confirmed,1);assert.equal(api.snapshot().goLearn,'https://tongxuetang.tongji.edu.cn/my/course/3381');dom.window.close();
});
test('遇到协议、付款、复选确认等弹窗时不点击',async()=>{
 for(const text of ['请阅读并同意协议','支付 10 元','订单确认','<input type="checkbox">确认信息']){const {dom,w,api}=page(button+'<div class="modal in">'+text+'<button>确认加入学习</button></div>');let clicked=0;w.document.querySelector('.modal button').onclick=()=>clicked++;assert.ok(api.snapshot().joinBlocked);await assert.rejects(api.perform({type:'joinCourse',courseId:'3381',stage:'confirm'}));assert.equal(clicked,0);dom.window.close();}
});
test('隐藏、禁用、其他课程和站外入口不会被点击',async()=>{
 for(const html of ['<div hidden>'+button+'</div>','<button disabled>加入学习</button>','<a href="/course/999/buy">加入学习</a>','<a href="https://evil.example/course/3381/buy">加入学习</a>']){const {dom,w,api}=page(html);let clicks=0;for(const el of w.document.querySelectorAll('a,button'))el.onclick=()=>clicks++;assert.equal(api.snapshot().canJoin,false);await assert.rejects(api.perform({type:'joinCourse',courseId:'3381',stage:'initial'}));assert.equal(clicks,0);dom.window.close();}
});
test('点击前重新核对课程和弹窗阶段，页面变化时停止',async()=>{
 const {dom,api}=page(button);await assert.rejects(api.perform({type:'joinCourse',courseId:'999',stage:'initial'}));await assert.rejects(api.perform({type:'joinCourse',courseId:'3381',stage:'confirm'}));dom.window.close();
});

test('桌面预加载调用原生点击桥接，入口被遮挡时阻止点击',async()=>{
 for(const covered of [false,true]){const {dom,w,api}=page(button);const control=w.document.querySelector('a');let bridgeCalls=0,scriptClicks=0;control.onclick=()=>scriptClicks++;control.scrollIntoView=()=>{};control.getBoundingClientRect=()=>({left:100,top:200,width:80,height:40});w.document.elementFromPoint=()=>covered?w.document.body:control;w.requestAnimationFrame=fn=>fn();w.TongxuetangDesktopJoinClick=async payload=>{bridgeCalls++;assert.equal(payload.courseId,'3381');assert.equal(payload.point.x,140);assert.equal(payload.point.y,220);return {ok:true};};const action=api.perform({type:'joinCourse',courseId:'3381',stage:'initial'});if(covered)await assert.rejects(action,/遮挡/);else await action;assert.equal(bridgeCalls,covered?0:1);assert.equal(scriptClicks,0);dom.window.close();}
});
test('页面未加载完成不发送加入点击',async()=>{const {dom,w,api}=page(button);Object.defineProperty(w.document,'readyState',{get:()=> 'loading'});assert.equal(api.snapshot().joinReady,false);await assert.rejects(api.perform({type:'joinCourse',courseId:'3381',stage:'initial'}),/加载/);dom.window.close();});
