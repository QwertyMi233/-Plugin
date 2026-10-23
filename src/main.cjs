'use strict';
const {app,BrowserWindow,ipcMain,protocol,safeStorage,session,shell,dialog,Menu}=require('electron');
const {applyUserscript}=require('./userscript.cjs');const {playbackSettings}=require('./playback-settings.cjs');
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
const {sendJoinClick}=require('./join-click.cjs');const {Store}=require('./store.cjs');const {AI}=require('./ai.cjs');const {Engine}=require('./engine.cjs');const C=require('./core.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setName('Tongxuetang Assistant');
if(!app.requestSingleInstanceLock()){app.quit();}else{
let mainWindow,courseWindow,store,engine,ai,quitting=false,playbackState=null,scriptBusy=false;const pending=new Map();
const allowedSchool=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='tongji.edu.cn'||u.hostname.endsWith('.tongji.edu.cn'));}catch{return false;}};
function show(window){if(window.isMinimized())window.restore();window.show();window.focus();}
function request(message){return new Promise((resolve,reject)=>{if(!courseWindow||courseWindow.isDestroyed())return reject(Error('请先打开课程窗口'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('课程页面没有响应，请等待加载完成或在课程窗口重新登录'));},message.type==='SCAN'?120000:12000);pending.set(id,{resolve,reject,timer});courseWindow.webContents.send('course:request',{id,message});});}
function createCourse(){
 const win=new BrowserWindow({width:1220,height:850,minWidth:850,minHeight:600,title:'同学堂 · 课程窗口',icon:path.join(__dirname,'icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'course-preload.cjs'),partition:'persist:tongji-course',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false}});courseWindow=win;
 win.webContents.setWindowOpenHandler(({url})=>{if(allowedSchool(url))setImmediate(()=>{if(!win.isDestroyed())win.loadURL(url).catch(()=>{});});return {action:'deny'};});
 win.webContents.on('will-navigate',(event,url)=>{if(!allowedSchool(url))event.preventDefault();});
 win.webContents.on('will-redirect',(event,url)=>{if(!allowedSchool(url))event.preventDefault();});
 win.webContents.on('did-navigate',()=>{if(courseWindow===win)playbackState=null;});
 win.webContents.on('did-finish-load',()=>{if(courseWindow===win)applyPlayback().catch(()=>{});});
 win.webContents.on('did-navigate',(_event,url)=>{if(courseWindow===win&&(url.startsWith('https://iam.tongji.edu.cn/')||url.startsWith(C.SITE+'/login')))engine.serial(()=>{if(store.data.run?.status==='running')engine.pause('需要登录，请在课程窗口完成认证后点击继续');});});
 win.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(courseWindow===win&&isMainFrame&&code!==-3&&store.data.run?.status==='running')engine.serial(()=>engine.pause('课程页面加载失败，请检查网络后继续'));});
 win.on('closed',()=>{if(courseWindow!==win)return;courseWindow=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('课程窗口已关闭'));}pending.clear();if(!quitting&&store.data.run?.status==='running')engine.serial(()=>engine.pause('课程窗口已关闭，点击继续可重新打开'));});return win;
}
async function applyPlayback(){
 if(!courseWindow||courseWindow.isDestroyed())return;
 const wc=courseWindow.webContents,settings=playbackSettings(store.data.settings);
 wc.send('course:playback',settings);
 if(scriptBusy)return;scriptBusy=true;
 try{const results=await applyUserscript(wc,settings);const error=results.find(r=>r?.error)?.error;if(playbackState)playbackState.scriptError=error||'';else if(error)playbackState={scriptError:error};}
 finally{scriptBusy=false;}
}
const browser={
 applyPlayback,
 async open(url){if(!allowedSchool(url))throw Error('拒绝非学校地址');const win=courseWindow&&!courseWindow.isDestroyed()?courseWindow:createCourse();show(win);await win.loadURL(url);},
 async switchCourse(url){if(!allowedSchool(url))throw Error('拒绝非学校地址');const old=courseWindow,win=createCourse();try{await win.loadURL(url);}catch(error){courseWindow=old&&!old.isDestroyed()?old:null;if(!win.isDestroyed())win.destroy();throw error;}show(win);if(old&&!old.isDestroyed())old.destroy();},
 async focusOrOpen(url){if(courseWindow&&!courseWindow.isDestroyed()){show(courseWindow);return;}return this.open(url);},
 request,async inspect(){return request({type:'INSPECT'});},async pauseVideo(){return request({type:'PAUSE_VIDEO'});}
};
app.on('second-instance',()=>{if(mainWindow)show(mainWindow);});
app.whenReady().then(()=>{
 protocol.handle('app',async req=>{const u=new URL(req.url),files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/app.css':'app.css','/icon.png':'icon.png'};const file=u.hostname==='assistant'?files[u.pathname]:null;if(!file)return new Response('Not found',{status:404});const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};return new Response(fs.readFileSync(path.join(__dirname,file)),{headers:{'Content-Type':types[path.extname(file)],'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});});
 if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}]));
 store=new Store(app.getPath('userData'),safeStorage);ai=new AI(store);engine=new Engine(store,ai,browser);
 const courseSession=session.fromPartition('persist:tongji-course');courseSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));courseSession.setPermissionCheckHandler(()=>false);
 mainWindow=new BrowserWindow({width:1230,height:920,minWidth:920,minHeight:680,title:'同学堂助手',icon:path.join(__dirname,'icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'ui-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));mainWindow.webContents.on('will-navigate',event=>event.preventDefault());mainWindow.loadURL('app://assistant/index.html');
 ipcMain.handle('app:invoke',(event,message)=>{if(event.sender!==mainWindow.webContents||event.senderFrame?.url!=='app://assistant/index.html'||event.senderFrame.parent)throw Error('无效设置页面来源');const type=message?.type,arg=message?.arg||{};
  if(type==='GET')return {...store.publicState(),playback:playbackState};
  if(type==='OPEN_KEY_PAGE'){const provider=store.data.settings.provider;return shell.openExternal(provider==='deepseek'?'https://platform.deepseek.com/api_keys':'https://platform.openai.com/api-keys').then(()=>({ok:true}));}
  if(type==='OPEN_DATA'){return shell.openPath(app.getPath('userData')).then(error=>{if(error)throw Error(error);return {ok:true};});}
  if(type==='EXPORT'){return engine.serial(async()=>{const target=await dialog.showSaveDialog(mainWindow,{defaultPath:'tongxuetang-log.json',filters:[{name:'JSON',extensions:['json']}]});if(target.canceled)return {canceled:true};const {settings,queue,run,logs}=store.publicState();fs.writeFileSync(target.filePath,JSON.stringify({version:app.getVersion(),settings:{...settings,notes:'[未导出资料]'},queue,run,logs},null,2),'utf8');return {ok:true};});}
  if(type==='INSPECT_EXPORT'){return engine.serial(async()=>{const data=await browser.inspect();const target=await dialog.showSaveDialog(mainWindow,{defaultPath:'tongxuetang-page.json',filters:[{name:'JSON',extensions:['json']}]});if(!target.canceled)fs.writeFileSync(target.filePath,JSON.stringify(data,null,2),'utf8');return {ok:!target.canceled};});}
  return engine.serial(()=>engine.dispatch(type,arg)).catch(e=>({error:e.message}));
 });
 ipcMain.handle('course:playback-get',event=>{if(!courseWindow||event.sender!==courseWindow.webContents||event.senderFrame?.parent||!C.safeURL(event.senderFrame?.url||''))throw Error('无效课程窗口来源');return playbackSettings(store.data.settings);});
 ipcMain.handle('course:join-click',(event,message)=>engine.serial(()=>{
  if(!courseWindow||courseWindow.isDestroyed()||event.sender!==courseWindow.webContents||event.senderFrame?.parent||!C.safeURL(event.senderFrame?.url||''))return {error:'无效课程窗口来源'};
  try{const result=sendJoinClick(courseWindow.webContents,store.data.run,message||{},courseWindow.getContentBounds());engine.log('info','已发送加入学习鼠标点击（'+(message.stage==='confirm'?'确认':'入口')+'）；等待平台返回学习目录');store.flush();return result;}catch(error){engine.pause(error.message);return {error:error.message};}
 }));
 ipcMain.handle('course:message',(event,message)=>{if(!courseWindow||event.sender!==courseWindow.webContents||event.senderFrame?.parent||!C.safeURL(event.senderFrame?.url||''))return {};if(message?.type==='PULSE'){const pb=message.snapshot?.playback;playbackState=pb?{target:store.data.settings.playbackRate,actual:typeof pb.actual==='number'&&Number.isFinite(pb.actual)?pb.actual:null,error:String(pb.error||'').slice(0,250),scriptError:playbackState?.scriptError||''}:null;applyPlayback().catch(()=>{});return engine.serial(()=>engine.pulse(message.snapshot));}if(message?.type==='ACTION_ERROR')return engine.serial(()=>{engine.pause(String(message.error||'网页操作失败').slice(0,500));return {};});return {};});
 ipcMain.on('course:reply',(event,message)=>{if(!courseWindow||event.sender!==courseWindow.webContents||event.senderFrame?.parent||!C.safeURL(event.senderFrame?.url||''))return;const p=pending.get(message?.id);if(p){clearTimeout(p.timer);pending.delete(message.id);p.resolve(message.result);}});
 const watchdog=setInterval(()=>{if(store.data.run?.status==='running'&&Date.now()-store.data.run.lastSeen>180000)engine.serial(()=>engine.pause('课程页面三分钟未响应，请检查登录和网络'));},30000);watchdog.unref();
 mainWindow.on('close',()=>{quitting=true;if(store.data.run?.status==='running')engine.pause('软件已关闭，重新打开后点击继续');ai.cancel();if(courseWindow&&!courseWindow.isDestroyed())courseWindow.close();});
 app.on('before-quit',()=>{quitting=true;ai.cancel();store.flush();courseSession.flushStorageData();});
}).catch(error=>{dialog.showErrorBox('同学堂助手启动失败',String(error.message));app.quit();});
app.on('window-all-closed',()=>app.quit());
}
