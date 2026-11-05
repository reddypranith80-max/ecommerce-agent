import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { INDIAN_STATES, ROLES, USER_STATUSES } from '@shop/shared';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String },
    role: { type: String, enum: ROLES, default: 'customer', required: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', required: true },
    /** Access tokens issued (iatMs) before this instant are rejected. */
    tokensValidAfter: { type: Date, default: () => new Date(0), required: true },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);
userSchema.index({ role: 1, createdAt: -1 });

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema);

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currentHash: { type: String, required: true, unique: true },
    previousHash: { type: String, index: true },
    previousValidUntil: { type: Date },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    lastUsedAt: { type: Date },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = model('Session', sessionSchema);

const passwordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true },
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordResetToken = model('PasswordResetToken', passwordResetSchema);

const addressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    landmark: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, enum: INDIAN_STATES, required: true },
    postalCode: { type: String, required: true, match: /^[1-9][0-9]{5}$/ },
    country: { type: String, default: 'IN', enum: ['IN'] },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);
addressSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { isDefault: true }, name: 'one_default_per_user' });
export type AddressDoc = HydratedDocument<InferSchemaType<typeof addressSchema>>;
export const Address = model('Address', addressSchema);
