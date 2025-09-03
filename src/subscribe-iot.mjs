import dotenv from 'dotenv';
import { iot } from 'aws-iot-device-sdk-v2';
import { mqtt, io as awsv2io } from 'aws-iot-device-sdk-v2';
import fs from 'fs';
import path from 'path';

dotenv.config();

let mqttConnection = null;

export async function startIotSubscriber({ onMessage }) {
  const endpoint = process.env.IOT_ENDPOINT;
  const region = process.env.IOT_REGION;
  const clientId = process.env.IOT_CLIENT_ID || `pigdevice-${Math.floor(Math.random()*1e6)}`;

  if (!endpoint || !region) {
    console.error('❌ Missing IoT configuration. Please set IOT_ENDPOINT and IOT_REGION in .env');
    console.log('Running without AWS IoT connection.');
    return;
  }

  try {
    console.log('Attempting to connect to AWS IoT...');
    console.log('Endpoint:', endpoint);
    console.log('Region:', region);
    console.log('Client ID:', clientId);

    // Check for certificate files
    const certPath = path.join(process.cwd(), 'certificates', 'certificate.pem');
    const keyPath = path.join(process.cwd(), 'certificates', 'private-key.pem');
    const caPath = path.join(process.cwd(), 'certificates', 'AmazonRootCA3.pem');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(caPath)) {
      console.log('✅ Found certificate files, using certificate-based authentication...');
      console.log('Certificate:', certPath);
      console.log('Private Key:', keyPath);
      console.log('Root CA:', caPath);
      
      // Create certificate-based connection
      const configBuilder = iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder_from_path(
        certPath,
        keyPath
      );
      configBuilder.with_clean_session(true);
      configBuilder.with_client_id(clientId);
      configBuilder.with_endpoint(endpoint);
      
      const config = configBuilder.build();
      const client = new mqtt.MqttClient(new awsv2io.ClientBootstrap());
      mqttConnection = client.new_connection(config);

      await mqttConnection.connect();
      console.log('✅ Connected to AWS IoT successfully using certificates!');

      const prefix = process.env.IOT_TOPIC_BALANCE_PREFIX || 'smpg/devices';
      const topic = `${prefix}/+/state`;

      await mqttConnection.subscribe(topic, mqtt.QoS.AtLeastOnce, (topic, payload) => {
        try {
          const parts = topic.split('/');
          const deviceId = parts[parts.length - 2];
          const data = JSON.parse(new TextDecoder().decode(payload));
          console.log(`📡 MQTT message received on topic: ${topic}`);
          console.log('Message data:', data);
          if (deviceId) onMessage(deviceId, data);
        } catch (e) {
          console.error('❌ IoT message parsing error:', e);
        }
      });

      console.log(`📡 Subscribed to MQTT topic pattern: ${topic}`);
      
    } else {
      console.log('❌ Certificate files not found. Please ensure:');
      console.log('   certificates/certificate.pem');
      console.log('   certificates/private-key.pem');
      console.log('   certificates/AmazonRootCA3.pem');
      console.log('Running without AWS IoT connection.');
    }
    
  } catch (error) {
    console.error('❌ IoT connection failed:', error);
    console.log('Running without AWS IoT - messages will not be received');
  }
}

// Function to publish MQTT messages to AWS IoT
export async function publishMqttMessage(topic, payload) {
  if (!mqttConnection) {
    console.error('❌ Cannot publish: MQTT connection not established');
    return false;
  }

  try {
    const message = JSON.stringify(payload);
    await mqttConnection.publish(topic, message, mqtt.QoS.AtLeastOnce);
    console.log(`📤 MQTT message published to topic: ${topic}`);
    console.log('Message payload:', message);
    return true;
  } catch (error) {
    console.error('❌ Failed to publish MQTT message:', error);
    return false;
  }
}
