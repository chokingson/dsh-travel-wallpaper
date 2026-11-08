import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('./client.js',import.meta.url),'utf8');
const baseline={rolesEnabled:true,referenceId:'custom-1',characters:'测试角色',imageToImage:true,style:'原画风',styleId:'custom',width:1920,height:1080,dailyCount:1,hour:8,world:'原世界',tripSource:'user',tripPrompt:'已确认行程',tripConfirmedAt:'2026-11-07',tripMeta:'{}',downloadDirectory:''};
function harness({config={},booking=null,status={},respond}={}){
  let factory,Panel,tree,changed=false,cursor=0,slots=[],effects=[],timers=[],calls=[],server={config:{...baseline,...config},booking,status,version:'0.12.1'},pending=[];
  const storage=new Map();
  const react={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(i=>i!==null&&i!==undefined&&i!==false)}),
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;changed=true;}];},
    useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},
    useEffect(fn,deps){const i=cursor++,prior=slots[i];if(!prior||!deps||deps.some((v,j)=>!Object.is(v,prior.deps[j]))){effects.push(()=>{prior?.cleanup?.();slots[i]={deps,cleanup:fn()};});}}
  };
  const context={window:{__ModuleLoader__:{load:module=>{factory=module.factory;}}},document:{createElement:()=>({remove(){}}),head:{appendChild(){}},addEventListener(){},removeEventListener(){}},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){},AbortSignal,URL,URLSearchParams,Date,console,
    fetch:async(url,options)=>{const body=options?.body?JSON.parse(options.body):null;calls.push({url,body});let data;if(respond)data=await respond(url,body,server);if(data===undefined){if(url.includes('clientSession'))data={writeToken:'test-token'};else if(body?.action==='cancel-travel-booking'){server.booking=null;data={booking:null};}else if(body?.action==='book-travel'){server.booking={id:'b',day:'2026-11-09',hour:8,dueAt:'2026-11-09T00:00:00.000Z',state:'pending',character:'测试角色'};data={booking:server.booking};}else if(body?.config){Object.assign(server.config,body.config);data={...server};}else if(body?.action){server.status={state:'running',action:body.action,stage:'world',issueId:'new-issue'};data={status:server.status};}else if(url.includes('referenceLibrary'))data={groups:[],slots:[{referenceId:'custom-1',name:'测试角色',identityId:'c1'},{},{}]};else if(url.includes('catalog'))data={styles:[],worlds:[],resolutions:[],characters:[]};else if(url.includes('channels'))data={profiles:[]};else if(url.includes('providers'))data={providers:[]};else if(url.includes('worlds'))data={worlds:[],total:0};else if(url.includes('delivery'))data={};else if(url.includes('models'))data={models:[]};else data=JSON.parse(JSON.stringify(server));}return{ok:true,status:200,json:async()=>data};}
  };
  vm.runInNewContext(source,context);
  const plugin=factory(name=>{assert.equal(name,'react');return react;});
  plugin.apply({effect(){},slots:{inject(_name,fn){fn();},register(_options,render){Panel=render().type;}}});
  function render(){cursor=0;changed=false;tree=Panel();const run=effects;effects=[];run.forEach(fn=>fn());}
  const settle=async()=>{for(let i=0;i<20;i++){if(changed||!tree)render();await new Promise(resolve=>setImmediate(resolve));if(!changed&&!effects.length)break;}return tree;};
  const walk=(node=tree)=>typeof node==='object'&&node?[node,...(node.children||[]).flatMap(child=>walk(child))]:[];
  const text=node=>typeof node==='object'&&node?(node.children||[]).map(text).join(''):String(node??'');
  const find=(type,label)=>walk().find(node=>node.type===type&&(text(node)===label||node.props['aria-label']===label||walk().some(parent=>parent.type==='label'&&parent.children.includes(node)&&parent.children[0]===label)));
  const click=async label=>{const button=find('button',label);assert.ok(button,'button '+label);button.props.onClick();await settle();};
  const change=async(label,value)=>{const input=walk().find(node=>['input','textarea','select'].includes(node.type)&&(node.props['aria-label']===label||walk().some(parent=>parent.type==='label'&&parent.children.includes(node)&&parent.children[0]===label)));assert.ok(input,'input '+label);input.props.onChange({target:{value}});await settle();};
  return{settle,walk,text,find,click,change,calls,server,storage,poll:async()=>{timers[0]();await settle();},get tree(){return tree;}};
}

test('persistent custom uploads use hidden chooser, selected status and a contained multiline name hint',async()=>{
 const ui=harness();await ui.settle();await ui.click('参考图');
 const input=ui.find('input','上传自定义角色1');assert.equal(input.props.hidden,true);
 assert.ok(ui.find('button','替换角色图'));assert.ok(ui.text(ui.tree).includes('已上传 · 已选'));
 const name=ui.find('textarea','自定义角色1名称');assert.ok(name);assert.equal(name.props.placeholder,'不命名，则该角色壁纸存于“已到访世界”自定义分栏中。');assert.ok(name.props.rows>=3);
});

test('three generation choices retain exact labels and booking can be cancelled',async()=>{
 const ui=harness();await ui.settle();for(const label of ['制作今日壁纸','立即盲盒旅行','盲盒旅行预订'])assert.ok(ui.find('button',label));
 assert.equal(ui.find('button','另做一张'),undefined);
 assert.ok(ui.text(ui.tree).includes('说走就走的旅行，角色不变，世界、事件都变'));
 await ui.click('盲盒旅行预订');assert.equal(ui.calls.filter(call=>call.body?.action==='book-travel').length,1);assert.ok(ui.text(ui.tree).includes('2026-11-09'));assert.ok(ui.text(ui.tree).includes('08:00'));
 await ui.click('取消盲盒旅行预订');assert.equal(ui.server.booking,null);
});

test('角色旅行介绍与日记说明采用新的用户称呼文案',async()=>{
 const ui=harness();await ui.settle();const text=ui.text(ui.tree);
 assert.ok(text.includes('带心爱的角色去旅行，是当旅客？扶老奶奶过马路？还是毁世界，由你主导。'));
 assert.ok(text.includes('默认称呼“用户”，可自行修改。'));
 assert.ok(!text.includes('大肥鱼像可爱的女儿'));
 assert.equal(ui.find('input','角色对你的称呼').props.placeholder,'用户');
});

test('ordinary generation requires draft confirmation; blindbox keeps the draft and selected role',async()=>{
 const ui=harness();await ui.settle();await ui.click('创作提示词');await ui.change('旅行创作正文','我还没确认的新世界');
 await ui.click('制作今日壁纸');assert.equal(ui.calls.filter(call=>call.body?.action==='run').length,0);
 await ui.click('立即盲盒旅行');assert.equal(ui.calls.filter(call=>call.body?.action==='travel-now').length,1);assert.equal(ui.server.config.characters,'测试角色');
 assert.equal(ui.find('textarea','旅行创作正文').props.value,'我还没确认的新世界');
 const active=ui.find('button','生成中，稍等');assert.ok(active);assert.equal(active.props.disabled,true);
 for(const label of ['制作今日壁纸','盲盒旅行预订'])assert.equal(ui.find('button',label).props.disabled,true);
});

test('published blindbox polls reconcile saved world, preserve newer edits and local trip draft, and show success',async()=>{
 const ui=harness();await ui.settle();await ui.click('创作提示词');await ui.change('旅行创作正文','保留这个未确认草稿');await ui.click('立即盲盒旅行');await ui.change('画风提示词（可自由修改）','我刚改的新画风');
 Object.assign(ui.server.config,{world:'DSH新世界',style:'服务器旧画风',tripPrompt:'DSH盲盒行程',tripConfirmedAt:'2026-11-08T12:00:00Z'});ui.server.status={state:'published',action:'travel-now',issueId:'new-issue',day:'2026-11-08'};
 await ui.poll();assert.equal(ui.find('textarea','画风提示词（可自由修改）').props.value,'我刚改的新画风');assert.equal(ui.find('textarea','旅行创作正文').props.value,'保留这个未确认草稿');assert.ok(ui.text(ui.tree).includes('新壁纸已生成并更换'));
 await ui.click('保存设置 · 有未保存修改');assert.equal(ui.server.config.style,'我刚改的新画风');assert.equal(ui.server.config.world,'DSH新世界');
});

test('blindbox completed poll refreshes confirmed world input when no local draft exists',async()=>{
 const ui=harness();await ui.settle();await ui.click('立即盲盒旅行');Object.assign(ui.server.config,{world:'全新世界',tripPrompt:'全新已确认行程',tripConfirmedAt:'2026-11-08'});ui.server.status={state:'published',action:'travel-now',issueId:'next'};await ui.poll();await ui.click('创作提示词');assert.equal(ui.find('textarea','旅行创作正文').props.value,'全新已确认行程');
});

test('same-event rapid clicks submit only one generation',async()=>{
 const ui=harness();await ui.settle();const button=ui.find('button','制作今日壁纸');button.props.onClick();button.props.onClick();await ui.settle();assert.equal(ui.calls.filter(call=>call.body?.action==='run').length,1);
});

test('observation mode has no diary progress label',async()=>{
 const ui=harness({config:{rolesEnabled:false},status:{state:'running',action:'travel-now',stage:'briefing'}});await ui.settle();assert.ok(!ui.text(ui.tree).includes('正在准备当日来信'));assert.ok(ui.text(ui.tree).includes('世界见闻'));
});

test('saving settings preserves an edit made while the save response is pending',async()=>{
 let release,delayed=false;const gate=new Promise(resolve=>{release=resolve;});
 const ui=harness({respond:async(_url,body,server)=>{if(body?.config&&!delayed){delayed=true;Object.assign(server.config,body.config);const snapshot=JSON.parse(JSON.stringify(server));await gate;return snapshot;}}});
 await ui.settle();await ui.click('创作提示词');await ui.change('画风提示词（可自由修改）','先保存这版');await ui.click('保存设置 · 有未保存修改');await ui.change('画风提示词（可自由修改）','等待时又改了');release();await ui.settle();
 assert.equal(ui.find('textarea','画风提示词（可自由修改）').props.value,'等待时又改了');assert.ok(ui.find('button','保存设置 · 有未保存修改'));await ui.click('保存设置 · 有未保存修改');assert.equal(ui.server.config.style,'等待时又改了');
});

test('an older poll cannot replace the running status after a new action response',async()=>{
 let capture=false,release;const gate=new Promise(resolve=>{release=resolve;});
 const ui=harness({respond:async(url,body,server)=>{if(capture&&!body&&url==='/api/planet-news'){capture=false;const snapshot=JSON.parse(JSON.stringify(server));snapshot.status={state:'published',issueId:'older'};snapshot.config.tripPrompt='过时行程';await gate;return snapshot;}}});
 await ui.settle();capture=true;await ui.poll();await ui.click('制作今日壁纸');release();await ui.settle();assert.ok(ui.find('button','生成中，稍等'));assert.ok(!ui.text(ui.tree).includes('新壁纸已生成并更换'));await ui.click('创作提示词');assert.equal(ui.find('textarea','旅行创作正文').props.value,'已确认行程');
});

test('restored tomorrow booking and scheduled run show booking progress without a competing action',async()=>{
 const booking={id:'persisted',day:'2026-11-09',hour:8,dueAt:'2026-11-09T00:00:00Z',character:'测试角色',state:'running'};
 const ui=harness({booking,status:{state:'running',action:'booked-travel',stage:'world'}});await ui.settle();assert.ok(ui.text(ui.tree).includes('2026-11-09 08:00（中国时间）'));assert.ok(ui.text(ui.tree).includes('正在创作盲盒新世界'));assert.ok(ui.find('button','生成中，稍等'));assert.equal(ui.find('button','取消盲盒旅行预订'),undefined);assert.equal(ui.find('button','立即盲盒旅行').props.disabled,true);
});

test('lock-screen synchronization follows saved preference and can be disabled independently',async()=>{
 const ui=harness({config:{syncLockScreen:true,wallpaperMode:'engine',dailyCount:3}});await ui.settle();
 const label=ui.walk().find(node=>node.type==='label'&&ui.text(node)==='同步更换锁屏壁纸');assert.ok(label);const checkbox=label.children.find(node=>node.type==='input');assert.equal(checkbox.props.checked,true);assert.ok(ui.text(ui.tree).includes('多图轮播时，锁屏使用第一张静态图片'));
 checkbox.props.onChange({target:{checked:false}});await ui.settle();await ui.click('保存设置 · 有未保存修改');assert.equal(ui.server.config.syncLockScreen,false);assert.equal(ui.server.config.wallpaperMode,'engine');assert.equal(ui.server.config.dailyCount,3);
});

test('lock-screen unavailable warning preserves explicit desktop success; applied status is separate',async()=>{
 const ui=harness({status:{state:'published',issueId:'with-lock-warning',lockScreen:{state:'unavailable',error:'系统策略不允许更换'}}});await ui.settle();const text=ui.text(ui.tree);assert.ok(text.includes('新壁纸已生成并更换'));assert.ok(text.includes('锁屏未能同步：系统策略不允许更换'));assert.ok(text.includes('桌面壁纸已正常更换'));
 ui.server.status={state:'published',issueId:'lock-applied',lockScreen:{state:'applied'}};await ui.poll();assert.ok(ui.text(ui.tree).includes('锁屏壁纸已同步更换'));assert.ok(!ui.text(ui.tree).includes('锁屏未能同步'));
});
