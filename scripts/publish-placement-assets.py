"""Prepare and apply verified placement assets, preserving original ad IDs and settings."""
import base64, importlib.util, json, os, ssl, sys, urllib.parse, urllib.request
from pathlib import Path
ROOT=Path(sys.argv[2]); mode=sys.argv[1]
CTX=ssl.create_default_context(cafile='/etc/ssl/cert.pem')
TOKEN=os.environ['THREESTRIPES_META_AD_TOKEN']
spec=importlib.util.spec_from_file_location('placement',Path(__file__).with_name('placement-creative.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def api(path,data=None,query=None):
 url='https://graph.facebook.com/v25.0/'+path
 if query:url+='?'+urllib.parse.urlencode(query)
 body=None if data is None else urllib.parse.urlencode({k:json.dumps(v) if isinstance(v,(list,dict)) else v for k,v in data.items()}).encode()
 req=urllib.request.Request(url,data=body,headers={'Authorization':'Bearer '+TOKEN})
 try:return json.load(urllib.request.urlopen(req,context=CTX,timeout=90))
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode()) from None
ads=json.load(open(ROOT/'live-before.json'))['data']
ledgerpath=ROOT/'publication-ledger.json'
ledger=json.load(open(ledgerpath)) if ledgerpath.exists() else {}
def save():ledgerpath.write_text(json.dumps(ledger,indent=2))
for ad in ads:
 if mode == 'prepare' and not all((ROOT/'final'/f"{ad['id']}-{v}.png").exists() for v in ['feed','story']):
  continue
 id=ad['id']; row=ledger.setdefault(id,{'old_creative_id':ad['creative']['id']})
 if mode=='prepare':
  for variant in ['feed','story']:
   if variant not in row:
    f=ROOT/'final'/f'{id}-{variant}.png'
    if not f.exists():raise RuntimeError('Missing '+str(f))
    result=api('act_358826439854169/adimages',{'bytes':base64.b64encode(f.read_bytes()).decode(),'name':f.name})
    row[variant]=next(iter(result['images'].values()))['hash'];save()
  if 'new_creative_id' not in row:
   result=api('act_358826439854169/adcreatives',module.payload(ad,row['feed'],row['story']))
   row['new_creative_id']=result['id'];save()
  creative=api(row['new_creative_id'],query={'fields':'asset_feed_spec,url_tags,object_story_spec,degrees_of_freedom_spec,contextual_multi_ads'})
  assert creative['url_tags']==ad['creative'].get('url_tags','')
  actual={x['hash'] for x in creative['asset_feed_spec']['images']}
  assert actual=={row['feed'],row['story']}
  assert all(x.get('enroll_status')=='OPT_OUT' for x in creative['degrees_of_freedom_spec']['creative_features_spec'].values())
  assert creative.get('contextual_multi_ads',{}).get('enroll_status')=='OPT_OUT'
  row['verified_creative']=creative;save()
 elif mode=='apply':
  assert row.get('qa_passed') is True, 'Visual QA required: '+id
  assert row.get('verified_creative'), 'Creative readback required'
  if not row.get('applied'):
   live=api(id,query={'fields':'creative,status,adset_id'})
   assert live['creative']['id']==row['old_creative_id'], 'Concurrent ad modification: '+id
   assert live['adset_id']==ad['adset_id']
   api(id,{'creative':{'creative_id':row['new_creative_id']}})
   row['applied']=True;save()
  live=api(id,query={'fields':'creative,status,effective_status,adset_id'})
  assert live['creative']['id']==row['new_creative_id']
  assert live['adset_id']==ad['adset_id'] and live['status']==ad['status']
  row['live_readback']=live;save()
 else:raise RuntimeError('Use prepare or apply')
 print(id,mode,'ok',flush=True)
