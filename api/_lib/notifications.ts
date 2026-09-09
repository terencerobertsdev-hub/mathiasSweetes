type OrderNotice = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  requested_date: string | null;
  subtotal_in_cents: number;
};

function csv(name: string): string[] {
  return String(process.env[name] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function orderText(order: OrderNotice): string {
  return [
    `Mathias Treats paid order ${order.id.slice(0, 8)}`,
    `Customer: ${order.customer_name}`,
    `Email: ${order.customer_email}`,
    `Phone: ${order.customer_phone || 'Not provided'}`,
    `Total: $${(order.subtotal_in_cents / 100).toFixed(2)}`,
    `Requested pickup: ${order.requested_date || 'Not requested'}`,
    'The private pickup address has not been released.',
    'An adult administrator must approve the pickup in Admin > Orders.',
  ].join('\n');
}

export async function notifyPaidOrder(order: OrderNotice): Promise<void> {
  const message = orderText(order);
  const emails = csv('ORDER_NOTIFICATION_EMAILS');
  const phones = csv('ORDER_NOTIFICATION_WHATSAPP');
  const tasks: Promise<unknown>[] = [];

  if (process.env['RESEND_API_KEY'] && emails.length) {
    tasks.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env['RESEND_API_KEY']}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env['ORDER_NOTIFICATION_FROM_EMAIL'] ?? 'Mathias Treats <onboarding@resend.dev>',
        to: emails,
        subject: `Paid Mathias Treats order ${order.id.slice(0, 8)}`,
        text: message,
      }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Resend notification failed with HTTP ${response.status}`);
    }));
  }

  const accountSid = process.env['TWILIO_ACCOUNT_SID'];
  const authToken = process.env['TWILIO_AUTH_TOKEN'];
  const from = process.env['TWILIO_WHATSAPP_FROM'];
  if (accountSid && authToken && from && phones.length) {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    for (const phone of phones) {
      const body = new URLSearchParams({ To: `whatsapp:${phone}`, From: `whatsapp:${from}`, Body: message.slice(0, 1500) });
      tasks.push(fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Twilio WhatsApp notification failed with HTTP ${response.status}`);
      }));
    }
  }

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Paid-order notification error', result.reason instanceof Error ? result.reason.message : 'Unknown error');
  }
}

export async function sendPickupAddress(order: OrderNotice, pickupTime: string): Promise<void> {
  const address = process.env['PICKUP_ADDRESS'];
  const key = process.env['RESEND_API_KEY'];
  if (!address || !key) throw new Error('Pickup email is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env['ORDER_NOTIFICATION_FROM_EMAIL'] ?? 'Mathias Treats <onboarding@resend.dev>',
      to: [order.customer_email],
      subject: `Pickup confirmed for Mathias Treats order ${order.id.slice(0, 8)}`,
      text: `Your paid Mathias Treats order is confirmed for pickup.\n\nPickup time: ${pickupTime}\nPickup address: ${address}\n\nPlease arrive only at the confirmed time. If using a delivery service, provide these details directly to your driver.`,
    }),
  });
  if (!response.ok) throw new Error(`Pickup email failed with HTTP ${response.status}`);
}
