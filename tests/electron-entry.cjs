'use strict';
// Development-only entry used by the sandboxed Linux UI smoke check. Not packaged.
const {app}=require('electron');
if(!process.env.TONGJI_SMOKE_DATA)throw Error('This entry is only for the smoke test');
app.setPath('userData',process.env.TONGJI_SMOKE_DATA);
// The execution sandbox forbids Unix domain sockets; Windows uses the real lock.
app.requestSingleInstanceLock=()=>true;
require('../src/main.cjs');
