// Only the public ingestion token is exposed. Personal API credentials stay server-side.
export function onRequestGet({env}) {
 return Response.json(env.POSTHOG_PROJECT_TOKEN ? {enabled:true,token:env.POSTHOG_PROJECT_TOKEN,host:'https://us.i.posthog.com'} : {enabled:false}, {headers:{'Cache-Control':'no-store'}});
}
