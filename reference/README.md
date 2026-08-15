# reference/ — third-party protocol data

## grills.json

`grills.json` is a **verbatim, unmodified** copy of the control-board specification from the
[`pytboss`](https://github.com/dknowles2/pytboss) project, used to cross-check our
independently-observed frame decoding.

- **Source:** https://github.com/dknowles2/pytboss (`pytboss/grills.json`)
- **License:** Apache License 2.0 — © the pytboss authors. See the pytboss `LICENSE`.
- **Modifications:** none.

This file is redistributed under the terms of the Apache-2.0 license. PelletPilot's own code
is MIT; this third-party file retains its original Apache-2.0 license. If you prefer not to
vendor it, delete it and fetch at build time:

```bash
curl -sL https://raw.githubusercontent.com/dknowles2/pytboss/main/pytboss/grills.json \
  -o reference/grills.json
```

PelletPilot is an independent project and is not affiliated with pytboss.
