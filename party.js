// Actor identities differ from legacy, name-based archive groups. No image reads here.
export const referenceSettingPlaceholder='若参考图为角色/宠物等生命，可输入人设提示词。亦可输入世界/物品设定';
export const builtinActors=[
 {id:'builtin-deepseek',name:'DS大肥鱼',description:'DS大肥鱼（DeepSeek鲸鱼娘；蓝发、头鳍、鲸尾）',persona:'活泼好奇，表达自然简短。',addressee:'用户',referenceId:'builtin-deepseek'},
 {id:'builtin-gpt',name:'GPT 龙娘',description:'GPT龙娘（白发、龙角、龙翼与龙尾）',persona:'自信好奇，喜欢探索和分享自己的发现。',addressee:'用户',referenceId:'builtin-gpt'},
 {id:'builtin-claude',name:'Claude 大小姐',description:'Claude大小姐（橙发、花饰、优雅长裙）',persona:'温和优雅，细心留意旅途里的细节。',addressee:'用户',referenceId:'builtin-claude'},
];
export const validReferenceId=id=>typeof id==='string'&&/^(?:[a-f\d]{32}|builtin-(?:deepseek|gpt|claude))$/.test(id);
const string=(value,label,max,{empty=true}={})=>{
 if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||(!empty&&!value.trim()))throw Error(`${label}无效或过长（最多${max}字）`);
 return value;
};
export function normalizeActor(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('角色档案无效');
 const id=string(value.id,'角色编号',120,{empty:false});if(!/^[a-zA-Z\d:_-]+$/.test(id))throw Error('角色编号无效');
 const referenceId=value.referenceId??'';if(referenceId&&!validReferenceId(referenceId))throw Error('参考图编号无效');
 return {id,name:string(value.name??'自定义','角色名称',40),description:string(value.description??'','外观与身份描述',3000),persona:string(value.persona??'','人设／参考设定',4000),addressee:string(value.addressee??'用户','角色称呼',40,{empty:false}),referenceId};
}
export function normalizeParty(value){
 if(!Array.isArray(value)||value.length<1||value.length>3)throw Error('同行角色须为1至3名，最多三名');
 const party=value.map(normalizeActor);if(new Set(party.map(actor=>actor.id)).size!==party.length)throw Error('同行角色编号重复');
 const refs=party.map(actor=>actor.referenceId).filter(Boolean);if(new Set(refs).size!==refs.length)throw Error('同一参考图不能重复绑定同行角色');
 return party;
}
export function activeParty(config={}){
 if(config.rolesEnabled===false)return [];
 if(Array.isArray(config.party))return config.party.map(actor=>({...actor}));
 const builtin=builtinActors.find(actor=>actor.referenceId===config.referenceId);
 return [{...(builtin||{id:config.referenceId?'ref:'+config.referenceId:'legacy-text',name:config.characters?.slice(0,40)||'自定义',description:config.characters||'',persona:'',referenceId:config.referenceId||''}),...(config.characters?{description:config.characters}:{}),addressee:config.diaryTitle||'用户'}];
}
export const partyDescription=party=>party.map((actor,index)=>`${index+1}. ${actor.name||'自定义'}：${actor.description||actor.name}${actor.persona?'；设定：'+actor.persona:''}`).join('；');
export const partyContext=config=>config.rolesEnabled===false?[]:Array.isArray(config.party)?config.party.map(actor=>({...actor})):null;
export function referenceBindings(config){
 if(config.rolesEnabled===false||!config.imageToImage)return [];
 return activeParty(config).filter(actor=>actor.referenceId).map((actor,index)=>({image:index+1,actorId:actor.id,name:actor.name,referenceId:actor.referenceId,description:actor.description,setting:actor.persona}));
}
export function partyInstructions(config){
 const party=activeParty(config);if(!party.length)return '';
 return `【同行身份档案】\n${JSON.stringify(party)}\n按各自编号分别保持身份，不合并同名角色。默认全体同行角色出镜；用户明确指定部分角色时按要求创作。主角色为${party[0].id}，仅其撰写来信。${Array.isArray(config.depictedMemberIds)?'本图实际出镜编号：'+JSON.stringify(config.depictedMemberIds)+'；未列入的同行者不画入本图，不影响其队伍身份。':''}`+
 (config.imageToImage?`\n【实际附图对应顺序】\n${JSON.stringify(referenceBindings(config))}\n未列入附图的角色仅按文字描述，不借用其他角色参考图。二次元参考角色保留二次元身份，真人参考不自动动漫化。`:'\n本次文生图仅采用文字档案，没有读取、分析或发送参考图。');
}
