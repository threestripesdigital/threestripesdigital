import {readFileSync} from 'node:fs';
const c=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(c.d1_databases.some(d=>d.database_id.startsWith('00000000')))throw Error('Create and configure the analytics database before deploying.');
if(c.vars.LOCAL_PREVIEW)throw Error('LOCAL_PREVIEW cannot be deployed.');
if(!c.assets.run_worker_first)throw Error('Dashboard assets must run through authentication.');
console.log('Deployment configuration checked.');
