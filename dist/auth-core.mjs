import {t} from './i18n.mjs';
export function managerSettings(config, origin) {
  if (!config.enabled) return null;
  const authority = new URL(config.authority);
  const domain = new URL(config.cognitoDomain);
  if (authority.protocol !== 'https:' || domain.protocol !== 'https:') throw Error(t("auth-core:https_authentication_endpoints_required_8cfc2d96"));
  for (const key of ['redirect_uri', 'post_logout_redirect_uri']) {
    const url = new URL(config[key]);
    if (url.origin !== origin || url.hash || url.search) throw Error(t("auth-core:authentication_return_urls_must_match_this_site_origin_e41296b2"));
  }
  if (!config.client_id) throw Error(t("auth-core:missing_app_client_id_922b89a1"));
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
