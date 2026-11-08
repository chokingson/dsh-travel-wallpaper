import{fileURLToPath}from'node:url';
import{spawn}from'node:child_process';import{readFile}from'node:fs/promises';import{randomBytes,timingSafeEqual}from'node:crypto';
export function createDesktopWidget({origin,platform=process.platform,spawnProcess=spawn}){
 const key=randomBytes(32).toString('hex');let child=null,starting=null,wanted=false,disposed=false,lastAttempt=0,heartbeat=0,error='',diagnostic='';
 const stop=()=>{const own=child;child=null;heartbeat=0;if(own&&!own.killed)own.kill();};
 return{
  authorized(value){return typeof value==='string'&&value.length===key.length&&timingSafeEqual(Buffer.from(value),Buffer.from(key));},
  heartbeat(){heartbeat=Date.now();},
  status(){return{running:Boolean(child&&!child.killed),ready:Boolean(child&&Date.now()-heartbeat<15_000),error};},
  diagnostic(){return diagnostic;},
  async sync(config){const next=Boolean(config.newsBallEnabled||(config.lettersEnabled&&config.rolesEnabled!==false));const changed=next!==wanted;wanted=next;
   if(!wanted||disposed){stop();return;}if(platform!=='win32'){error='桌面浮球和轻提醒目前仅支持Windows；信件仍保存在本机信箱。';return;}
   if(child||starting)return;if(changed)lastAttempt=0;if(Date.now()-lastAttempt<60_000)return;lastAttempt=Date.now();
   starting=(async()=>{try{const source=await readFile(new URL('./desk-widget-v2.ps1',import.meta.url),'utf8');if(!wanted||disposed)return;
    const url=new URL(typeof origin==='function'?origin():origin);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('仅支持本机服务');
    const launched=spawnProcess('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command',source],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TRAVEL_WIDGET_URL:url.origin+'/api/planet-news',TRAVEL_WIDGET_KEY:key,TRAVEL_WIDGET_ASSET_DIR:fileURLToPath(new URL('./assets/sounds',import.meta.url))}});
    child=launched;error='';diagnostic='';launched.stderr?.on('data',value=>{diagnostic=(diagnostic+value.toString()).slice(-2000);});
    launched.once('error',()=>{if(child===launched)child=null;error='桌面组件启动失败，请确认Windows PowerShell和WPF可用。';});
    launched.once('exit',code=>{if(child===launched)child=null;if(wanted&&!disposed&&code)error='桌面组件已停止，可关闭后重新开启。';});
   }catch(e){error='桌面组件暂未启动，信箱仍可在DSH设置中查看。';diagnostic=e.message;}})().finally(()=>{starting=null;});return starting;
  },
  dispose(){disposed=true;wanted=false;stop();},
 };
}
