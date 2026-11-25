import {t} from '../dist/i18n.mjs';
import {CognitoIdentityProviderClient,AdminCreateUserCommand} from '@aws-sdk/client-cognito-identity-provider';
// Node-only provider. Never bundled into browser assets or the Sites Worker.
export function cognitoInvitationProvider(config,{client}={}){
  const issuer=new URL(config.AUTH_ISSUER),pool=issuer.pathname.slice(1);
  const region=pool.split('_')[0];
  if(!/^[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+$/.test(pool)||issuer.origin!==`https://cognito-idp.${region}.amazonaws.com`)throw Error(t("server-invitation-provider:invalid_invitation_pool_configuration_5dbaab26"));
  // No retry of non-idempotent user creation or invitation delivery. In
  // particular an email-only pool may generate a different username on retry.
  client??=new CognitoIdentityProviderClient({region,maxAttempts:1,requestHandler:{connectionTimeout:3000,requestTimeout:8000}});
  return {
    async prepare(email){
      const result=await client.send(new AdminCreateUserCommand({UserPoolId:pool,Username:email,
        UserAttributes:[{Name:'email',Value:email},{Name:'email_verified',Value:'true'}],
        MessageAction:'SUPPRESS',DesiredDeliveryMediums:['EMAIL'],ForceAliasCreation:false}));
      const subject=result.User?.Attributes?.find(a=>a.Name==='sub')?.Value;
      const username=result.User?.Username;
      if(!subject||!username)throw Error(t("server-invitation-provider:invitation_identity_missing_7e6ef7b1"));
      return {issuer:config.AUTH_ISSUER,subject,username};
    },
    async deliver(email){
      await client.send(new AdminCreateUserCommand({UserPoolId:pool,Username:email,
        MessageAction:'RESEND',DesiredDeliveryMediums:['EMAIL'],ForceAliasCreation:false}));
    }
  };
}
