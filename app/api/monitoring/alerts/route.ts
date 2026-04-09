export async function POST(request: Request): Promise<Response> {
  const webhookSecret = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret || webhookSecret !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let alert: Record<string, unknown>;

  try {
    alert = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Log the alert
  console.warn('[monitoring/alerts] Received alert from Snowflake:', JSON.stringify(alert));

  // Forward to notification system if configured
  const notificationUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (notificationUrl) {
    fetch(notificationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'snowflake', alert, receivedAt: Date.now() }),
    }).catch((err) => {
      console.error('[monitoring/alerts] Failed to forward alert:', err);
    });
  }

  return Response.json({ received: true });
}
