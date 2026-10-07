// Rebuild with isolated, pinned tooling; generated assets are committed for static hosting.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'thm-pdf-build-'));
try{
 execFileSync('npm',['install','--prefix',dir,'--no-save','--package-lock=false','pdf-lib@1.17.1','@pdf-lib/fontkit@1.1.1','qrcode@1.5.4','esbuild@0.25.11'],{stdio:'inherit'});
 execFileSync(join(dir,'node_modules/.bin/esbuild'),['scripts/seller-presentation-client.js','--bundle','--minify','--format=esm','--platform=browser','--outfile=admin-presentation-pdf.js'],{stdio:'inherit',env:{...process.env,NODE_PATH:join(dir,'node_modules')}});
}finally{rmSync(dir,{recursive:true,force:true});}
