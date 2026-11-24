# Engineering rules
Use public window.toy APIs only. Explicit mock injection only; never silently mock production. Treat client data as untrusted. Do not log user identifiers or credentials. Preserve stable upstream metadata; no vendor JS redistribution. Run build/tests before promotion. Real-device verification is separate from CI.
