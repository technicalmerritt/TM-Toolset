'use strict';
// TM Toolset — licence generator.
//
// This script is NOT secret (safe to keep in the repo). The SECRET is the
// private key file it reads: tm-vendor-private-key.pem. Keep that key off
// GitHub, off email, and backed up somewhere safe (password manager / encrypted
// drive). The .gitignore in this folder stops any *.pem being committed.
//
// Licences are PER USER (tied to an e-mail) and work on every machine that user
// installs the app on — no machine ID needed in the normal case.
//
// Usage (run from this folder, with the private key saved alongside it):
//   node make-license.js --email customer@x.com --name "Customer Ltd"
//   node make-license.js --email a@b.com --name "A" --seats 5       (note agreed machine count on the key)
//   node make-license.js --email a@b.com --name "A" --days 365      (expires in 365 days)
//   node make-license.js --email a@b.com --name "A" --machine XXXXX-...  (rare: lock to ONE machine ID)
//   node make-license.js ... --key /path/to/tm-vendor-private-key.pem   (key in another location)

const crypto = require('crypto'), fs = require('fs'), path = require('path');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; }

const keyPath = arg('key', path.join(__dirname, 'tm-vendor-private-key.pem'));
if (!fs.existsSync(keyPath)) {
  console.error('ERROR: private key not found at ' + keyPath);
  console.error('Save your tm-vendor-private-key.pem next to this script, or pass --key <path>.');
  process.exit(1);
}
const priv = fs.readFileSync(keyPath, 'utf8');

const email = arg('email', '');
if (!email) { console.error('ERROR: --email is required (licences are per user).'); process.exit(1); }

const payload = { name: arg('name', ''), email: email, issued: new Date().toISOString().slice(0, 10) };
const seats = arg('seats', ''); if (seats) payload.seats = +seats;            // informational: agreed machine count
const days = arg('days', ''); if (days) payload.expires = new Date(Date.now() + (+days) * 86400000).toISOString().slice(0, 10);
const machine = arg('machine', ''); if (machine) payload.machine = machine;    // optional one-off hard lock

const buf = Buffer.from(JSON.stringify(payload), 'utf8');
const sig = crypto.sign(null, buf, priv);
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

console.log('\nLicence for ' + (payload.email || payload.name)
  + (payload.seats ? (' — ' + payload.seats + ' machines') : '')
  + (payload.expires ? (' — expires ' + payload.expires) : ' — perpetual')
  + (payload.machine ? ' — MACHINE-LOCKED' : '') + ':\n');
console.log('E-mail to give the customer: ' + payload.email);
console.log('\nLicence key:\n');
console.log(b64u(buf) + '.' + b64u(sig));
console.log('');
