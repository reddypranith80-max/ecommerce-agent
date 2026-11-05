import { useEffect, useState } from 'react';
import { Banknote, CircleCheck, CircleX, CreditCard, Landmark, LoaderCircle, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import type { Order, PaymentInit } from '@shop/shared';
import { Alert, Badge, Button, Modal, cx } from '../components/ui';
import { countdown, formatINR, useNow } from '../lib/format';
import { ApiError, api, errorMessage } from '../services/api';

type Method = 'upi' | 'card' | 'netbanking' | 'wallet';
type StepState = 'todo' | 'doing' | 'done' | 'failed';

const METHODS: { id: Method; label: string; icon: typeof Smartphone; detail: string }[] = [
  { id: 'upi', label: 'UPI', icon: Smartphone, detail: 'Test UPI ID: success@demopay' },
  { id: 'card', label: 'Card', icon: CreditCard, detail: 'Test card 4111 1111 1111 1111 · 12/30 · CVV 123' },
  { id: 'netbanking', label: 'Netbanking', icon: Landmark, detail: 'Test bank: DemoPay Bank' },
  { id: 'wallet', label: 'Wallet', icon: Wallet, detail: 'Test wallet balance: ₹1,00,000 (virtual)' },
];

interface Props {
  open: boolean;
  orderNumber: string;
  payment: PaymentInit;
  storeName: string;
  onClose: () => void;
  onPaid: (order: Order) => void;
  /** Payment captured but the browser "closed" before reporting it: only the webhook will confirm. */
  onClosedEarly: () => void;
}

/**
 * Stands in for a hosted payment page (like Razorpay Checkout). It talks to the simulated gateway,
 * then hands the signed result to the store, which verifies it server-side before confirming anything.
 */
export function DemoPayCheckout({ open, orderNumber, payment, storeName, onClose, onPaid, onClosedEarly }: Props) {
  const [method, setMethod] = useState<Method>('upi');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[]>(['todo', 'todo', 'todo', 'todo']);
  const now = useNow();
  const msLeft = new Date(payment.windowEndsAt).getTime() - now;

  useEffect(() => {
    if (open) {
      setSteps(['todo', 'todo', 'todo', 'todo']);
      setError(null);
    }
  }, [open]);

  const mark = (i: number, s: StepState) => setSteps((prev) => prev.map((x, j) => (j === i ? s : x)));

  async function pay(outcome: 'success' | 'failure' | 'success_close') {
    setBusy(true);
    setError(null);
    setSteps(['doing', 'todo', 'todo', 'todo']);
    try {
      const res = await api.post<{ closed: boolean; gatewayOrderId?: string; gatewayPaymentId?: string; signature?: string }>(
        `/demopay/checkout/${payment.gatewayOrderId}/pay`,
        { method, outcome },
      );
      mark(0, 'done');
      if (res.closed) {
        mark(1, 'failed');
        await new Promise((r) => setTimeout(r, 900));
        onClosedEarly();
        return;
      }
      mark(1, 'doing');
      await new Promise((r) => setTimeout(r, 400));
      mark(1, 'done');
      mark(2, 'doing');
      const order = await api.post<Order>('/payments/verify', {
        orderNumber,
        gatewayOrderId: res.gatewayOrderId,
        gatewayPaymentId: res.gatewayPaymentId,
        signature: res.signature,
      });
      mark(2, 'done');
      mark(3, order.status === 'confirmed' ? 'done' : 'failed');
      await new Promise((r) => setTimeout(r, 700));
      onPaid(order);
    } catch (e) {
      setSteps((prev) => prev.map((s) => (s === 'doing' ? 'failed' : s)));
      setError(e instanceof ApiError && e.code === 'PAYMENT_DECLINED' ? 'The (simulated) bank declined this payment. Nothing was charged — try again.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const stepLabels = [
    `DemoPay captures ${formatINR(payment.amount)} (virtual money)`,
    'Browser sends the signed result to the store',
    'Store checks the signature and asks DemoPay directly',
    'Order confirmed · reserved stock becomes allocated',
  ];

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Complete your payment" size="lg">
      <div className="grid gap-5 md:grid-cols-[1fr_240px]">
        <div>
          <div className="flex items-center justify-between rounded-xl bg-indigo-950 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-indigo-300" />
              <div>
                <p className="text-sm font-semibold">DemoPay</p>
                <p className="text-xs text-indigo-200">Paying {storeName}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">{formatINR(payment.amount)}</p>
              <Badge tone="amber">TEST MODE</Badge>
            </div>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Virtual money only. Pay within <span className={cx('font-semibold', msLeft < 120_000 ? 'text-rose-600' : 'text-stone-700')}>{countdown(msLeft)}</span> — the items are held for you until then.
          </p>

          <div className="mt-4 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Payment method">
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={method === m.id}
                onClick={() => setMethod(m.id)}
                className={cx('flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium', method === m.id ? 'border-indigo-600 bg-indigo-50 text-indigo-800' : 'border-stone-200 hover:bg-stone-50')}
              >
                <m.icon className="size-5" />
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">{METHODS.find((m) => m.id === method)!.detail}</p>

          {error && <Alert tone="error" className="mt-3">{error}</Alert>}

          <div className="mt-4 grid gap-2">
            <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700" loading={busy} onClick={() => pay('success')} icon={<Banknote className="size-4" />}>
              Pay {formatINR(payment.amount)}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => pay('failure')}>
                Simulate a decline
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => pay('success_close')}>
                Pay &amp; close the tab
              </Button>
            </div>
          </div>
        </div>

        <aside className="rounded-xl border border-stone-200 bg-stone-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">What happens behind the scenes</p>
          <ol className="mt-3 space-y-3">
            {stepLabels.map((text, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5">
                  {steps[i] === 'done' ? (
                    <CircleCheck className="size-4 text-emerald-600" />
                  ) : steps[i] === 'doing' ? (
                    <LoaderCircle className="size-4 animate-spin text-indigo-600" />
                  ) : steps[i] === 'failed' ? (
                    <CircleX className="size-4 text-rose-500" />
                  ) : (
                    <span className="block size-4 rounded-full border-2 border-stone-300" />
                  )}
                </span>
                <span className={cx(steps[i] === 'todo' ? 'text-stone-400' : 'text-stone-700')}>{text}</span>
              </li>
            ))}
          </ol>
          {steps[1] === 'failed' && steps[0] === 'done' && (
            <p className="mt-3 text-xs text-stone-600">The browser never reported back. The store will learn about the payment from DemoPay’s signed webhook instead.</p>
          )}
        </aside>
      </div>
    </Modal>
  );
}
