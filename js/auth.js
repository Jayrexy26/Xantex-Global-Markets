async function createProfileIfNotExists(user) {
  const supabase = window._supabaseClient;

  // check if profile exists
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!existing) {
    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email,
      balance: 0
    });
  }
}