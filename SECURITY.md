# Security

Report a vulnerability privately through GitHub's "Report a vulnerability" button on this
repository's Security tab. You will get a reply within two days.

What this server guarantees, and its tests check: HTTPS only, to the hosts listed under
`factory.allowHosts` in `package.json`, re-checked on every redirect; response size caps and
deadlines; retries only for reads; bounded tool inputs; error messages that never contain upstream
bodies, keys or query strings; exact-pinned dependencies with a shrinkwrap for every install path.
Releases are published from CI with npm provenance, and the Claude Desktop bundle carries a
Sigstore build-provenance attestation.
