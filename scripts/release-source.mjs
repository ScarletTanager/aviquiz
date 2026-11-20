import {spawnSync} from 'node:child_process';
function runGit(root,args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error('Git verification failed; verify repository and GitHub access.');return r.stdout.trim();}
export function verifyReleaseSource(root,{git=args=>runGit(root,args)}={}){
 if(git(['status','--porcelain','--untracked-files=normal']))throw Error('Production packaging refused: commit and push all source changes first.');
 const commit=git(['rev-parse','HEAD']),branch=git(['branch','--show-current']);
 if(!/^[0-9a-f]{40}$/.test(commit)||!branch)throw Error('Production packaging requires a checked-out, pushed Git branch.');
 if(branch!=='main')throw Error('Production packaging requires main after user-approved staging verification.');
 const remote=git(['ls-remote','--exit-code','origin','refs/heads/'+branch]);
 if(remote.split(/\s+/)[0]!==commit)throw Error('Production packaging refused: GitHub does not have this branch at the current commit. Push it first.');
 return {commit,branch};
}
