// Normalize generated placement artwork into exact upload dimensions and safe zones.
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const fs = require('fs');
const path = require('path');
async function main() {
 const dir = process.argv[2];
 const rows = JSON.parse(fs.readFileSync(path.join(dir,'generated-manifest.json')));
 fs.mkdirSync(path.join(dir,'final'), {recursive:true});
 for (const r of rows) {
  const source = r.variant === 'story' ? rows.find(x => x.id === r.id && x.variant === 'feed').path : r.path;
  const {data} = await sharp(source).extract({left:0,top:0,width:1,height:1}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const background = {r:data[0],g:data[1],b:data[2],alpha:1};
  const story = r.variant === 'story';
  let pipeline = sharp(source).resize(story ? 960 : 1080, story ? 1200 : 1350, {fit:'contain',background});
  if (story) pipeline = pipeline.extend({top:300,bottom:420,left:60,right:60,background});
  await pipeline.png().toFile(path.join(dir,'final',`${r.id}-${r.variant}.png`));
 }
 console.log(`Normalized ${rows.length} files`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
