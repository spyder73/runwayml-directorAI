import net from 'net';
import tls from 'tls';

type SmtpSocket = net.Socket | tls.TLSSocket;

export type SendVerificationEmailInput = {
  to: string;
  token: string;
};

export type SendEmailResult = {
  sent: boolean;
  reason?: string;
  verifyUrl?: string;
};

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function buildVerificationUrl(token: string) {
  return `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

function smtpHostConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function encodeAddress(address: string) {
  return address.includes('<') ? address : `<${address}>`;
}

function dotStuff(message: string) {
  return message
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => line.startsWith('.') ? `.${line}` : line)
    .join('\r\n');
}

function buildMessage({ to, verifyUrl }: { to: string; verifyUrl: string }) {
  const from = process.env.SMTP_FROM || 'Lifestory <no-reply@localhost>';
  return [
    `From: ${from}`,
    `To: ${to}`,
    'Subject: Confirm your Lifestory email',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Confirm your email address to finish setting up your Lifestory account.',
    '',
    verifyUrl,
    '',
    'If you did not create this account, you can ignore this email.',
  ].join('\r\n');
}

async function readSmtpResponse(socket: SmtpSocket) {
  let buffer = '';

  while (true) {
    const chunk = await new Promise<string>((resolve, reject) => {
      const onData = (data: Buffer) => {
        cleanup();
        resolve(data.toString('utf8'));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('error', onError);
      };
      socket.once('data', onData);
      socket.once('error', onError);
    });

    buffer += chunk;
    const lines = buffer.split(/\r?\n/).filter(Boolean);
    const lastLine = lines[lines.length - 1];
    if (lastLine && /^\d{3} /.test(lastLine)) {
      const code = Number(lastLine.slice(0, 3));
      return { code, text: buffer };
    }
  }
}

async function writeCommand(socket: SmtpSocket, command: string, expected: number | number[]) {
  socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(socket);
  const expectedCodes = Array.isArray(expected) ? expected : [expected];
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP command failed: ${response.text.trim()}`);
  }
  return response;
}

function connectSocket(host: string, port: number, secure: boolean) {
  return new Promise<SmtpSocket>((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });

    socket.setTimeout(Number(process.env.SMTP_TIMEOUT_MS || 15000));
    socket.once('connect', () => resolve(socket));
    socket.once('secureConnect', () => resolve(socket));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('SMTP connection timed out.'));
    });
    socket.once('error', reject);
  });
}

async function upgradeToTls(socket: SmtpSocket, host: string) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host });
    secureSocket.once('secureConnect', () => resolve(secureSocket));
    secureSocket.once('error', reject);
  });
}

async function sendSmtpMail({ to, message }: { to: string; message: string }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const from = process.env.SMTP_FROM;
  if (!host || !from) {
    return { sent: false, reason: 'SMTP_HOST or SMTP_FROM missing' };
  }

  const secure = process.env.SMTP_SECURE === '1' || port === 465;
  let socket = await connectSocket(host, port, secure);

  try {
    await readSmtpResponse(socket);
    const ehlo = await writeCommand(socket, `EHLO ${process.env.SMTP_EHLO_DOMAIN || 'localhost'}`, 250);

    if (!secure && ehlo.text.includes('STARTTLS') && process.env.SMTP_DISABLE_STARTTLS !== '1') {
      await writeCommand(socket, 'STARTTLS', 220);
      socket = await upgradeToTls(socket, host);
      await writeCommand(socket, `EHLO ${process.env.SMTP_EHLO_DOMAIN || 'localhost'}`, 250);
    }

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await writeCommand(socket, 'AUTH LOGIN', 334);
      await writeCommand(socket, Buffer.from(process.env.SMTP_USER).toString('base64'), 334);
      await writeCommand(socket, Buffer.from(process.env.SMTP_PASS).toString('base64'), 235);
    }

    await writeCommand(socket, `MAIL FROM:${encodeAddress(from)}`, 250);
    await writeCommand(socket, `RCPT TO:${encodeAddress(to)}`, [250, 251]);
    await writeCommand(socket, 'DATA', 354);
    await writeCommand(socket, `${dotStuff(message)}\r\n.`, 250);
    await writeCommand(socket, 'QUIT', 221);

    return { sent: true };
  } finally {
    socket.destroy();
  }
}

export async function sendVerificationEmail(input: SendVerificationEmailInput): Promise<SendEmailResult> {
  const verifyUrl = buildVerificationUrl(input.token);

  if (!smtpHostConfigured()) {
    return { sent: false, reason: 'SMTP not configured', verifyUrl };
  }

  const result = await sendSmtpMail({
    to: input.to,
    message: buildMessage({ to: input.to, verifyUrl }),
  });

  return { ...result, verifyUrl };
}
