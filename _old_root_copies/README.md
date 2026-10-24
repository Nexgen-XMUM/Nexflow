# Old root-level copies (moved 2026-10-25)

These files used to sit in the repository root. Nothing in the running app,
the launchers or the test suites imports or serves them. The live versions are:

| Old copy | Live file |
|---|---|
| router.py, repository.py | backend/blind_boxes/ |
| customer.js, customer.html, customers.css, intergration.css | frontend/ (customer.js, customer.css, integration.css, index.html#customer) |
| test_fronted.py.old | backend/tests/test_frontend.py |
| loyalty_account.jason | — (misspelled extension, unused) |

Kept rather than deleted so nothing is lost; safe to remove after the hackathon.
