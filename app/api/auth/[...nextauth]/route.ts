import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const validUser = credentials?.username === process.env.AUTH_USERNAME;
        const validPass = credentials?.password === process.env.AUTH_PASSWORD;
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
