import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Inbox, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { changePasswordSchema, updateProfileSchema, type Address, type AuthResult, type DemoEmail, type PublicUser } from '@shop/shared';
import { Badge, Button, ButtonLink, Card, Checkbox, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton, cx, useDocumentTitle } from '../components/ui';
import { AddressForm, AddressLines } from '../features/address';
import { keys, useAddresses } from '../features/hooks';
import { formatDateTime } from '../lib/format';
import { ApiError, api, errorMessage, qs } from '../services/api';
import { toast } from '../store/local';
import { useSession } from '../store/session';

const TABS = [
  ['profile', 'Profile'],
  ['addresses', 'Addresses'],
  ['security', 'Password'],
] as const;

export function AccountPage() {
  useDocumentTitle('Your account');
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'profile') as (typeof TABS)[number][0];
  return (
    <div className="container-page py-8">
      <PageHeader title="Your account" subtitle={<><Link to="/orders" className="text-brand-700 hover:underline">View your orders</Link></>} />
      <div className="mb-6 flex gap-1 border-b border-stone-200" role="tablist">
        {TABS.map(([id, text]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id })} className={cx('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === id ? 'border-brand-700 text-brand-800' : 'border-transparent text-stone-500 hover:text-stone-800')}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'profile' && <ProfileTab />}
      {tab === 'addresses' && <AddressesTab />}
      {tab === 'security' && <PasswordTab />}
    </div>
  );
}

function ProfileTab() {
  const user = useSession((s) => s.user)!;
  const form = useForm({ resolver: zodResolver(updateProfileSchema), defaultValues: { name: user.name, phone: user.phone?.replace('+91', '') ?? '' } });
  const save = useMutation({
    mutationFn: (v: { name?: string; phone?: string }) => api.patch<PublicUser>('/me', v),
    onSuccess: (u) => {
      const token = useSession.getState().accessToken!;
      useSession.getState().setSession(u, token);
      toast.success('Profile saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="max-w-xl p-6">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Input label="Email" value={user.email} disabled hint="Email cannot be changed in this demo." />
        <Input label="Full name" {...form.register('name')} error={form.formState.errors.name?.message} />
        <Input label="Mobile number" inputMode="tel" {...form.register('phone')} error={form.formState.errors.phone?.message} />
        <Button type="submit" loading={save.isPending}>Save changes</Button>
      </form>
    </Card>
  );
}

function AddressesTab() {
  const addresses = useAddresses();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/me/addresses/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.addresses });
      toast.success('Address removed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api.post(`/me/addresses/${id}/default`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.addresses }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add address</Button>
      </div>
      {addresses.isPending ? (
        <Skeleton className="h-32" />
      ) : addresses.isError ? (
        <ErrorState error={addresses.error} onRetry={() => addresses.refetch()} />
      ) : addresses.data.length === 0 ? (
        <EmptyState icon={<MapPin className="size-10" />} title="No saved addresses">Add one now to check out faster.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {addresses.data.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="mb-2 flex gap-2">
                {a.label && <Badge>{a.label}</Badge>}
                {a.isDefault && <Badge tone="brand">Default</Badge>}
              </div>
              <AddressLines a={a} />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(a)}>Edit</Button>
                {!a.isDefault && <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(a.id)}>Make default</Button>}
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => remove.mutate(a.id)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add address' : 'Edit address'} size="lg">
        {editing !== null && <AddressForm address={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function PasswordTab() {
  const form = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '' } });
  const save = useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) => api.post<AuthResult>('/me/password', v),
    onSuccess: (r) => {
      useSession.getState().setSession(r.user, r.accessToken);
      form.reset();
      toast.success('Password changed. Other devices have been signed out.');
    },
    onError: (e) => {
      if (e instanceof ApiError) for (const [k, m] of Object.entries(e.fieldErrors())) form.setError(k as never, { message: m });
      toast.error(errorMessage(e));
    },
  });
  return (
    <Card className="max-w-xl p-6">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Input label="Current password" type="password" autoComplete="current-password" {...form.register('currentPassword')} error={form.formState.errors.currentPassword?.message} />
        <Input label="New password" type="password" autoComplete="new-password" hint="At least 8 characters with a letter and a number." {...form.register('newPassword')} error={form.formState.errors.newPassword?.message} />
        <Button type="submit" loading={save.isPending}>Change password</Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- demo inbox

export function DemoInboxPage() {
  useDocumentTitle('Demo inbox');
  const user = useSession((s) => s.user);
  const [mine, setMine] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const email = mine && user ? user.email : undefined;
  const mails = useQuery({ queryKey: ['inbox', email], queryFn: () => api.get<DemoEmail[]>(`/demo/inbox${qs({ email })}`), refetchInterval: 4000 });
  return (
    <div className="container-page py-8">
      <PageHeader
        title="Demo inbox"
        subtitle="In this demo, emails are delivered here instead of to a real mailbox: order confirmations, shipping updates, refunds and password resets."
        actions={user && <Checkbox label="Only my emails" checked={mine} onChange={(e) => setMine(e.target.checked)} />}
      />
      {mails.isError ? (
        <ErrorState error={mails.error} onRetry={() => mails.refetch()} />
      ) : mails.isPending ? (
        <Skeleton className="h-48" />
      ) : mails.data.length === 0 ? (
        <EmptyState icon={<Inbox className="size-10" />} title="No emails yet">Place an order or request a password reset to see one arrive.</EmptyState>
      ) : (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {mails.data.map((m) => (
            <li key={m.id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-stone-900">{m.subject}</span>
                  <span className="block truncate text-xs text-stone-500">To {m.to}</span>
                </span>
                <span className="shrink-0 text-xs text-stone-500">{formatDateTime(m.createdAt)}</span>
              </button>
              {open === m.id && <EmailBody text={m.text} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmailBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <div className="whitespace-pre-wrap border-t border-stone-100 bg-stone-50 px-4 py-4 text-sm text-stone-700">
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{part}</span>;
        // Links to this store open in-app; anything else is shown as plain text.
        const url = new URL(part);
        return url.origin === window.location.origin ? (
          <a key={i} href={url.pathname + url.search + url.hash} className="font-medium text-brand-700 underline">{part}</a>
        ) : (
          <span key={i} className="text-stone-500">{part}</span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- static pages & 404

const PAGES: Record<string, { title: string; body: string[] }> = {
  about: {
    title: 'About this demo',
    body: [
      'Storefront Demo is a complete, working online store built to show how e-commerce works end to end: catalog and search, cart and wishlist, checkout, online payment, Cash on Delivery, order tracking, reviews, coupons and an admin dashboard.',
      'Payments go through DemoPay, a built-in gateway that behaves like a real one (orders, signed callbacks, webhooks, refunds) but only moves virtual money.',
      'Sign in as the demo admin (admin@demo.store / Admin@1234) to manage products, stock, orders, customers and coupons, and to see sales analytics.',
    ],
  },
  shipping: { title: 'Shipping', body: ['We deliver across India. Shipping is ₹49, and free on orders of ₹999 or more after discounts.', 'In this demo, shipping and tracking are updated by the store admin from the dashboard.'] },
  returns: {
    title: 'Cancellations & refunds',
    body: [
      'You can cancel an order yourself until it starts being packed. Online payments are refunded in full automatically.',
      'If a payment reaches us after an order has expired or was cancelled, it is refunded automatically too.',
      'Returns after delivery are not part of this demo.',
    ],
  },
  privacy: { title: 'Privacy', body: ['This demo stores only what it needs to run: your name, email, addresses and orders. Passwords are stored as salted bcrypt hashes. Nothing is shared with anyone.'] },
  terms: { title: 'Terms', body: ['This is a demonstration store. Products, prices, payments and deliveries are not real, and no contract of sale is formed.'] },
  contact: { title: 'Contact', body: ['Questions about the demo? Write to support@storefront.demo (not a real mailbox).'] },
};

export function StaticPage() {
  const { slug = '' } = useParams();
  const page = PAGES[slug];
  useDocumentTitle(page?.title ?? 'Not found');
  if (!page) return <NotFoundPage />;
  return (
    <div className="container-page max-w-3xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
      <div className="mt-6 space-y-4 text-stone-700">{page.body.map((p, i) => <p key={i}>{p}</p>)}</div>
    </div>
  );
}

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="container-page py-16">
      <EmptyState title="We could not find that page" action={<ButtonLink to="/">Go to the home page</ButtonLink>}>The link may be broken, or the page may have moved.</EmptyState>
    </div>
  );
}
