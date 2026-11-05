import type { Types } from 'mongoose';
import { logger } from '../config/logger';
import { AuditLog } from '../models/system.model';

export interface Actor {
  type: 'customer' | 'admin' | 'system';
  id?: Types.ObjectId | string;
  ip?: string;
}

export const SYSTEM_ACTOR: Actor = { type: 'system' };

/** Records an admin write action. Never throws: auditing must not break the operation it describes. */
export async function audit(actor: Actor, action: string, entityType: string, entityId: string, summary = ''): Promise<void> {
  if (!actor.id) return;
  try {
    await AuditLog.create({ actorId: actor.id, action, entityType, entityId, summary, ip: actor.ip });
  } catch (err) {
    logger.error({ err, action }, 'Audit log write failed');
  }
}
