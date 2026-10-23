'use strict';
const DEFAULT_PLAYBACK={playbackRate:1,timerHookerEnabled:false};
function playbackSettings(input={}){
 const raw=input.playbackRate===undefined?1:input.playbackRate;
 const rate=typeof raw==='number'||typeof raw==='string'&&raw.trim()?Number(raw):NaN;
 if(!Number.isFinite(rate)||rate<0.25||rate>16)throw Error('视频倍速须为 0.25 至 16 之间的数字');
 if(input.timerHookerEnabled!==undefined&&typeof input.timerHookerEnabled!=='boolean')throw Error('脚本开关格式无效');
 return {playbackRate:rate,timerHookerEnabled:input.timerHookerEnabled===true};
}
module.exports={DEFAULT_PLAYBACK,playbackSettings};
