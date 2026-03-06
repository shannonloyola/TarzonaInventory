import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

type RequestResetBody = {
  action: "request_reset";
  email?: string;
  origin?: string;
};

type ResetPasswordBody = {
  action: "reset_password";
  token?: string;
  newPassword?: string;
};

type IncomingBody = RequestResetBody | ResetPasswordBody;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function buildResetLink(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const randomHex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${crypto.randomUUID()}-${randomHex}`;
}

async function sendResetEmail(to: string, link: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!apiKey || !from) {
    throw new Error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Tarzona Inventory Password Reset",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
          <h2 style="margin:0 0 12px;">Reset your password</h2>
          <p style="margin:0 0 16px;">Click the button below to reset your account password.</p>
          <p style="margin:0 0 16px;">
            <a href="${link}" style="background:#8B2E2E;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;display:inline-block;">
              Reset Password
            </a>
          </p>
          <p style="margin:0;color:#6B7280;font-size:12px;">This link expires in 15 minutes.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to send email: ${message}`);
  }
}

async function handleRequestReset(
  supabase: ReturnType<typeof createClient>,
  body: RequestResetBody,
): Promise<Response> {
  const email = String(body.email || "").trim().toLowerCase();
  const appOrigin = String(body.origin || Deno.env.get("APP_BASE_URL") || "").trim();

  if (!email || !EMAIL_REGEX.test(email)) {
    return jsonResponse({ error: "Valid email is required." }, 400);
  }
  if (!appOrigin) {
    return jsonResponse({ error: "Missing application origin/base URL." }, 400);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  // Prevent user enumeration: return success even when email does not exist.
  if (!profile?.id) {
    return jsonResponse({ ok: true });
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("profile_id, is_active")
    .eq("profile_id", profile.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!account?.profile_id) {
    return jsonResponse({ ok: true });
  }

  const rawToken = generateSecureToken();
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error: insertError } = await supabase.from("password_reset_tokens").insert({
    profile_id: profile.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
    used_at: null,
  });

  if (insertError) {
    console.error("Failed to insert password reset token:", insertError);
    return jsonResponse({ error: "Failed to create reset token." }, 500);
  }

  const resetLink = buildResetLink(appOrigin, rawToken);
  try {
    await sendResetEmail(email, resetLink);
  } catch (err) {
    console.error("Failed to send reset email:", err);
    return jsonResponse({ error: "Failed to send reset email." }, 500);
  }

  return jsonResponse({ ok: true });
}

async function handleResetPassword(
  supabase: ReturnType<typeof createClient>,
  body: ResetPasswordBody,
): Promise<Response> {
  const token = String(body.token || "").trim();
  const newPassword = String(body.newPassword || "");

  if (!token) return jsonResponse({ error: "Token is required." }, 400);
  if (newPassword.length < 6) {
    return jsonResponse({ error: "Password must be at least 6 characters." }, 400);
  }

  const nowIso = new Date().toISOString();
  const { data: candidates, error: tokenLoadError } = await supabase
    .from("password_reset_tokens")
    .select("id, profile_id, token_hash, expires_at, used_at")
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(100);

  if (tokenLoadError) {
    console.error("Failed loading reset tokens:", tokenLoadError);
    return jsonResponse({ error: "Failed to verify reset token." }, 500);
  }

  const matchedToken = (candidates || []).find((row) =>
    bcrypt.compareSync(token, String((row as { token_hash?: unknown }).token_hash || "")),
  ) as
    | {
        id: string;
        profile_id: string;
      }
    | undefined;

  if (!matchedToken) {
    return jsonResponse({ error: "Invalid or expired token." }, 400);
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const { error: updatePasswordError } = await supabase
    .from("user_accounts")
    .update({ password_hash: newHash })
    .eq("profile_id", matchedToken.profile_id)
    .eq("is_active", true);

  if (updatePasswordError) {
    console.error("Failed updating password hash:", updatePasswordError);
    return jsonResponse({ error: "Failed to update password." }, 500);
  }

  const { error: markUsedError } = await supabase
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matchedToken.id);

  if (markUsedError) {
    console.error("Failed marking reset token used:", markUsedError);
    return jsonResponse({ error: "Failed to finalize password reset." }, 500);
  }

  return jsonResponse({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase server environment variables." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (body.action === "request_reset") {
    return handleRequestReset(supabase, body);
  }

  if (body.action === "reset_password") {
    return handleResetPassword(supabase, body);
  }

  return jsonResponse({ error: "Unsupported action." }, 400);
});

