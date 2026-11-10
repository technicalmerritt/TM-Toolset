'use strict';
// TM Toolset — signing keypair generator.
//
// You normally only run this ONCE (or to rotate the signing key). It creates a
// new Ed25519 keypair:
//   - tm-vendor-private-key.pem  → the SECRET. Keep it safe, never commit/email it.
//   - prints the PUBLIC key line  → paste this into src/main/license/verify.js
//                                   (the PUBLIC_KEY constant) and ship an app
//                                   update, so the app can verify licences signed
//                                   with the new private key.
//
// WARNING: rotating the key invalidates every licence signed with the OLD key.
// Only rotate before you've issued real licences, or be ready to re-issue them.
//
// Usage:
//   node make-keys.js

const crypto = require('crypto'), fs = require('fs'), path = require('path');

const outPath = path.join(__dirname, 'tm-vendor-private-key.pem');
if (fs.existsSync(outPath)) {
  console.error('A key already exists at ' + outPath);
  console.error('Refusing to overwrite it. Move/rename it first if you really mean to rotate.');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(outPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).trim();
const pubBody = pubPem.split('\n').slice(1, -1).join('');
const jsLine = "'-----BEGIN PUBLIC KEY-----\\n" + pubBody + "\\n-----END PUBLIC KEY-----\\n'";

console.log('\nPrivate key written to: ' + outPath);
console.log('   → Keep this safe and backed up. Never commit or email it.\n');
console.log('Paste this as the PUBLIC_KEY value in src/main/license/verify.js:\n');
console.log('const PUBLIC_KEY = ' + jsLine + ';\n');
