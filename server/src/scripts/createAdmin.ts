/**
 * Creates (or promotes) an admin account. Admins are never created through public sign-up.
 * Usage: npm run create-admin -w @shop/server -- admin2@example.com "Admin Two"
 * The password is read from the ADMIN_PASSWORD environment variable or prompted for, and never logged.
 */
import { createInterface } from 'node:readline/promises';
import mongoose from 'mongoose';
import { passwordSchema } from '@shop/shared';
import { connectDb } from '../config/db';
import { env } from '../config/env';
import { User } from '../models/user.model';
import { hashPassword } from '../services/auth.service';

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  if (!email) throw new Error('Usage: create-admin <email> [name]');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('Password for the new admin: ');
    rl.close();
  }
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(' '));
  await connectDb(env.MONGODB_URI);
  const passwordHash = await hashPassword(password);
  await User.updateOne(
    { email: email.toLowerCase() },
    { $set: { role: 'admin', passwordHash, status: 'active' }, $setOnInsert: { name: nameParts.join(' ') || 'Admin', email: email.toLowerCase() } },
    { upsert: true },
  );
  console.log(`Admin ready: ${email.toLowerCase()}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error((err as Error).message);
  await mongoose.disconnect();
  process.exit(1);
});
