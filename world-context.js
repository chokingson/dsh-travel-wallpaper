const strings=value=>Array.isArray(value)?value.filter(s=>typeof s==='string'&&s.trim()):[];
export function worldContext(config={}){
 let meta={};try{meta=JSON.parse(config.tripMeta||'{}');}catch{}
 const structured=['builtin','dsh'].includes(config.tripSource);
 const rules=strings(meta.worldRules||meta.rules);
 const facts={world:config.world||meta.world||'',era:config.era||meta.time||'',environment:meta.environment||'',society:meta.society||'',rules,motifs:strings(meta.motifs||meta.themes)};
 const inspiration=structured?[...strings(meta.candidates),meta.conflict,meta.opening,...strings(meta.beats)].filter(s=>typeof s==='string'&&s.trim()):[];
 const textRequirements=structured&&String(config.textPrompt||'').trim()===String(config.tripPrompt||'').trim()?'':config.textPrompt||'';
 return{facts,inspiration,structured,textRequirements,setting:structured?[
  '【世界】'+facts.world,facts.era&&'【时间】'+facts.era,facts.environment&&'【环境】'+facts.environment,facts.society&&'【社会形态】'+facts.society,
  rules.length&&'【世界规则】'+rules.join('；'),facts.motifs.length&&'【世界要素】'+facts.motifs.join('、'),
  config.rolesEnabled!==false&&config.characters&&'【旅行角色】'+config.characters,
 ].filter(Boolean).join('\n\n'):config.tripPrompt||''};
}
