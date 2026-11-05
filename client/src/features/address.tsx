import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { INDIAN_STATES, addressSchema, type Address } from '@shop/shared';
import { Button, Checkbox, Input, Select } from '../components/ui';
import { ApiError, api, errorMessage } from '../services/api';
import { toast } from '../store/local';
import { keys } from './hooks';

export function AddressForm({ address, onDone, onCancel }: { address?: Address; onDone: (a: Address) => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const form = useForm({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      label: address?.label ?? 'Home',
      fullName: address?.fullName ?? '',
      phone: address?.phone?.replace('+91', '') ?? '',
      line1: address?.line1 ?? '',
      line2: address?.line2 ?? '',
      landmark: address?.landmark ?? '',
      city: address?.city ?? '',
      state: address?.state ?? ('' as never),
      postalCode: address?.postalCode ?? '',
      isDefault: address?.isDefault ?? false,
    },
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      address ? api.patch<Address>(`/me/addresses/${address.id}`, body) : api.post<Address>('/me/addresses', body),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: keys.addresses });
      toast.success(address ? 'Address updated' : 'Address saved');
      onDone(a);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        for (const [path, message] of Object.entries(e.fieldErrors())) form.setError(path as never, { message });
      }
      toast.error(errorMessage(e));
    },
  });
  const err = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Input label="Full name" autoComplete="name" {...form.register('fullName')} error={err.fullName?.message} />
      <Input label="Mobile number" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" {...form.register('phone')} error={err.phone?.message} />
      <Input className="sm:col-span-2" label="Address line 1" autoComplete="address-line1" placeholder="House no., street" {...form.register('line1')} error={err.line1?.message} />
      <Input className="sm:col-span-2" label="Address line 2 (optional)" autoComplete="address-line2" {...form.register('line2')} error={err.line2?.message} />
      <Input label="Landmark (optional)" {...form.register('landmark')} error={err.landmark?.message} />
      <Input label="City" autoComplete="address-level2" {...form.register('city')} error={err.city?.message} />
      <Select label="State" {...form.register('state')} error={err.state?.message}>
        <option value="">Choose a state</option>
        {INDIAN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <Input label="PIN code" inputMode="numeric" autoComplete="postal-code" maxLength={6} {...form.register('postalCode')} error={err.postalCode?.message} />
      <Input label="Label (optional)" placeholder="Home, Work…" {...form.register('label')} error={err.label?.message} />
      <div className="flex items-end pb-2">
        <Checkbox label="Make this my default address" {...form.register('isDefault')} />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={save.isPending}>
          Save address
        </Button>
      </div>
    </form>
  );
}

export function AddressLines({ a }: { a: Omit<Address, 'id' | 'isDefault'> }) {
  return (
    <address className="text-sm not-italic leading-relaxed text-stone-600">
      <span className="font-medium text-stone-900">{a.fullName}</span>
      <br />
      {a.line1}
      {a.line2 ? `, ${a.line2}` : ''}
      {a.landmark ? ` (near ${a.landmark})` : ''}
      <br />
      {a.city}, {a.state} {a.postalCode}
      <br />
      {a.phone}
    </address>
  );
}
