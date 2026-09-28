import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { requestEmbeddings } from './embeddings.ts';
const originalFetch=globalThis.fetch;
const originalEnv={...process.env};
afterEach(()=>{globalThis.fetch=originalFetch;for(const key of ['EMBEDDING_PROVIDER','EMBEDDING_MODEL','OLLAMA_BASE_URL','LMSTUDIO_BASE_URL']){if(originalEnv[key]===undefined) delete process.env[key];else process.env[key]=originalEnv[key];}});

test('native Ollama embeddings use the configured server and model with truncation disabled',async()=>{
  process.env.EMBEDDING_PROVIDER='ollama';process.env.OLLAMA_BASE_URL='https://ollama.example.test/v1/';process.env.EMBEDDING_MODEL='qwen3-embedding:4b';
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://ollama.example.test/api/embed');
    assert.deepEqual(JSON.parse(options.body),{model:'qwen3-embedding:4b',input:['one','two'],truncate:false});
    assert.equal(options.headers['ngrok-skip-browser-warning'],'true');
    return Response.json({embeddings:[[1,0],[0,1]]});
  };
  assert.deepEqual(await requestEmbeddings(['one','two']),[[1,0],[0,1]]);
});

test('invalid dimensions, zero vectors and wrong counts are rejected',async()=>{
  process.env.EMBEDDING_PROVIDER='ollama';
  for(const embeddings of [[[1,2],[1]],[[0,0],[1,0]],[[1,2]],[[1,'bad'],[1,2]]]){
    globalThis.fetch=async()=>Response.json({embeddings});
    await assert.rejects(requestEmbeddings(['one','two']),/invalid/);
  }
});

test('LM Studio compatibility orders indexed vectors and rejects duplicate indexes',async()=>{
  process.env.EMBEDDING_PROVIDER='lmstudio';process.env.LMSTUDIO_BASE_URL='http://local.test/v1';
  globalThis.fetch=async(url)=>{assert.equal(url,'http://local.test/v1/embeddings');return Response.json({data:[{index:1,embedding:[0,1]},{index:0,embedding:[1,0]}]});};
  assert.deepEqual(await requestEmbeddings(['one','two']),[[1,0],[0,1]]);
  globalThis.fetch=async()=>Response.json({data:[{index:0,embedding:[0,1]},{index:0,embedding:[1,0]}]});
  await assert.rejects(requestEmbeddings(['one','two']),/indexes/);
});
