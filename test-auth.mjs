import assert from 'node:assert/strict';
import {managerSettings, logoutURL} from './dist/auth-core.mjs';
const config={enabled:true,authority:'https://cognito-idp.us-east-2.amazonaws.com/pool',client_id:'public-client',cognitoDomain:'https://example.auth.us-east-2.amazoncognito.com',redirect_uri:'https://aviquiz.org/auth/callback',post_logout_redirect_uri:'https://aviquiz.org/'};
assert.equal(managerSettings({enabled:false},'https://aviquiz.org'),null);
const settings=managerSettings(config,'https://aviquiz.org');
assert.equal(settings.response_type,'code');
assert.equal(settings.scope,'openid email');
assert.equal(settings.client_secret,undefined);
assert.equal(settings.automaticSilentRenew,false);
assert.throws(()=>managerSettings(config,'https://other.example'));
assert.throws(()=>managerSettings({...config,redirect_uri:'https://aviquiz.org/auth/callback?next=evil'},'https://aviquiz.org'));
const logout=new URL(logoutURL(config));
assert.equal(logout.pathname,'/logout');
assert.equal(logout.searchParams.get('logout_uri'),'https://aviquiz.org/');
console.log('Authentication configuration and redirect checks passed.');

const {authConfig} = await import('./dist/auth-config.mjs');
assert.ok(managerSettings(authConfig, new URL(authConfig.redirect_uri).origin));
assert.equal(new URL(logoutURL(authConfig)).origin, authConfig.cognitoDomain);
console.log('Staging configuration is enabled with matching callback/logout origins.');

assert.equal(new URL(authConfig.redirect_uri).pathname, '/auth/callback');
assert.equal(new URL(authConfig.post_logout_redirect_uri).pathname, '/');
