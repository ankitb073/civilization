# 0003: Decade steps for slow systems, a yearly loop for politics and war

**Context.** The brief says to step forward century by century. But territorial changes must be logged in strict chronological order, or the map and the checker disagree. Early versions mixed decade-level and year-level changes, and that produced revolutionaries executed before their own revolution.

**Decision.**
- Centuries are the database checkpoint unit.
- Each century runs ten decade steps:
  - Climate, population, settlements, technology and economy run at decade level.
  - Inside each decade, a yearly loop runs government change, diplomacy, succession, revolts, war and expansion.
- Religion and culture changes are logged after the yearly loop.
- Every state change goes through an event with causes that are no later than the event.

**Why.**
- Every log stays monotonic in time.
- Replaying the logs reproduces the final map exactly.
- The checker can prove it.
