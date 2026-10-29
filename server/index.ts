import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4317;

const { httpServer } = await createApp();
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Relay Chess listening on http://0.0.0.0:${port}`);
});
