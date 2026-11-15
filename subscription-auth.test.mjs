import test from 'node:test';
import assert from 'node:assert/strict';
import {SubscriptionManager} from './vendor/subscriptions.js';

function context(){
 const values=new Map();
 return {values,credentials:{resolve:async key=>values.has(key)?{value:values.get(key)}:undefined,set:async(key,value)=>values.set(key,value),unset:async key=>values.delete(key)}};
}
const expired={accessToken:'test-old-access',refreshToken:'test-old-refresh',expiresAt:1,email:'',accountId:''};

test('rejected subscription refresh persists an honest login state; a new login clears it',async t=>{
 const ctx=context(),manager=new SubscriptionManager(ctx),oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});
 await manager.saveBlob('codex',expired);let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'invalid_grant'}),{status:401,headers:{'content-type':'application/json'}});};
 await assert.rejects(manager.generate({vendor:'codex',prompt:'test'}),error=>error.code==='SUBSCRIPTION_AUTH_REQUIRED'&&error.beforeSubmission===true);
 assert.equal(calls,1);
 assert.equal((await manager.loginStatus('codex')).state,'reauthorization-required');
 const restarted=new SubscriptionManager(ctx);
 assert.equal((await restarted.loginStatus('codex')).state,'reauthorization-required');
 await restarted.saveBlob('codex',{...expired,accessToken:'new-login',expiresAt:Date.now()+3600000});
 assert.equal((await restarted.loginStatus('codex')).state,'logged-in');
});

test('a temporary token-server outage does not falsely mark an account as signed out',async t=>{
 const ctx=context(),manager=new SubscriptionManager(ctx),oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});
 await manager.saveBlob('codex',expired);
 globalThis.fetch=async()=>new Response('{}',{status:503});
 await assert.rejects(manager.generate({vendor:'codex',prompt:'test'}),error=>error.code!=='SUBSCRIPTION_AUTH_REQUIRED');
 assert.equal((await manager.loginStatus('codex')).state,'logged-in');
});

test('an external shared login invalidates the old failure marker without exposing credentials',async t=>{
 const ctx=context(),manager=new SubscriptionManager(ctx),oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});
 await manager.saveBlob('codex',expired);
 globalThis.fetch=async()=>new Response('{"error":"invalid_grant"}',{status:400});
 await assert.rejects(manager.generate({vendor:'codex',prompt:'test'}));
 assert.equal((await manager.loginStatus('codex')).state,'reauthorization-required');
 const tokenKey=[...ctx.values.keys()].find(key=>key.includes('CODEX_OAUTH_1'));
 ctx.values.set(tokenKey,JSON.stringify({...expired,accessToken:'external-new-login',expiresAt:Date.now()+3600000}));
 const status=await manager.loginStatus('codex');assert.equal(status.state,'logged-in');
 assert.equal(JSON.stringify(status).includes('external-new-login'),false);
});

test('a generation 401 after a successful refresh marks that refreshed credential, not the old token',async t=>{
 const ctx=context(),manager=new SubscriptionManager(ctx),oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});await manager.saveBlob('codex',expired);
 globalThis.fetch=async url=>String(url).includes('/oauth/token')?new Response(JSON.stringify({access_token:'refreshed-access',refresh_token:'refreshed-refresh',expires_in:3600}),{status:200}):new Response('{"error":{"message":"unauthorized"}}',{status:401});
 await assert.rejects(manager.generate({vendor:'codex',prompt:'test'}),error=>error.code==='SUBSCRIPTION_AUTH_REQUIRED');
 assert.equal((await manager.loginStatus('codex')).state,'reauthorization-required');
});
