import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import browserHandler, { gatewayPlan } from '../api/browser-run.js';
import mcpHandler from '../api/mcp.js';

function call(handler, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = {method:'POST',url:'/api/mcp',headers:{host:'test.example.com',
      'content-type':'application/json',accept:'application/json, text/event-stream',...headers},query:{},body};
    const result = {status:200,headers:{}};
    const res = {setHeader(n,v){result.headers[n]=v;},status(n){result.status=n;return this;},
      json(data){result.data=data;return this;},send(data){result.data=data;return this;}};
    Promise.resolve(handler(req,res)).then(()=>resolve(result)).catch(reject);
  });
}

function rpc(result) {
  const body = result.data.toString();
  const dataLine = body.split('\n').find(x => x.startsWith('data:'));
  const json = dataLine ? dataLine.slice(5).trim() : body;
  return JSON.parse(json);
}

test('browser state machine and actual MCP transport preserve public scope and stop limits', async () => {
  const oldLaunch = puppeteer.launch, oldPath = chromium.executablePath, oldFetch = globalThis.fetch;
  const oldEnv = process.env.VERCEL_ENV;
  let mode = 'read', launches = 0, clicks = 0, plannerCalls = 0, closed = 0;
  const initialUrl = 'https://1.1.1.1/';
  process.env.VERCEL_ENV = 'preview';
  chromium.executablePath = async () => '/fixture-chromium';
  puppeteer.launch = async options => {
    launches++;
    assert.ok(options.args.some(x => x.startsWith('--proxy-server=http://127.0.0.1:')));
    let url = initialUrl;
    const page = {
      async setRequestInterception(){},on(){},async goto(value){url=value;},
      async evaluate(){return {url,title:url===initialUrl?'Example Domain':'Example Domains',
        bodyText:'Public fixture page',elements:[{id:'cp-0',tag:'a',label:'Learn more',href:'https://www.iana.org/help/example-domains'}]};},
      async click(){clicks++;url='https://www.iana.org/help/example-domains';},
    };
    return {async newPage(){return page;},async close(){closed++;}};
  };
  globalThis.fetch = async () => {
    plannerCalls++;
    if (mode === '429') return new Response(JSON.stringify({error:{message:'Untrusted secret-bearing upstream details'}}),{status:429});
    const decision = mode === 'click' && clicks === 0 ? {action:'click',id:'cp-0'} :
      mode === 'protected' ? {action:'navigate',url:'https://example.com/delete_account',text:'should-not-echo'} :
      {action:'finish',answer:'Fixture title confirmed'};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(decision)}}]}));
  };
  try {
    let result = await call(browserHandler,{url:initialUrl,task:'Tell me the page title.',maxSteps:2});
    assert.equal(result.status,200);assert.equal(result.data.status,'completed');assert.equal(result.data.pageTitle,'Example Domain');
    mode='click';clicks=0;
    result = await call(browserHandler,{url:initialUrl,
      task:'Click the Learn more link exactly once. After that destination loads, stop browsing and tell me its title and URL.',maxSteps:7});
    assert.equal(result.data.guard,'explicit-post-navigation-stop',JSON.stringify(result));assert.equal(clicks,1);
    assert.equal(result.data.finalUrl,'https://www.iana.org/help/example-domains');
    mode='protected';
    result = await call(browserHandler,{url:initialUrl,task:'Find information on this page.'});
    assert.equal(result.data.status,'approval_required');assert.equal(result.data.pendingAction.text,undefined);
    const before = launches;
    for (const task of ['Buy this item','Send a message','Delete my account','Change password','Enter the card number']) {
      result=await call(browserHandler,{url:initialUrl,task});
      assert.equal(result.data.status,'approval_required');
    }
    assert.equal(launches,before);
    result=await call(browserHandler,{url:'http://[::ffff:127.0.0.1]',task:'Read the title.'});
    assert.equal(result.status,400);assert.equal(launches,before);
    mode='read';
    result=await call(mcpHandler,{jsonrpc:'2.0',id:1,method:'initialize',params:{
      protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'counterpart-local-qa',version:'1.0'}}});
    assert.equal(result.status,200);assert.equal(rpc(result).result.serverInfo.name,'Counterpart Browser Cloud');
    result=await call(mcpHandler,{jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
    const tool=rpc(result).result.tools.find(x=>x.name==='browse_web');
    assert.ok(tool);assert.equal(tool.inputSchema.properties.maxSteps.maximum,7);
    assert.equal(tool.annotations.readOnlyHint,true);
    result=await call(mcpHandler,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'browse_web',
      arguments:{url:initialUrl,task:'Read the page title.',maxSteps:2}}});
    assert.equal(result.status,200);assert.equal(rpc(result).result.structuredContent.status,'completed');
    mode='429';const before429=plannerCalls;
    result=await call(browserHandler,{url:initialUrl,task:'Read this page.'});
    assert.equal(result.status,429);assert.equal(result.data.code,'PLANNER_RATE_LIMIT');
    assert.equal(plannerCalls-before429,3);assert.doesNotMatch(JSON.stringify(result.data),/Untrusted|secret-bearing/);
    const beforeDeadline=plannerCalls;
    await assert.rejects(gatewayPlan('Read',{},[],true,Date.now()-1),{code:'BROWSER_TIMEOUT'});
    assert.equal(plannerCalls,beforeDeadline);assert.equal(closed,launches);
    process.env.VERCEL_ENV='production';
    result=await call(mcpHandler,{jsonrpc:'2.0',id:4,method:'tools/list',params:{}});
    assert.equal(result.status,403);assert.equal(result.data.code,'PREVIEW_ONLY');
  } finally {
    puppeteer.launch=oldLaunch;chromium.executablePath=oldPath;globalThis.fetch=oldFetch;
    if (oldEnv===undefined) delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;
  }
});
