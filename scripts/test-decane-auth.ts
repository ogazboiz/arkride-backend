import 'dotenv/config';
import * as readline from 'readline';
import { DecaneClient, DecaneAuthError, DecaneApiError } from 'decane-node';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query: string): Promise<string> =>
  new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log('\n=================================================');
  console.log('       Decane Backend Integration Test CLI        ');
  console.log('=================================================\n');

  const appId = process.env.DECANE_APP_ID;
  const apiKey = process.env.DECANE_API_KEY;
  const verificationKey = process.env.DECANE_VERIFICATION_KEY;
  const backendBaseUrl = process.env.BACKEND_URL || 'http://localhost:4010';

  console.log('Configuration:');
  console.log(`- App ID:           ${appId || '(Not set - tokens accepted from any project)'}`);
  console.log(`- API Key:          ${apiKey ? apiKey.slice(0, 8) + '...' : '(MISSING - required for sign-in calls)'}`);
  console.log(`- Verification Key: ${verificationKey ? 'Configured (offline ES256)' : 'Not set (will use remote JWKS)'}`);
  console.log(`- Target Backend:   ${backendBaseUrl}`);
  console.log('-------------------------------------------------\n');

  const decane = new DecaneClient({
    appId: appId || undefined,
    apiKey: apiKey || undefined,
    verificationKey: verificationKey || undefined,
  });

  console.log('Select test action:');
  console.log('1. Run Server-Side Email OTP Flow (connectWithEmail -> verifyEmailCode)');
  console.log('2. Verify an Existing Decane Access Token (paste token)');
  console.log('3. Test Google ID Token Exchange (connectWithGoogleToken)');
  console.log('4. Exit\n');

  const choice = await ask('Choose option (1-4): ');

  let accessToken = '';

  if (choice.trim() === '1') {
    if (!apiKey) {
      console.error('\n❌ ERROR: DECANE_API_KEY is required for server-side sign-in flows.');
      console.error('Please set DECANE_API_KEY in your .env file.\n');
      rl.close();
      return;
    }

    const email = await ask('\nEnter your test email: ');
    console.log(`\n[1/4] Requesting 6-digit OTP code for ${email}...`);
    try {
      await decane.connectWithEmail(email.trim());
      console.log('✅ OTP code sent successfully! Check your inbox.');
    } catch (err) {
      console.error('❌ Failed to send OTP:', err);
      rl.close();
      return;
    }

    const code = await ask('\nEnter the 6-digit OTP received: ');
    console.log(`\n[2/4] Verifying code with Decane backend...`);
    try {
      const session = await decane.verifyEmailCode(email.trim(), code.trim());
      accessToken = session.accessToken;
      console.log('✅ Authentication Successful!');
      console.log(`- Decane User ID: ${session.userId}`);
      console.log(`- Is New User:    ${session.isNewUser}`);
      console.log(`- Has Wallet:     ${session.hasShare}`);
      console.log(`- Access Token:   ${accessToken.slice(0, 32)}...`);
    } catch (err) {
      if (err instanceof DecaneApiError) {
        console.error(`❌ Decane API Error [${err.code}]: Status ${err.status}`);
      } else {
        console.error('❌ Verification failed:', err);
      }
      rl.close();
      return;
    }
  } else if (choice.trim() === '2') {
    accessToken = (await ask('\nPaste Decane Access Token: ')).trim();
  } else if (choice.trim() === '3') {
    if (!apiKey) {
      console.error('\n❌ ERROR: DECANE_API_KEY is required for token exchanges.');
      rl.close();
      return;
    }
    const googleIdToken = (await ask('\nPaste Google ID Token: ')).trim();
    console.log('\nExchanging Google ID Token with Decane backend...');
    try {
      const session = await decane.connectWithGoogleToken(googleIdToken);
      accessToken = session.accessToken;
      console.log('✅ Google Exchange Successful!');
      console.log('Decane User ID:', session.userId);
      console.log('Profile:', session.profile);
    } catch (err) {
      console.error('❌ Google Token Exchange failed:', err);
      rl.close();
      return;
    }
  } else {
    console.log('Exiting.');
    rl.close();
    return;
  }

  if (!accessToken) {
    console.log('No access token available. Exiting.');
    rl.close();
    return;
  }

  // Step: Local Verification & Wallet Resolution
  console.log('\n[3/4] Testing Local Token Verification & Address Resolution...');
  try {
    const claims = await decane.verifyAccessToken(accessToken);
    console.log('✅ Signature & Claims Verified:');
    console.log(`  - User ID (uid):   ${claims.userId}`);
    console.log(`  - Subject (sub):   ${claims.subject}`);
    console.log(`  - Project ID:      ${claims.projectId ?? 'None'}`);
    console.log(`  - Token ID (jti):  ${claims.tokenId}`);
    console.log(`  - Expires At:      ${new Date((claims.expiresAt ?? 0) * 1000).toISOString()}`);

    const user = await decane.getUser(accessToken);
    console.log('\n✅ Resolved Wallet Addresses:');
    console.log('  - EVM:    ', user.addresses.evm ?? '(None yet)');
    console.log('  - Solana: ', user.addresses.solana ?? '(None yet)');
    console.log('  - Tron:   ', user.addresses.tron ?? '(None yet)');
  } catch (err) {
    if (err instanceof DecaneAuthError) {
      console.error(`❌ Token Verification Failed: reason = ${err.reason}`);
    } else {
      console.error('❌ Verification Error:', err);
    }
    rl.close();
    return;
  }

  // Step: Dispatch to NestJS Backend
  console.log(`\n[4/4] Sending Decane token to NestJS API (${backendBaseUrl}/api/v1/auth/decane)...`);
  try {
    const response = await fetch(`${backendBaseUrl}/api/v1/auth/decane`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: accessToken }),
    });

    const body = await response.json();
    if (response.ok) {
      console.log('🎉 NestJS API Response [200 OK]:');
      console.log(JSON.stringify(body, null, 2));
      console.log('\n✅ Backend integration successfully verified end-to-end!');
    } else {
      console.error(`❌ Backend returned status ${response.status}:`, body);
    }
  } catch (err) {
    console.log('⚠️ Could not connect to local NestJS server.');
    console.log('Make sure your NestJS app is running (`npm run start:dev`).');
    console.log(`You can manually test with cURL:\n`);
    console.log(`curl -X POST ${backendBaseUrl}/api/v1/auth/decane \\
  -H "Content-Type: application/json" \\
  -d '{"token": "${accessToken}"}'\n`);
  }

  rl.close();
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  rl.close();
});
