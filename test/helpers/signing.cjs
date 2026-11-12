// Deliberately fake test-only credentials, not valid tokens or production secrets.
const fakeSigningSecret = 'FAKE-TEST-ONLY-signing-secret-00000000';
const fakeUserId = '00000000-0000-0000-0000-000000000001';
const fakeJwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: fakeUserId })).toString('base64url')}.FAKE-test-signature`;
const fakeAuthorization = `Bearer ${fakeJwt}`;
module.exports = { fakeSigningSecret, fakeUserId, fakeJwt, fakeAuthorization };
