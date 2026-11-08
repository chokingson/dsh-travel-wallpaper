import{test}from'node:test';import assert from'node:assert/strict';import{EventEmitter}from'node:events';
test('新闻球与信件提醒独立运行，全部关闭只停止自己的桌面进程',async()=>{
 const{createDesktopWidget}=await import('./native-widget.js');const launches=[];
 const widget=createDesktopWidget({origin:()=> 'http://127.0.0.1:13054',platform:'win32',spawnProcess:(file,args,options)=>{const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.killed=false;p.kill=()=>{p.killed=true;};launches.push({file,args,options,p});return p;}});
 await widget.sync({newsBallEnabled:true,lettersEnabled:false});assert.equal(launches.length,1);assert.equal(launches[0].options.windowsHide,true);assert.ok(launches[0].args.includes('-STA'));assert.ok(!launches[0].args.includes('-ExecutionPolicy'));
 const key=launches[0].options.env.TRAVEL_WIDGET_KEY;assert.ok(widget.authorized(key));assert.ok(!widget.authorized('wrong'));assert.ok(!JSON.stringify(widget.status()).includes(key));
 await widget.sync({newsBallEnabled:false,lettersEnabled:true,rolesEnabled:true});assert.equal(launches.length,1);assert.equal(launches[0].p.killed,false);
 await widget.sync({newsBallEnabled:false,lettersEnabled:true,rolesEnabled:false});assert.equal(launches[0].p.killed,true);
 await widget.sync({newsBallEnabled:true,rolesEnabled:false});assert.equal(launches.length,2);widget.dispose();assert.equal(launches[1].p.killed,true);
});
