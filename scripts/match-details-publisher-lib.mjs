import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CONTRACT='tennis-match-details-v1';
export const SPORT='Tennis';
export const COMPONENTS=['SurfaceFit','ServeVsReturn','ReturnVsServe','HoldBreak','SecondServe','BaseControl'];
export const ACTIVE_PATH='data/match-details/active.json';
export const RELEASE_ROOT='data/match-details/releases';
export const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new Error(message)};
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:fail(`Invalid BoardDate: ${value}`);
const finite=(value,label,min,max)=>{if(value===null||value===undefined)return;if(!Number.isFinite(value)||value<min||value>max)fail(`Invalid ${label}`)};

export function validatePointer(pointer){
  if(!pointer||typeof pointer!=='object')fail('Invalid active pointer');
  if(pointer.ContractVersion!==CONTRACT)fail('ContractVersion mismatch');
  if(pointer.Sport!==SPORT)fail('Sport mismatch');
  date(pointer.BoardDate);
  if(!pointer.Release||typeof pointer.Release!=='string')fail('Missing Release');
  const expected=`./releases/${pointer.Release}/TripleThreat_Tennis_V2_Match_Details.json`;
  if(pointer.Artifact!==expected)fail('Invalid artifact path');
  if(!/^[a-f0-9]{64}$/.test(pointer.SHA256||''))fail('Invalid SHA-256');
  if(!pointer.GeneratedAt||Number.isNaN(Date.parse(pointer.GeneratedAt)))fail('Invalid GeneratedAt');
  return pointer;
}

function validateSide(side,player,opponent,label){
  if(!side||side.Player!==player||side.Opponent!==opponent)fail(`Invalid ${label} identities`);
  const status=side.MatchupScoreStatus;
  if(status==='SCORED')finite(side.MatchupScore,`${label} Matchup Score`,0,100);
  else if(status==='UNAVAILABLE'){if(side.MatchupScore!==null)fail(`Inconsistent ${label} Matchup Score state/value`)}
  else fail(`Invalid ${label} Matchup Score status`);
  if(!side.Components||typeof side.Components!=='object')fail(`Missing ${label} components`);
  for(const component of COMPONENTS){const value=side.Components[component];if(!value)fail(`Missing ${label} ${component}`);finite(value.Score,`${label} ${component}`,0,100)}
}

export function validateArtifact(artifact,pointer){
  if(!artifact||typeof artifact!=='object'||!Array.isArray(artifact.Matches))fail('Invalid artifact');
  if(artifact.ContractVersion!==CONTRACT)fail('ContractVersion mismatch');
  if(artifact.Sport!==SPORT)fail('Sport mismatch');
  date(artifact.BoardDate);
  if(pointer&&artifact.BoardDate!==pointer.BoardDate)fail('BoardDate mismatch');
  if(artifact.MatchCount!==artifact.Matches.length)fail('MatchCount mismatch');
  const ids=new Set();
  for(const match of artifact.Matches){
    if(!match.MatchID||ids.has(match.MatchID))fail('Duplicate or missing MatchID');ids.add(match.MatchID);
    if(match.BoardDate!==artifact.BoardDate)fail('Match BoardDate mismatch');
    if(!match.PlayerA||!match.PlayerB||match.PlayerA===match.PlayerB)fail('Duplicate player-side identity');
    validateSide(match.PlayerAMatchup,match.PlayerA,match.PlayerB,'Player A');
    validateSide(match.PlayerBMatchup,match.PlayerB,match.PlayerA,'Player B');
    const read=match.ModelRead||{};
    for(const key of ['ModelWinProbability','PlayerAModelWinProbability','PlayerBModelWinProbability','NoVigMarketProbability','PlayerANoVigProbability','PlayerBNoVigProbability'])finite(read[key],key,0,1);
    finite(read.Edge,'Edge',-1,1);
    if(match.CounterEvidence?.Status==='UNAVAILABLE'&&match.CounterEvidence.Evidence?.length)fail('Unavailable Counter Evidence contains evidence');
  }
  return artifact;
}

export function validateCandidate(pointerBytes,artifactBytes){
  let pointer,artifact;try{pointer=JSON.parse(pointerBytes)}catch{fail('Invalid pointer JSON')}try{artifact=JSON.parse(artifactBytes)}catch{fail('Invalid artifact JSON')}
  validatePointer(pointer);validateArtifact(artifact,pointer);
  if(sha256(artifactBytes)!==pointer.SHA256)fail('Artifact SHA-256 mismatch');
  return{pointer,artifact};
}

export function assertNotOlder(candidate,current){if(current&&candidate.BoardDate<current.BoardDate)fail('Older candidate cannot replace active BoardDate')}
export function isIdempotent(candidate,current){return Boolean(current&&candidate.Release===current.Release&&candidate.SHA256===current.SHA256)}
export function intendedPaths(pointer){return[ACTIVE_PATH,`${RELEASE_ROOT}/${pointer.Release}/TripleThreat_Tennis_V2_Match_Details.json`]}
export function assertAllowedChanges(changes,pointer){const allowed=new Set(intendedPaths(pointer));for(const changed of changes){if(!allowed.has(changed.replaceAll('\\','/')))fail(`Unrelated repository change: ${changed}`)}}
export function gitSafety({branch,origin,inProgress,dirty=[],staged=[]},expectedOrigin){if(branch!=='main')fail('Publisher requires branch main');if(origin!==expectedOrigin)fail('Publisher remote mismatch');if(inProgress)fail('Git operation in progress');if(dirty.length)fail('Unrelated dirty files present');if(staged.length)fail('Unrelated staged files present')}
export function pushArgs(){return['push','origin','main']}
export function needsPush(aheadCount){return Number(aheadCount)>0}

export async function acquireLock(repo,{waitMs=5000,pollMs=100}={}){const lock=path.join(repo,'.git','match-details-publish.lock');const deadline=Date.now()+waitMs;while(true){try{fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return()=>fs.rmSync(lock,{recursive:true,force:true})}catch(error){if(error.code!=='EEXIST')throw error;if(Date.now()>=deadline)fail('Publication lock timeout');await new Promise(resolve=>setTimeout(resolve,pollMs))}}}

export async function pollLive({baseUrl,pointer,timeoutMs=60000,pollMs=2000,fetchImpl=fetch}){const deadline=Date.now()+timeoutMs;let last='';while(Date.now()<deadline){try{const activeResponse=await fetchImpl(`${baseUrl}/${ACTIVE_PATH}?t=${Date.now()}`,{cache:'no-store'});if(!activeResponse.ok)throw new Error(`active HTTP ${activeResponse.status}`);const liveBytes=Buffer.from(await activeResponse.arrayBuffer());const live=validatePointer(JSON.parse(liveBytes));if(live.Release!==pointer.Release||live.SHA256!==pointer.SHA256||live.BoardDate!==pointer.BoardDate)throw new Error('Live pointer mismatch');const artifactUrl=new URL(live.Artifact,`${baseUrl}/${ACTIVE_PATH}`).href;const artifactResponse=await fetchImpl(`${artifactUrl}?t=${Date.now()}`,{cache:'no-store'});if(!artifactResponse.ok)throw new Error(`artifact HTTP ${artifactResponse.status}`);const artifactBytes=Buffer.from(await artifactResponse.arrayBuffer());validateCandidate(Buffer.from(JSON.stringify(live)),artifactBytes);return{live,artifactBytes}}catch(error){last=error.message}await new Promise(resolve=>setTimeout(resolve,pollMs))}fail(`Pages verification timeout: ${last}`)}
