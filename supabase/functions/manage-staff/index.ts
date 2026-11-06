// manage-staff: the only way people and codes are changed.
//
// Creating an auth user, or changing anyone's password, needs the service role
// key. That key must never be in the page or the repository, so those actions
// live here, where it is an environment variable the platform supplies. The page
// calls this with the signed-in person's own token, and this refuses anyone who
// is not an active Manager.
//
// Actions (POST JSON {action, ...}):
//   list                                    -> {people:[{login,name,role,active,facilities,last_sign_in}]}
//   codes                                   -> {access, editing}          when each shared code was last changed
//   add        {name, role, facilities[]}   -> {login, code}          code is shown once
//   update     {login, name?, role?, facilities?}
//   reset_code {login}                      -> {code}                 shown once
//   remove     {login}                      signs them out at once; their history stays
//   restore    {login}
//   set_access_code  {code}                 the shared code on the login page
//   set_editing_code {code}                 the shared editing code
//
// Codes it generates are 10 characters from an alphabet with nothing easy to
// misread (no 0/O, 1/l/I), and are returned once and not stored anywhere but as
// the auth system's own hash.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DOMAIN = "@staff.conwayarena.local";
const SHARED_EMAIL = "operations@conwayarena.local";
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function makeCode(len = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// "Dana Reyes" -> "dana-reyes-k3x": readable in the audit trail, unique, and a
// valid email local part.
function makeLogin(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "person";
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  return `${slug}-${tail}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Who is calling, and are they a Manager? The platform has already checked the
  // token is genuine; this checks it belongs to someone entitled to do this.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return reply(401, { error: "Sign in first." });
  const { data: role } = await admin.rpc("admin_role_of", { p_user: who.user.id });
  if (role !== "management") return reply(403, { error: "Only Management can do this." });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: "Send JSON." }); }

  const fail = (status: number, error: string) => reply(status, { error });
  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x).map(String) : [];

  try {
    switch (b.action) {
      case "list": {
        const { data, error } = await admin.rpc("admin_list_staff");
        if (error) throw error;
        return reply(200, { people: data });
      }

      case "codes": {
        const { data, error } = await admin.rpc("admin_code_times");
        if (error) throw error;
        return reply(200, data);             // {access, editing}: when each was last changed, or null
      }

      case "add": {
        const name = String(b.name ?? "").trim();
        const role = b.role === "management" ? "management" : "staff";
        if (!name) return fail(400, "A name is needed.");
        const login = makeLogin(name), code = makeCode();
        const { data: made, error: mkErr } = await admin.auth.admin.createUser({
          email: login + DOMAIN, password: code, email_confirm: true,
        });
        if (mkErr || !made?.user) return fail(500, "Could not create the sign-in: " + (mkErr?.message ?? "unknown"));
        const { error } = await admin.rpc("admin_save_staff", {
          p_user: made.user.id, p_login: login, p_name: name, p_role: role, p_facilities: asList(b.facilities),
        });
        if (error) {                                   // do not leave a login with no person behind it
          await admin.auth.admin.deleteUser(made.user.id);
          throw error;
        }
        return reply(200, { login, code });
      }

      case "update": {
        const login = String(b.login ?? "");
        const { data: uid } = await admin.rpc("admin_user_of", { p_login: login });
        if (!uid) return fail(404, "No such person.");
        const { data: all } = await admin.rpc("admin_list_staff");
        const cur = (all as any[]).find((p) => p.login === login);
        const role = b.role === undefined ? cur.role : (b.role === "management" ? "management" : "staff");
        // Never leave the building with no Manager.
        if (cur.role === "management" && role !== "management" &&
            (all as any[]).filter((p) => p.role === "management" && p.active).length <= 1)
          return fail(409, "That would leave no Manager.");
        const { error } = await admin.rpc("admin_save_staff", {
          p_user: uid, p_login: login,
          p_name: b.name === undefined ? cur.name : String(b.name).trim() || cur.name,
          p_role: role,
          p_facilities: b.facilities === undefined ? cur.facilities : asList(b.facilities),
        });
        if (error) throw error;
        return reply(200, { ok: true });
      }

      case "reset_code": {
        const { data: uid } = await admin.rpc("admin_user_of", { p_login: String(b.login ?? "") });
        if (!uid) return fail(404, "No such person.");
        const code = makeCode();
        const { error } = await admin.auth.admin.updateUserById(uid as string, { password: code });
        if (error) throw error;
        return reply(200, { code });
      }

      case "remove":
      case "restore": {
        const login = String(b.login ?? ""), removing = b.action === "remove";
        const { data: uid } = await admin.rpc("admin_user_of", { p_login: login });
        if (!uid) return fail(404, "No such person.");
        if (removing && uid === who.user.id) return fail(409, "You cannot remove yourself.");
        if (removing) {
          const { data: all } = await admin.rpc("admin_list_staff");
          const left = (all as any[]).filter((p) => p.role === "management" && p.active && p.login !== login);
          const target = (all as any[]).find((p) => p.login === login);
          if (target?.role === "management" && left.length === 0) return fail(409, "That would leave no Manager.");
        }
        // Closing the sign-in as well as the staff row is what makes the device
        // find out: a refresh for a banned user is refused, and the client treats
        // that as "signed out".
        const { error: banErr } = await admin.auth.admin.updateUserById(uid as string, {
          ban_duration: removing ? "876000h" : "none",
        });
        if (banErr) throw banErr;
        const { error } = await admin.rpc("admin_set_active", { p_login: login, p_active: !removing });
        if (error) throw error;
        return reply(200, { ok: true });
      }

      case "set_access_code": {
        const code = String(b.code ?? "");
        if (code.length < 8) return fail(400, "The access code needs at least 8 characters.");
        const { data: uid } = await admin.rpc("admin_user_id", { p_email: SHARED_EMAIL });
        if (!uid) return fail(500, "The shared account was not found.");
        const { error } = await admin.auth.admin.updateUserById(uid as string, { password: code });
        if (error) throw error;
        await admin.rpc("admin_note_access_code");
        return reply(200, { ok: true });     // every device is asked again, within the hour
      }

      case "set_editing_code": {
        const code = String(b.code ?? "");
        if (code.length < 8) return fail(400, "The editing code needs at least 8 characters.");
        const { error } = await admin.rpc("admin_set_editing_code", { p_code: code });
        if (error) throw error;
        return reply(200, { ok: true });     // and everyone's open window ends with the old code
      }

      default:
        return fail(400, "Unknown action.");
    }
  } catch (e) {
    console.error("manage-staff", b.action, (e as Error).message);
    return fail(500, "That did not work. " + ((e as Error).message ?? ""));
  }
});
