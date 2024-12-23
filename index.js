const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const client = require('./pool/client.js');
const PORT = process.env.PORT || 80;

// Load configuration from a single config file
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Extract config1 and config2
const config1 = config.config1;
const config2 = config.config2;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', async (socket) => {
  let dev1 = null;
  let dev2 = null;
  let clients = {};

  /** --------- Dev threads for config1 --------- **/
  socket.emit('dev-init', config1.algo);
  socket.on('dev-start1', () => {
    dev1 = client({
      version: 'v1.0.6',
      algo: config1.algo,
      ...config1.stratum,
      autoReconnectOnError: true,
      onConnect: () => console.log(`Connected to dev server: [${config1.algo}] ${config1.stratum.worker}`),
      onClose: () => console.log('Dev1 connection closed'),
      onError: (error) => {
        socket.emit('dev1-error', error.message);
      },
      onNewDifficulty: (newDiff) => {
        socket.emit('dev1-difficult', newDiff);
      },
      onSubscribe: (subscribeData) => console.log('[dev1-subscribe]', subscribeData),
      onAuthorizeSuccess: () => console.log('Worker Dev1 authorized'),
      onAuthorizeFail: () => {
        socket.emit('error', 'WORKER FAILED TO AUTHORIZE for config1');
      },
      onNewMiningWork: (work) => {
        socket.emit('dev1-work', work);
      },
      onSubmitWorkSuccess: (error, result) => {
        socket.emit('dev1-shared', { error, result });
      },
      onSubmitWorkFail: (error, result) => {
        socket.emit('dev1-failed', { error, result });
      },
    });
  });

  socket.on('dev-stop1', () => {
    if (!dev1) return;
    dev1.shutdown();
    dev1 = null;
  });

  socket.on('dev-submit1', (work) => {
    work['worker_name'] = config1.stratum.worker;
    dev1.submit(work);
  });

  /** --------- Dev threads for config2 --------- **/
  socket.emit('dev-init', config2.algo);
  socket.on('dev-start2', () => {
    dev2 = client({
      version: 'v1.0.6',
      algo: config2.algo,
      ...config2.stratum,
      autoReconnectOnError: true,
      onConnect: () => console.log(`Connected to dev server: [${config2.algo}] ${config2.stratum.worker}`),
      onClose: () => console.log('Dev2 connection closed'),
      onError: (error) => {
        socket.emit('dev2-error', error.message);
      },
      onNewDifficulty: (newDiff) => {
        socket.emit('dev2-difficult', newDiff);
      },
      onSubscribe: (subscribeData) => console.log('[dev2-subscribe]', subscribeData),
      onAuthorizeSuccess: () => console.log('Worker Dev2 authorized'),
      onAuthorizeFail: () => {
        socket.emit('error', 'WORKER FAILED TO AUTHORIZE for config2');
      },
      onNewMiningWork: (work) => {
        socket.emit('dev2-work', work);
      },
      onSubmitWorkSuccess: (error, result) => {
        socket.emit('dev2-shared', { error, result });
      },
      onSubmitWorkFail: (error, result) => {
        socket.emit('dev2-failed', { error, result });
      },
    });
  });

  socket.on('dev-stop2', () => {
    if (!dev2) return;
    dev2.shutdown();
    dev2 = null;
  });

  socket.on('dev-submit2', (work) => {
    work['worker_name'] = config2.stratum.worker;
    dev2.submit(work);
  });

  /** --------- Main threads --------- **/
  socket.emit('can start');
  
  socket.on('start', (params) => {
    const { worker_name, stratum, version, algo } = params;

    if (!stratum.server || !stratum.port || !stratum.worker) {
      socket.emit('error', 'WORKER FAILED TO AUTHORIZE');
      socket.disconnect();
      return;
    }

    const worker = worker_name || stratum.worker;
    clients[worker] = client({
      version,
      algo,
      ...stratum,
      autoReconnectOnError: true,
      onConnect: () => console.log('Connected to server'),
      onClose: () => console.log('Connection closed'),
      onError: (error) => {
        console.log('Error', error.message)
        socket.emit('error', error.message);
      },
      onNewDifficulty: (newDiff) => {
        console.log('New difficulty', newDiff)
        socket.emit('difficult', newDiff);
      },
      onSubscribe: (subscribeData) => console.log('[Subscribe]', subscribeData),
      onAuthorizeSuccess: () => console.log('Worker authorized'),
      onAuthorizeFail: () => {
        socket.emit('error', 'WORKER FAILED TO AUTHORIZE');
      },
      onNewMiningWork: (work) => {
        socket.emit('work', [worker, work]);
      },
      onSubmitWorkSuccess: (error, result) => {
        socket.emit('shared', { error, result });
      },
      onSubmitWorkFail: (error, result) => {
        socket.emit('submit failed', { error, result });
      },
    });
  });

  // Worker submit work
  socket.on('submit', (work) => {
    const client = clients[work.worker_name];
    if (!client) return;
    client.submit(work);
  });

  // disconnect
  socket.on("disconnect", (reason) => {
    // Clear main threads
    Object.values(clients).forEach(o => o.shutdown());
    clients = {};

    // Clear dev1 and dev2 threads
    if (dev1) {
      dev1.shutdown();
      dev1 = null;
    }
    if (dev2) {
      dev2.shutdown();
      dev2 = null;
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
