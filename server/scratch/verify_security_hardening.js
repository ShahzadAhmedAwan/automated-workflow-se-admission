import assert from 'node:assert/strict';
import { StorageService } from '../src/modules/verification/services/storage/storage.service.js';
import { encryptAtRest, decryptAtRest } from '../src/core/security/tokens.js';
import { SeetScraperService } from '../src/modules/merit/services/seet-scraper.service.js';
import { createApp } from '../src/app.js';

console.log('--- RUNNING SECURITY HARDENING VERIFICATION ---');

// 1. Path Traversal Tests
console.log('\n[1] Testing Path Traversal Defense in StorageService...');
const traversalAttacks = [
  '../../.env',
  '../../../etc/passwd',
  '..\\..\\windows\\win.ini',
  'uploads/../../../.env',
  'uploads/student_1/../../../../package.json',
  'uploads/\0student/doc.jpg',
  '/absolute/path/file.txt',
  'C:\\windows\\system32',
];

for (const attack of traversalAttacks) {
  assert.throws(
    () => StorageService._resolveLocalPath(attack),
    (err) => {
      assert.ok(err instanceof Error);
      return true;
    },
    `Expected attack '${attack}' to be blocked by StorageService._resolveLocalPath`
  );
}
console.log('✓ All 8 path traversal and null byte attack vectors blocked successfully.');

// Valid relative path should resolve safely within allowed base
const validKey = 'uploads/student_9999/matric_test.pdf';
const resolved = StorageService._resolveLocalPath(validKey);
assert.ok(resolved.includes('uploads'), 'Resolved path should include uploads');
assert.ok(!resolved.includes('..'), 'Resolved path must not contain .. traversal');
console.log('✓ Valid storage key resolves strictly inside safe directory.');

// 2. Encryption at Rest Tests
console.log('\n[2] Testing AES-256-GCM At-Rest Token Encryption & Decryption...');
const testToken = '4f8b91c2e3a54d6789abcdef0123456789abcdef0123456789abcdef01234567';
const encrypted = encryptAtRest(testToken);
assert.notEqual(encrypted, testToken, 'Encrypted token must not equal raw plaintext');
assert.equal(encrypted.split(':').length, 3, 'Encrypted format must be iv:tag:ciphertext');

const decrypted = decryptAtRest(encrypted);
assert.equal(decrypted, testToken, 'Decrypted token must exactly match original plaintext');

// Tampering detection
const parts = encrypted.split(':');
const tamperedCiphertext = parts[0] + ':' + parts[1] + ':' + parts[2].slice(0, -2) + '00';
const tamperedResult = decryptAtRest(tamperedCiphertext);
assert.equal(tamperedResult, null, 'Tampered ciphertext must fail authentication and return null');

// Legacy backwards compatibility (unencrypted string)
const legacy = 'legacy-plain-token-12345';
assert.equal(decryptAtRest(legacy), legacy, 'Legacy plaintext token should pass through safely');
console.log('✓ AES-256-GCM field encryption, decryption, MAC verification, and legacy compatibility verified.');

// 3. SSRF Protection Tests
console.log('\n[3] Testing SEET Scraper SSRF Protection...');
const ssrfAttacks = [
  'http://169.254.169.254/latest/meta-data/',
  'https://169.254.169.254/secret',
  'https://evil-attacker.com/malicious.php',
  'https://subdomain.attacker.com/steal?token=123',
  'ftp://seet.must.edu.pk/files',
  'javascript:alert(1)',
];

for (const attack of ssrfAttacks) {
  assert.throws(
    () => SeetScraperService.validateTargetUrl(attack),
    (err) => {
      assert.ok(err instanceof Error);
      return true;
    },
    `Expected SSRF target '${attack}' to be rejected.`
  );
}
console.log('✓ All 6 SSRF, cloud metadata, and untrusted host attacks blocked.');

// Valid university host
const validUrl = 'https://seet.must.edu.pk/seet_result.php';
const accepted = SeetScraperService.validateTargetUrl(validUrl);
assert.equal(accepted, validUrl, 'Official SEET university URL must be accepted');
console.log('✓ Official university domain accepted correctly.');

// 4. HTTP App Security & Redirect Token Sanitization
console.log('\n[4] Testing Express App Public Link Sanitization...');
import http from 'node:http';

const app = createApp();
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

try {
  // Test malicious tokens in /u/:token
  const badRedirectTokens = [
    '..%2fevil',
    'foo%2fbar',
    'token%0d%0aSet-Cookie:evil=1',
    '%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    'short',
  ];

  for (const badToken of badRedirectTokens) {
    const res = await fetch(`${baseUrl}/u/${badToken}`, { redirect: 'manual' });
    assert.equal(res.status, 400, `Expected 400 for bad token '${badToken}', got ${res.status}`);
  }
  console.log('✓ Invalid and malicious redirect tokens strictly rejected with 400 Bad Request.');

  const goodToken = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const goodRes = await fetch(`${baseUrl}/u/${goodToken}`, { redirect: 'manual' });
  assert.equal(goodRes.status, 302, 'Valid token must trigger 302 redirect');
  assert.ok(goodRes.headers.get('location').includes(goodToken), 'Redirect must point to safe origin with token');
  console.log('✓ Valid token successfully redirects to official upload URL.');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('\n========================================');
console.log(' ALL SECURITY HARDENING TESTS PASSED!');
console.log('========================================');
