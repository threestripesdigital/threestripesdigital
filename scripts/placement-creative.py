"""Build a placement-specific creative payload from an existing approved ad."""
def payload(ad, feed_hash, story_hash):
    old=ad['creative']; spec=old['object_story_spec']; link=spec['link_data']
    return {
        'name': old.get('name',ad['name'])+' | placement sizes',
        'url_tags':old.get('url_tags',''),
        'object_story_spec':{k:spec[k] for k in ['page_id','instagram_user_id'] if k in spec},
        'contextual_multi_ads':{'enroll_status':'OPT_OUT'},
        'degrees_of_freedom_spec':{'creative_features_spec':{k:{'enroll_status':'OPT_OUT'} for k in old['degrees_of_freedom_spec']['creative_features_spec']}},
        'asset_feed_spec':{
            'ad_formats':['SINGLE_IMAGE'],
            'optimization_type':'PLACEMENT',
            'bodies':[{'text':link['message']}],
            'titles':[{'text':link['name']}],
            'descriptions':[{'text':link.get('description','')}],
            'link_urls':[{'website_url':link['link']}],
            'call_to_action_types':[link['call_to_action']['type']],
            'images':[
                {'hash':feed_hash,'adlabels':[{'name':'feed'}]},
                {'hash':story_hash,'adlabels':[{'name':'story'}]}
            ],
            'asset_customization_rules':[
                {'customization_spec':{'publisher_platforms':['instagram'],'instagram_positions':['story']},'image_label':{'name':'story'},'priority':1},
                {'customization_spec':{'publisher_platforms':['facebook','instagram'],'facebook_positions':['feed'],'instagram_positions':['stream']},'image_label':{'name':'feed'},'priority':2,'is_default':True}
            ]
        }
    }
