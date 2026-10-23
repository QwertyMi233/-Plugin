// Owned local fixture only: protocol handler prevents requests to the school.
'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron');const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');const {applyUserscript}=require('../src/userscript.cjs');
const root=path.resolve(__dirname,'../src'),url='https://tongxuetang.tongji.edu.cn/course/3382/task/1/show';let win,ui;
app.commandLine.appendSwitch('disable-gpu');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function actual(){return win.webContents.executeJavaScript("Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'playbackRate').get.call(document.querySelector('video'))");}
app.whenReady().then(async()=>{
 let settings={playbackRate:2,timerHookerEnabled:false};
 const s=session.fromPartition('smoke-fixture');await s.protocol.handle('https',req=>new Response(req.url.includes('/frame')?'<video></video>':'<!doctype html><title>本地视频测试</title><video></video><iframe src="/frame"></iframe>',{headers:{'content-type':'text/html'}}));
 ipcMain.handle('course:playback-get',()=>settings);ipcMain.handle('course:message',()=>({}));
 win=new BrowserWindow({show:false,webPreferences:{partition:'smoke-fixture',preload:path.join(root,'course-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const errors=[];win.webContents.on('preload-error',(_e,_p,err)=>errors.push(err.message));
 await win.loadURL(url);await delay(400);assert.deepEqual(errors,[]);assert.equal(await actual(),2);
 settings={playbackRate:4,timerHookerEnabled:true};win.webContents.send('course:playback',settings);await delay(100);
 let results=await applyUserscript(win.webContents,{playbackRate:4,timerHookerEnabled:true});assert.equal(results.filter(r=>r?.active).length,2,JSON.stringify(results));assert.equal(await actual(),4);
 const frame=win.webContents.mainFrame.framesInSubtree.find(f=>f.url.endsWith('/frame'));assert.equal(await frame.executeJavaScript("Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'playbackRate').get.call(document.querySelector('video'))"),4);
 settings={playbackRate:4,timerHookerEnabled:true};win.webContents.send('course:playback',settings);await delay(100);
 // INSPECT goes through the actual generated preload and isolated world.
 const inspect=new Promise(resolve=>ipcMain.once('course:reply',(_e,m)=>resolve(m.result)));win.webContents.send('course:request',{id:'inspect',message:{type:'INSPECT'}});const snapshot=await inspect;assert.equal(snapshot.video.playbackRate,4);
 await applyUserscript(win.webContents,{playbackRate:1,timerHookerEnabled:false});settings={playbackRate:1,timerHookerEnabled:false};win.webContents.send('course:playback',settings);await delay(100);assert.equal(await actual(),1);
 let calls=[];const state={settings:{...settings,provider:'deepseek',model:'deepseek-flash',notes:'',maxCourses:3,maxCalls:20,autoJoin:true,autoSubmit:true},queue:[],logs:[],keyStatus:{},run:null,playback:{actual:1}};
 ipcMain.handle('app:invoke',(_e,m)=>{calls.push(m);if(m.type==='GET')return state;if(m.type==='SAVE_PLAYBACK')Object.assign(state.settings,m.arg);return {ok:true};});
 ui=new BrowserWindow({show:true,width:1230,height:1150,webPreferences:{preload:path.join(root,'ui-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});await ui.loadFile(path.join(root,'index.html'));await delay(300);
 await ui.webContents.executeJavaScript("document.getElementById('playbackRate').value='2';document.getElementById('applyPlayback').click()");await delay(100);assert.equal(calls.find(m=>m.type==='SAVE_PLAYBACK').arg.playbackRate,'2');
 await delay(500);if(process.env.TONGJI_SCREENSHOT)fs.writeFileSync(process.env.TONGJI_SCREENSHOT,(await ui.webContents.capturePage()).toPNG());
 console.log('ELECTRON_SMOKE_OK: isolated preload, real media rate, main/iframe userscript, disable/reset and homepage control');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
setTimeout(()=>{console.error('SMOKE_TIMEOUT');app.exit(1);},25000).unref();
