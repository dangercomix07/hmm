## Progress
- Traced intermittent UART framing errors to a shared buffer lifetime.
- Moved ownership into the receiver and added a regression test.
## Evidence
- The recorded failing trace now passes the parser test; the hardware run is still pending.
## Blockers
- The bench is occupied until tomorrow.
## Next steps
- Replay the trace on the board when the bench becomes available.
