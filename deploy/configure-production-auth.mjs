// Update public auth settings without displaying or changing database credentials.
import fs from 'node:fs/promises';
const file='/etc/aviquiz/aviquiz.env';
const info=await fs.lstat(file);
if(process.getuid()!==0||!info.isFile()||info.uid!==0||(info.mode&0o777)!==0o600)throw Error('Protected runtime file required.');
const settings={AUTH_ENABLED:'true',AUTH_ISSUER:'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_PeMNWojig',AUTH_CLIENT_ID:'5k6432qbameb6cdibj6s1013ig',AUTH_DOMAIN:'https://us-east-2pemnwojig.auth.us-east-2.amazoncognito.com'}; // gitleaks:allow -- Public client/hosting identifier; not a credential.
const lines=(await fs.readFile(file,'utf8')).split('\n').filter(line=>!Object.keys(settings).some(key=>line.startsWith(key+'=')));
const text=lines.filter(Boolean).join('\n')+'\n'+Object.entries(settings).map(([key,value])=>key+'='+value).join('\n')+'\n';
await fs.writeFile(file+'.new',text,{mode:0o600,flag:'wx'});await fs.rename(file+'.new',file);
console.log('Production public authentication settings configured; protected database settings preserved.');
