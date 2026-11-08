import { supabase } from '../lib/supabase'

// Thin ergonomic accessor so components can `const { supabase } = useSupabase()`.
export function useSupabase() {
  return { supabase }
}
