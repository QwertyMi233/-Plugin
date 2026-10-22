'use strict';
// The pinned builder already includes a native NSIS uninstaller reader, normally
// used on macOS. Use that same reader for the intermediate uninstaller on Linux
// so an unsigned build does not require executing Windows binaries in Wine.
if(process.platform==='linux'){
 const {WineVmManager}=require('app-builder-lib/out/vm/WineVm.js');
 const {UninstallerReader}=require('app-builder-lib/out/targets/nsis/nsisUtil.js');
 const original=WineVmManager.prototype.exec;
 WineVmManager.prototype.exec=function(file,args,options){
  if(options?.env?.__COMPAT_LAYER==='RunAsInvoker'&&(!args||!args.length))return UninstallerReader.exec(file,file.slice(0,-3)+'__uninstaller.exe');
  return original.call(this,file,args,options);
 };
}
const {build,Platform,Arch}=require('electron-builder');
build({targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),publish:'never'}).then(files=>console.log('Built:',files.join('\n'))).catch(error=>{console.error(error.message);process.exitCode=1;});
