#!/usr/bin/env node
// Bridge for hook events that only support `type: "command"` (SessionStart):
// reads the event JSON from stdin, POSTs it to OpenPlancia and prints the reply on stdout.
// Always exits 0 so a OpenPlancia problem never blocks Claude Code.
// It runs inside the Claude session, so it also tells OpenPlancia the session's inbox address
// (CLAUDE_CODE_MESSAGING_SOCKET): replies between agents are addressed to it.
'use strict';
const http = require('node:http');

const url = process.argv[2];
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  if (!url) process.exit(0);
  let body = Buffer.concat(chunks);
  const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
  if (socket) {
    try {
      const event = JSON.parse(body.toString('utf8'));
      event.plancia_messaging_socket = socket;
      body = Buffer.from(JSON.stringify(event));
    } catch {
      // not JSON: forward it as it is
    }
  }
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
