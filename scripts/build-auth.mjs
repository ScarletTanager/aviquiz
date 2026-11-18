import fs from 'node:fs';
// Copy upstream ESM and map its one dependency to a same-origin module.
const source = new URL('../node_modules/oidc-client-ts/dist/esm/oidc-client-ts.js', import.meta.url);
const code = fs.readFileSync(source, 'utf8').replace('from "jwt-decode"', 'from "./jwt-decode.mjs"');
if (/^import.*from ["'](?!\.\/)/m.test(code)) throw Error('OIDC distribution now needs bundling; inspect before publishing.');
fs.writeFileSync(new URL('../dist/oidc-client-ts.mjs', import.meta.url), code.replace(/\/\/# sourceMappingURL=.*$/m, ''));
fs.copyFileSync(new URL('../node_modules/oidc-client-ts/LICENSE', import.meta.url), new URL('../dist/oidc-client-ts-LICENSE.txt', import.meta.url));

fs.copyFileSync(new URL('../node_modules/jwt-decode/build/esm/index.js', import.meta.url), new URL('../dist/jwt-decode.mjs', import.meta.url));
fs.copyFileSync(new URL('../node_modules/jwt-decode/LICENSE', import.meta.url), new URL('../dist/jwt-decode-LICENSE.txt', import.meta.url));
