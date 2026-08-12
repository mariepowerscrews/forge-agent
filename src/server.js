'use strict';

const http = require('http');
const DeepSeekAgent = require('./agent');
const config = require('./config');

const PORT = Number(process.env.PORT || 10000);

config.HEADLESS = true;
config.NO_TUI = true;
config.WORKING_DIR = '/workspace';

let agent = null;
let initializing = null;

async function getAgent() {
  if (agent) return agent;

  if (!initializing) {
    initializing = (async () => {
      const instance = new DeepSeekAgent();
      await instance.init();
      agent = instance;
      return instance;
    })().finally(() => {
      initializing = null;
    });
  }

  return initializing;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      status: 'ok',
      agentInitialized: Boolean(agent)
    }));
  }

  if (req.method === 'POST' && req.url === '/run') {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const { task } = JSON.parse(body || '{}');

        if (!task || typeof task !== 'string') {
          res.writeHead(400);
          return res.end(JSON.stringify({
            error: 'task is required'
          }));
        }

        const forge = await getAgent();
        const result = await forge.run(task);

        res.writeHead(200);
        res.end(JSON.stringify({ result }));
      } catch (err) {
        console.error(err);

        res.writeHead(500);
        res.end(JSON.stringify({
          error: err.message
        }));
      }
    });

    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Forge Agent listening on 0.0.0.0:${PORT}`);
});
