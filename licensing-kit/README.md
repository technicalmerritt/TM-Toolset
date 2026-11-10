# TM Toolset — Licensing Kit

Everything you need to issue licences for TM Toolset. These scripts are safe to
keep in the repo. **The only secret is your private key** (`tm-vendor-private-key.pem`) —
keep it off GitHub, off email, and backed up.

## How licensing works (no server, no website)

TM Toolset uses **offline, signed licences**. There is nothing to log into:

1. The app ships a **public key** (baked into `src/main/license/verify.js`).
2. You hold the matching **private key** and sign licence keys with it.
3. A licence is a text string: `base64(payload).base64(signature)`. The app
   verifies the signature offline against the public key — no internet needed.

The app runs a **14-day trial** on first use, then asks for a licence. A licence
is **per user** (tied to an e-mail) and works on **all** of that user's machines.

## One-time setup (you've already done this if Claude set it up for you)

```bash
node make-keys.js
```

This writes `tm-vendor-private-key.pem` (SECRET) and prints the public key line
to paste into `src/main/license/verify.js`. You then ship an app update so the
new public key is live. **Rotating the key invalidates licences signed with the
old key**, so only do this before issuing real licences.

## Issue a licence (the day-to-day task)

Save your `tm-vendor-private-key.pem` in this folder, then:

```bash
node make-license.js --email customer@example.com --name "Customer Name"
```

It prints the customer's **e-mail** and a **licence key**. Options:

| Flag | Meaning |
|------|---------|
| `--email` | **Required.** The e-mail the licence is tied to. |
| `--name`  | Display name (shown in the app). |
| `--days 365` | Licence expires after N days (omit = perpetual). |
| `--seats 5`  | Note of the agreed machine count (informational only). |
| `--machine XXXXX-...` | Rare: hard-lock to one PC's machine ID. |
| `--key /path/to/key.pem` | Use a private key in another location. |

## The customer activates it

In TM Toolset: **Settings → Licence** (or the prompt shown when the trial ends):

1. Enter the **e-mail** the licence was issued to.
2. Paste the **licence key**.
3. Click **Activate**.

That's it — it works on every machine that user installs the app on.

## ⚠️ Protect your private key

- Back it up (password manager / encrypted drive). If you lose it you can't issue
  more licences without rotating (which invalidates existing ones).
- Never commit it (the `.gitignore` here blocks `*.pem`) or email it.
- It is not needed by, and must never be shipped inside, the app itself.
