(() => {
  if (!window.OCDesktop || !window.OCAuth) return;
  const auth = window.OCAuth;
  function returnTo() {
    if (!location.pathname.includes('/auth/')) auth.setReturnTo(location.href);
    else if (!localStorage.getItem('oc_auth_return_to')) auth.setReturnTo('/openconstruction-web/account.html');
  }
  auth.signInWithProvider = async provider => {
    returnTo();
    const redirectTo = await window.OCDesktop.prepareSignIn();
    const result = await auth.getClient().auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true, scopes: provider === 'github' ? 'read:user user:email' : undefined } });
    if (!result.error && result.data?.url) await window.OCDesktop.openSignIn(result.data.url);
    return result;
  };
  auth.signInWithEmail = async (email, captchaToken = '') => {
    returnTo();
    const emailRedirectTo = await window.OCDesktop.prepareSignIn();
    return auth.getClient().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo, shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}) } });
  };
  auth.linkIdentity = async () => {
    await window.OCDesktop.openExternal('https://www.openconstruction.org/account.html#linked-identities');
    return { data: {}, error: null };
  };
})();
