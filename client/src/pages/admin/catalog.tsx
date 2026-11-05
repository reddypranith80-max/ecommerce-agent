import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { PRODUCT_STATUSES, type AdminProduct, type AdminProductRow, type CategoryNode, type MediaUpload, type PageMeta } from '@shop/shared';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
  useDocumentTitle,
} from '../../components/ui';
import { formatDate, formatINR, label, paiseToRupees, rupeesToPaise, useDebounced } from '../../lib/format';
import { ApiError, api, errorMessage, qs, request } from '../../services/api';
import { toast } from '../../store/local';

const STATUS_TONE = { draft: 'amber', active: 'green', archived: 'stone' } as const;
const STOCK_TONE = { in_stock: 'green', low_stock: 'amber', out_of_stock: 'red' } as const;

export function useAdminCategories() {
  return useQuery({ queryKey: ['admin', 'categories'], queryFn: () => api.get<CategoryNode[]>('/admin/categories') });
}

export function flattenCategories(nodes: CategoryNode[] = [], depth = 0): { id: string; name: string; depth: number; node: CategoryNode }[] {
  return nodes.flatMap((n) => [{ id: n.id, name: n.name, depth, node: n }, ...flattenCategories(n.children, depth + 1)]);
}

// ---------------------------------------------------------------- product list

export function AdminProducts() {
  useDocumentTitle('Products');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounced(q, 300);
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  useEffect(() => {
    if (debounced !== (params.get('q') ?? '')) setParams((p) => { const n = new URLSearchParams(p); debounced ? n.set('q', debounced) : n.delete('q'); n.delete('page'); return n; });
  }, [debounced, params, setParams]);
  const list = useQuery({
    queryKey: ['admin', 'products', { q: debounced, status, page }],
    queryFn: () => request<{ data: AdminProductRow[]; meta: PageMeta }>(`/admin/products${qs({ q: debounced, status, page })}`),
  });
  return (
    <div>
      <PageHeader title="Products" actions={<ButtonLink to="/admin/products/new"><Plus className="size-4" /> New product</ButtonLink>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="w-full sm:w-72" placeholder="Search name, brand or exact SKU" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Status" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-96" />
      ) : list.data.data.length === 0 ? (
        <EmptyState title="No products found" action={<ButtonLink to="/admin/products/new">Create a product</ButtonLink>}>Try another search or create a product.</EmptyState>
      ) : (
        <>
          <Table>
            <thead><tr><Th>Product</Th><Th>Category</Th><Th>Price</Th><Th>Stock</Th><Th>Status</Th><Th>Updated</Th><Th /></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {list.data.data.map((p) => (
                <tr key={p.id} className="hover:bg-stone-50">
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="size-10 shrink-0 overflow-hidden rounded-md bg-stone-100">{p.imageUrl && <img src={p.imageUrl} alt="" className="size-full object-cover" />}</div>
                      <div><Link to={`/admin/products/${p.id}`} className="font-medium hover:text-brand-700">{p.name}</Link><p className="text-xs text-stone-500">{p.variantCount} variants</p></div>
                    </div>
                  </Td>
                  <Td>{p.categoryName}</Td>
                  <Td className="whitespace-nowrap">{p.priceMin === p.priceMax ? formatINR(p.priceMin) : `${formatINR(p.priceMin)} – ${formatINR(p.priceMax)}`}</Td>
                  <Td><Badge tone={STOCK_TONE[p.stockStatus]}>{p.totalAvailable} available</Badge></Td>
                  <Td><Badge tone={STATUS_TONE[p.status]}>{label(p.status)}</Badge></Td>
                  <Td className="text-stone-500">{formatDate(p.updatedAt)}</Td>
                  <Td><Link to={`/admin/products/${p.id}`} className="text-brand-700" aria-label={`Edit ${p.name}`}><Pencil className="size-4" /></Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={list.data.meta} onPage={(n) => setParams((p) => { const x = new URLSearchParams(p); x.set('page', String(n)); return x; })} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- product editor

interface VariantRow {
  id?: string;
  sku: string;
  optionValues: Record<string, string>;
  price: string;
  compareAt: string;
  isActive: boolean;
  initialStock: string;
  lowStockThreshold: string;
  available?: number;
  reserved?: number;
  allocated?: number;
}
interface OptionRow { name: string; values: string }
interface ImageRow { mediaId: string; thumbUrl: string; alt: string }
interface Draft {
  name: string; slug: string; brand: string; categoryId: string; status: AdminProduct['status']; isFeatured: boolean;
  description: string; tags: string; hsnCode: string; gstRate: string; options: OptionRow[]; variants: VariantRow[]; images: ImageRow[];
}

const emptyDraft: Draft = {
  name: '', slug: '', brand: '', categoryId: '', status: 'draft', isFeatured: false, description: '', tags: '', hsnCode: '', gstRate: '',
  options: [{ name: 'Size', values: 'S, M, L' }],
  variants: [],
  images: [],
};

function fromProduct(p: AdminProduct): Draft {
  return {
    name: p.name, slug: p.slug, brand: p.brand ?? '', categoryId: p.categoryId, status: p.status, isFeatured: p.isFeatured,
    description: p.description, tags: p.tags.join(', '), hsnCode: p.hsnCode ?? '', gstRate: p.gstRate?.toString() ?? '',
    options: p.options.map((o) => ({ name: o.name, values: o.values.join(', ') })),
    variants: p.variants.map((v) => ({
      id: v.id, sku: v.sku, optionValues: v.optionValues, price: paiseToRupees(v.price), compareAt: v.compareAtPrice ? paiseToRupees(v.compareAtPrice) : '',
      isActive: v.isActive, initialStock: '', lowStockThreshold: String(v.lowStockThreshold), available: v.available, reserved: v.reserved, allocated: v.allocated,
    })),
    images: p.images.map((i) => ({ mediaId: i.mediaId, thumbUrl: i.thumbUrl, alt: i.alt })),
  };
}

const splitValues = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];

function combos(options: OptionRow[]): Record<string, string>[] {
  const valid = options.filter((o) => o.name.trim() && splitValues(o.values).length);
  if (valid.length === 0) return [{}];
  return valid.reduce<Record<string, string>[]>(
    (acc, o) => acc.flatMap((c) => splitValues(o.values).map((v) => ({ ...c, [o.name.trim()]: v }))),
    [{}],
  );
}

export function AdminProductEdit() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const categories = useAdminCategories();
  const product = useQuery({ queryKey: ['admin', 'product', id], queryFn: () => api.get<AdminProduct>(`/admin/products/${id}`), enabled: !isNew });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  useDocumentTitle(isNew ? 'New product' : (product.data?.name ?? 'Edit product'));

  useEffect(() => {
    if (product.data) setDraft(fromProduct(product.data));
  }, [product.data]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setVariant = (i: number, patch: Partial<VariantRow>) => setDraft((d) => ({ ...d, variants: d.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));

  const generate = () => {
    const prefix = (draft.name || 'SKU').split(/\s+/).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'SKU';
    const base = draft.variants[0];
    const next = combos(draft.options).map((ov) => {
      const existing = draft.variants.find((v) => JSON.stringify(v.optionValues) === JSON.stringify(ov));
      if (existing) return existing;
      const suffix = Object.values(ov).map((x) => x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)).join('-');
      return { sku: `${prefix}-${suffix || 'STD'}`, optionValues: ov, price: base?.price ?? '', compareAt: base?.compareAt ?? '', isActive: true, initialStock: '10', lowStockThreshold: '5' };
    });
    set('variants', next);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).slice(0, 10).forEach((f) => fd.append('files', f));
    setUploading(true);
    try {
      const res = await request<{ data: MediaUpload[] }>('/admin/media', { method: 'POST', body: fd });
      setDraft((d) => ({ ...d, images: [...d.images, ...res.data.map((m) => ({ mediaId: m.id, thumbUrl: m.thumbUrl, alt: '' }))].slice(0, 10) }));
      toast.success(`${res.data.length} image(s) uploaded`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const moveImage = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const imgs = [...d.images];
      const j = i + dir;
      if (j < 0 || j >= imgs.length) return d;
      [imgs[i], imgs[j]] = [imgs[j]!, imgs[i]!];
      return { ...d, images: imgs };
    });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: draft.name,
        ...(draft.slug ? { slug: draft.slug } : {}),
        description: draft.description,
        ...(draft.brand ? { brand: draft.brand } : {}),
        tags: splitValues(draft.tags.toLowerCase()),
        categoryId: draft.categoryId,
        status: draft.status,
        isFeatured: draft.isFeatured,
        options: draft.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), values: splitValues(o.values) })),
        variants: draft.variants.map((v) => ({
          ...(v.id ? { id: v.id } : {}),
          sku: v.sku,
          optionValues: v.optionValues,
          price: rupeesToPaise(v.price || 0),
          compareAtPrice: v.compareAt ? rupeesToPaise(v.compareAt) : null,
          isActive: v.isActive,
          ...(!v.id ? { initialStock: Number(v.initialStock || 0) } : {}),
          lowStockThreshold: Number(v.lowStockThreshold || 5),
        })),
        images: draft.images.map((i) => ({ mediaId: i.mediaId, alt: i.alt })),
        ...(draft.hsnCode ? { hsnCode: draft.hsnCode } : {}),
        ...(draft.gstRate ? { gstRate: Number(draft.gstRate) } : {}),
      };
      return isNew ? api.post<{ id: string }>('/admin/products', body) : api.patch<{ id: string }>(`/admin/products/${id}`, { ...body, version: product.data!.version });
    },
    onSuccess: (res) => {
      toast.success('Product saved');
      setErrors([]);
      void qc.invalidateQueries({ queryKey: ['admin'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      if (isNew) navigate(`/admin/products/${res.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && Array.isArray(e.details)) setErrors((e.details as { path: string; message: string }[]).map((d) => `${d.path || 'product'}: ${d.message}`));
      else setErrors([errorMessage(e)]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/admin/products/${id}`),
    onSuccess: () => {
      toast.success('Product deleted');
      void qc.invalidateQueries({ queryKey: ['admin'] });
      navigate('/admin/products');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const flat = useMemo(() => flattenCategories(categories.data), [categories.data]);
  if (!isNew && product.isPending) return <Skeleton className="h-96" />;
  if (!isNew && product.isError) return <ErrorState error={product.error} onRetry={() => product.refetch()} />;

  return (
    <div className="max-w-5xl">
      <Link to="/admin/products" className="mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-brand-700"><ArrowLeft className="size-4" /> Products</Link>
      <PageHeader
        title={isNew ? 'New product' : draft.name || 'Edit product'}
        subtitle={!isNew && product.data?.everOrdered ? 'This product has been ordered: variants can be deactivated but not removed, and it can be archived but not deleted.' : undefined}
        actions={
          <>
            {!isNew && draft.slug && draft.status === 'active' && <ButtonLink to={`/p/${draft.slug}`} variant="outline">View in store</ButtonLink>}
            {!isNew && !product.data?.everOrdered && <Button variant="outline" icon={<Trash2 className="size-4" />} loading={remove.isPending} onClick={() => confirm('Delete this product permanently?') && remove.mutate()}>Delete</Button>}
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save product</Button>
          </>
        }
      />
      {errors.length > 0 && (
        <Alert tone="error" className="mb-4">
          <ul className="list-inside list-disc">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <Input label="Name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            <Textarea label="Description" rows={5} value={draft.description} onChange={(e) => set('description', e.target.value)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Brand" value={draft.brand} onChange={(e) => set('brand', e.target.value)} />
              <Input label="URL slug" hint="Leave empty to generate from the name." value={draft.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} />
              <Input label="Tags" hint="Comma separated" value={draft.tags} onChange={(e) => set('tags', e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <Input label="HSN code" value={draft.hsnCode} onChange={(e) => set('hsnCode', e.target.value)} />
                <Input label="GST %" type="number" value={draft.gstRate} onChange={(e) => set('gstRate', e.target.value)} />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Images</h2>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-50">
                <ImagePlus className="size-4" /> {uploading ? 'Uploading…' : 'Upload images'}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="sr-only" disabled={uploading} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
              </label>
            </div>
            {draft.images.length === 0 ? (
              <p className="text-sm text-stone-500">No images yet. JPEG, PNG, WebP or AVIF up to 5 MB; they are resized and converted to WebP.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {draft.images.map((img, i) => (
                  <div key={img.mediaId} className="rounded-lg border border-stone-200 p-2">
                    <div className="relative">
                      <img src={img.thumbUrl} alt="" className="aspect-square w-full rounded-md object-cover" />
                      {i === 0 && <Badge tone="brand" className="absolute left-1 top-1">Main</Badge>}
                      <button className="absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow" aria-label="Remove image" onClick={() => set('images', draft.images.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
                    </div>
                    <input className="mt-2 w-full rounded border border-stone-200 px-2 py-1 text-xs" placeholder="Alt text" value={img.alt} onChange={(e) => set('images', draft.images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} />
                    <div className="mt-1 flex justify-between">
                      <button onClick={() => moveImage(i, -1)} disabled={i === 0} aria-label="Move left" className="p-1 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
                      <button onClick={() => moveImage(i, 1)} disabled={i === draft.images.length - 1} aria-label="Move right" className="p-1 disabled:opacity-30"><ChevronRight className="size-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 font-semibold">Options & variants</h2>
            <p className="mb-4 text-sm text-stone-500">Define up to 3 options (e.g. Size, Colour), then generate one variant per combination. Prices are in rupees.</p>
            <div className="space-y-2">
              {draft.options.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="w-36" aria-label="Option name" placeholder="Size" value={o.name} onChange={(e) => set('options', draft.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Input className="flex-1" aria-label="Option values" placeholder="S, M, L" value={o.values} onChange={(e) => set('options', draft.options.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
                  <Button variant="ghost" aria-label="Remove option" onClick={() => set('options', draft.options.filter((_, j) => j !== i))}><X className="size-4" /></Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {draft.options.length < 3 && <Button variant="outline" size="sm" icon={<Plus className="size-4" />} onClick={() => set('options', [...draft.options, { name: '', values: '' }])}>Add option</Button>}
              <Button variant="secondary" size="sm" onClick={generate}>Generate variants</Button>
            </div>

            {draft.variants.length > 0 && (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-stone-500">
                      <th className="py-2 pr-2">Variant</th><th className="pr-2">SKU</th><th className="pr-2">Price ₹</th><th className="pr-2">MRP ₹</th><th className="pr-2">Stock</th><th className="pr-2">Low at</th><th className="pr-2">Active</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.variants.map((v, i) => (
                      <tr key={v.id ?? v.sku + i} className="border-t border-stone-100">
                        <td className="py-2 pr-2 whitespace-nowrap">{Object.values(v.optionValues).join(' / ') || 'Default'}</td>
                        <td className="pr-2"><input className="w-36 rounded border border-stone-300 px-2 py-1 disabled:bg-stone-50" value={v.sku} disabled={Boolean(v.id)} onChange={(e) => setVariant(i, { sku: e.target.value.toUpperCase() })} aria-label="SKU" /></td>
                        <td className="pr-2"><input className="w-24 rounded border border-stone-300 px-2 py-1" type="number" min={1} value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} aria-label="Price" /></td>
                        <td className="pr-2"><input className="w-24 rounded border border-stone-300 px-2 py-1" type="number" min={0} value={v.compareAt} onChange={(e) => setVariant(i, { compareAt: e.target.value })} aria-label="Compare-at price" /></td>
                        <td className="pr-2 whitespace-nowrap">
                          {v.id ? (
                            <Link to={`/admin/inventory?q=${encodeURIComponent(v.sku)}`} className="text-brand-700 hover:underline">{v.available} avail.{v.reserved ? ` · ${v.reserved} held` : ''}</Link>
                          ) : (
                            <input className="w-20 rounded border border-stone-300 px-2 py-1" type="number" min={0} value={v.initialStock} onChange={(e) => setVariant(i, { initialStock: e.target.value })} aria-label="Opening stock" />
                          )}
                        </td>
                        <td className="pr-2"><input className="w-16 rounded border border-stone-300 px-2 py-1" type="number" min={0} value={v.lowStockThreshold} onChange={(e) => setVariant(i, { lowStockThreshold: e.target.value })} aria-label="Low stock threshold" /></td>
                        <td className="pr-2"><input type="checkbox" className="accent-brand-700" checked={v.isActive} onChange={(e) => setVariant(i, { isActive: e.target.checked })} aria-label="Active" /></td>
                        <td>{(!v.id || !product.data?.everOrdered) && <button onClick={() => set('variants', draft.variants.filter((_, j) => j !== i))} aria-label="Remove variant" className="p-1 text-stone-500"><Trash2 className="size-4" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <Select label="Status" value={draft.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
              {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
            <Select label="Category" value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Choose a category</option>
              {flat.map((c) => <option key={c.id} value={c.id}>{'— '.repeat(c.depth)}{c.name}</option>)}
            </Select>
            <Checkbox label="Feature on the home page" checked={draft.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} />
          </Card>
          <Alert tone="info">Stock for existing variants is changed on the <Link to="/admin/inventory" className="underline">Inventory</Link> page, so every change is recorded with a reason.</Alert>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- categories

export function AdminCategories() {
  useDocumentTitle('Categories');
  const qc = useQueryClient();
  const tree = useAdminCategories();
  const [editing, setEditing] = useState<CategoryNode | { parentId: string | null } | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', parentId: '', description: '', sortOrder: '0', isActive: true });
  const isEdit = editing !== null && 'id' in editing;

  useEffect(() => {
    if (!editing) return;
    if ('id' in editing) setForm({ name: editing.name, slug: editing.slug, parentId: editing.parentId ?? '', description: editing.description ?? '', sortOrder: String(editing.sortOrder), isActive: editing.isActive });
    else setForm({ name: '', slug: '', parentId: editing.parentId ?? '', description: '', sortOrder: '0', isActive: true });
  }, [editing]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, ...(form.slug ? { slug: form.slug } : {}), parentId: form.parentId || null, description: form.description, sortOrder: Number(form.sortOrder || 0), isActive: form.isActive };
      return isEdit ? api.patch(`/admin/categories/${(editing as CategoryNode).id}`, { ...body, version: (editing as CategoryNode).version ?? 0 }) : api.post('/admin/categories', body);
    },
    onSuccess: () => {
      toast.success('Category saved');
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/categories/${id}`),
    onSuccess: () => {
      toast.success('Category deleted');
      void qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const flat = flattenCategories(tree.data);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Categories" subtitle="Up to three levels. Categories with products or subcategories cannot be deleted or moved." actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing({ parentId: null })}>New category</Button>} />
      {tree.isError ? (
        <ErrorState error={tree.error} onRetry={() => tree.refetch()} />
      ) : tree.isPending ? (
        <Skeleton className="h-64" />
      ) : (
        <Card className="divide-y divide-stone-100">
          {flat.map(({ id, name, depth, node }) => (
            <div key={id} className="flex items-center gap-2 px-4 py-3" style={{ paddingLeft: `${16 + depth * 24}px` }}>
              <span className="flex-1 text-sm font-medium">{name} <span className="text-xs font-normal text-stone-400">/{node.slug}</span></span>
              {!node.isActive && <Badge>Hidden</Badge>}
              {depth < 2 && <Button size="sm" variant="ghost" onClick={() => setEditing({ parentId: id })}>+ Sub</Button>}
              <Button size="sm" variant="ghost" onClick={() => setEditing(node)} aria-label={`Edit ${name}`}><Pencil className="size-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => confirm(`Delete ${name}?`) && remove.mutate(id)} aria-label={`Delete ${name}`}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </Card>
      )}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={isEdit ? 'Edit category' : 'New category'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}
      >
        <div className="space-y-3">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Slug" hint="Leave empty to generate from the name." value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
          <Select label="Parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
            <option value="">None (top level)</option>
            {flat.filter((c) => c.depth < 2 && (!isEdit || c.id !== (editing as CategoryNode).id)).map((c) => <option key={c.id} value={c.id}>{'— '.repeat(c.depth)}{c.name}</option>)}
          </Select>
          <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label="Sort order" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          <Checkbox label="Visible in the store" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
        </div>
      </Modal>
    </div>
  );
}
