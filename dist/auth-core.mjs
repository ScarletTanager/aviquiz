export function managerSettings(config, origin) {
  if (!config.enabled) return null;
  const authority = new URL(config.authority);
  const domain = new URL(config.cognitoDomain);
  if (authority.protocol !== 'https:' || domain.protocol !== 'https:') throw Error('HTTPS authentication endpoints required.');
  for (const key of ['redirect_uri', 'post_logout_redirect_uri']) {
    const url = new URL(config[key]);
    if (url.origin !== origin || url.hash || url.search) throw Error('Authentication return URLs must match this site origin and have no query or fragment.');
  }
  if (!config.client_id) throw Error('Missing app client ID.');
  return {authority: config.authority, client_id: config.client_id,
    redirect_uri: config.redirect_uri, response_type: 'code', scope: 'openid email',
    automaticSilentRenew: false, revokeTokenTypes: ['refresh_token'], loadUserInfo: false};
}
export function logoutURL(config) {
  const url = new URL('/logout', config.cognitoDomain);
  url.searchParams.set('client_id', config.client_id);
  url.searchParams.set('logout_uri', config.post_logout_redirect_uri);
  return url.href;
}
