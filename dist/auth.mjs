import {authConfig} from './auth-config.mjs';
import {managerSettings, logoutURL} from './auth-core.mjs';
const button = document.getElementById('account-action');
const status = document.getElementById('account-status');
async function initialize() {
  const settings = managerSettings(authConfig, location.origin);
  if (!settings) return; // No discovery or AWS requests before explicit activation.
  const {UserManager, WebStorageStateStore} = await import('./oidc-client-ts.mjs');
  const manager = new UserManager({...settings,
    userStore: new WebStorageStateStore({store: sessionStorage}),
    stateStore: new WebStorageStateStore({store: sessionStorage})});
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
    button.textContent = signedIn ? 'Sign out' : 'Sign in';
    if (signedIn) status.textContent = `Signed in${user.profile.email ? ' as ' + user.profile.email : ''}. Quiz progress is still stored in this browser.`;
  }
  render();
  manager.events.addAccessTokenExpired(() => { user = null; render(); status.textContent = 'Your session expired. Sign in again when needed.'; });
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
