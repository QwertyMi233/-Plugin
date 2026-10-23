'use strict';
const {build,Platform,Arch}=require('electron-builder');
const {execFileSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
(async()=>{
 process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';
 const root=path.resolve(__dirname,'..');
 await build({targets:Platform.MAC.createTarget(['dir'],Arch.arm64),publish:'never'});
 const appPath=path.join(root,'dist/mac-arm64/Tongxuetang Assistant.app');
 if(process.platform==='darwin'){
  execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',appPath],{stdio:'inherit'});
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',appPath],{stdio:'inherit'});
 }else{
  if(!process.env.TONGJI_RCODESIGN)throw Error('Cross-build requires TONGJI_RCODESIGN for ad-hoc signing');
  execFileSync(process.env.TONGJI_RCODESIGN,['sign',appPath],{stdio:'inherit'});
  execFileSync('python3',[path.join(__dirname,'verify-mac-signatures.py'),appPath],{stdio:'inherit'});
 }
 const version=require('../package.json').version,target=path.join(root,`dist/Tongxuetang-Assistant-${version}-mac-arm64.zip`);
 if(fs.existsSync(target))fs.unlinkSync(target);
 if(process.platform==='darwin')execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',appPath,target],{stdio:'inherit'});
 else execFileSync('python3',[path.join(__dirname,'archive-mac.py'),appPath,target],{stdio:'inherit'});
 console.log('Built:',target);
})().catch(error=>{console.error(error);process.exitCode=1;});
