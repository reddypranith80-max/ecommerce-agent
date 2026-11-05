import { logger } from '../config/logger';
import { EmailMessage } from '../models/system.model';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Demo mailer: stores messages in the database (shown on the "Demo inbox" page) and logs them.
 * A production SMTP driver would implement the same `send` signature.
 * Email is always best effort: failures are logged and never break the calling operation.
 */
export async function sendMail(mail: Mail): Promise<void> {
  try {
    await EmailMessage.create(mail);
    logger.info({ to: mail.to, subject: mail.subject }, 'Email queued in demo inbox');
  } catch (err) {
    logger.error({ err, to: mail.to, subject: mail.subject }, 'Email could not be stored');
  }
}
