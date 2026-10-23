'use strict';
const C=require('./core.cjs');
function sendJoinClick(webContents,run,message,bounds){
 const current=run?.courses?.[run.index],attempt=run?.joinAttempt;
 if(run?.status!=='running'||!current||current.id!==message.courseId||attempt?.courseId!==current.id||attempt.stage!==message.stage)throw Error('加入学习请求与当前运行计划不匹配');
 const url=webContents.getURL();
 if(!C.safeURL(url)||C.courseId(url)!==current.id||new URL(url).pathname.includes('/task/'))throw Error('课程页面已变化，停止加入学习');
 if(!['initial','confirm'].includes(message.stage))throw Error('加入学习阶段无效');
 const {x,y}=message.point||{};
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=bounds.width||y>=bounds.height)throw Error('加入学习按钮不在课程窗口内');
 const point={x:Math.floor(x),y:Math.floor(y)};
 webContents.sendInputEvent({type:'mouseMove',...point});
 webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
 webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
 return {ok:true};
}
module.exports={sendJoinClick};
