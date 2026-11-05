import { MAX_ADDRESSES, type Address as AddressDTO, type AddressInput } from '@shop/shared';
import { withTransaction } from '../config/db';
import { Address, User, type AddressDoc } from '../models/user.model';
import { notFound, unprocessable } from '../utils/errors';
import { toPublicUser } from './auth.service';

export function toAddressDTO(a: AddressDoc): AddressDTO {
  return {
    id: a.id as string,
    label: a.label ?? null,
    fullName: a.fullName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 ?? null,
    landmark: a.landmark ?? null,
    city: a.city,
    state: a.state as AddressDTO['state'],
    postalCode: a.postalCode,
    country: 'IN',
    isDefault: a.isDefault,
  };
}

export async function updateProfile(userId: string, input: { name?: string; phone?: string }) {
  const user = await User.findById(userId);
  if (!user) throw notFound('Account not found.');
  if (input.name !== undefined) user.name = input.name;
  if (input.phone !== undefined) user.phone = input.phone || undefined;
  await user.save();
  return toPublicUser(user);
}

export async function listAddresses(userId: string) {
  const list = await Address.find({ userId }).sort({ isDefault: -1, updatedAt: -1 });
  return list.map(toAddressDTO);
}

export async function createAddress(userId: string, input: AddressInput) {
  return withTransaction(async (session) => {
    const count = await Address.countDocuments({ userId }).session(session);
    if (count >= MAX_ADDRESSES) throw unprocessable('LIMIT_REACHED', `You can save up to ${MAX_ADDRESSES} addresses.`);
    const makeDefault = input.isDefault || count === 0;
    if (makeDefault) await Address.updateMany({ userId, isDefault: true }, { $set: { isDefault: false } }, { session });
    const [created] = await Address.create([{ ...input, userId, isDefault: makeDefault }], { session });
    return toAddressDTO(created!);
  });
}

export async function updateAddress(userId: string, id: string, input: Partial<AddressInput>) {
  return withTransaction(async (session) => {
    const address = await Address.findOne({ _id: id, userId }).session(session);
    if (!address) throw notFound('Address not found.');
    if (input.isDefault === true && !address.isDefault) {
      await Address.updateMany({ userId, isDefault: true }, { $set: { isDefault: false } }, { session });
    }
    const { isDefault, ...rest } = input;
    address.set(rest);
    if (isDefault === true) address.isDefault = true;
    await address.save({ session });
    return toAddressDTO(address);
  });
}

export async function setDefaultAddress(userId: string, id: string) {
  return updateAddress(userId, id, { isDefault: true });
}

export async function deleteAddress(userId: string, id: string) {
  await withTransaction(async (session) => {
    const address = await Address.findOneAndDelete({ _id: id, userId }, { session });
    if (!address) throw notFound('Address not found.');
    if (address.isDefault) {
      const next = await Address.findOne({ userId }).sort({ updatedAt: -1 }).session(session);
      if (next) {
        next.isDefault = true;
        await next.save({ session });
      }
    }
  });
}
