'use strict';

const path = require('node:path');
const { runPowerShellScript } = require('../ps-runner');

function runDrives() {
  return runPowerShellScript({ scriptPath: path.join(__dirname, 'drives.ps1'), timeoutMs: 60000 });
}

module.exports = { runDrives };
