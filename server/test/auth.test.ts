import { describe, expect, it } from 'vitest';
import { EmailMessage } from '../src/models/system.model';
import { api, makeUser, V1 } from './helpers';

describe('authentication', () => {
  it('registers, rejects duplicates and never returns secrets', async () => {
    const res = await api().post(`${V1}/auth/register`).send({ name: 'Ravi Kumar', email: 'Ravi@Example.com', password: 'Secret123' }).expect(201);
    expect(res.body.data.user.email).toBe('ravi@example.com');
    expect(res.body.data.user.role).toBe('customer');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Secret123/);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/rt=.+HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    const dup = await api().post(`${V1}/auth/register`).send({ name: 'Ravi Kumar', email: 'ravi@example.com', password: 'Secret123' }).expect(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input and rejects unknown fields (no mass assignment)', async () => {
    const weak = await api().post(`${V1}/auth/register`).send({ name: 'A', email: 'nope', password: 'short' }).expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    expect(weak.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    await api().post(`${V1}/auth/register`).send({ name: 'Mallory', email: 'm@example.com', password: 'Secret123', role: 'admin' }).expect(400);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const user = await makeUser();
    const wrong = await api().post(`${V1}/auth/login`).send({ email: user.email, password: 'WrongPass1' }).expect(401);
    const unknown = await api().post(`${V1}/auth/login`).send({ email: 'ghost@example.com', password: 'WrongPass1' }).expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toMatchObject({ code: wrong.body.error.code, message: wrong.body.error.message });
  });

  it('rotates refresh tokens, tolerates a racing tab, and revokes on logout', async () => {
    const user = await makeUser();
    // No cookie at all: nothing to restore, answered without an error.
    await api().post(`${V1}/auth/refresh`).set('X-Requested-With', 'fetch').expect(204);
    const refresh = (cookie: string) => api().post(`${V1}/auth/refresh`).set('Cookie', cookie).set('X-Requested-With', 'fetch');

    const first = await refresh(user.cookie).expect(200);
    const rotated = String(first.headers['set-cookie']?.[0]).split(';')[0]!;
    expect(rotated).not.toBe(user.cookie);

    // Another tab still holds the previous token: accepted within the grace window, without rotating again.
    const racing = await refresh(user.cookie).expect(200);
    expect(racing.headers['set-cookie']).toBeUndefined();
    expect(racing.body.data.accessToken).toBeTruthy();

    await api().post(`${V1}/auth/logout`).set('Cookie', rotated).set('X-Requested-With', 'fetch').expect(204);
    const after = await refresh(rotated).expect(401);
    expect(after.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('refuses cookie endpoints without the CSRF header or from another origin', async () => {
    const user = await makeUser();
    await api().post(`${V1}/auth/refresh`).set('Cookie', user.cookie).expect(403);
    await api()
      .post(`${V1}/auth/refresh`)
      .set('Cookie', user.cookie)
      .set('X-Requested-With', 'fetch')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('resets a password with a single-use emailed token and signs out other sessions', async () => {
    const user = await makeUser();
    await api().post(`${V1}/auth/forgot-password`).send({ email: user.email }).expect(202);
    await api().post(`${V1}/auth/forgot-password`).send({ email: 'nobody@example.com' }).expect(202);

    const mail = await EmailMessage.findOne({ to: user.email }).sort({ createdAt: -1 });
    const token = mail!.text.match(/#token=([A-Za-z0-9_-]+)/)![1]!;
    await api().post(`${V1}/auth/reset-password`).send({ token, password: 'BrandNew99' }).expect(204);
    await api().post(`${V1}/auth/reset-password`).send({ token, password: 'BrandNew98' }).expect(400);

    // Old access token and refresh cookie no longer work.
    await api().get(`${V1}/me`).set(user.auth).expect(401);
    await api().post(`${V1}/auth/refresh`).set('Cookie', user.cookie).set('X-Requested-With', 'fetch').expect(401);
    await api().post(`${V1}/auth/login`).send({ email: user.email, password: 'BrandNew99' }).expect(200);
  });
});

describe('authorization', () => {
  it('requires a token and the right permission', async () => {
    const customer = await makeUser();
    const admin = await makeUser('admin');
    await api().get(`${V1}/cart`).expect(401);
    await api().get(`${V1}/admin/dashboard`).set(customer.auth).expect(403);
    await api().get(`${V1}/admin/orders`).set(customer.auth).expect(403);
    await api().get(`${V1}/admin/dashboard`).set(admin.auth).expect(200);
  });

  it('keeps one customer out of another customer\'s data', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const addr = await api()
      .post(`${V1}/me/addresses`)
      .set(a.auth)
      .send({ fullName: 'Alice A', phone: '9876543210', line1: '1 Lane', city: 'Pune', state: 'Maharashtra', postalCode: '411001' })
      .expect(201);
    await api().patch(`${V1}/me/addresses/${addr.body.data.id}`).set(b.auth).send({ city: 'Hacked' }).expect(404);
    await api().delete(`${V1}/me/addresses/${addr.body.data.id}`).set(b.auth).expect(404);
  });

  it('blocks a customer immediately, including existing tokens', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser();
    await api().get(`${V1}/me`).set(customer.auth).expect(200);
    await api().patch(`${V1}/admin/customers/${customer.id}`).set(admin.auth).send({ status: 'blocked' }).expect(200);
    await api().get(`${V1}/me`).set(customer.auth).expect(401);
    const login = await api().post(`${V1}/auth/login`).send({ email: customer.email, password: 'Passw0rd!x' }).expect(403);
    expect(login.body.error.code).toBe('ACCOUNT_BLOCKED');
    // Admins cannot be blocked through this endpoint, and cannot block themselves.
    await api().patch(`${V1}/admin/customers/${admin.id}`).set(admin.auth).send({ status: 'blocked' }).expect(403);
  });
});
