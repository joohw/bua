import { readFile,writeFile,mkdir,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root='D:/physical AI arena/work/小红书写作素材-2026-10-13';
for(const id of ['69c4ab4f000000001b001d4d','6a8ba48c0000000017003958','69d60cc6000000001a027995','69e1f4770000000021010d2d']) {
 const dir=`${root}/${id}`;
 let doc; try {doc=JSON.parse(await readFile(`${dir}/页面资源.json`,'utf8'));}catch {continue;}
 const urls=[...new Set(doc.images.map(i=>i.src).filter(s=>s.includes('sns-webpic')&&!s.includes('/comment/')))];
 await mkdir(`${dir}/images`,{recursive:true});
 const rows=await Promise.all(urls.map(async(url,index)=>{
  try {
   const r=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{Referer:'https://www.xiaohongshu.com/'}});
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const data=Buffer.from(await r.arrayBuffer());
   const type=r.headers.get('content-type')||'';
   if(!type.startsWith('image/'))throw new Error(`Unexpected ${type}`);
   const ext=type.includes('webp')?'webp':type.includes('png')?'png':'jpg';
   const file=`images/${String(index+1).padStart(2,'0')}.${ext}`;
   await writeFile(`${dir}/${file}`,data);
   return {index:index+1,file,url,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),status:'saved'};
  }catch(e){return {index:index+1,url,status:'failed',error:e.message};}
 }));
 await writeFile(`${dir}/图片清单.json`,JSON.stringify(rows,null,2));
 console.log(JSON.stringify({id,total:urls.length,saved:rows.filter(r=>r.status==='saved').length,failures:rows.filter(r=>r.status!=='saved')}));
}

