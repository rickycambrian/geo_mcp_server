import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync } from 'fs';

const GATEWAY = 'https://agents.rickydata.org';

// Read private key from .env
const envContent = readFileSync('/Users/riccardoesclapon/Documents/github/mcp_deployments_registry/.env', 'utf-8');
const keyMatch = envContent.match(/^OPERATOR_WALLET_PRIVATE_KEY=(.+)$/m);
if (!keyMatch) throw new Error('OPERATOR_WALLET_PRIVATE_KEY not found in .env');
let privateKey = keyMatch[1].trim();
if (!privateKey.startsWith('0x')) privateKey = '0x' + privateKey;

const account = privateKeyToAccount(privateKey);
const walletAddress = account.address;
const expiresAt = '2027-01-01T00:00:00.000Z';

// Step 1: Get challenge message to sign
console.log('Step 1: Getting challenge message...');
const challengeRes = await fetch(`${GATEWAY}/auth/challenge?walletAddress=${walletAddress}&expiresAt=${encodeURIComponent(expiresAt)}`);
if (!challengeRes.ok) {
  console.error('Challenge failed:', challengeRes.status, await challengeRes.text());
  process.exit(1);
}
const challengeData = await challengeRes.json();
console.log('Message:', challengeData.message);

// Step 2: Sign the challenge
console.log('\nStep 2: Signing message...');
const signature = await account.signMessage({ message: challengeData.message });
console.log('Signature:', signature.slice(0, 20) + '...');

// Step 3: Verify signature and get token
console.log('\nStep 3: Verifying signature...');
const nonce = challengeData.nonce;
console.log('Nonce:', nonce);
const verifyRes = await fetch(`${GATEWAY}/auth/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ walletAddress, signature, nonce, expiresAt }),
});

if (!verifyRes.ok) {
  console.error('Verify failed:', verifyRes.status, await verifyRes.text());
  process.exit(1);
}

const tokenData = await verifyRes.json();
console.log('Response keys:', Object.keys(tokenData));

const token = tokenData.token || tokenData.accessToken || tokenData.jwt;
if (token) {
  console.log('Token obtained (first 30 chars):', token.slice(0, 30) + '...');
  writeFileSync('/tmp/agent-token.txt', token);
  console.log('Token saved to /tmp/agent-token.txt');
} else {
  console.log('Full response:', JSON.stringify(tokenData).slice(0, 500));
  // Save full response for debugging
  writeFileSync('/tmp/agent-token-response.json', JSON.stringify(tokenData, null, 2));
  console.log('Full response saved to /tmp/agent-token-response.json');
}
