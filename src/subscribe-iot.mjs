import dotenv from 'dotenv';
import { iot } from 'aws-iot-device-sdk-v2';
import { mqtt, io as awsv2io, auth } from 'aws-iot-device-sdk-v2';

dotenv.config();

export async function startIotSubscriber({ onMessage }) {
  const endpoint = process.env.IOT_ENDPOINT;
  const region = process.env.IOT_REGION || 'eu-central-1';
  if (!endpoint) {
    console.warn('IOT_ENDPOINT not set. Running without AWS IoT.');
    return;
  }

  const clientId = process.env.IOT_CLIENT_ID || `pigdevice-${Math.floor(Math.random()*1e6)}`;

  const configBuilder = iot.AwsIotMqttConnectionConfigBuilder.new_with_websockets();
  configBuilder.with_clean_session(true);
  configBuilder.with_client_id(clientId);
  configBuilder.with_endpoint(endpoint);
  configBuilder.with_use_websockets(true);
  configBuilder.with_region(region);
  configBuilder.with_credentials_provider(auth.AwsCredentialsProvider.newDefault());

  const config = configBuilder.build();
  const client = new mqtt.MqttClient(new awsv2io.ClientBootstrap());
  const connection = client.new_connection(config);

  await connection.connect();
  console.log('Connected to AWS IoT');

  const prefix = process.env.IOT_TOPIC_BALANCE_PREFIX || 'smpg/devices';
  const topic = `${prefix}/+/state`;

  await connection.subscribe(topic, mqtt.QoS.AtLeastOnce, (topic, payload) => {
    try {
      const parts = topic.split('/');
      const deviceId = parts[parts.length - 2];
      const data = JSON.parse(new TextDecoder().decode(payload));
      if (deviceId) onMessage(deviceId, data);
    } catch (e) {
      console.error('IoT msg error', e);
    }
  });

  console.log('Subscribed to', topic);
}
