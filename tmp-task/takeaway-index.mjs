import {readFile,writeFile,access} from 'node:fs/promises';
const root='D:/physical AI arena/work/小红书写作素材-2026-10-13';
const entries=[
{id:'6a76b0720000000032023123',count:7,rank:'重点推荐：团队自报的真机实验',takeaway:'评测同一个模型时，也必须冻结部署策略和时间同步配置；动作更平滑不代表任务更准确。',detail:'作者对比六种部署方案。配图在三个任务上同时报告完成分数、完成时间和动作 jerk，训练时前缀条件表现较强，但并非每项指标都第一；旧动作前缀在突发障碍物出现时可能妨碍重新规划。',use:'第二章整体集成；第五章差异归因、持续运行与异常恢复。',limit:'不能推广为所有 WAM 的最佳方案；帖子、图内 arXiv submit 编号与正文正式论文链接的对应关系尚待核查。',action:'在比较表增加硬件时间戳、端到端延迟、动作块长度、重叠融合策略、精度和平滑度；补测突发变化后的响应。'},
{id:'6a5c9f14000000001f01c6b5',count:7,rank:'重点推荐：论文解读与作者自报小实验',takeaway:'高分未必验证了希望测量的能力；先用弱模型或去掉关键输入的对照，检查任务是否能走捷径。',detail:'作者介绍 2606.04233v1 对五个基准的审计，并自述移除 VLM 后在 LIBERO 获得较高分数。讨论捷径可解性、统计显著性、渐进过拟合与数据来源依赖。',use:'第五章评价标准与任务捷径；第六章可信比較的证据设计。',limit:'作者的模型参数、训练步骤和分数未独立复现；不能由此断言所有 LIBERO 高分都无效，也不能把多基准高分直接当作岗位部署证据。',action:'增加语言置换、弱基线、跨任务与新场景复测；将研发回归分数和泛化证据分开。'},
{id:'6aa92f8800000000120272bc',count:0,rank:'推荐：说明实验边界的技术解读',takeaway:'Sim–Real 相关性必须与任务、配置和版本样本绑定；不能由有限受控实验推出所有榜上模型都已获得真机验证。',detail:'正文把统一仿真比较的用途定位为筛选版本和定位短板，明确区分技术报告 v4 的受控实验与当前排行榜。',use:'第四章仿真服务用途；第五章仿真结论的外推边界。',limit:'R²=0.931、四个任务及十六个配置均是帖子转述，原报告尚未核实。该帖是视频形式，本轮只归档页面文字；未保存或观看完整视频，不标为完整视频归档。',action:'每次引用相关性都附样本范围，并为采购或上线保留关键任务真机确认。'},
{id:'697ddb84000000001a02f1d3',count:7,rank:'推荐：供给方自述与评论补充边界',takeaway:'场景看起来真实、能导入仿真器，仍不等于已验证接触力学和触觉；采购测试资产应先明确需要哪些物理属性。',detail:'作者介绍场景生成与仿真资产，评论答复“有触觉么”时说明暂时没有，主要是几何和纹理。配图展示场景和生产流程，不提供真机性能验证。',use:'第三章评测基础设施供给；第五章视觉与物理真实性、评测环境成本。',limit:'“数据需求多2–3个数量级”“数据荒已是共识”等无明确依据，不采用。2026年3月上线是当时计划，不写成当前已上线；几何纹理答复也不等于已否定全部物理参数。',action:'资产验收分别列几何、纹理、碰撞、摩擦、质量、关节、触觉及真机校准证据，按任务决定哪些必需。'}
];
let notes='# 第三轮：有 takeaway 的帖子\n\n采集日期：2026-10-13。选材标准：具体机制 → 可采用的判断或动作 → 适用边界。新增四篇推荐素材，其中三篇图文共21张配图、一篇仅保存视频帖可见文字；视频未完成归档。新增评论仅保证可见部分，折叠回复可能缺失。\n\n';
let html=await readFile(root+'/素材浏览.html','utf8');
html=html.replace('六篇推荐及原始素材 · 43 张正文图','十篇推荐及原始素材 · 64 张正文图').replace('</nav>','<p><a href="#takeaways">第三轮 takeaway 精选</a></p></nav>');
html+='<h1 id="takeaways">第三轮：可以用于研究判断的 takeaway</h1>';
for(const p of entries){
 const dir=`${root}/${p.id}`,doc=JSON.parse(await readFile(dir+'/页面资源.json','utf8')),rows=JSON.parse(await readFile(dir+'/图片清单.json','utf8')),raw=await readFile(dir+'/页面文字.txt','utf8');
 if(rows.length!==p.count||rows.some(r=>r.status!=='saved'))throw Error(`Incomplete ${p.id}`);
 const title=doc.title.replace(' - 小红书','');
 const text=`## ${title}\n\n作者：${doc.author}；页面日期：${doc.date}（仅月日时不推定年份）。分类：${p.rank}。\n\n**Takeaway：${p.takeaway}**\n\n依据：${p.detail}\n\n写作用途：${p.use}\n\n可执行补充：${p.action}\n\n边界与核查：${p.limit}\n\n[原帖](https://www.xiaohongshu.com/explore/${p.id}) · [本地素材](${p.id}/帖子.md)\n\n`;
 notes+=text;
 let md='# '+title+'\n\n'+text+'## 页面文字与可见评论\n\n'+raw+'\n\n## 配图\n\n';
 html+=`<article><h2>${title}</h2><p>${doc.author} · ${doc.date} · <a href="https://www.xiaohongshu.com/explore/${p.id}">原帖</a></p><div class="note"><b>${p.rank}</b><p>Takeaway：${p.takeaway}</p><p>${p.detail}</p><p>写作用途：${p.use}</p><p>可执行补充：${p.action}</p><p>边界：${p.limit}</p></div><details><summary>页面文字与可见评论</summary><pre>${raw.replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre></details>`;
 for(const [i,r] of [...rows.slice(1),...rows.slice(0,1)].entries()){await access(`${dir}/${r.file}`);md+=`### 第${i+1}张\n\n![配图](${r.file})\n\n`;html+=`<h3>第${i+1}张</h3><img loading="lazy" src="${p.id}/${r.file}">`;}
 html+='</article>';await writeFile(dir+'/帖子.md',md);
}
notes+='## 未进入推荐浏览页的候选\n\n- 具身智能不缺模型，开始缺一把靠谱的尺子：与本轮 RoboColiseum 解读重叠，89.5% 相关性、10% 差异、5分钟接入和30分钟出报告均缺明确实验口径，不优先推荐。保存正文及5张图，尚未逐图核读。\n- 为什么具身智能公司突然开始“刷榜”了？：主要为行业动机判断，缺访谈或统计支撑，不用于市场共识。保存正文及7张图，尚未逐图核读。\n- Agent测试集如何构建：小黄金集、生成新样本与 badcase 回归的分层思路可作为跨领域线索；作者明确指出软硬件自动评测适用有限。保存正文、评论和12张图，本轮未完成全部图内文字核读，不进入 Physical AI 推荐集。\n';
await writeFile(root+'/Takeaway精选-第三轮.md',notes);await writeFile(root+'/素材浏览.html',html);
let index=await readFile(root+'/素材索引.md','utf8');index+='\n## 第三轮 takeaway 精选\n\n新增四篇有具体判断或行动启示的素材：[Takeaway精选-第三轮](Takeaway精选-第三轮.md)。精选与原始素材合计10篇、64张正文图（另有原始评论附图）。本轮一篇为视频帖，仅保存可见文字，不宣称视频已读取或归档。另存三篇非推荐候选，图内文字未全部核读。\n';await writeFile(root+'/素材索引.md',index);
console.log('Verified 4 new selections and 21 image references.');
