# Connect a Facebook account to Leadpath

Use these steps for each business. The token at the end does not expire on a date.

The app already connected for this project is **FUB Integration**. For another account, create a new app inside that account’s own Meta business.

## 1. Create the app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and click **Create app**.
2. Name it after the account.
3. When it asks what the app is for, choose the use case for capturing leads from ads. If you do not see that, choose **Other**, then **Business**.
4. Attach it to the Meta business that owns the Facebook Page.
5. Finish creating the app.

## 2. Copy the app ID and app secret

1. In the app, open **App settings**, then **Basic**.
2. Copy the **App ID**. It is not a secret.
3. Next to **App secret**, click **Show**, enter your Facebook password, and copy the secret.
4. In Leadpath, open **Connections**. Paste the App ID and App secret, then save.

## 3. Tell Facebook where to send leads

1. In the app, open **Webhooks**.
2. Choose the **Page** object.
3. Set the callback URL to `https://leadpath-gamma.vercel.app/api/webhooks/meta`.
4. Make up a private phrase. Put that same phrase in **Verify token** on the Leadpath Connections page, and in the Meta webhook verify token box.
5. Save it in both places, then subscribe to the field **leadgen**.

## 4. Create the token that does not expire

1. Open [business.facebook.com/settings](https://business.facebook.com/settings) for that same business.
2. Go to **Users**, then **System users**.
3. Click **Add**. Name it after the account and set the role to **Admin**.
4. Open that system user and click **Assign assets**.
5. Add the app you just created.
6. Add the Facebook Page that runs the ads, with full control. The token can only see Pages you assign here.
7. Click **Generate token**.
8. Choose that same app. If expiration has **Never**, choose **Never**.
9. Turn on these permissions:
   - `leads_retrieval`
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_ads`
   - `pages_manage_metadata`
   - `ads_management`
   - `business_management`
10. Click **Generate token** and copy it once. Meta will not show it again.
11. Paste it into **Page access token** on Connections and save.

## 5. Turn the Page on

On Connections, click **Turn on lead notifications** next to that Page.

## For another account

Repeat this inside that account’s own business: a new app, that business’s Page assigned to the system user, and a new token. Keep the token and the app secret out of chat and out of git.
