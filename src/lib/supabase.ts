export type SupabaseEnvironment = {
  url?: string;
  publishableKey?: string;
  isConfigured: boolean;
};

export function getSupabaseEnvironment(): SupabaseEnvironment {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  return {
    url,
    publishableKey,
    isConfigured: Boolean(url && publishableKey),
  };
}
