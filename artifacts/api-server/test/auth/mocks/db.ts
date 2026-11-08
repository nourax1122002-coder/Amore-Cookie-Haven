type AuthResponse = { data: any; error: any };
type MockOutputs = {
  signIn: AuthResponse;
  signUp: AuthResponse;
  resend: AuthResponse;
  recovery: AuthResponse;
  getUser: AuthResponse;
  setSession: AuthResponse;
  refreshSession: AuthResponse;
  signOut: AuthResponse;
};

const emptyResponse = (): AuthResponse => ({ data: { user: null, session: null }, error: null });
const outputs: MockOutputs = {
  signIn: emptyResponse(),
  signUp: emptyResponse(),
  resend: emptyResponse(),
  recovery: emptyResponse(),
  getUser: emptyResponse(),
  setSession: emptyResponse(),
  refreshSession: emptyResponse(),
  signOut: { data: {}, error: null },
};

export const authCalls = {
  signIn: [] as Array<{ email: string; password: string }>,
  signUp: [] as Array<{ email: string; password: string; options?: Record<string, unknown> }>,
  resend: [] as Array<{ type: string; email: string; options?: Record<string, unknown> }>,
  recovery: [] as Array<{ email: string; options?: Record<string, unknown> }>,
  getUser: [] as string[],
  setSession: [] as Array<{ access_token: string; refresh_token: string }>,
  refreshSession: [] as Array<{ refresh_token: string }>,
  signOut: [] as Array<{ scope?: string }>,
  profiles: [] as Array<{ userId: string; email: string; displayName: string; role: string }>,
};

export function resetAuthMock() {
  for (const values of Object.values(authCalls)) values.length = 0;
  Object.assign(outputs, {
    signIn: emptyResponse(),
    signUp: emptyResponse(),
    resend: emptyResponse(),
    recovery: emptyResponse(),
    getUser: emptyResponse(),
    setSession: emptyResponse(),
    refreshSession: emptyResponse(),
    signOut: { data: {}, error: null },
  });
}

export function setAuthMockOutput(name: keyof MockOutputs, response: AuthResponse) {
  outputs[name] = response;
}

export function createSupabaseAuthClient() {
  return {
    auth: {
      signInWithPassword: async (input: { email: string; password: string }) => {
        authCalls.signIn.push(input);
        return outputs.signIn;
      },
      signUp: async (input: { email: string; password: string; options?: Record<string, unknown> }) => {
        authCalls.signUp.push(input);
        return outputs.signUp;
      },
      resend: async (input: { type: string; email: string; options?: Record<string, unknown> }) => {
        authCalls.resend.push(input);
        return outputs.resend;
      },
      resetPasswordForEmail: async (email: string, options?: Record<string, unknown>) => {
        authCalls.recovery.push({ email, options });
        return outputs.recovery;
      },
      getUser: async (token: string) => {
        authCalls.getUser.push(token);
        return outputs.getUser;
      },
      setSession: async (input: { access_token: string; refresh_token: string }) => {
        authCalls.setSession.push(input);
        return outputs.setSession;
      },
      refreshSession: async (input: { refresh_token: string }) => {
        authCalls.refreshSession.push(input);
        return outputs.refreshSession;
      },
      signOut: async (input: { scope?: string }) => {
        authCalls.signOut.push(input);
        return outputs.signOut;
      },
    },
  };
}

export async function saveUserProfile(input: { userId: string; email: string; displayName: string; role: string }) {
  authCalls.profiles.push(input);
  return { ...input, createdAt: new Date(0), updatedAt: new Date(0) };
}
