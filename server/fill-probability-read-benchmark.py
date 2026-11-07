"""T85 task-private read-only source projection. Never imported by production until Head approves."""
import base64,gzip,hashlib,json,math,struct,sys,time,urllib.parse,urllib.request
from pathlib import Path
STRATEGY='MMRPI'; SYMBOL='bybit.perp.wlfi_usdt'; ACCOUNT='bybit.Wealth_Trading09'; SIDE='ask'
def number(x):
    if type(x) not in (float,int) or not math.isfinite(x):raise ValueError('nonfinite')
    return x

def filekv_with_bytes(root,key,now):
    # Same bounded originalFileKV header/checksum algorithm, returning exactbody length.
    encoded=key.encode().hex()
    while len(encoded)>120:root=root/('p'+encoded[:120]);encoded=encoded[120:]
    with (root/('k'+encoded)/'current').open('rb') as stream:
        header=stream.read(33)
        if len(header)!=33 or header[:9]!=b'FKV00001S':raise ValueError('header')
        expiry,size,checksum=struct.unpack('<QQQ',header[9:])
        if size>256*1024 or expiry and expiry<=now:raise ValueError('size-expiry')
        payload=stream.read(size)
        if len(payload)!=size or stream.read(1):raise ValueError('length')
    actual=14695981039346656037
    for byte in payload:actual=(actual^byte)*1099511628211&((1<<64)-1)
    if actual!=checksum:raise ValueError('checksum')
    return json.loads(payload),size

def read(req):
    mode=req['mode']
    if mode not in ('disk','redis','influx') or req['spec']['name']!=STRATEGY:raise ValueError('scope')
    ns={'__name__':'task_private_import'};exec(req['originalFillProbe'],ns)
    setting=Path(req['spec']['setting']);root=setting.parent;cfg=ns['read_json'](setting)
    instance=str(cfg['strategy']['params']['instance_id']);pid,sha,started=ns['identity'](root,STRATEGY)
    if instance!='5' or sha!=req['spec']['sourceSha'] or req['spec']['feedbackVersion']!=8:raise ValueError('source-drift')
    t=time.perf_counter();read_at=int(time.time()*1000);source_time=None;quality={};read_bytes=None;scope='';sample_run=None
    if mode=='disk':
        key='cache:mm:target_fill_feedback:'+STRATEGY+':'+instance+':symbol:'+SYMBOL
        value,read_bytes=filekv_with_bytes(root/'.deploy_runtime/mm_cpp/local-persistence/state',key,read_at)
        ns['decode_state'](value,STRATEGY,instance,SYMBOL,8,read_at,started)
        side=value['side_states'][SIDE];ema=side['ema'];obs=side['observation']
        fields=[('hit_ema',ema['hit_ema']),('exposure_ema_seconds',ema['exposure_ema_seconds']),('base_model_hazard_ema',ema['base_model_hazard_ema']),('model_hazard_ema',ema['model_hazard_ema']),('actual_probability_1s',obs['actual_probability_1s']),('theoretical_probability_1s',obs['theoretical_probability_1s'])]
        source_time=obs['at_ms'];quality={'ready':obs['ready'],'enabled':obs['enabled'],'savedAt':value['saved_at_ms'],'observationSchema':side['observation_schema']};scope='symbol-side EMA shared across accounts'
        read_size_kind='exact FileKVbody bytes, excludes33B header'
    elif mode=='redis':
        import redis
        client=redis.Redis.from_url(cfg['system']['cache_redis'],socket_connect_timeout=2,socket_timeout=2)
        try:blobs=client.mget(['heartbeat:strategy:'+STRATEGY,'cache:mm:fill_probability_observation:'+STRATEGY+':'+instance])
        finally:client.close()
        if any(x and len(x)>4*1024*1024 for x in blobs):raise ValueError('size')
        hb,quote=[json.loads(x) if x else {} for x in blobs]
        if hb.get('pid')!=pid or hb.get('success') is not True or hb.get('strategy')!=STRATEGY or str(hb.get('strategy_idx'))!=instance or hb.get('type')!='hb' or number(hb.get('reporter_started_at_ms'))<started:raise ValueError('heartbeat')
        decoded=ns['decode_quotes'](quote,STRATEGY,instance,pid,read_at,started);side=decoded.get((ACCOUNT,SYMBOL),{}).get(SIDE)
        if not side or side['available'] is not True:raise ValueError('quote-unavailable')
        names=['baseTarget','beforeNormalize','afterNormalize','pmax','normalizationScale','currentCaProbability'];fields=[(k,side[k]) for k in names];source_time=side['at'];quality={'available':side['available'],'exportedAt':side['exportedAt'],'quoted':side['quoted']};scope='one account-symbol-side quote';read_bytes=sum(len(x or b'') for x in blobs);read_size_kind='actual Redis blobs'
    else:
        inf=cfg['system']['influx'];u=urllib.parse.urlsplit(inf['url']);endpoint=urllib.parse.urlunsplit((u.scheme,u.netloc,'/query','',''))
        q='SELECT "count","sample_schema","sample_count","sample_00","bps_sum","notional_sum" FROM "MMActualMarkout" WHERE "strategy"=\'MMRPI\' AND "strategy_idx"=\'5\' AND "run"=\'1794061842331754692\' AND "symbol"=\'bybit.perp.wlfi_usdt\' AND "side"=\'sell\' AND "tif"=\'rpi\' AND "horizon"=\'60m\' AND "kind"=\'maker\' AND "population"=\'opening\' AND time>=1794067849796ms AND time<1794067859796ms AND "count">0 GROUP BY "strategy","strategy_idx","run","symbol","side","tif","horizon" LIMIT 2'
        request=urllib.request.Request(endpoint+'?'+urllib.parse.urlencode({'db':inf['database'],'q':q,'epoch':'ms'}),headers={'Accept-Encoding':'gzip'})
        if inf.get('username'):request.add_header('Authorization','Basic '+base64.b64encode((inf['username']+':'+inf.get('password','')).encode()).decode())
        with urllib.request.urlopen(request,timeout=10) as r:raw=r.read(65537);encoding=r.getheader('Content-Encoding')
        if len(raw)>65536:raise ValueError('size')
        response=json.loads(gzip.decompress(raw) if encoding=='gzip' else raw);rows=[]
        for part in response.get('results',[]):
            if part.get('error'):raise ValueError('query')
            for series in part.get('series',[]):rows.extend(dict(zip(series['columns'],v)) for v in series.get('values',[]))
        if len(rows)!=1:raise ValueError('nonempty-scope')
        point=rows[0]
        if point['time']!=1794067854559 or point['count']!=1 or point['sample_count']!=1 or point['sample_schema']!=1 or not math.isclose(point['notional_sum'],51.2043,rel_tol=1e-12,abs_tol=1e-9):raise ValueError('frozen-record')
        names=['count','sample_schema','sample_count','sample_00','bps_sum','notional_sum'];fields=[(k,point[k]) for k in names];source_time=point['time'];sample_run='1794061842331754692';quality={'historicalFrozenPoint':True,'horizon':'60m','tif':'rpi','accountAttribution':'metric has no account/CID; requestedaccount is context only'};scope='historical opening-maker sample, sell';read_bytes=len(raw);read_size_kind='encoded Influx HTTPbody'
    fields=[{'name':name,'value':number(value)} for name,value in fields]
    return {'version':1,'source':mode,'scope':{'strategy':STRATEGY,'instance':instance,'symbol':SYMBOL,'requestedAccount':ACCOUNT,'side':SIDE,'meaning':scope},'currentRuntimeIdentity':{'pid':pid,'sourceSha':sha,'processStartedAt':started},'sampleIdentity':{'run':sample_run,'historicalSourceEvidence':'accepted mature60-before-shared proof' if sample_run else None},'sourceTimeMs':source_time,'readAtMs':read_at,'sourceAgeMs':read_at-source_time if source_time else None,'quality':quality,'fields':fields,'rowCount':1,'sourceReadBytes':read_bytes,'sourceReadBytesKind':read_size_kind,'sourceReadMs':(time.perf_counter()-t)*1000,'strictlyComparableContent':False}
if __name__=='__main__':
    try:print(json.dumps(read(json.loads(sys.argv[1])),allow_nan=False,separators=(',',':')))
    except Exception:print('{"error":"task-benchmark-source-unavailable"}');sys.exit(1)
