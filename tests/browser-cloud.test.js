import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { isPublicIP, safeUrl, resolvePublicTarget, actionNeedsApproval,
  productionDisabled, createRunLimiter } from '../lib/browser-safety.js';
import { createPublicWebProxy } from '../lib/public-web-proxy.js';

test('rejects private, metadata, mapped IPv6, alternate encodings, and URL credentials', () => {
  for (const address of ['127.0.0.1','10.1.2.3','172.31.0.1','192.168.0.1',
    '169.254.169.254','100.64.1.1','0.0.0.0','224.0.0.1','::1','fe80::1',
    'fd00::1','::ffff:127.0.0.1','::ffff:10.0.0.1','2001:db8::1','2002:7f00:1::']) {
    assert.equal(isPublicIP(address), false, address);
  }
  for (const url of ['http://localhost','http://localhost.','http://test.local',
    'http://127.1','http://2130706433','http://0x7f000001','http://0177.0.0.1',
    'http://[::1]','http://[::ffff:7f00:1]','https://example.com:8443',
    'https://user:secret@example.com','file:///etc/passwd','javascript:alert(1)']) {
    assert.equal(safeUrl(url), null, url);
  }
  assert.ok(safeUrl('https://example.com'));
  assert.equal(isPublicIP('8.8.8.8'), true);
  assert.equal(isPublicIP('2606:4700:4700::1111'), true);
  assert.ok(safeUrl('https://[2606:4700:4700::1111]'));
});

test('DNS validation rejects private and mixed answers and returns the exact validated IP', async () => {
  for (const answers of [[{address:'127.0.0.1',family:4}],
    [{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]]) {
    await assert.rejects(resolvePublicTarget('https://example.com',async () => answers), {code:'UNSAFE_URL'});
  }
  const result = await resolvePublicTarget('https://example.com',async () => [{address:'93.184.216.34',family:4}]);
  assert.equal(result.address, '93.184.216.34');
});

test('blocks purchase, send, delete, security, terms, unknown forms, and credentials', () => {
  const elements = [
    {id:'cp-0',tag:'a',label:'Learn more',href:'https://www.iana.org/help/example-domains'},
    {id:'cp-1',tag:'button',type:'submit',label:'Continue',formMethod:'post'},
    {id:'cp-2',tag:'input',type:'password',label:'Access'},
    {id:'cp-3',tag:'input',type:'search',label:'Search',formMethod:'get',formPurpose:'search'},
    {id:'cp-4',tag:'button',label:'Find',formMethod:'get',formPurpose:'search'},
    {id:'cp-5',tag:'input',type:'text',name:'cc-number',autocomplete:'cc-number',label:'Card number'},
  ];
  const snapshot = {elements};
  assert.equal(actionNeedsApproval({action:'click',id:'cp-0'},snapshot),false);
  assert.equal(actionNeedsApproval({action:'type',id:'cp-3',text:'Irvine art classes'},snapshot),false);
  assert.equal(actionNeedsApproval({action:'click',id:'cp-4'},snapshot),false);
  for (const action of [
    {action:'click',id:'cp-1'},{action:'type',id:'cp-2',text:'hidden-secret'},
    {action:'type',id:'cp-5',text:'hidden-card'},{action:'click',id:'cp-999'},
    ...['checkout','send-message','delete_account','change-password','accept-terms','login']
      .map(path => ({action:'navigate',url:'https://example.com/'+path})),
    {action:'navigate',url:'http://127.0.0.1'},
  ]) assert.equal(actionNeedsApproval(action,snapshot),true,JSON.stringify(action));
});

test('main production stays disabled even if dedicated flag is accidentally set', () => {
  const dedicated = {VERCEL_ENV:'production',COUNTERPART_BROWSER_SERVICE:'dedicated-v1',
    VERCEL_PROJECT_ID:'prj_W6UoNfPuV49vk0ywIw1hJXuCbIJL',
    COUNTERPART_BROWSER_PROJECT_ID:'prj_W6UoNfPuV49vk0ywIw1hJXuCbIJL'};
  assert.equal(productionDisabled(dedicated),false);
  assert.equal(productionDisabled({...dedicated,VERCEL_PROJECT_ID:'prj_lzUulhynX4eHg96Xsys6t093IgY5'}),true);
  assert.equal(productionDisabled({...dedicated,COUNTERPART_BROWSER_PROJECT_ID:'prj_other'}),true);
  assert.equal(productionDisabled({...dedicated,VERCEL_PROJECT_ID:undefined}),false);
  assert.equal(productionDisabled({VERCEL_ENV:'production'}),true);
  assert.equal(productionDisabled({VERCEL_ENV:'preview'}),false);
});

test('run quota and concurrent-run controls fail closed', () => {
  const limiter = createRunLimiter({limit:2,windowMs:100});
  const first = limiter.acquire(1000);
  assert.equal(typeof first,'function');
  assert.equal(limiter.acquire(1001),null);
  first(); first();
  const second = limiter.acquire(1002);
  second();
  assert.equal(limiter.acquire(1003),null);
  assert.equal(typeof limiter.acquire(1103),'function');
});

test('proxy refuses direct HTTP, CONNECT, private IPv6, and mutation methods', async () => {
  const proxy = await createPublicWebProxy();
  const port = Number(new URL(proxy.url).port);
  try {
    for (const [method,path] of [['GET','http://127.0.0.1'],['POST','http://example.com'],
      ['GET','http://[::ffff:7f00:1]'],['GET','http://169.254.169.254/latest/meta-data']]) {
      const status = await new Promise((resolve,reject) => {
        const req = http.request({host:'127.0.0.1',port,method,path},res => {res.resume();resolve(res.statusCode);});
        req.on('error',reject);req.end();
      });
      assert.equal(status,403);
    }
    const response = await new Promise((resolve,reject) => {
      const socket = net.connect({host:'127.0.0.1',port},() => socket.write('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n'));
      socket.on('data',chunk => {resolve(chunk.toString());socket.destroy();});socket.on('error',reject);
    });
    assert.match(response,/403 Forbidden/);
  } finally { await proxy.close(); }
});
