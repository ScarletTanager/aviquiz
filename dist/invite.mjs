import {accountFetch} from './auth-session.mjs';
const form=document.getElementById('invite-form'),email=document.getElementById('invite-email'),button=document.getElementById('invite-send');
const access=document.getElementById('invite-access'),result=document.getElementById('invite-result');
const introduction=document.getElementById('invite-introduction'),reference=document.getElementById('invite-reference');
let requestId=null,busy=false,administrator=false;
function showReview(id){
  form.hidden=true;introduction.hidden=true;
  access.textContent=administrator?'Check this invitation before sending it again.':'Please ask an AviQuiz administrator to check this invitation.';
  reference.textContent='Support reference: '+id;reference.hidden=false;
}
async function initialize(){
  try{
    const response=await accountFetch('/api/invitations');
    if(!response.ok){access.textContent=response.status===401?'Please sign in again to invite someone.':response.status===403?'Sign in with an account that has invitation permission to use this page.':'Invitations are unavailable. Please try again later.';return;}
    const data=await response.json();
    administrator=data.administrator===true;
    if(!data.available){access.textContent='Invitations are not enabled on this site yet.';return;}
    access.textContent='You can invite people to AviQuiz.';form.hidden=false;
  }catch{access.textContent='Could not check invitation access. Reload to try again.';}
}
email.addEventListener('input',()=>{if(!busy)requestId=null;});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  requestId??=crypto.randomUUID();busy=true;button.disabled=true;email.disabled=true;
  result.textContent='Sending invitation…';
  try{
    const response=await accountFetch('/api/invitations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email.value.trim(),requestId})});
    const data=await response.json();
    if(response.ok){result.textContent=`Invitation sent to ${email.value.trim()}. They can follow the instructions in the email to sign in at aviquiz.org.`;form.reset();requestId=null;}
    else{result.textContent=data.error||'The invitation could not be confirmed.';if(data.requiresReview===true){showReview(data.requestId||requestId);}}
  }catch{
    result.textContent='The connection was interrupted before we received the result. The account or invitation email may already exist. Check its status before trying again.';
    showReview(requestId);
  }finally{busy=false;button.disabled=false;email.disabled=false;}
});
initialize();
