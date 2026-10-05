#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ACTIVE_PATH,acquireLock,assertAllowedChanges,assertNotOlder,gitSafety,intendedPaths,isIdempotent,needsPush,pollLive,porcelainLines,validateCandidate,validatePointer,validateUncommittedRecovery} from './match-details-publisher-lib.mjs';

const args=process.argv.slice(2);const value=flag=>{const index=args.indexOf(flag);return index<0?'':args[index+1]};
if(args[0]!=='publish'||!value('--active')||!value('--artifact')||!args.includes('--production'))throw new Error('Usage: node scripts/publish-match-details.mjs publish --active <active.json> --artifact <artifact.json> --production');
const repo=path.resolve(value('--repo')||process.cwd());const sourceActive=path.resolve(value('--active'));const sourceArtifact=path.resolve(value('--artifact'));
const expectedOrigin='https://github.com/dblxlgaming-sudo/triple-threat-match-detail.git';const liveBase='https://dblxlgaming-sudo.github.io/triple-threat-match-detail';
function git(...gitArgs){const result=spawnSync('git',gitArgs,{cwd:repo,encoding:'utf8'});if(result.status!==0)throw new Error((result.stderr||result.stdout).trim());return result.stdout.trim()}
function statusLines(){const result=spawnSync('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:repo,encoding:'utf8'});if(result.status!==0)throw new Error((result.stderr||result.stdout).trim());return porcelainLines(result.stdout)}
function state(){const status=statusLines();return{branch:git('branch','--show-current'),origin:git('remote','get-url','origin').replace(/\.git$/,'')+'.git',inProgress:['MERGE_HEAD','REBASE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD'].some(file=>fs.existsSync(path.join(repo,'.git',file))),dirty:status.filter(line=>line.slice(1,2)!==' '),staged:status.filter(line=>line[0]!==' '&&line[0]!=='?')}}
const releaseLock=await acquireLock(repo,{waitMs:Number(value('--lock-wait-ms')||5000)});
try{
  const pointerBytes=fs.readFileSync(sourceActive),artifactBytes=fs.readFileSync(sourceArtifact);const candidate=validateCandidate(pointerBytes,artifactBytes);
  const [activeRelative,releaseRelative]=intendedPaths(candidate.pointer),activeFile=path.join(repo,activeRelative),releaseFile=path.join(repo,releaseRelative);const repositoryState=state();let recoverUncommitted=false;
  if(repositoryState.dirty.length||repositoryState.staged.length){const changes=statusLines().map(line=>line.slice(3));validateUncommittedRecovery({changes,pointer:candidate.pointer,pointerBytes,artifactBytes,diskPointerBytes:fs.existsSync(activeFile)?fs.readFileSync(activeFile):null,diskArtifactBytes:fs.existsSync(releaseFile)?fs.readFileSync(releaseFile):null});recoverUncommitted=true}
  gitSafety({...repositoryState,dirty:[],staged:[]},expectedOrigin);
  const current=fs.existsSync(activeFile)?validatePointer(JSON.parse(fs.readFileSync(activeFile))):null;assertNotOlder(candidate.pointer,current);
  if(recoverUncommitted){git('add','--',releaseRelative,activeRelative);assertAllowedChanges(git('diff','--cached','--name-only').split(/\r?\n/).filter(Boolean),candidate.pointer);git('commit','-m',`Publish Match Details ${candidate.pointer.Release}`)}
  else if(!isIdempotent(candidate.pointer,current)){
    if(fs.existsSync(releaseFile))throw new Error('Immutable release path already exists with different active state');
    const stageRoot=fs.mkdtempSync(path.join(repo,'.git','match-details-stage-'));try{const staged=path.join(stageRoot,'artifact.json');fs.copyFileSync(sourceArtifact,staged);validateCandidate(pointerBytes,fs.readFileSync(staged));fs.mkdirSync(path.dirname(releaseFile),{recursive:true});fs.copyFileSync(staged,releaseFile);fs.mkdirSync(path.dirname(activeFile),{recursive:true});const tempActive=`${activeFile}.tmp-${process.pid}`;fs.copyFileSync(sourceActive,tempActive);fs.renameSync(tempActive,activeFile);assertAllowedChanges(statusLines().map(line=>line.slice(3)),candidate.pointer);git('add','--',releaseRelative,activeRelative);assertAllowedChanges(git('diff','--cached','--name-only').split(/\r?\n/).filter(Boolean),candidate.pointer);git('commit','-m',`Publish Match Details ${candidate.pointer.Release}`)}finally{fs.rmSync(stageRoot,{recursive:true,force:true})}
  }
  if(needsPush(git('rev-list','--count','origin/main..HEAD')))git(...['push','origin','main']);await pollLive({baseUrl:liveBase,pointer:candidate.pointer,timeoutMs:Number(value('--pages-timeout-ms')||120000)});console.log(`SUCCESS ${candidate.pointer.Release} ${candidate.pointer.BoardDate}`);
}finally{releaseLock()}
