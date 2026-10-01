// Study-only same-origin proxy, with independent connectivity diagnostics.
const BACKEND='https://counterpart-ai-backend.blee12384.workers.dev/api/team';
const HEALTH='https://counterpart-ai-backend.blee12384.workers.dev/health';
module.exports=async(request,response)=>{
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Counterpart-Study-Proxy','v5');
  if(request.method==='GET'){
    const probe=String(request.query?.probe||'proxy');
    if(probe==='proxy') return response.status(200).json({proxy:'ok',version:'study-v5'});
    if(probe!=='backend') return response.status(400).json({error:'Unsupported diagnostic'});
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),10000);
      let upstream;
      try{upstream=await fetch(HEALTH,{method:'GET',headers:{Accept:'application/json'},signal:controller.signal});}
      finally{clearTimeout(timer);}
      const contentType=upstream.headers.get('content-type')||'';
      let backendVersion='';
      if(contentType.includes('application/json')){
        const data=await upstream.json();
        backendVersion=String(data?.version||data?.status||'').slice(0,100);
      }
      return response.status(upstream.ok?200:502).json({
        proxy:'ok',backend:upstream.ok?'reachable':'unhealthy',
        backendStatus:upstream.status,...(backendVersion?{backendVersion}:{})
      });
    }catch(error){
      return response.status(502).json({
        proxy:'ok',backend:'unreachable',
        reason:error?.name==='AbortError'?'Health check timed out after 10 seconds':'Could not reach Cloudflare backend'
      });
    }
  }
  if(request.method!=='POST'){
    response.setHeader('Allow','GET, POST');
    return response.status(405).json({error:'Method not allowed'});
  }
  try{
    const body=typeof request.body==='string'?request.body:JSON.stringify(request.body??{});
    const headers={'Content-Type':'application/json'};
    const accessKey=request.headers['x-counterpart-key'];
    if(accessKey)headers['X-Counterpart-Key']=accessKey;
    const started=Date.now();
    const upstream=await fetch(BACKEND,{method:'POST',headers,body});
    const text=await upstream.text();
    console.info('Counterpart upstream status',upstream.status,'elapsedMs',Date.now()-started);
    response.status(upstream.status);
    response.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json; charset=utf-8');
    return response.send(text);
  }catch(error){
    console.error('Counterpart proxy upstream error',error?.name||'Error');
    return response.status(502).json({
      error:'Counterpart backend proxy failed',
      detail:String(error?.message||error)
    });
  }
};
