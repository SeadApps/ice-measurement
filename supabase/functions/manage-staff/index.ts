// manage-staff: the only way people and codes are changed.
//
// Creating an auth user, or changing anyone's password, needs the service role
// key. That key must never be in the page or the repository, so those actions
// live here, where it is an environment variable the platform supplies. The page
// calls this with the signed-in person's own token, and this refuses anyone who
// is not an active Admin or Manager.
//
// Three roles. An Admin may do everything below. A Manager may list, add, change, reset,
// remove and restore STAFF who are in their own facilities, and nothing else: no
// Managers or Admins, no shared codes, and nobody who also belongs to a facility that is
// not theirs. (A server that has not yet moved on still calls an Admin "management".)
//
// Actions (POST JSON {action, ...}):
//   list                                    -> {people:[{login,name,role,active,facilities,last_sign_in,editable}]}
//   codes                                   -> {access, editing}          when each shared code was last changed   (Admin)
//   add        {name, role, facilities[]}   -> {login, code}          code is shown once
//   update     {login, name?, role?, facilities?}
//   reset_code {login}                      -> {code}                 shown once
//   remove     {login}                      signs them out at once; their history stays
//   restore    {login}
//   set_access_code  {code}                 the shared code on the login page                                       (Admin)
//   set_editing_code {code}                 the shared editing code                                                 (Admin)
//
// Codes it generates are 10 characters from an alphabet with nothing easy to
// misread (no 0/O, 1/l/I), and are returned once and not stored anywhere but as
// the auth system's own hash.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DOMAIN = "@staff.conwayarena.local";
const SHARED_EMAIL = "operations@conwayarena.local";
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROLES = ["admin", "manager", "staff"];

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

  // Who is calling, and are they an Admin or a Manager? The platform has already checked the
  // token is genuine; this checks it belongs to someone entitled to do this.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return reply(401, { error: "Sign in first." });
  const { data: rawRole } = await admin.rpc("admin_role_of", { p_user: who.user.id });
  const role = rawRole === "management" ? "admin" : (rawRole as string | null);   // an older server's name for an Admin
  if (role !== "admin" && role !== "manager") return reply(403, { error: "Only Managers and Admins can do this." });
  const isAdmin = role === "admin";

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: "Send JSON." }); }

  const fail = (status: number, error: string) => reply(status, { error });
  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x).map(String) : [];
  const roleOf = (p: any): string => (p.role === "management" ? "admin" : p.role);   // tolerate the older name

  try {
    // Everybody, once: it is how a Manager's own facilities are known, and what every Manager rule is judged against.
    const { data: everyone, error: listErr } = await admin.rpc("admin_list_staff");
    if (listErr) throw listErr;
    const all = (everyone as any[]).map((p) => ({ ...p, rawRole: p.role, role: roleOf(p) }));      // rawRole: what the table says, sent back unchanged
    const meLogin = (who.user.email ?? "").toLowerCase().replace(DOMAIN, "");
    const me = all.find((p) => p.login === meLogin);
    const mine: string[] = isAdmin ? [] : (me?.facilities ?? []);

    // A Manager sees Staff who hold at least one of their facilities, and changes only those who hold nothing else.
    const seen = (p: any) => isAdmin || (p.role === "staff" && (p.facilities as string[]).some((f) => mine.includes(f)));
    const editable = (p: any) =>
      isAdmin || (p.role === "staff" && (p.facilities as string[]).length > 0 && (p.facilities as string[]).every((f) => mine.includes(f)));
    const admins = () => all.filter((p) => p.role === "admin" && p.active);
    const adminOnly = () => (isAdmin ? null : fail(403, "Only an Admin can do this."));
    // The one place a Manager's limits on facilities are checked, for add and for update.
    const facilitiesAllowed = (facs: string[]) => {
      if (isAdmin) return null;
      if (!facs.length) return fail(400, "Pick at least one of your facilities.");
      if (!facs.every((f) => mine.includes(f))) return fail(403, "You can only give people your own facilities.");
      return null;
    };
    const target = () => {
      const p = all.find((x) => x.login === String(b.login ?? ""));
      if (!p || !seen(p)) return { err: fail(404, "No such person.") };
      if (!editable(p)) return { err: fail(403, "You can only change people who are in your own facilities.") };
      return { p };
    };

    switch (b.action) {
      case "list": {
        const people = all.filter(seen).map(({ rawRole, ...p }) => ({ ...p, editable: editable(p) }));
        return reply(200, { people });
      }

      case "codes": {
        const no = adminOnly(); if (no) return no;
        const { data, error } = await admin.rpc("admin_code_times");
        if (error) throw error;
        return reply(200, data);             // {access, editing}: when each was last changed, or null
      }

      case "add": {
        const name = String(b.name ?? "").trim();
        const newRole = ROLES.includes(String(b.role)) ? String(b.role) : "staff";
        if (!name) return fail(400, "A name is needed.");
        if (!isAdmin && newRole !== "staff") return fail(403, "Only an Admin can add a Manager or an Admin.");
        const facs = asList(b.facilities);
        const no = facilitiesAllowed(facs); if (no) return no;
        const login = makeLogin(name), code = makeCode();
        const { data: made, error: mkErr } = await admin.auth.admin.createUser({
          email: login + DOMAIN, password: code, email_confirm: true,
        });
        if (mkErr || !made?.user) return fail(500, "Could not create the sign-in: " + (mkErr?.message ?? "unknown"));
        const { error } = await admin.rpc("admin_save_staff", {
          p_user: made.user.id, p_login: login, p_name: name, p_role: newRole, p_facilities: newRole === "admin" ? [] : facs,
        });
        if (error) {                                   // do not leave a login with no person behind it
          await admin.auth.admin.deleteUser(made.user.id);
          throw error;
        }
        return reply(200, { login, code });
      }

      case "update": {
        const t = target(); if (t.err) return t.err;
        const cur = t.p;
        const { data: uid } = await admin.rpc("admin_user_of", { p_login: cur.login });
        if (!uid) return fail(404, "No such person.");
        const newRole = b.role === undefined ? cur.role : (ROLES.includes(String(b.role)) ? String(b.role) : "staff");
        if (!isAdmin && newRole !== cur.role) return fail(403, "Only an Admin can change a role.");
        // Never leave the building with no Admin.
        if (cur.role === "admin" && newRole !== "admin" && admins().length <= 1) return fail(409, "That would leave no Admin.");
        const facs = b.facilities === undefined ? (cur.facilities as string[]) : asList(b.facilities);
        if (b.facilities !== undefined) { const no = facilitiesAllowed(facs); if (no) return no; }
        const { error } = await admin.rpc("admin_save_staff", {
          p_user: uid, p_login: cur.login,
          p_name: b.name === undefined ? cur.name : String(b.name).trim() || cur.name,
          p_role: newRole === cur.role ? cur.rawRole : newRole,        // an unchanged role goes back as the table spells it
          p_facilities: newRole === "admin" ? [] : facs,
        });
        if (error) throw error;
        return reply(200, { ok: true });
      }

      case "reset_code": {
        const t = target(); if (t.err) return t.err;
        const { data: uid } = await admin.rpc("admin_user_of", { p_login: t.p.login });
        if (!uid) return fail(404, "No such person.");
        const code = makeCode();
        const { error } = await admin.auth.admin.updateUserById(uid as string, { password: code });
        if (error) throw error;
        return reply(200, { code });
      }

      case "remove":
      case "restore": {
        const t = target(); if (t.err) return t.err;
        const removing = b.action === "remove";
        const { data: uid } = await admin.rpc("admin_user_of", { p_login: t.p.login });
        if (!uid) return fail(404, "No such person.");
        if (removing && uid === who.user.id) return fail(409, "You cannot remove yourself.");
        if (removing && t.p.role === "admin" && admins().filter((p) => p.login !== t.p.login).length === 0)
          return fail(409, "That would leave no Admin.");
        // Closing the sign-in as well as the staff row is what makes the device
        // find out: a refresh for a banned user is refused, and the client treats
        // that as "signed out".
        const { error: banErr } = await admin.auth.admin.updateUserById(uid as string, {
          ban_duration: removing ? "876000h" : "none",
        });
        if (banErr) throw banErr;
        const { error } = await admin.rpc("admin_set_active", { p_login: t.p.login, p_active: !removing });
        if (error) throw error;
        return reply(200, { ok: true });
      }

      case "set_access_code": {
        const no = adminOnly(); if (no) return no;
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
        const no = adminOnly(); if (no) return no;
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
