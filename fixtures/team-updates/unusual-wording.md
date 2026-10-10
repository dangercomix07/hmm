### What changed
- The intermittent boot gremlin was a stale pointer; reproduced it and pinned down its owner.
### Observations
- The same trace fails before the fix and passes after it.
### Up next
- Chek the pointer lifetime during shutdown too.
