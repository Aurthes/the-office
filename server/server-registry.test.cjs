const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {loadServerRegistry,saveServerRegistry}=require('./server-registry');
const machine={alias:'worker01',group:'offline',active:false,family:'Research'};
test('fresh instance stays empty; saves, reloads and clears its own private registry',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-registry-test-'));
 try{
  const first=path.join(root,'first/registry.json'),second=path.join(root,'second/registry.json');
  assert.deepEqual(await loadServerRegistry(first),{configured:false,hosts:[]});
  await saveServerRegistry([machine,{alias:'My Mac',group:'local',active:true,family:'Personal'}],first);
  assert.deepEqual((await loadServerRegistry(first)).hosts,[machine,{alias:'My Mac',group:'local',active:true,family:'Personal'}]);
  assert.deepEqual(await loadServerRegistry(second),{configured:false,hosts:[]});
  assert.equal((await fs.stat(first)).mode&0o777,0o600);
  await saveServerRegistry([],first);assert.deepEqual(await loadServerRegistry(first),{configured:false,hosts:[]});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('rejects invalid edits before touching a saved configuration',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-registry-test-')),file=path.join(root,'registry.json');
 try{
  await saveServerRegistry([machine],file);const before=await fs.readFile(file,'utf8');
  for(const hosts of [[machine,machine],[{...machine,alias:'-oProxyCommand=bad'}],[{...machine,group:'unknown'}],[{...machine,family:'a\nb'}],[{...machine,active:'yes'}],[{alias:'a',group:'local',active:true},{alias:'b',group:'local',active:true}]]){
   await assert.rejects(saveServerRegistry(hosts,file));assert.equal(await fs.readFile(file,'utf8'),before);
  }
  assert.deepEqual(await fs.readdir(root),['registry.json']);
  await fs.writeFile(file,'{broken');await assert.rejects(loadServerRegistry(file));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('explicit legacy inventory seeds an instance once; clearing the instance never reloads that inventory',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-registry-test-')),file=path.join(root,'registry.json'),legacy=path.join(root,'pool.conf');
 const previousFile=process.env.CLAW3D_SERVER_REGISTRY_FILE,previousPool=process.env.CLAW3D_SERVER_POOL_FILE;
 try{
  process.env.CLAW3D_SERVER_REGISTRY_FILE=file;process.env.CLAW3D_SERVER_POOL_FILE=legacy;
  await fs.writeFile(legacy,'worker01|offline|active=no|private transport note');
  assert.deepEqual((await loadServerRegistry()).hosts,[{alias:'worker01',group:'offline',active:false}]);
  await saveServerRegistry([]);assert.deepEqual(await loadServerRegistry(),{configured:false,hosts:[]});
  assert.equal(await fs.readFile(legacy,'utf8'),'worker01|offline|active=no|private transport note');
 }finally{
  for(const [key,value] of [['CLAW3D_SERVER_REGISTRY_FILE',previousFile],['CLAW3D_SERVER_POOL_FILE',previousPool]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await fs.rm(root,{recursive:true,force:true});
 }
});
