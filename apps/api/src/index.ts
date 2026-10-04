import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

const app = Fastify({ logger: true, trustProxy: true });
await app.register(helmet, { global: true });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
app.get('/health', async () => ({ ok: true, service: 'dispatch-api' }));

const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: '0.0.0.0', port });
