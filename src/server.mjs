import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import dayjs from 'dayjs';
import QRCode from 'qrcode';
import { Server as SocketIOServer } from 'socket.io';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(express.json()); // Add JSON body parser

// In-memory mock state; will be updated by IoT subscriber
const deviceStateById = new Map();

// helper to get or seed state
function getDeviceState(deviceId) {
  if (!deviceStateById.has(deviceId)) {
    deviceStateById.set(deviceId, {
      deviceId,
      amountCents: 0,
      currency: 'EUR',
      updatedAt: new Date().toISOString(),
    });
  }
  return deviceStateById.get(deviceId);
}

app.get('/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const state = getDeviceState(deviceId);
  const donorUrl = `https://donor.smartpigg.com/${deviceId}`;
  const qrPngDataUrl = await QRCode.toDataURL(donorUrl, { margin: 1, width: 220 });
  res.render('device', {
    deviceId,
    clock: dayjs().format('HH:mm'),
    amountFormatted: formatCurrency(state.amountCents, state.currency),
    qrPngDataUrl,
    donorUrl,
  });
});

io.on('connection', (socket) => {
  socket.on('join-device', (deviceId) => {
    socket.join(deviceId);
    // push the latest known state immediately on join
    try { pushStateToClients(deviceId); } catch {}
  });
});

function pushStateToClients(deviceId) {
  const state = getDeviceState(deviceId);
  io.to(deviceId).emit('device-state', {
    deviceId,
    amountCents: state.amountCents,
    currency: state.currency,
    amountFormatted: formatCurrency(state.amountCents, state.currency),
    updatedAt: state.updatedAt,
    clock: dayjs().format('HH:mm'),
  });
}

function formatCurrency(amountCents, currency) {
  const amount = amountCents / 100;
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
}

// Mock endpoint to simulate money being added
app.post('/api/:deviceId/add/:cents', (req, res) => {
  const { deviceId, cents } = req.params;
  const state = getDeviceState(deviceId);
  state.amountCents += Number(cents);
  state.updatedAt = new Date().toISOString();
  pushStateToClients(deviceId);
  res.json({ ok: true, state });
});

// Endpoint to set an exact amount (in cents)
app.post('/api/:deviceId/set/:cents', (req, res) => {
  const { deviceId, cents } = req.params;
  const state = getDeviceState(deviceId);
  state.amountCents = Number(cents);
  state.updatedAt = new Date().toISOString();
  pushStateToClients(deviceId);
  res.json({ ok: true, state });
});

// Simulate IoT message for testing
app.post('/api/:deviceId/iot-simulate', (req, res) => {
  const { deviceId } = req.params;
  const { amountCents, currency = 'EUR' } = req.body;
  
  if (typeof amountCents !== 'number') {
    return res.status(400).json({ error: 'amountCents must be a number' });
  }
  
  // Simulate the IoT message processing
  const state = getDeviceState(deviceId);
  state.amountCents = amountCents;
  state.currency = currency;
  state.updatedAt = new Date().toISOString();
  
  // Push to connected clients
  pushStateToClients(deviceId);
  
  console.log(`📡 Simulated IoT message for ${deviceId}: ${amountCents} cents`);
  
  res.json({ 
    ok: true, 
    message: 'IoT message simulated successfully',
    state,
    note: 'Use this endpoint to test the pig device without IoT connection'
  });
});

// Send MQTT message to AWS IoT
app.post('/api/:deviceId/mqtt-publish', async (req, res) => {
  const { deviceId } = req.params;
  const { topic, payload } = req.body;
  
  if (!topic || !payload) {
    return res.status(400).json({ error: 'topic and payload are required' });
  }
  
  try {
    // Import the publish function
    const { publishMqttMessage } = await import('./subscribe-iot.mjs');
    
    // Publish the MQTT message
    const success = await publishMqttMessage(topic, payload);
    
    if (success) {
      console.log(`📤 MQTT message sent to ${topic} for device ${deviceId}`);
      res.json({ 
        ok: true, 
        message: 'MQTT message published successfully',
        topic,
        payload
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to publish MQTT message',
        reason: 'MQTT connection not available'
      });
    }
  } catch (error) {
    console.error('❌ Error publishing MQTT message:', error);
    res.status(500).json({ 
      error: 'Failed to publish MQTT message',
      details: error.message
    });
  }
});

const port = process.env.PORT || 4090;
server.listen(port, () => {
  console.log(`pigdevice listening on http://localhost:${port}/<DEVICE_ID>`);
});

// Placeholder for AWS IoT wiring; implemented in separate module
import('./subscribe-iot.mjs').then(({ startIotSubscriber }) => {
  startIotSubscriber({ onMessage: (deviceId, payload) => {
    const state = getDeviceState(deviceId);
    if (typeof payload.amountCents === 'number') state.amountCents = payload.amountCents;
    if (typeof payload.deltaCents === 'number') state.amountCents += payload.deltaCents;
    if (typeof payload.currency === 'string') state.currency = payload.currency;
    state.updatedAt = new Date().toISOString();
    pushStateToClients(deviceId);
  }}).catch(err => console.error('IoT subscriber failed', err));
}).catch(err => console.error('IoT module load failed', err));
