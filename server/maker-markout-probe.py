"""Bounded read-only Influx query; credentials stay in the instance setting."""
import base64,json,math,sys,urllib.parse,urllib.request
from pathlib import Path

HORIZONS={'100ms','1s','5s','15s','30s','1m','2m','5m','10m','15m','30m','60m'}

def read(request):
    if request['horizon'] not in HORIZONS or len(request['strategies'])>16:raise ValueError('request')
    start,end,until,bucket=[int(request[k]) for k in ['start','end','until','bucketMs']]
    if not 0<end-start<=86400000 or not end<=until<end+bucket or bucket not in (300000,900000,3600000):raise ValueError('window')
    rows=[];quality=[]
    for spec in request['strategies']:
        config=json.loads(Path(spec['setting']).read_text())['system']['influx']
        u=urllib.parse.urlsplit(config['url']);endpoint=urllib.parse.urlunsplit((u.scheme,u.netloc,'/query','',''))
        strategy=spec['name']
        if not strategy or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-' for c in strategy):raise ValueError('strategy')
        where=' WHERE "strategy"=\''+strategy+'\' AND "horizon"=\''+request['horizon']+'\' AND "kind"=\'maker\' AND "population"=\'opening\' '
        columns=['count','sample_schema','sample_count','sample_overflow','sample_invalid']+[f'sample_{i:02d}' for i in range(64)]
        samples='SELECT '+','.join('"'+c+'"' for c in columns)+' FROM "MMActualMarkout"'+where+f' AND time>={start}ms AND time<{until}ms AND "count">0 GROUP BY "strategy","symbol","side","tif","run" LIMIT 20001'
        coverage='SELECT last("missing_total") AS missing,last("pending") AS pending,last("settled_total") AS settled FROM "MMActualMarkout"'+where+f' AND time>={start-bucket}ms AND time<{until}ms GROUP BY "strategy","symbol","side","tif","run",time({bucket}ms) fill(none)'
        req=urllib.request.Request(endpoint+'?'+urllib.parse.urlencode({'db':config['database'],'q':samples+';'+coverage,'epoch':'ms'}))
        if config.get('username'):req.add_header('Authorization','Basic '+base64.b64encode((config['username']+':'+config.get('password','')).encode()).decode())
        with urllib.request.urlopen(req,timeout=15) as response:raw=response.read(12*1024*1024+1)
        if len(raw)>12*1024*1024:raise ValueError('response limit')
        result=json.loads(raw)['results']
        if len(result)!=2 or any(r.get('error') for r in result):raise ValueError('query')
        for target,part in [(rows,result[0]),(quality,result[1])]:
            for series in part.get('series',[]):
                tags=series.get('tags',{})
                for values in series.get('values',[]):
                    value=dict(zip(series['columns'],values));r={k:value.get(k,tags.get(k,'')) for k in ['strategy','symbol','side','tif','run']}
                    r['strategy']=r['strategy'] or strategy;r['tif']=r['tif'] or 'unknown';r['time']=value['time']
                    r['fields']={k:(v if isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) else None) for k,v in value.items() if k not in ['time','strategy','symbol','side','tif','run','horizon','quote','kind','population','strategy_idx','valuation_method']}
                    target.append(r)
                    if len(rows)>20000 or len(quality)>20000:raise ValueError('row limit')
    return {'version':1,'rows':rows,'quality':quality}

if __name__=='__main__':
    try:print(json.dumps(read(json.loads(sys.argv[1])),allow_nan=False,separators=(',',':')))
    except Exception:print(json.dumps({'version':1,'error':'source-unavailable','rows':[],'quality':[]}))
