import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { safeEqual } from '@/lib/safe-equal';

/**
 * AUTH-FAIL-CLOSED-V1
 *
 * The previous authorize() compared `credentials?.username` against
 * `process.env.AUTH_USERNAME` with `===`. When neither env var is set — the
 * state a fresh deploy is in until someone fills them in — both sides are
 * `undefined` for a request that simply omits the fields, so
 * `undefined === undefined` returned true and NextAuth issued a valid
 * session. Reproduced locally: POST to /api/auth/callback/credentials with
 * only a csrfToken returned a signed-in session, and that cookie then got
 * 200s from /api/settings and /contacts which 307 without it.
 *
 * Two changes close it:
 *   - refuse to authenticate at all unless BOTH env vars are non-empty, so
 *     a misconfigured deploy is locked rather than wide open;
 *   - coerce the submitted values to strings and compare in constant time,
 *     so a missing field can never be type-equal to a missing secret.
 */
const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!AUTH_USERNAME || !AUTH_PASSWORD) {
          // Deliberately loud: this is a deployment fault, and the symptom
          // (nobody can log in) is far better than the alternative.
          console.error(
            '[auth] AUTH_USERNAME and/or AUTH_PASSWORD are not set — refusing all sign-in attempts.'
          );
          return null;
        }

        const username = typeof credentials?.username === 'string' ? credentials.username : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!username || !password) return null;

        const validUser = safeEqual(username, AUTH_USERNAME);
        const validPass = safeEqual(password, AUTH_PASSWORD);
        if (validUser && validPass) {
          return { id: '1', name: 'Roam Admin', email: 'admin@roamlocal.app' };
        }
        return null;
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: '/login' },
});

export { handler as GET, handler as POST };
