'use strict';
const fs=require('node:fs');
const path=require('node:path');
const PROVIDERS=Object.freeze({deepseek:{name:'DeepSeek',model:'deepseek-flash',url:'https://api.deepseek.com/responses'},openai:{name:'OpenAI',model:'gpt-6-luna',url:'https://api.openai.com/v1/responses'}});
const {DEFAULT_PLAYBACK,playbackSettings}=require('./playback-settings.cjs');
const DEFAULTS={...DEFAULT_PLAYBACK,provider:'deepseek',model:'deepseek-flash',autoSubmit:true,autoJoin:true,notes:'',maxCalls:20,maxCourses:3};
class Store {
  constructor(directory,safeStorage){
    this.dir=directory;this.file=path.join(directory,'settings.json');this.vault=safeStorage;this.sessionKeys=new Map();
    fs.mkdirSync(directory,{recursive:true});
    try{this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(this.data.version!==2||!this.data.settings||typeof this.data.secrets!=='object')throw Error('bad');}
    catch(e){if(e.code!=='ENOENT'&&fs.existsSync(this.file)){fs.renameSync(this.file,this.file+'.unreadable-'+Date.now());this.recoveryMessage='旧设置文件无法读取，已保留副本，请重新配置。';}this.data={version:2,settings:{...DEFAULTS},secrets:{},queue:[],run:null,logs:[],cache:{}};}
    this.data.settings={...DEFAULTS,...this.data.settings};
    try{Object.assign(this.data.settings,playbackSettings(this.data.settings));}catch{Object.assign(this.data.settings,DEFAULT_PLAYBACK);}
    this.data.queue ||= [];this.data.logs ||= [];this.data.cache ||= {};
    if(this.data.run?.status==='running'){this.data.run.status='paused';this.data.run.phase='软件已重新打开，请确认登录状态后点击继续。';this.data.run.paper=null;this.data.run.aiNonce=String(Date.now());}
    this.flush();
  }
  flush(){const tmp=this.file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(this.data,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,this.file);}
  update(values){Object.assign(this.data,values);this.flush();}
  key(provider=this.data.settings.provider){
    if(!PROVIDERS[provider])throw Error('未知 AI 服务商');
    if(this.sessionKeys.has(provider))return this.sessionKeys.get(provider);
    const encrypted=this.data.secrets[provider];if(!encrypted)return '';
    try{return this.vault.decryptString(Buffer.from(encrypted,'base64'));}catch{throw Error('无法解密已保存密钥。请在当前系统账户重新填写并保存。');}
  }
  hasKey(provider=this.data.settings.provider){try{return !!this.key(provider);}catch{return false;}}
  setKey(provider,key,remember=true){
    if(!PROVIDERS[provider]||typeof key!=='string'||key.trim().length<10||key.length>1000)throw Error('请填写有效的 API 密钥');
    key=key.trim();
    if(remember){if(!this.vault.isEncryptionAvailable())throw Error('操作系统加密不可用，无法安全保存密钥。可关闭“加密记住密钥”临时使用。');const encrypted=this.vault.encryptString(key).toString('base64');this.data.secrets[provider]=encrypted;this.sessionKeys.delete(provider);}
    else{this.sessionKeys.set(provider,key);delete this.data.secrets[provider];}
    this.flush();
  }
  forget(provider){this.sessionKeys.delete(provider);delete this.data.secrets[provider];this.flush();}
  saveSettings(input){
    if(!input||!PROVIDERS[input.provider])throw Error('请选择支持的 AI 服务商');
    if(typeof input.model!=='string'||!/^[-A-Za-z0-9_.:]{1,100}$/.test(input.model))throw Error('模型名称格式无效');
    const settings={...playbackSettings({...this.data.settings,...input}),provider:input.provider,model:input.model,autoSubmit:!!input.autoSubmit,autoJoin:input.autoJoin!==false,notes:String(input.notes||'').slice(0,100000),maxCalls:Math.max(1,Math.min(100,Math.trunc(Number(input.maxCalls)||20))),maxCourses:Math.max(1,Math.min(100,Math.trunc(Number(input.maxCourses)||3)))};
    if(input.apiKey?.trim())this.setKey(settings.provider,input.apiKey,input.remember!==false);
    this.data.settings=settings;this.flush();return settings;
  }
  savePlayback(input){Object.assign(this.data.settings,playbackSettings(input));this.flush();return this.data.settings;}
  publicState(){const {settings,queue,run,logs}=this.data;return {settings,queue,run:run?{status:run.status,phase:run.phase,index:run.index,courses:run.courses,aiCalls:run.aiCalls,preview:run.preview}:null,logs,keyStatus:Object.fromEntries(Object.keys(PROVIDERS).map(p=>[p,{configured:this.hasKey(p),remembered:!!this.data.secrets[p]}])),encryptionAvailable:this.vault.isEncryptionAvailable(),recoveryMessage:this.recoveryMessage||''};}
}
module.exports={Store,PROVIDERS,DEFAULTS};
