import{test}from'node:test';import assert from'node:assert/strict';
test('DSH桌面移除Origin后仍可凭插件写入令牌保存，外站和猜测令牌不能写',async()=>{
 const{createRequestGuard}=await import('./request-guard.js');const guard=createRequestGuard(),key=guard.session().writeToken,req=(origin,key)=>({headers:{host:'127.0.0.1:13431',...(origin?{origin}:{}),...(key?{'x-travel-client-key':key}:{})}});
 assert.equal(guard.allowsRead(req()),true);assert.equal(guard.allowsWrite(req(),{}),false);assert.equal(guard.allowsWrite(req(null,key),{}),true);assert.equal(guard.allowsWrite(req(),{clientToken:key}),true);assert.equal(guard.allowsWrite(req(null,'x'.repeat(64)),{}),false);assert.equal(guard.allowsWrite(req(null,'鲸'.repeat(64)),{}),false);
 assert.equal(guard.allowsRead(req('https://evil.example')),false);assert.equal(guard.allowsWrite(req('https://evil.example',key),{}),false);assert.equal(guard.allowsWrite(req('http://127.0.0.1:13431'),{}),true);assert.equal(guard.allowsWrite(req('dsh-app://app',key),{}),true);assert.equal(guard.allowsRead({headers:{host:'evil.example'}}),false);assert.equal(guard.allowsRead(req('not a url')),false);assert.notEqual(createRequestGuard().session().writeToken,key);
});
