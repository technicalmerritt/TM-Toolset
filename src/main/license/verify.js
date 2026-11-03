'use strict';

// Offline licence verification. The app ships ONLY the public key; licences are
// signed by the vendor's private key (kept off the app). A licence string is
// "<base64url(payload JSON)>.<base64url(ed25519 signature)>".
const crypto = require('node:crypto');

const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEALK687PM9fXadNr8V3/yHihLroUjAW3UfzdZPQTbaNXA=\n-----END PUBLIC KEY-----\n';

function b64urlDecode(s) {
  s = ('' + s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// Returns the payload object if the signature is valid, else null.
function verifyLicense(key) {
  try {
    if (!key || typeof key !== 'string' || key.indexOf('.') < 0) return null;
    const parts = key.trim().split('.');
    if (parts.length !== 2) return null;
    const payloadBuf = b64urlDecode(parts[0]);
    const sigBuf = b64urlDecode(parts[1]);
    const ok = crypto.verify(null, payloadBuf, PUBLIC_KEY, sigBuf);
    if (!ok) return null;
    return JSON.parse(payloadBuf.toString('utf8')); // { name, email, issued, expires?, machine? }
  } catch { return null; }
}

module.exports = { verifyLicense };
