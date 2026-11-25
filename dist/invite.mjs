import {t} from './i18n.mjs';
import {accountFetch} from './auth-session.mjs';
const form=document.getElementById('invite-form'),email=document.getElementById('invite-email'),button=document.getElementById('invite-send');
const access=document.getElementById('invite-access'),result=document.getElementById('invite-result');
const introduction=document.getElementById('invite-introduction'),reference=document.getElementById('invite-reference');
let requestId=null,busy=false,administrator=false;
function showReview(id){
  form.hidden=true;introduction.hidden=true;
  access.textContent=administrator?t("invite:check_this_invitation_before_sending_it_again_c8c96367"):t("invite:please_ask_an_aviquiz_administrator_to_check_this_invit_826d189e");
  reference.textContent=t("invite:support_reference_678a98f6")+id;reference.hidden=false;
}
async function initialize(){
  try{
    const response=await accountFetch('/api/invitations');
    if(!response.ok){access.textContent=response.status===401?t("invite:please_sign_in_again_to_invite_someone_a698a992"):response.status===403?t("invite:sign_in_with_an_account_that_has_invitation_permission_1ebccef5"):t("invite:invitations_are_unavailable_please_try_again_later_ea6ca828");return;}
    const data=await response.json();
    administrator=data.administrator===true;
    if(!data.available){access.textContent=t("invite:invitations_are_not_enabled_on_this_site_yet_11dfcf5b");return;}
    access.textContent=t("invite:you_can_invite_people_to_aviquiz_9729a199");form.hidden=false;
  }catch{access.textContent=t("invite:could_not_check_invitation_access_reload_to_try_again_b41d1bab");}
}
email.addEventListener('input',()=>{if(!busy)requestId=null;});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  requestId??=crypto.randomUUID();busy=true;button.disabled=true;email.disabled=true;
  result.textContent=t("invite:sending_invitation_04bbb6e0");
  try{
    const response=await accountFetch('/api/invitations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email.value.trim(),requestId})});
    const data=await response.json();
    if(response.ok){result.textContent=t("invite:invitation_sent_to_they_can_follow_the_instructions_in_91bb0dcb", {v0:(email.value.trim())});form.reset();requestId=null;}
    else{result.textContent=data.error||t("invite:the_invitation_could_not_be_confirmed_cd12202b");if(data.requiresReview===true){showReview(data.requestId||requestId);}}
  }catch{
    result.textContent=t("invite:the_connection_was_interrupted_before_we_received_the_r_ebb5870e");
    showReview(requestId);
  }finally{busy=false;button.disabled=false;email.disabled=false;}
});
initialize();
