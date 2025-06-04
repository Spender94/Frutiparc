const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Example HTTP endpoints
// Serve static example data for some endpoints
app.get('/ff/tree', (req, res) => {
  res.sendFile(path.join(__dirname, 'examples', 'ff_tree.json'));
});

app.get('/ff/mv', (req, res) => {
  res.sendFile(path.join(__dirname, 'examples', 'ff_mv.json'));
});

app.get('/ff/cp', (req, res) => {
  res.sendFile(path.join(__dirname, 'examples', 'ff_cp.json'));
});

const server = app.listen(port, () => {
  console.log(`HTTP server running on http://localhost:${port}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws.send('Hello from server');

  ws.on('message', (msg) => {
    console.log('received:', msg.toString());
    ws.send(`echo: ${msg}`);
  });
});
