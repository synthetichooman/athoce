import { isRentalAuthorized } from '../../_rental.js';
import { isTelegramConfigured, sendTelegramMessage } from '../../_telegram.js';

const CONTACT_METHODS = new Set(['instagram', 'phone', 'email']);
const MAX_PRODUCTS = 30;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function clean(value, maxLength = 240) {
  return String(value || '')
    .trim()
    .slice(0, maxLength);
}

function getOrigin(request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return 'https://athoce.kr';
  }
}

function normalizeProducts(products, origin) {
  if (!Array.isArray(products)) {
    return [];
  }

  return products
    .slice(0, MAX_PRODUCTS)
    .map((product) => {
      const prodNo = clean(product?.prodNo, 80);
      const name = clean(product?.name, 160) || 'unnamed product';
      const price = Number(product?.price || 0);
      const detailUrl = prodNo
        ? `${origin}/detail.html?prodNo=${encodeURIComponent(prodNo)}`
        : clean(product?.detailUrl, 320);

      return {
        prodNo,
        name,
        price: Number.isFinite(price) ? price : 0,
        detailUrl,
      };
    })
    .filter((product) => product.prodNo || product.name);
}

function formatPrice(price) {
  return price ? `${new Intl.NumberFormat('ko-KR').format(price)}원` : 'price inquiry';
}

function buildInquiryMessage(payload) {
  const productLines = payload.products
    .map((product, index) => {
      const title = `${index + 1}. ${product.name}`;
      const meta = [`prodNo: ${product.prodNo || '-'}`, `price: ${formatPrice(product.price)}`];
      return [title, meta.join(' / '), product.detailUrl].join('\n');
    })
    .join('\n\n');

  return [
    '[athoce] rental availability inquiry',
    `time: ${new Date().toISOString()}`,
    `organization: ${payload.organization}`,
    `contact: ${payload.contactMethod} / ${payload.contact}`,
    `items: ${payload.products.length}`,
    '',
    productLines,
  ].join('\n');
}

async function sendEmailIfConfigured(env, payload, message) {
  const webhookUrl = clean(env.RENTAL_INQUIRY_EMAIL_WEBHOOK_URL || env.INQUIRY_EMAIL_WEBHOOK_URL, 600);
  const webhookSecret = clean(
    env.RENTAL_INQUIRY_EMAIL_WEBHOOK_SECRET || env.INQUIRY_EMAIL_WEBHOOK_SECRET,
    600,
  );

  if (webhookUrl) {
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
    };

    if (webhookSecret) {
      headers.authorization = `Bearer ${webhookSecret}`;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'rental_availability_inquiry',
        message,
        ...payload,
      }),
    });

    return {
      sent: response.ok,
      status: response.status,
      provider: 'webhook',
    };
  }

  const resendApiKey = clean(env.RESEND_API_KEY, 600);
  const emailTo = clean(env.INQUIRY_EMAIL_TO || env.RENTAL_INQUIRY_EMAIL_TO, 320);
  const emailFrom = clean(env.INQUIRY_EMAIL_FROM || env.RENTAL_INQUIRY_EMAIL_FROM, 320);

  if (!resendApiKey || !emailTo || !emailFrom) {
    return {
      sent: false,
      skipped: true,
      reason: 'email_not_configured',
    };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resendApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [emailTo],
      subject: '[athoce] rental availability inquiry',
      text: message,
    }),
  });

  return {
    sent: response.ok,
    status: response.status,
    provider: 'resend',
  };
}

export async function onRequestPost({ env, request }) {
  if (!(await isRentalAuthorized(request, env))) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'RENTAL_AUTH_REQUIRED',
          message: 'password required.',
        },
      },
      401,
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const contactMethod = clean(body?.contactMethod, 40).toLowerCase();
  const contact = clean(body?.contact, 160);
  const organization = clean(body?.organization, 160);
  const products = normalizeProducts(body?.products, getOrigin(request));

  if (!CONTACT_METHODS.has(contactMethod) || !contact || !organization || !products.length) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'INVALID_INQUIRY',
          message: 'contact and selected products are required.',
        },
      },
      400,
    );
  }

  if (!isTelegramConfigured(env)) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'TELEGRAM_NOT_CONFIGURED',
          message: 'telegram is not configured.',
        },
      },
      500,
    );
  }

  const payload = {
    contactMethod,
    contact,
    organization,
    products,
  };
  const message = buildInquiryMessage(payload);
  const telegram = await sendTelegramMessage(env, message);
  const email = await sendEmailIfConfigured(env, payload, message);

  if (!telegram.ok) {
    return jsonResponse(
      {
        ok: false,
        telegram,
        email,
        error: {
          code: 'TELEGRAM_SEND_FAILED',
          message: 'telegram send failed.',
        },
      },
      502,
    );
  }

  return jsonResponse({
    ok: true,
    telegram: {
      sent: true,
      status: telegram.status || null,
    },
    email,
  });
}
