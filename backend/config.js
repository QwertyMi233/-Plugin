'use strict';
const $=id=>document.getElementById(id);
let token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
history.replaceState(null,'',location.pathname);
$('token').value=token;
async function api(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data;}
$('form').addEventListener('submit',async event=>{event.preventDefault();try{await api('/config',{apiKey:$('apiKey').value.trim(),model:$('model').value.trim()});$('apiKey').value='';$('status').textContent='已配置。回到插件设置，保存连接口令后点击“测试云端 AI”。';}catch(e){$('status').textContent=e.message;}});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(token);$('status').textContent='已复制连接口令。';}catch{$('token').select();$('status').textContent='请按 Ctrl+C 复制。';}});
if(token)api('/health').then(data=>{$('model').value=data.model;$('status').textContent=data.configured?'服务已配置，可以回到插件测试。':'请填写 OpenAI API Key。';}).catch(e=>{$('status').textContent=e.message;});else $('status').textContent='请从服务启动窗口提供的完整配置链接进入。';
