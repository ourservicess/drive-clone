import { z } from 'zod';

// IDs are MongoDB ObjectIds: exactly 24 hex characters. Anything else is
// rejected with 400 before it reaches the database.
export const idSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const idParam = z.object({ id: idSchema });

// ---------- auth ----------
export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')).pipe(z.string().max(254)),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Password is required').max(128),
});

// ---------- listing / sorting ----------
export const sortSchema = z.object({
  sort: z.enum(['name', 'date', 'size']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type SortOptions = z.infer<typeof sortSchema>;

export const listFilesQuery = sortSchema.extend({
  folderId: idSchema.optional(), // missing = top level of My Drive
});

export const listFoldersQuery = sortSchema.extend({
  parentId: idSchema.optional(),
});

export const searchQuery = z.object({
  q: z.string().trim().min(1, 'Search text is required').max(100),
});

// ---------- files ----------
const nameField = z.string().min(1, 'Name is required').max(255, 'Name is too long');

export const updateFileSchema = z
  .object({
    name: nameField.optional(),
    folderId: idSchema.nullable().optional(), // null = move to top level
  })
  .refine((v) => v.name !== undefined || v.folderId !== undefined, {
    message: 'Provide a new name or a destination folder',
  });

export const starSchema = z.object({ starred: z.boolean() });

// ---------- folders ----------
export const createFolderSchema = z.object({
  name: nameField,
  parentId: idSchema.nullable().optional(),
});

export const updateFolderSchema = z
  .object({
    name: nameField.optional(),
    parentId: idSchema.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, {
    message: 'Provide a new name or a destination folder',
  });
