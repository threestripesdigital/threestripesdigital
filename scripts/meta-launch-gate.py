"""Fail closed unless every ad in a registered campaign has a current QA pass."""
import argparse,json,os,ssl,urllib.request,urllib.parse,http.cookiejar
p=argparse.ArgumentParser();p.add_argument('--campaign',required=True);p.add_argument('--activate',action='store_true',help='Activate only after a fresh passed evaluation and explicit launch authorization');p.add_argument('--entity-id',help='Specific ad or ad set to activate; defaults to the campaign');args=p.parse_args()
if not args.campaign.isdecimal() or (args.entity_id and not args.entity_id.isdecimal()):p.error('Meta IDs must be numeric')
base='https://rank-boost-command-center.bilal-17f.workers.dev'
jar=http.cookiejar.CookieJar();op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile='/etc/ssl/cert.pem')))
op.addheaders=[('User-Agent','Mozilla/5.0')]
req=urllib.request.Request(base+'/login',data=json.dumps({'password':os.environ['RANK_BOOST_DASHBOARD_PASSWORD']}).encode(),headers={'Content-Type':'application/json','Origin':base});op.open(req,timeout=30).read()
r=json.load(op.open(base+'/api/creative-qa?fresh=1',timeout=90));ads=[a for a in r['ads'] if a['campaign']['id']==args.campaign]
failed=[{'id':a['id'],'issues':a['issues'],'visual_reviewed':a['reviewed']} for a in ads if not a['passed']]
if not ads or failed:print(json.dumps({'passed':False,'reason':'Campaign must be registered and every current ad must pass','failed':failed},indent=2));raise SystemExit(1)
print(json.dumps({'passed':True,'campaign':args.campaign,'checkedAt':r['checkedAt'],'ads':[{'id':a['id'],'fingerprint':a['fingerprint']} for a in ads]},indent=2))

if args.activate:
 target=args.entity_id or args.campaign
 token=os.environ['THREESTRIPES_META_AD_TOKEN']
 def meta(data=None,fields='status'):
  url='https://graph.facebook.com/v25.0/'+target
  if data is None:url+='?'+urllib.parse.urlencode({'fields':fields})
  req=urllib.request.Request(url,data=urllib.parse.urlencode(data).encode() if data else None,headers={'Authorization':'Bearer '+token})
  return json.load(op.open(req,timeout=30))
 if target!=args.campaign and meta(fields='campaign_id').get('campaign_id')!=args.campaign:raise SystemExit('Target is outside the reviewed campaign')
 meta({'status':'ACTIVE'})
 live=meta()
 if live.get('status')!='ACTIVE':raise SystemExit('Activation did not verify')
 print(json.dumps({'activated':target,'status':live['status']}))
