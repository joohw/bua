import { connect } from '../packages/sdk/dist/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
const root = 'D:/physical AI arena/work/小红书写作素材-2026-10-13';
const a = await connect({port:17432,client:{name:'Codex 小红书素材归档'}});
try {
 const b = await a.browsers.getDefault();
 const tabs = await b.tabs.list();
 let t1 = await b.tabs.get(tabs.find(t=>t.url?.includes('68f1dba2')).id);
 let t2info = tabs.find(t=>t.url?.includes('6965170a'));
 let t2 = t2info ? await b.tabs.get(t2info.id) : await b.tabs.new({visible:true,url:'https://www.xiaohongshu.com/discovery/item/6965170a000000000a029f8c?xsec_token=CBPoOvLjmoZKNsO16ukGe_iKJqQ5A4rBHvh6V4XT41QK8%3D&xsec_source=app_share'});
 for (const [id,t] of [['68f1dba2000000000301dda1',t1],['6965170a000000000a029f8c',t2]]) {
  const dir = `${root}/${id}`;
  await mkdir(dir,{recursive:true});
  const text = await t.text();
  await writeFile(`${dir}/页面文字.txt`,text);
  const dom = await t.playwright.evaluate(`JSON.stringify({title:document.title,url:location.href,images:Array.from(document.images).map(i=>({src:i.currentSrc||i.src,alt:i.alt,width:i.naturalWidth,height:i.naturalHeight,class:i.className})),backgrounds:Array.from(document.querySelectorAll('*')).map(e=>({class:e.className,bg:getComputedStyle(e).backgroundImage})).filter(e=>e.bg!=='none')})`);
  await writeFile(`${dir}/页面资源.json`,dom);
  await writeFile(`${dir}/页面截图.png`,await t.screenshot());
  console.log(JSON.stringify({id,tab:t.id,text:text.slice(-1800),dom:JSON.parse(dom)}));
 }
} finally {await a.close();}
