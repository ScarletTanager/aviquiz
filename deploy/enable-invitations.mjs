import fs from 'node:fs/promises';
if(process.getuid()!==0)throw Error('Root required.');
const file='/etc/aviquiz/aviquiz.env';
const original=await fs.readFile(file,'utf8');
if(!/^AUTH_ENABLED=true$/m.test(original))throw Error('Account sign-in must already be enabled.');
const updated=original.split('\n').filter(line=>!line.startsWith('INVITATIONS_ENABLED=')).join('\n').trimEnd()+'\nINVITATIONS_ENABLED=true\n';
await fs.writeFile(file+'.new',updated,{mode:0o600,flag:'wx'});
await fs.rename(file+'.new',file);
console.log('Invitation feature enabled in protected runtime configuration.');
