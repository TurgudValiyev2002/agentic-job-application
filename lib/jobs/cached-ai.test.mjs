import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { aiCacheKey, readAiCache, writeAiCache, AI_CACHE_TTL_MS } from '../ai/result-cache.ts';
import { screenJobsCached, scoreJobMatchCached } from './cached-ai.ts';
import { defaultSearchPreferences as preferences } from './preferences.ts';
import { JOB_MATCH_PROMPT_VERSION } from '../ai/job-match.ts';
const cv='Built Python services.';
const job={id:'one',title:'Developer',company:'Example',location:'Vienna',description:'Python required.'};
const profile={titles:['Developer'],skills:['Python'],keywords:[],seniority:'junior',locations:[],remotePreference:'any'};
const assessment={roleFit:'aligned',requirements:[{requirement:'Python',jobQuote:'Python',cvQuote:cv,status:'met',importance:'required',explanation:'Demonstrated in the CV.'}]};
async function setup(t){
 const directory=await mkdtemp(path.join(tmpdir(),'orch-ai-cache-'));const old=process.env.AI_RESULT_CACHE_DIR,enabled=process.env.AI_CACHE_ENABLED;
 process.env.AI_RESULT_CACHE_DIR=directory;delete process.env.AI_CACHE_ENABLED;
 t.after(async()=>{if(old===undefined)delete process.env.AI_RESULT_CACHE_DIR;else process.env.AI_RESULT_CACHE_DIR=old;if(enabled===undefined)delete process.env.AI_CACHE_ENABLED;else process.env.AI_CACHE_ENABLED=enabled;await rm(directory,{recursive:true,force:true});});return directory;
}
test('reuses screening and scores across instances, ignores storage metadata, invalidates changed input',async t=>{
 await setup(t);let calls=0;
 const provider={providerName:'ollama',model:'test',requestStructuredCompletion:async input=>{calls++;const data=JSON.parse(input.messages[1].content);return {ok:true,model:'test',durationMs:1,content:JSON.stringify(input.schemaName==='job_relevance_screen'?{decisions:data.jobs.map(j=>({id:j.id,careerFit:'aligned',seniorityFit:'compatible',reason:'Career fits.'}))}:assessment)};}};
 assert.equal((await screenJobsCached([job],cv,profile,preferences,provider)).cached,0);
 assert.equal((await scoreJobMatchCached(cv,job,provider,preferences)).cached,false);assert.equal(calls,2);
 assert.equal((await screenJobsCached([{...job,id:'new-database-id',embedding:[1,0],updatedAt:new Date()}],cv,profile,preferences,{...provider})).cached,1);
 assert.equal((await scoreJobMatchCached(cv,job,{...provider},preferences)).cached,true);assert.equal(calls,2);
 for(const [text,posting,prefs,model] of [[cv+' Updated.',job,preferences,'test'],[cv,{...job,description:'Python required. SQL preferred.'},preferences,'test'],[cv,job,{...preferences,titles:['Backend Developer']},'test'],[cv,job,preferences,'new-model']]) {
   assert.equal((await scoreJobMatchCached(text,posting,{...provider,model},prefs)).cached,false);
 }
  assert.equal(calls,6);
  assert.equal((await screenJobsCached([job],cv,{...profile,seniority:'senior'},preferences,provider)).cached,0);
  assert.equal((await screenJobsCached([{...job,location:'Berlin'}],cv,profile,preferences,provider)).cached,0);
  assert.notEqual(aiCacheKey('assessment',{},provider,'v1'),aiCacheKey('assessment',{},provider,'v2'));
});
test('expired, malformed and invalid-evidence entries miss; failed calls are never cached',async t=>{
 const directory=await setup(t);let calls=0;
 const provider={providerName:'ollama',model:'test',requestStructuredCompletion:async()=>{calls++;return {ok:false,kind:'timeout',message:'offline',model:'test',durationMs:1};}};
 const key=aiCacheKey('assessment',{cvText:cv,preferences,job:{title:job.title,company:job.company,description:job.description}},provider,JOB_MATCH_PROMPT_VERSION);
 await writeAiCache(key,{...assessment,requirements:[{...assessment.requirements[0],cvQuote:'Invented evidence'}]});
 assert.equal((await scoreJobMatchCached(cv,job,provider,preferences)).ok,false);
 assert.equal((await scoreJobMatchCached(cv,job,provider,preferences)).ok,false);assert.equal(calls,2);
 const file=path.join(directory,`${key}.json`);const entry=JSON.parse(await readFile(file,'utf8'));
 await writeFile(file,JSON.stringify({...entry,createdAt:Date.now()-AI_CACHE_TTL_MS-1}));assert.equal(await readAiCache(key,z.unknown()),null);
 await writeFile(file,'broken');assert.equal(await readAiCache(key,z.unknown()),null);
});
