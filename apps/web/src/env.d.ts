/// <reference types="vite/client" />

// Narrows the two Supabase browser vars (see `.env.example`) from Vite's
// `any` fallback to `string`, so `~/lib/supabase/client` needs no runtime
// cast. Must be `interface`, not `type`: only interfaces merge across
// declarations, which is the mechanism this relies on.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}
