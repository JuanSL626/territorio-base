/// <reference types="vite/client" />

// Declaration merging with Vite's own `ImportMetaEnv`. Narrows the two
// Supabase browser vars (see `.env.example`) from Vite's `any` fallback to
// `string`, so `~/lib/supabase/client` doesn't need a runtime cast.
// Must be `interface`, not `type`: only interfaces merge across declarations,
// which is the entire mechanism this relies on.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}
