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
