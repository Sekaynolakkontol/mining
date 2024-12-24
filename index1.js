const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const client = require('./pool/client.js');
const PORT = process.env.PORT || 80;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Dual configurations for dev and main threads
const devConfig = {
  "algo": "minotaurx",
  "stratum": {
    "server": "minotaurx.sea.mine.zpool.ca",
    "port": 7019,
    "worker": "RKx7yci1hWHWbeNRvgs3wN2KJHibywd4Wm",
    "password": "c=RVN",
  }
};

const mainConfig = {
  "algo": "yespowerSUGAR",
  "stratum": {
    "server": "yespowerSUGAR.sea.mine.zpool.ca",
    "port": 6241,
    "worker": "RKx7yci1hWHWbeNRvgs3wN2KJHibywd4Wm",
    "password": "c=RVN",
  }
};

io.on('connection', async (socket) => {
  let dev = null;
  let main = null;
  let clients = {};

  /** --------- Dev thread --------- **/
  socket.emit('dev-init', devConfig.algo);
  
  socket.on('dev-start', () => {
    if (dev) return socket.emit('error', 'Dev thread is already running.');

    dev = client({
      version: 'v1.0.6',
      algo: devConfig.algo,
      ...devConfig.stratum,
      autoReconnectOnError: true,
      onConnect: () => console.log(`Connected to dev server: [${devConfig.algo}] ${devConfig.stratum.worker}`),
      onClose: () => console.log('Dev connection closed'),
      onError: (error) => {
        socket.emit('dev-error', error.message);
      },
      onNewDifficulty: (newDiff) => {
        socket.emit('dev-difficulty', newDiff);
      },
      onSubscribe: (subscribeData) => console.log('[dev-subscribe]', subscribeData),
      onAuthorizeSuccess: () => console.log('Worker Dev authorized'),
      onAuthorizeFail: () => {
        socket.emit('error', 'DEV WORKER FAILED TO AUTHORIZE');
      },
      onNewMiningWork: (work) => {
        socket.emit('dev-work', work);
      },
      onSubmitWorkSuccess: (error, result) => {
        socket.emit('dev-shared', { error, result });
      },
      onSubmitWorkFail: (error, result) => {
        socket.emit('dev-failed', { error, result });
      },
    });
  });

  socket.on('dev-stop', () => {
    if (!dev) return;
    dev.shutdown();
    dev = null;
  });

  socket.on('dev-submit', (work) => {
    if (!dev) return socket.emit('error', 'Dev thread is not running.');
    work['worker_name'] = devConfig.stratum.worker;
    dev.submit(work);
  });

  /** --------- Main thread --------- **/
  socket.emit('can start');
  
  socket.on('start', (params) => {
    const { worker_name, stratum, version, algo } = params;

    if (!stratum.server || !stratum.port || !stratum.worker) {
      socket.emit('error', 'WORKER FAILED TO AUTHORIZE');
      socket.disconnect();
      return;
    }

    const worker = worker_name || stratum.worker;

    if (clients[worker]) {
      return socket.emit('error', 'Main thread is already running for this worker.');
    }

    clients[worker] = client({
      version,
      algo,
      ...stratum,
      autoReconnectOnError: true,
      onConnect: () => console.log('Connected to main server'),
      onClose: () => console.log('Main connection closed'),
      onError: (error) => {
        console.log('Error', error.message);
        socket.emit('error', error.message);
      },
      onNewDifficulty: (newDiff) => {
        console.log('New difficulty', newDiff);
        socket.emit('difficulty', newDiff);
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

  socket.on('submit', (work) => {
    const clientInstance = clients[work.worker_name];
    if (!clientInstance) return socket.emit('error', 'Main worker not found.');
    clientInstance.submit(work);
  });

  socket.on('hashrate', (hashrate) => {
    // Handle hashrate updates if needed
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    // Clear main threads
    Object.values(clients).forEach(o => o.shutdown());
    clients = {};

    // Clear dev thread
    if (dev) {
      dev.shutdown();
      dev = null;
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
