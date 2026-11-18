import {connect} from '../packages/sdk/dist/index.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root='D:/physical AI arena/work/小红书写作素材-2026-10-13';
const a=await connect({port:17432,client:{name:'Codex 高质量帖子筛选'}});
try{
 const b=await a.browsers.getDefault(); const opened=JSON.parse(await readFile('D:/bua/tmp-task/xhs-practical-tabs.json','utf8'));
 for(const info of opened){
  const t=await b.tabs.get(info.id);
  const text=await t.text();
  const doc=await t.playwright.evaluate(`({title:document.title,url:location.href,images:Array.from(document.images).map(i=>({src:i.currentSrc||i.src,width:i.naturalWidth,height:i.naturalHeight})),author:document.querySelector('.author-wrapper .name')?.textContent||'',body:document.querySelector('#detail-desc')?.innerText||'',date:document.querySelector('.date')?.textContent||''})`);
  const id=doc.url.match(/(?:explore|search_result)\/([a-f0-9]{24})/)?.[1];
  if(!id){console.log(JSON.stringify({title:info.title,error:'无有效帖子地址',text}));continue;}
  await mkdir(`${root}/${id}`,{recursive:true});
  await writeFile(`${root}/${id}/页面文字.txt`,text);
  await writeFile(`${root}/${id}/页面资源.json`,JSON.stringify({...doc,url:doc.url.split('?')[0]},null,2));
  console.log(JSON.stringify({id,title:info.title,author:doc.author,date:doc.date,text:text.slice(-10000),images:[...new Set(doc.images.filter(i=>i.src.includes('sns-webpic')).map(i=>i.src))].length}));
 }
}finally{await a.close();}


