// Deterministic vector layouts for compact Meta placements.
// Proof imagery remains unchanged in the original feed and story assets.
const fs=require('node:fs'),path=require('node:path');
const sharp=require('../../analytics/node_modules/sharp');
const out=process.argv[2]; if(!out)throw Error('Output directory required');fs.mkdirSync(out,{recursive:true});
const designs={
 a1:{bg:'#0a1729',fg:'#ffffff',accent:'#d4b35d',lines:['PAID FOR SEO.','NO RESULTS?']},
 a2:{bg:'#000000',fg:'#ffffff',accent:'#f4ce48',lines:['I FIRED MY','SEO AGENCY.']},
 a3:{bg:'#000000',fg:'#ffffff',accent:'#f4ce48',lines:['I RAN THIS TO','PROVE IT WAS FAKE.']},
 a4:{bg:'#000000',fg:'#ffffff',accent:'#f4ce48',lines:['YOUR SEO AGENCY','IS LYING TO YOU.']},
 b2:{bg:'#0a1729',fg:'#ffffff',accent:'#d4b35d',lines:['OMAHA: #6 TO #1','ON GOOGLE.']},
 b3:{bg:'#ffffff',fg:'#101724',accent:'#1967ed',lines:['LET THEM FIND','YOUR FIRM.'],extra:'NOT A LEAD MARKETPLACE.'},
 b4:{bg:'#0a1729',fg:'#ffffff',accent:'#d4b35d',lines:['PAGE 1 OF GOOGLE.','FREE.']}
};
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const txt=(s,x,y,size,color,weight=800)=>`<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="middle">${esc(s)}</text>`;
(async()=>{for(const [key,d]of Object.entries(designs))for(const format of ['square']){
const w=format==='wide'?1200:1080,h=format==='wide'?628:1080;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${d.bg}"/>`;
svg+=txt('LAW FIRM OWNERS',w/2,format==='wide'?95:145,format==='wide'?48:60,d.accent);
const sz=format==='wide'?76:90, y=format==='wide'?200:330;
d.lines.forEach((s,i)=>svg+=txt(s,w/2,y+i*96,sz,d.fg));
if(d.extra)svg+=txt(d.extra,w/2,format==='wide'?390:590,format==='wide'?43:47,d.accent);
svg+=`<rect x="70" y="${h-390}" width="${w-140}" height="165" rx="12" fill="${d.accent}"/>`;
svg+=txt('PAGE 1 FREE',w/2,h-320,format==='wide'?47:72,d.bg==='#ffffff'?'#ffffff':'#101724');
svg+=txt('IN 24 TO 48 HOURS',w/2,h-260,44,d.bg==='#ffffff'?'#ffffff':'#101724');
svg+='</svg>';fs.writeFileSync(path.join(out,`${key}-${format}.svg`),svg);await sharp(Buffer.from(svg)).png().toFile(path.join(out,`${key}-${format}.png`));
const search=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${d.bg}"/><g transform="translate(0,100)">${svg.replace(/<svg[^>]*>/,'').replace('</svg>','')}</g></svg>`;fs.writeFileSync(path.join(out,`${key}-search.svg`),search);await sharp(Buffer.from(search)).png().toFile(path.join(out,`${key}-search.png`));
}console.log('Exported 7 compact vector layouts');})();
