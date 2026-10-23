'use strict';
const fs=require('node:fs'),path=require('node:path');
const SITE='https://tongxuetang.tongji.edu.cn';
function taskURL(url){try{const u=new URL(url);return u.origin===SITE&&/^\/course\/\d+\/task\/\d+(?:\/|$)/.test(u.pathname);}catch{return false;}}
const vendor=['everything-hook.js','timer-hooker.user.js'].map(name=>fs.readFileSync(path.join(__dirname,'vendor',name),'utf8')).join('\n;\n');
function code(settings){
 const config=JSON.stringify({rate:settings.playbackRate,enabled:settings.timerHookerEnabled===true});
 return `(() => {
  const config=${config};
  const active=config.enabled&&!!document.querySelector('video')&&!document.querySelector('.js-testpaper-question');
  if(!active&&!window.__tongjiTimerInstalled)return {installed:false,active:false};
  try {
   if(active&&!window.__tongjiTimerInstalled){
    ${vendor}
    if(!window.timer||typeof window.timer.change!=='function')throw Error('脚本依赖未能初始化');
    window.isDOMLoaded=document.readyState!=='loading';
    window.__tongjiTimerInstalled=true;
   }
   const percentage=active?1/config.rate:1;
   if(window.timer._percentage!==percentage)window.timer.change(percentage);
   else if(active)window.timer.changeVideoSpeed();
   return {installed:true,active};
  }catch(e){return {installed:!!window.__tongjiTimerInstalled,active:false,error:String(e.message).slice(0,250)};}
 })()`;
}
async function applyUserscript(wc,settings){
 if(!taskURL(wc.getURL()))return [];
 const frames=wc.mainFrame.framesInSubtree;
 return Promise.all(frames.map(async frame=>{
  try{if(new URL(frame.url).origin!==SITE)return null;return await frame.executeJavaScript(code(settings));}
  catch(e){return {error:String(e.message).slice(0,250)};}
 }));
}
module.exports={taskURL,code,applyUserscript};
