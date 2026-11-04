if (process.env.AUTH_INTEGRATION === '1') {
  await import('./auth.integration.test.js');
} else {
  await import('./auth.integration.test.js');
  await import('./auth.security.test.js');
}
