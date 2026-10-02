  emailInput.required = !isUpdatePassword;
  passwordInput.required = true;
  passwordInput.autocomplete = isSignUp || isUpdatePassword ? 'new-password' : 'current-password';
  confirmInput.required = isSignUp || isUpdatePassword;

  // Clear stale password values whenever auth mode changes
  passwordInput.value = '';
  confirmInput.value = '';

  emailInput.focus();