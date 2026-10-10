import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/wallE411/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixtureRoot=process.env.MATCH_DETAILS_FIXTURE_ROOT;
const pointer=JSON.parse(fs.readFileSync(path.join(fixtureRoot,'active.json')));
const boardDate=pointer.BoardDate;
const staleDate=boardDate==='2026-10-03'?'2026-10-04':'2026-10-03';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});

try{
  const results=[];
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const page=await browser.newPage({viewport}),errors=[],requests=[];
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>requests.push(request.url()));
    await page.goto(`http://127.0.0.1:8765/?sport=tennis&boardDate=${boardDate}`,{waitUntil:'networkidle'});
    await page.waitForSelector('#view:not([hidden])');
    const result=await page.evaluate(()=>({count:document.querySelector('#match').options.length,scoreCount:document.querySelectorAll('.score-value').length,componentRows:document.querySelectorAll('#comparison .evidence-component').length,reasonCards:document.querySelectorAll('#evidence .reason-card').length,conclusion:document.querySelector('#model-conclusion').textContent,counter:document.querySelector('#counter-evidence').textContent,overflow:document.documentElement.scrollWidth>window.innerWidth,status:document.querySelector('#status').textContent}));
    assert.equal(result.scoreCount,2);assert.equal(result.componentRows,6);assert.equal(result.reasonCards,4);assert.ok(result.conclusion.trim().length>0);assert.match(result.counter,/NO_AUTHORITATIVE_MATCHUP_COUNTER_EVIDENCE_FIELD/);assert.equal(result.overflow,false);assert.deepEqual(errors,[]);assert.equal(requests.some(url=>/docs\.google|spreadsheet|output=csv/i.test(url)),false);
    results.push({viewport,result,errors,googleSheetRequests:0});
  }
  const stale=await browser.newPage({viewport:{width:390,height:844}});
  await stale.goto(`http://127.0.0.1:8765/?sport=tennis&boardDate=${staleDate}`,{waitUntil:'networkidle'});
  const staleState=await stale.evaluate(()=>({hidden:document.querySelector('#view').hidden,status:document.querySelector('#status').textContent}));
  assert.equal(staleState.hidden,true);assert.match(staleState.status,new RegExp(`No current Match Details data is available for ${staleDate}`));
  console.log(JSON.stringify({results,staleState},null,2));
}finally{await browser.close()}
