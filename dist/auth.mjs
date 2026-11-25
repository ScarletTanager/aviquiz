import {t} from './i18n.mjs';
import {authConfig} from './auth-config.mjs';
import {managerSettings, logoutURL} from './auth-core.mjs';
import {getUserManager} from './auth-session.mjs';
const button = document.getElementById('account-action');
const status = document.getElementById('account-status');
async function initialize() {
  const settings = managerSettings(authConfig, location.origin);
  if (!settings) return; // No discovery or AWS requests before explicit activation.
  const manager = await getUserManager();
  let user;
  const callback = location.pathname === new URL(settings.redirect_uri).pathname;
  try {
    if (callback) {
      user = await manager.signinCallback(location.href);
      history.replaceState(null, '', '/');
    } else user = await manager.getUser();
  } catch {
    if (callback) history.replaceState(null, '', '/');
    status.textContent = t("auth:sign_in_could_not_finish_please_try_again_guest_quizzes_7323af07");
  }
  button.hidden = false;
  function render() {
    const signedIn = user && !user.expired;
    if(!signedIn){const link=document.getElementById('invite-link');if(link)link.hidden=true;}
    button.textContent = signedIn ? t("auth:sign_out_48f0d3d3") : t("auth:sign_in_bfd402b2");
    if (signedIn) status.textContent = t("auth:signed_in_manage_quiz_history_storage_on_the_statistics_5c818826", {v0:(user.profile.email ? t("common:signedInAs",{email:user.profile.email}) : '')});
  }
  render();
  if (user && !user.expired) {
    let setupStage=t("auth:account_registration_02ade663"), setupStatus=null;
    try {
      const headers = {'authorization': `Bearer ${user.id_token}`, 'content-type': 'application/json'};
      let response = await fetch('/api/account/enroll', {method:'POST', headers, body:'{}'});
      setupStatus=response.status;
      if (!response.ok) throw Error(t("auth:account_registration_unavailable_f10f7bf3"));
      let account = await response.json();
      if (account.canBootstrap) {
        setupStage=t("auth:administrator_setup_2a892efa"); setupStatus=null;
        response = await fetch('/api/account/bootstrap', {method:'POST', headers, body:'{}'});
        setupStatus=response.status;
        if (!response.ok) throw Error(t("auth:administrator_setup_unavailable_dda80b84"));
        account = await response.json();
      }
      if (account.kind !== 'user') throw Error(t("auth:account_registration_unavailable_f10f7bf3"));
      window.dispatchEvent(new Event('aviquiz-account-changed'));
      const inviteLink=document.getElementById('invite-link');
      if(inviteLink)inviteLink.hidden=!(account.administrator||account.permissions?.includes('users.invite'));
      status.textContent = t("auth:signed_in_manage_quiz_history_storage_on_the_statistics_60534a7a", {v0:(user.profile.email ? t("common:signedInAs",{email:user.profile.email}) : ''),v1:(account.administrator ? t("auth:aviquiz_administrator_379a2b43") : '')});
    } catch {
      status.dataset.accountSetupStage = setupStage;
      status.dataset.accountSetupStatus = String(setupStatus || 'network');
      status.textContent = t("auth:sign_in_succeeded_but_aviquiz_could_not_finish_guest_qu_87d73d7a", {v0:(setupStage.toLowerCase()),v1:(setupStatus===401 ? t("auth:sign_out_and_sign_in_again_25bc2275") : t("auth:reload_to_retry_a4f6146d"))});
    }
  }
  manager.events.addAccessTokenExpired(() => { user = null; window.dispatchEvent(new Event('aviquiz-account-changed')); render(); status.textContent = t("auth:your_session_expired_sign_in_again_when_needed_5ce1c7a8"); });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (user && !user.expired) {
        await manager.removeUser();
        location.assign(logoutURL(authConfig));
      } else await manager.signinRedirect();
    } catch {
      status.textContent = t("auth:account_service_unavailable_guest_quizzes_remain_availa_50a7abb6");
      button.disabled = false;
    }
  });
}
initialize().catch(() => {status.textContent = t("auth:account_sign_in_is_not_available_yet_guest_quizzes_rema_67e0d311");});
