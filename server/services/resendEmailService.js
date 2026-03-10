import axios from 'axios';
import { logger } from '../utils/logger.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM_EMAIL = 'noreply@suitegenie.in';
const DEFAULT_FROM_NAME = 'SuiteGenie';
const MAX_SUBJECT_LENGTH = 200;

const toShortText = (value = '', max = 320) => {
  const normalized = String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 320;
  return normalized.slice(0, safeMax);
};

class ResendEmailService {
  constructor() {
    this.apiKey = String(process.env.RESEND_API_KEY || '').trim();
    this.fromEmail = String(process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL).trim() || DEFAULT_FROM_EMAIL;
    this.fromName = String(process.env.RESEND_FROM_NAME || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME;
    this.enabled = Boolean(this.apiKey);
  }

  isEnabled() {
    return this.enabled;
  }

  getFromHeader() {
    return `${this.fromName} <${this.fromEmail}>`;
  }

  async sendEmail({ to = '', subject = '', html = '', text = '' } = {}) {
    const cleanTo = toShortText(to, 320);
    if (!cleanTo) {
      throw new Error('Email recipient is required');
    }

    const cleanSubject = toShortText(subject, MAX_SUBJECT_LENGTH);
    if (!cleanSubject) {
      throw new Error('Email subject is required');
    }

    const cleanHtml = String(html || '').trim();
    const cleanText = String(text || '').trim();
    if (!cleanHtml && !cleanText) {
      throw new Error('Email content is required');
    }

    if (!this.isEnabled()) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const payload = {
      from: this.getFromHeader(),
      to: [cleanTo],
      subject: cleanSubject,
      ...(cleanHtml ? { html: cleanHtml } : {}),
      ...(cleanText ? { text: cleanText } : {}),
    };

    const response = await axios.post(RESEND_ENDPOINT, payload, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const messageId = String(response?.data?.id || '').trim() || null;
    logger.info('[Email] Resend message sent', {
      to: cleanTo,
      messageId,
      subject: cleanSubject,
    });

    return {
      messageId,
      provider: 'resend',
    };
  }
}

const resendEmailService = new ResendEmailService();
export default resendEmailService;
