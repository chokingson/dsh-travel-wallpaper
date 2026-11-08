export function createConfigMutator({read,write,validate=value=>value}){
 let queue=Promise.resolve();
 return update=>{
  const operation=queue.catch(()=>{}).then(async()=>{const current=await read(),next=await update(current);if(next===current)return current;const checked=await validate(next);await write(checked);return checked;});
  queue=operation;return operation;
 };
}
