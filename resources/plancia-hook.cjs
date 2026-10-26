#!/usr/bin/env node
// Bridge for hook events that only support `type: "command"` (SessionStart):
// reads the event JSON from stdin, POSTs it to Plancia and prints the reply on stdout.
// Always exits 0 so a Plancia problem never blocks Claude Code.
'use strict';
const http = require('node:http');

const url = process.argv[2];
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  if (!url) process.exit(0);
  const body = Buffer.concat(chunks);
  const req = http.request(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length },
      timeout: 4000,
    },
    (res) => {
      const out = [];
      res.on('data', (c) => out.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) process.stdout.write(Buffer.concat(out));
        process.exit(0);
      });
    },
  );
  req.on('timeout', () => req.destroy());
  req.on('error', () => process.exit(0));
  req.end(body);
});
