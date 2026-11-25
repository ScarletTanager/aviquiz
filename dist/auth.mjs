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
    status.textContent = 'Sign-in could not finish. Please try again. Guest quizzes remain available.';
  }
  button.hidden = false;
  function render() {
    const signedIn = user && !user.expired;
    if(!signedIn){const link=document.getElementById('invite-link');if(link)link.hidden=true;}
    button.textContent = signedIn ? 'Sign out' : 'Sign in';
    if (signedIn) status.textContent = `Signed in${user.profile.email ? ' as ' + user.profile.email : ''}. Manage quiz history storage on the Statistics page.`;
  }
  render();
  if (user && !user.expired) {
    let setupStage='Account registration', setupStatus=null;
    try {
      const headers = {'authorization': `Bearer ${user.id_token}`, 'content-type': 'application/json'};
      let response = await fetch('/api/account/enroll', {method:'POST', headers, body:'{}'});
      setupStatus=response.status;
      if (!response.ok) throw Error('Account registration unavailable.');
      let account = await response.json();
      if (account.canBootstrap) {
        setupStage='Administrator setup'; setupStatus=null;
        response = await fetch('/api/account/bootstrap', {method:'POST', headers, body:'{}'});
        setupStatus=response.status;
        if (!response.ok) throw Error('Administrator setup unavailable.');
        account = await response.json();
      }
      if (account.kind !== 'user') throw Error('Account registration unavailable.');
      window.dispatchEvent(new Event('aviquiz-account-changed'));
      const inviteLink=document.getElementById('invite-link');
      if(inviteLink)inviteLink.hidden=!(account.administrator||account.permissions?.includes('users.invite'));
      status.textContent = `Signed in${user.profile.email ? ' as ' + user.profile.email : ''}${account.administrator ? ' · AviQuiz administrator' : ''}. Manage quiz history storage on the Statistics page.`;
    } catch {
      status.dataset.accountSetupStage = setupStage;
      status.dataset.accountSetupStatus = String(setupStatus || 'network');
      status.textContent = `Sign-in succeeded, but AviQuiz ${setupStage.toLowerCase()} could not finish. ${setupStatus===401 ? 'Sign out and sign in again.' : 'Reload to retry.'} Guest quizzes remain available.`;
    }
  }
  manager.events.addAccessTokenExpired(() => { user = null; window.dispatchEvent(new Event('aviquiz-account-changed')); render(); status.textContent = 'Your session expired. Sign in again when needed.'; });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (user && !user.expired) {
        await manager.removeUser();
        location.assign(logoutURL(authConfig));
      } else await manager.signinRedirect();
    } catch {
      status.textContent = 'Account service unavailable. Guest quizzes remain available.';
      button.disabled = false;
    }
  });
}
initialize().catch(() => {status.textContent = 'Account sign-in is not available yet. Guest quizzes remain available.';});
