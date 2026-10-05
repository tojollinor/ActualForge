# Enable Banking Setup

<ExperimentalFeatureWarning issueId="7799" />

:::warning
All functionality described here may not be available in the latest stable release. See [Experimental Features](../../experimental/index.md) for instructions to enable experimental features. Use the `nightly` images for the latest implementation.
:::

To set up Enable Banking, start by creating and signing in to your account: https://enablebanking.com/sign-in/

Create a new application: https://enablebanking.com/cp/applications. Select **Production** and make sure the redirect URL uses `https` and your domain.

```text
Application Name: ActualForge
Allowed redirect URLs: https://actualbudget.example.com/enablebanking/auth_callback
```

When Enable Banking generates the private key in your browser, save the downloaded
`.pem` file. Its filename normally matches the Application ID. Keep this file
private; Enable Banking does not need the private key itself because the
corresponding public key is registered with the application.

For a restricted Production application, use **Activate by linking accounts** in
the Enable Banking Control Panel to whitelist the accounts you want to test.
This activation does not replace ActualForge's own authorization flow; you still
authorize the same account again when linking it inside ActualForge.

Copy the Application ID before going back to ActualForge.

Go to **More → Bank Sync**, choose **Set up Enable Banking**, and enter the
Application ID. You can either upload the `.pem`/`.key` private-key file or
paste the private key directly. ActualForge accepts normal PEM text, PEM text
whose line breaks were copied as literal `\\n`, and base64 DER private-key
content. The server validates that the value is an RSA private key, normalizes
it to PEM and verifies the credentials with Enable Banking before saving them.

If the original browser-generated private key is no longer available, a public
certificate or public key is not enough to reconstruct it. Register a new key
pair/application instead of trying to convert public material into a private
key.

Now go to an ActualForge account and select **Link account → Enable Banking**.
Select your country and bank from the live provider list returned by Enable
Banking, then follow the prompts to link your account.
