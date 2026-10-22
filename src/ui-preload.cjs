'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('assistant',{invoke:(type,arg={})=>ipcRenderer.invoke('app:invoke',{type,arg})});
