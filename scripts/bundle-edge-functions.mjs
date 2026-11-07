// Dashboard's single-file editor deployment. No env files or Vite app config are loaded.
import {build} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
mkdirSync('supabase/bundles',{recursive:true});
const supported=['recipes','ocr','recognize','email-verification','email-reminder-worker','export-download'];
const names=process.argv.slice(2).length?process.argv.slice(2):supported;
if(names.some(name=>!supported.includes(name)))throw new Error('Unknown Edge function name');
for(const name of names){
  const result=await build({configFile:false,envFile:false,logLevel:'error',build:{write:false,minify:false,target:'es2022',ssr:`supabase/functions/${name}/index.ts`,rollupOptions:{external:[/^(npm|jsr|node):/],output:{format:'es'}}}});
  const outputs=(Array.isArray(result)?result:[result]).flatMap(r=>r.output);
  const entry=outputs.find(o=>o.type==='chunk'&&o.isEntry);
  if(!entry||!entry.code.includes('Deno.serve'))throw new Error(`Invalid Edge bundle: ${name}`);
  writeFileSync(`supabase/bundles/${name}.ts`,'// Generated deployment bundle. Secrets are read from Deno.env at runtime.\n'+entry.code);
}
console.log(`${names.length} single-file Edge bundles generated without loading env files.`);
