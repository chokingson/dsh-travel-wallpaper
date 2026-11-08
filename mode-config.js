export const observerFields={interactionPrompt:'observerInteractionPrompt',interactionId:'observerInteractionId',world:'observerWorld',era:'observerEra',tripPrompt:'observerTripPrompt',tripSource:'observerTripSource',tripCaseId:'observerTripCaseId',tripTimeId:'observerTripTimeId',tripGenerationId:'observerTripGenerationId',tripMeta:'observerTripMeta',tripConfirmedAt:'observerTripConfirmedAt',tripStartDay:'observerTripStartDay',imageToImage:'observerImageToImage',referenceId:'observerReferenceId',referenceInstructions:'observerReferenceInstructions',textPrompt:'observerTextPrompt',topic:'observerTopic',tags:'observerTags',rules:'observerRules',extraPrompt:'observerExtraPrompt',textContent:'observerTextContent'};
export function effectiveConfig(config) {
  const result={...config};
  if(config.rolesEnabled===false) {
    for(const[key,field]of Object.entries(observerFields)){
      if((key==='world'||key==='era')&&!config[field]&&!config.observerTripSource)continue;
      result[key]=config[field]??(key==='imageToImage'?false:'');
    }
    Object.assign(result,{characters:'',diaryEnabled:false,diaryTitle:'',imageToImage:false,referenceId:'',referenceInstructions:''});
  }
  if(result.tripPrompt&&result.tripMeta){try{const meta=JSON.parse(result.tripMeta);if(typeof meta.world==='string'&&meta.world)result.world=meta.world;result.era=typeof meta.time==='string'?meta.time:'';}catch{}}
  if(!result.imageToImage)Object.assign(result,{referenceId:'',referenceInstructions:''});
  return result;
}
export const observationGuard='观察世界模式：只围绕世界环境和当次事件创作，不安排预设或自定义旅行角色出镜，不写角色日记、给用户的留言或专属称呼。可以采用第一人称观景；背景居民或生物仅按世界场景需要出现，不设置固定旅行主角。参考图只借鉴场景与画风，不保留原人物。此模式要求优先于素材残留的角色旅行描述；画面文字只呈现世界事件信息。';
