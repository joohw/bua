import {readFile,writeFile} from 'node:fs/promises';
const root='D:/physical AI arena/work/小红书写作素材-2026-10-13';
const entries=[
['68f1dba2000000000301dda1','原始素材','多样性、真实性、可扩展性的框架与真机资产公开倡议。',17],
['6965170a000000000a029f8c','原始素材','BEHAVIOR-1K、长期任务和应用导向评测；事实仍需回查论文。',5],
['68ed3721000000000302fa24','重点推荐','评论区进一步区分：仿真与真机可以追求策略优劣排序对应，难以要求成功率数值相同；作者以摩擦和夹爪材料解释差异。可用于正文第五章，说明物理条件和评分规则为何影响结论。“只有 SIMPLER”及 LIBERO 例子须回查原始研究。与原始第一篇有重叠，增量主要在评论。',1],
['6a6178d9000000000c033c01','重点推荐（争论材料）','区分远程参与评测与第三方复建评测环境，提出公开协议和跨场地复核。评论追问样本量、交付成本和可复现后是否更易被针对优化。这组争论适合讨论独立 Arena 的必要性与代价。作者将中心化评测一概否定的判断过强；DROID 是数据集，不能把数据采集标准直接等同评测公平性。项目任务数量及开放情况未独立核实。',6],
['6a96d747000000001001f5db','推荐（项目方自述）','The Imitator Game 将评测对象收窄为人类视频到机器人行为的模仿，提供配对数据、任务和接口线索。价值在于说明新能力需要对应的测试对象，不能只沿用旧榜单。帖子不能证明它已实际评测 Gen-1.5；最大规模、200+ 任务和开放情况需查论文、代码。原始来源线索：https://imitator-game.github.io/ 、https://arxiv.org/abs/2608.22301 。',1],
['69bbfc4e000000001f007282','推荐（项目方自述）','ManipArena 提供分层 OOD、统一模型、子任务评分和远程接口的具体设计。图中区分 Score 与 SR，且移动操作结果注明仍在评测；不能把全部任务写成已完成比较。硬件统一不等于消除所有物理差异，基线不能证明 VLA 与世界模型必须融合。图内数据仅保存为供给侧自报，赛事当前状态、费用、商业服务与正式论文结论尚未核实。',13],
['6a55d5d40000000008031670','不推荐作为事实证据','榜单限定条件、任务分布与截图日期值得检查，但作者正文对 RoboCasa 的指控与配图并不直接一致：所附 overall 图将 Xiaomi-Robotics-1 列在首位，另一张宣传图明确写开源榜与截至日期。现有材料不能判定造假。仅保留为选材反例；针对具体机构的指控不进入研究正文。',4],
['6a8a0ade000000002202d23e','不推荐','架构猜测、估值消息和个人评价缺乏可追溯证据，评论亦出现直接异议。保存初筛材料用于追溯排除理由，不加入推荐浏览页。',1]
];
let notes='# 扩展帖子筛选记录\n\n采集：2026-10-13。通过用户 Chrome 搜索“具身评测”，从可见结果中按论证与方法增量筛选，未按点赞数排序。新增四篇推荐素材、两篇不推荐候选；推荐素材新增 21 张图，连同原始两篇共有六篇、43 张正文图，另有原始评论附图一张。\n\n本轮全部新增配图已逐张读取（不推荐的 Gen1.5 候选图仅为封面，未作为论证依据）。评论仅保存抓取时可见部分；有折叠回复的帖子不标为完整评论归档。所有新增帖的页面日期若仅显示月日，保留原显示，不补猜年份。\n\n';
let html='<!doctype html><meta charset="utf-8"><title>具身评测精选素材</title><style>body{max-width:1100px;margin:40px auto;padding:20px;font:18px/1.8 sans-serif;background:#f4f4f4}article{background:white;padding:25px;margin:24px 0}img{max-width:100%}pre{white-space:pre-wrap;font:16px/1.8 sans-serif}.note{background:#eef3ff;padding:18px}a{color:#1762b5}</style><h1>具身评测精选素材</h1><p>六篇推荐及原始素材 · 43 张正文图 · 更新于 2026-10-13</p><p>新增四篇按方法增量筛选。项目方自述与第三方争论分别标注，未经核验的数字和指控不作为正文事实。</p><nav>';
for(const [id,status,reason,count] of entries){if(!status.startsWith('不推荐')){const d=JSON.parse(await readFile(`${root}/${id}/页面资源.json`,'utf8'));html+=`<p><a href="#p${id}">${d.title.replace(' - 小红书','')}</a> · ${status}</p>`;}}
html+='</nav>';
for(const [id,status,reason,count] of entries){
 const dir=`${root}/${id}`,d=JSON.parse(await readFile(dir+'/页面资源.json','utf8')),rows=JSON.parse(await readFile(dir+'/图片清单.json','utf8'));
 if(rows.length!==count||rows.some(x=>x.status!=='saved'))throw Error('Incomplete '+id);
 const title=d.title.replace(' - 小红书',''),raw=await readFile(dir+'/页面文字.txt','utf8');
 const ordered=count>1?[...rows.slice(1),rows[0]]:rows;
 notes+=`## ${title}\n\n判定：${status}。\n\n${reason}\n\n[本地帖子](${id}/帖子.md) · [原帖](https://www.xiaohongshu.com/explore/${id}) · ${count} 张图。\n\n`;
 let md=`# ${title}\n\n采集：2026-10-13。作者：${d.author||'见页面文字'}。发布日期：${d.date||'见页面文字'}。\n\n[原帖](https://www.xiaohongshu.com/explore/${id})\n\n## 选材说明\n\n${status}：${reason}\n\n## 页面文字（评论仅保证抓取时可见部分）\n\n${raw}\n\n## 配图\n\n`;
 if(!status.startsWith('不推荐'))html+=`<article id="p${id}"><h2>${title}</h2><p>${d.author||''} · ${d.date||''} · <a href="https://www.xiaohongshu.com/explore/${id}">原帖</a></p><div class="note"><b>${status}</b><p>${reason}</p></div><details><summary>页面正文与可见评论</summary><pre>${raw.replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre></details>`;
 for(const [i,r] of ordered.entries()){md+=`### 第 ${i+1} 张\n\n![第 ${i+1} 张](${r.file})\n\n`;if(!status.startsWith('不推荐'))html+=`<h3>第 ${i+1} 张</h3><img loading="lazy" src="${id}/${r.file}">`;}
 if(!status.startsWith('不推荐'))html+='</article>';
 await writeFile(dir+'/帖子.md',md);
}
await writeFile(root+'/扩展筛选记录.md',notes);await writeFile(root+'/素材浏览.html',html);
let index=await readFile(root+'/素材索引.md','utf8');index+='\n## 2026-10-13 第二轮扩展\n\n新增四篇推荐素材（21 张图），六篇推荐及原始素材合计 43 张正文图，另有一张原始评论附图。另留存两篇不推荐候选（5 张图），不进入精选浏览页。[详细筛选记录](扩展筛选记录.md)。新增评论仅保存可见部分，未宣称展开所有回复。\n';await writeFile(root+'/素材索引.md',index);
console.log('Curated viewer verified: 6 selected posts, 43 images; 2 excluded candidates retained.');
