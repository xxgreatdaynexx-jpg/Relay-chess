import type { IMemoryDb } from 'pg-mem';

/** pg-mem has no built-ins for these; the production SQL still uses the real Postgres functions. */
export function registerPgAdvisoryFunctions(db: IMemoryDb) {
  db.public.registerFunction({ name: 'hashtext', args: ['text' as never], returns: 'int' as never, implementation: (s: string) => {
    let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h;
  } });
  db.public.registerFunction({ name: 'pg_advisory_lock', args: ['int' as never], returns: 'text' as never, implementation: () => null });
  db.public.registerFunction({ name: 'pg_advisory_unlock', args: ['int' as never], returns: 'bool' as never, implementation: () => true });
}
