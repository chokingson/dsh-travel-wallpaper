import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),data=JSON.parse(await readFile(new URL('about-support.json',root),'utf8'));
const materials=data.materials.map(item=>`### ${item.name}\n\n${item.authors}\n\n${item.conditions}\n\n${item.verification}\n\n包内文件：${item.files.map(f=>'`'+f+'`').join('、')}。\n\n${item.links.map(link=>`[${link.label}](${link.url})`).join(' · ')}`).join('\n\n');
const publicCopy=`## 关于与支持\n\n${data.introduction}\n\n[GitHub 项目](${data.githubUrl}) · [问题反馈](${data.feedbackUrl}) · [可更新的支持页面](${data.supportPageUrl})\n\n${data.supportPageNote}\n\n作者公开微信：\`${data.wechat}\`。\n\n### 自愿支持开发\n\n${data.support.paragraphs.join('\n\n')}\n\n${data.support.equalAccess}\n\n进入插件“关于与支持”分栏即显示作者赞赏码，可放大查看。不自动弹窗、不设红点、不催促、不做付款解锁。\n\n![作者提供的微信官方赞赏码](assets/support/wechat-appreciation.png)\n\n### 独立项目说明\n\n${data.independence}\n\n### 素材说明\n\n${data.materialNotice}\n\n${materials}`;
const configuration=`## 公开资料维护\n\n作者只需编辑包内 \`about-support.json\`，可更新公开微信、项目/反馈/支持页面链接及说明；不从本机私人配置推断资料。二维码固定使用 \`assets/support/wechat-appreciation.png\`，必须是作者明确提供并允许公开的微信官方赞赏码，不能替换成付款码或登录二维码。修改公开资料后运行 \`node scripts/sync-about-docs.mjs\` 同步本文、README与素材说明。\n\n将 \`support.enabled\` 改为 \`false\` 可暂停该安装版本的赞赏码展示与本机图片接口；下一次进入分栏重新读取。发布新版时同样可关闭。若希望GitHub支持页面也停止展示，请同时移除SUPPORT.md/README里的图片并调整发布文件。已加载页面或他人已经保存的图片不会被撤销。此插件不自动联网拉取远程配置，更新在线说明不能远程关闭用户离线副本。\n\n缺少公开联系方式、有效链接或赞赏图时，页面显示待配置，不影响其它功能。微信号可主动复制，剪贴板权限失败时可手动选择。链接由用户主动打开，不自动请求第三方站点。\n\n核实日期：2026-11-08。ZipZipPipe说明核对入口：[Pixiv公开作品资料](https://www.pixiv.net/ajax/illust/148186519)；第三方索引只作来源线索，不替代作者对具体文件的授权。当前原图与作者原帖的逐项对应仍需补充，不能仅凭整理站的统一页脚推定所有作品采用同一许可。`;
const markerStart='<!-- ABOUT-SUPPORT:START -->',markerEnd='<!-- ABOUT-SUPPORT:END -->';
let readme=await readFile(new URL('README.md',root),'utf8');
const block=markerStart+'\n'+publicCopy+'\n\n维护方法见 [SUPPORT.md](SUPPORT.md)。\n'+markerEnd;
if(readme.includes(markerStart))readme=readme.slice(0,readme.indexOf(markerStart))+block+readme.slice(readme.indexOf(markerEnd)+markerEnd.length);
else {const insert=readme.indexOf('\n## ');readme=readme.slice(0,insert)+'\n'+block+'\n'+readme.slice(insert);}
await writeFile(new URL('README.md',root),readme);
await writeFile(new URL('SUPPORT.md',root),'# 旅行壁纸：关于与支持\n\n'+publicCopy+'\n\n'+configuration+'\n');
let notice=await readFile(new URL('THIRD_PARTY_NOTICES.md',root),'utf8');
const start=notice.indexOf('## 社区角色参考图'),end=notice.indexOf('订阅登录采用兼容协议',start);
if(start<0||end<0)throw Error('找不到原素材说明边界，未覆盖第三方代码许可');
notice=notice.slice(0,start)+'## 社区角色参考图（与代码许可分开）\n\n'+data.materialNotice+'\n\n参考图取自 [FishArchive图鉴](https://fisharchive.cc/characters)，下载记录日期2026-11-07；本项目未改动参考图文件，仅在界面缩放。下列作者原帖条件与整理站文件对应分开记录，不统一套用整理站CC页脚。\n\n'+materials+'\n\n'+notice.slice(end);
await writeFile(new URL('THIRD_PARTY_NOTICES.md',root),notice);
console.log('Synced README.md, SUPPORT.md and THIRD_PARTY_NOTICES.md from public about-support.json');
