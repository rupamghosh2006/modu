import { FastifyRequest, FastifyReply } from 'fastify';
import { request as undiciRequest } from 'undici';
import { isHopByHopHeader, PaymentReceipt } from '@modu/shared';
import { Readable } from 'node:stream';

export interface ForwardOptions {
  targetUrl: string;
  receipt: PaymentReceipt;
}

export async function forwardStream(
  req: FastifyRequest,
  reply: FastifyReply,
  options: ForwardOptions
): Promise<FastifyReply> {
  const { targetUrl, receipt } = options;

  // Filter incoming headers
  const filteredHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined && !isHopByHopHeader(key)) {
      filteredHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  // Determine request body stream
  let reqBodyStream: Readable | null = null;
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    reqBodyStream = req.raw;
  }

  try {
    const originResponse = await undiciRequest(targetUrl, {
      method: method as any,
      headers: filteredHeaders,
      body: reqBodyStream,
    });

    // Set origin status code
    reply.status(originResponse.statusCode);

    // Forward origin headers (minus hop-by-hop)
    for (const [key, value] of Object.entries(originResponse.headers)) {
      if (value !== undefined && !isHopByHopHeader(key)) {
        reply.header(key, value);
      }
    }

    // Set x402 settlement receipt header
    reply.header('X-PAYMENT-RESPONSE', JSON.stringify(receipt));

    // Fastify natively streams Readable streams safely
    return reply.send(originResponse.body);
  } catch (err: any) {
    return reply.status(502).send({
      error: 'Bad Gateway: failed to connect to origin server',
      details: err.message,
    });
  }
}
