import {readFile,writeFile} from 'node:fs/promises';
const root='D:/physical AI arena/work/小红书写作素材-2026-10-13';
const posts=[{id:'68f1dba2000000000301dda1',title:'具身操作评测的三大挑战与解决方案浅析',author:'穆尧_YaoMarkMu',date:'编辑于 2025-10-17',count:17,comments:6},{id:'6965170a000000000a029f8c',title:'具身智能评测初探',author:'Jing（泽雉）',date:'页面显示 01-12（年份未显示）',count:5,comments:4}];
let md='# 小红书写作素材归档\n\n采集日期：2026-10-13（北京时间）。范围：用户提供的两篇帖子。通过用户 Chrome 的 BUA 读取页面，下载页面 DOM 中实际出现的配图地址。\n\n已逐张阅读 22 张配图，保存正文和页面显示的全部 10 条评论（含回复）；未扩展到作者其他帖子或全站搜索结果。图片保留 CDN 返回的原始字节，并非未经压缩的作者原文件。\n\n每篇的页面文字.txt 保留可见文字；页面资源.json 和图片清单.json 记录来源、下载状态、字节数与 SHA-256。轮播含首尾克隆，已去重，以下按正文阅读顺序展示；文件编号仍保留初始 DOM 顺序。\n\n';
let html='<!doctype html><meta charset="utf-8"><title>小红书写作素材归档</title><style>body{max-width:1100px;margin:40px auto;font:18px/1.8 sans-serif;background:#f5f5f5;padding:20px}img{max-width:100%;height:auto}article{background:white;padding:25px;margin:25px 0}pre{white-space:pre-wrap;font:16px/1.8 sans-serif}a{color:#1762b5}</style><h1>小红书写作素材归档</h1><p>用户提供的两篇帖子 · 2026-10-13 · 22 张配图。内容为第三方作者观点，引用事实前需回查原始来源。</p>';
for(const p of posts){
 const rows=JSON.parse(await readFile(`${root}/${p.id}/图片清单.json`,'utf8'));
 if(rows.length!==p.count||rows.some(r=>r.status!=='saved'))throw new Error(`图片不完整 ${p.id}`);
 const ordered=[...rows.slice(1),rows[0]];
 const url=`https://www.xiaohongshu.com/explore/${p.id}`;
 let page=`# ${p.title}\n\n作者：${p.author}。发布日期：${p.date}。来源：[原帖](${url})。采集：2026-10-13。\n\n## 页面可见文字与评论\n\n${await readFile(`${root}/${p.id}/页面文字.txt`,'utf8')}\n\n## 配图（阅读顺序）\n\n`;
 html+=`<article><h2>${p.title}</h2><p>${p.author} · ${p.date} · <a href="${url}">原帖</a></p>`;
 for(const [i,r] of ordered.entries()){page+=`### 第 ${i+1} 张\n\n![第 ${i+1} 张](${r.file})\n\n`;html+=`<h3>第 ${i+1} 张</h3><img loading="lazy" src="${p.id}/${r.file}">`;}
 const raw=await readFile(`${root}/${p.id}/页面文字.txt`,'utf8');
 html+=`<details><summary>页面文字及 ${p.comments} 条评论</summary><pre>${raw.replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre></details></article>`;
 await writeFile(`${root}/${p.id}/帖子.md`,page);
 md+=`- [${p.title}](${p.id}/帖子.md)：${p.author}，${p.count} 张配图，页面显示 ${p.comments} 条评论。\n`;
 const resources=JSON.parse(await readFile(`${root}/${p.id}/页面资源.json`,'utf8'));resources.url=url;
 await writeFile(`${root}/${p.id}/页面资源.json`,JSON.stringify(resources,null,2));
}
md+='\n## 阅读摘记与后续核查\n\n第一篇将多样性、真实性和可扩展性作为核心挑战，比较仿真、真机及世界模型配合 VLM 的方法；讨论域随机化、物理与视觉对齐、本体与模态扩展、任务进度和轨迹质量，并建议公开真机物料与配置。ManipulationNet 的地域描述在评论中被参与者补充为含美欧中成员；写作不能直接沿用幻灯片中的“北美学术联盟”。“只有 SIMPLER 严格对齐”等绝对判断及 LIBERO 评分案例需另查论文和实现。\n\n第二篇围绕 BEHAVIOR-1K 与 OmniGibson 讨论任务定义、仿真环境、长期任务、竞赛及应用价值，类比 ImageNet，并讨论 GDPval、APEX 的单次执行与真实多轮交互之间的差异。图内 ImageNet 类比表明确由作者请 DeepSeek 总结，不作为独立事实依据；BEHAVIOR-1K 发布日期、调查人数、任务筛选数字、冠军方案和所引名言归属均需回查原始来源。评论提到 pass@k、pass^k、EmbodiedBench、xbench、BabyVision 等，保存为待研究线索，不能写成市场共识。\n\n第一篇页面截图已保存；第二篇截图调用超时，已保存全部五张正文图与页面文字，不能将截图状态标为成功。仅完成素材归档，未修改正文、大纲或固定文章预览。\n';
await writeFile(`${root}/素材索引.md`,md);await writeFile(`${root}/素材浏览.html`,html);
console.log('Verified: 2 posts, 22 images, index and offline viewer saved.');
