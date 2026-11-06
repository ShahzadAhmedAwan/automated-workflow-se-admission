if (process.env.AUTH_INTEGRATION === '1') {
  await import('./auth.integration.test.js');
} else {
  await import('./auth.integration.test.js');
  await import('./auth.security.test.js');
  await import('./auth.critical.test.js');
  await import('./auth.mocked-service.test.js');
  await import('./marketing.test.js');
  await import('./verification.test.js');
}
