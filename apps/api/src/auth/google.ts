import { OAuth2Client } from 'google-auth-library';
import { env, googleOAuthConfigured } from '../env.js';

let _client: OAuth2Client | null = null;

export function googleClient(): OAuth2Client {
  if (!googleOAuthConfigured) throw new Error('google_oauth_not_configured');
  if (!_client) {
    _client = new OAuth2Client(
      env.GOOGLE_OAUTH_CLIENT_ID,
      env.GOOGLE_OAUTH_CLIENT_SECRET,
      env.OAUTH_REDIRECT_URL,
    );
  }
  return _client;
}

export const GOOGLE_LOGIN_SCOPES = ['openid', 'email', 'profile'];

export function buildConsentUrl(state: string): string {
  return googleClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_LOGIN_SCOPES,
    state,
  });
}

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
};

export async function exchangeCodeForProfile(
  code: string,
): Promise<{ profile: GoogleProfile; tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null } }> {
  const client = googleClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new Error('no_id_token');
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_OAUTH_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p || !p.sub || !p.email) throw new Error('invalid_id_token');
  return {
    profile: {
      sub: p.sub,
      email: p.email,
      name: p.name ?? p.email,
      picture: p.picture,
      emailVerified: p.email_verified === true,
    },
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    },
  };
}
